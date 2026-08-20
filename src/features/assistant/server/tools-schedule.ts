import "server-only";
// AI 비서 일정 툴 2종(시간표·캘린더, 2026-08-20 권한 커버리지 배선) — 기존 features/timetable·calendar
// 조회 함수의 **read-only 래핑**(새 쿼리 없음). 쿠키 세션 createClient 경유 → RLS 자동 상속 +
// 메뉴 게이트(tool-gate) — 시간표·캘린더를 못 여는 사람은 비서로도 못 본다(#77).
//
// 왜 이 둘인가: 12메뉴 대비 "권한은 있는데 물어보면 못 답하던" 구멍 중 **매일 묻는 것**이라서다
// ("오늘 몇 시에 무슨 반이야?", "이번 달 학원 일정 뭐 있어?"). 성적·교재요청·셔틀은 아직 구멍으로
// 남겨 뒀다(docs/changelog 2026-08-20 표) — 툴이 늘면 프롬프트가 길어지고 라운드가 늘어난다.

import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  getTodaySchedule,
  getWeeklySchedule,
  type ScheduleSlot,
  type TodaySlot,
} from "@/features/timetable/server/queries";
import { getMonthEvents } from "@/features/calendar/server/queries";
import { eventTimeLabel } from "@/features/calendar/types";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { DAY_LABEL, subjectLabeler } from "./labels";
import { requireMenu } from "./tool-gate";

/** 한 번에 모델에게 넘길 슬롯 상한(툴 결과 토큰 방어) — 하루치는 보통 이 안에 든다. */
const SLOT_CAP = 60;
/** 한 달 일정 상한 — 넘치면 앞에서부터(날짜순) 자르고 note로 밝힌다. */
const EVENT_CAP = 40;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** 오늘(KST)의 요일 키 — 서버가 UTC라 new Date().getDay()는 새벽에 어제가 된다(timetable과 같은 규약). */
function todayDayKey(): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${kstToday()}T00:00:00Z`).getUTCDay()
  ]!;
}

const SLOT_STATUS_LABEL: Record<TodaySlot["status"], string> = {
  done: "종료",
  ongoing: "진행 중",
  upcoming: "예정",
};

/** 하루치 슬롯 — 오늘은 진행 상태가 붙고, 다른 요일은 붙지 않는다(같은 모양으로 좁혀 다룬다). */
type DaySlot = ScheduleSlot & { status?: TodaySlot["status"] };

/**
 * 그 요일의 배치. 다른 요일은 주간 시간표에서 고른다 — `getWeeklySchedule`이 이미 **요일 칸의 실제
 * 날짜**로 유효성을 걸러 주므로(fetchSlots → slotLiveOnDate) 배치가 바뀐 주에도 칸이 두 번 나오지
 * 않는다([[#88]]·2026-08-04 행 분할 규약). 여기서 다시 거르지 말 것.
 */
async function loadDaySlots(target: string, today: string): Promise<DaySlot[]> {
  if (target === today) return getTodaySchedule();
  const all = await getWeeklySchedule();
  return all.filter((s) => s.dayOfWeek === target);
}

export const timetableDayTool = betaZodTool({
  name: "get_timetable_day",
  description:
    "요일별 시간표 배치(반·과목·담당 강사·강의실·시작/종료 시각·수강생 수)를 돌려준다. 오늘은 진행 상태(종료/진행 중/예정)도 함께. '오늘 시간표 어때?', '수요일에 무슨 반 있어?', '○○ 선생님 오늘 몇 시 수업이야?' 류 질문에 사용. 특정 반의 시간표만 필요하면 get_class_detail이 더 적합하다.",
  inputSchema: z.object({
    day: z
      .enum(DAY_KEYS)
      .optional()
      .describe("요일(mon~sun). 미지정 시 오늘(KST). 사용자가 요일을 말했을 때만 지정"),
    teacher: z.string().optional().describe("담당 강사 이름(부분 일치)으로 좁힌다"),
  }),
  run: async ({ day, teacher }) => {
    const denied = await requireMenu("timetable", "시간표");
    if (denied) return denied;
    const today = todayDayKey();
    const target = day ?? today;
    // 라벨러와 슬롯 조회는 서로 독립 — 병렬(B4).
    const [label, slots] = await Promise.all([subjectLabeler(), loadDaySlots(target, today)]);
    const term = teacher?.trim() ?? "";
    // ⚠️ 칸 라벨과 반 담임을 **둘 다** 본다 — 칸 라벨은 닉네임·방 이름(LAB·JJ)일 수 있어서, 그것만
    // 보면 실제 담당 강사 이름으로 물었을 때 그 사람 수업이 통째로 안 나온다.
    const filtered = term
      ? slots.filter((s) => [s.slotTeacherLabel, s.teacherName].some((v) => (v ?? "").includes(term)))
      : slots;
    const shown = filtered.slice(0, SLOT_CAP);
    return JSON.stringify({
      day: DAY_LABEL[target] ?? target,
      isToday: target === today,
      date: target === today ? kstToday() : undefined,
      total: filtered.length,
      shown: shown.length,
      // 세는 단위를 못박는다 — 같은 반이 하루 두 교시면 2다. 안 적으면 모델이 "수업 N개"로 옮긴다.
      unit: "수업 칸(같은 반이 하루에 두 교시면 2로 셉니다)",
      note:
        filtered.length > shown.length
          ? `${filtered.length}개 중 앞에서 ${shown.length}개만 표시했습니다. teacher로 좁혀 다시 호출하세요.`
          : undefined,
      teacherFilter: term || undefined,
      slots: shown.map((s) => {
        // 🔴 칸 라벨이 자리(LAB·JJ)면 **사람이 아니라 방**이다 — teacher 자리에 넣으면 모델이
        //    "LAB 선생님"이라고 답한다(자리는 계정도 없다, teacher-label.ts 🔴).
        const seat = specialSlotLabel(s.slotTeacherLabel);
        return {
          classId: s.classId,
          className: s.className,
          subject: label(s.subject) ?? s.subject,
          // 칸 단위 라벨이 있으면 그게 실제 담당(반 기본 담임을 덮어쓴다 — 시간표 화면과 같은 우선순위).
          teacher: seat ? null : (s.slotTeacherLabel ?? s.teacherName),
          seat, // 자리 교시면 방 이름(LAB·JJ), 아니면 null
          classroom: s.slotRoomLabel ?? s.classroomName,
          start: s.startTime.slice(0, 5),
          end: s.endTime.slice(0, 5),
          studentCount: s.studentCount,
          status: s.status ? SLOT_STATUS_LABEL[s.status] : undefined,
        };
      }),
    });
  },
});

export const calendarEventsTool = betaZodTool({
  name: "get_calendar_events",
  description:
    "학원 캘린더의 월별 일정(제목·기간·시간·분류·등록자)을 돌려준다. 승인된 휴가도 함께 표시된다. '이번 달 일정 뭐 있어?', '다음 주에 학원 행사 있나?' 류 질문에 사용.",
  inputSchema: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("YYYY-MM. 미지정 시 이번 달(KST)"),
  }),
  run: async ({ month }) => {
    const denied = await requireMenu("calendar", "캘린더 일정");
    if (denied) return denied;
    const target = month ?? kstMonth();
    const { ready, events } = await getMonthEvents(target);
    // 표가 아직 없는 배포(0218a 전)에서도 조용히 "일정 없음"이라 답하지 않게 사실을 그대로 넘긴다.
    if (!ready) return JSON.stringify({ month: target, error: "캘린더 기능이 아직 준비되지 않았습니다." });
    const shown = events.slice(0, EVENT_CAP);
    return JSON.stringify({
      month: target,
      total: events.length,
      shown: shown.length,
      note:
        events.length > shown.length
          ? `${events.length}건 중 앞에서 ${shown.length}건만 표시했습니다. 이 목록만 보고 "전부"라고 답하지 마세요.`
          : undefined,
      events: shown.map((e) => ({
        title: e.title,
        // 하루짜리는 시작일만(같은 날짜를 두 번 적으면 모델이 "이틀"로 서술한다).
        date: e.startDate === e.endDate ? e.startDate : `${e.startDate} ~ ${e.endDate}`,
        time: eventTimeLabel(e),
        kind: e.source === "leave" ? "휴가" : (e.tag?.name ?? "학원 일정"),
        memo: e.memo,
        createdBy: e.createdByName,
      })),
    });
  },
});
