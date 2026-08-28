import type { PlanSlot } from "@/features/timetable-dev/types";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";

/**
 * 월별 **계획 슬롯**(0231a `timetable_plan_slots`) → 기존 시간표 격자가 먹는 모양(`ScheduleSlotWithStudents`).
 *
 * 🔴 왜 어댑터인가: 시간표(개발중)은 본 시간표 화면을 **그대로 복사**한 것이라, 격자·셀·hover·검색·집계가
 *    전부 `ScheduleSlotWithStudents`를 전제로 짜여 있다(복사본의 가치가 거기 있다). 계획 슬롯은 반 id와
 *    자리(요일·시각·강사/강의실 override)만 들고 있으므로, **반 메타(이름·과목·색·특강·프로그램)와 학생
 *    명단**은 현재 시간표 조회 결과에서 빌려 온다. 계획 표에 반 이름을 복사해 두지 않는 이유와 같다 —
 *    반 이름이 바뀌면 계획도 따라와야 한다(스냅샷은 조용히 낡는다).
 *
 * ⚠️ 이 함수는 **순수**다(DB·세션 없음). 조회는 호출부(page)가 하고 여기선 합치기만 한다.
 *
 * ⚠️ 학생 명단은 `class_id` 단위다(getWeeklyScheduleWithStudents가 반별 명단을 모든 슬롯에 같은 배열로
 *    붙인다) — 그래서 계획의 새 자리에도 그 반 명단을 그대로 붙이는 게 맞다.
 *
 * 🔴 **반 메타를 못 찾은 계획 칸은 조용히 버리지 않는다** — 개수를 함께 돌려주고 화면이 한 줄로 밝힌다.
 *    (이름·과목을 모르면 과목 칩·격자 어디에도 올릴 수 없다. 빈 화면이 "고장"으로 읽히는 것보다,
 *    "현재 시간표에 없는 반 N칸"이라고 말하는 편이 정직하다.)
 */

/** 반 단위로 한 번만 뽑아 두는 표시 재료 — 같은 반의 계획 칸이 여럿이라 매번 찾지 않는다. */
type ClassMeta = Pick<
  ScheduleSlotWithStudents,
  | "className"
  | "subject"
  | "teacherName"
  | "classroomName"
  | "classBgColor"
  | "classTextColor"
  | "classRoomId"
  | "isSpecialLecture"
  | "englishTrack"
  | "studentCount"
  | "students"
>;

export type PlanAdaptation = {
  /** 격자에 그릴 수 있는 칸(반 메타가 해결된 것만). */
  slots: ScheduleSlotWithStudents[];
  /** 반 메타를 못 찾아 격자에서 빠진 계획 칸 수. */
  unresolvedSlots: number;
  /** 그 칸들이 속한 반 수(문구에 쓴다 — "반 2개 · 6칸"). */
  unresolvedClasses: number;
};

/** DB의 'HH:MM:SS'와 계획의 'HH:MM'을 한 모양으로 — 격자 소비처는 전부 slice(0,5)라 어느 쪽도 안전하지만, 현 시간표와 같은 모양으로 내보내 비교·정렬이 갈리지 않게 한다. */
function withSeconds(t: string): string {
  return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function planSlotsToScheduleSlots(
  plan: readonly PlanSlot[],
  live: readonly ScheduleSlotWithStudents[],
): PlanAdaptation {
  const metaOf = new Map<string, ClassMeta>();
  for (const s of live) {
    if (metaOf.has(s.classId)) continue;
    metaOf.set(s.classId, {
      className: s.className,
      subject: s.subject,
      teacherName: s.teacherName,
      classroomName: s.classroomName,
      classBgColor: s.classBgColor,
      classTextColor: s.classTextColor,
      classRoomId: s.classRoomId,
      isSpecialLecture: s.isSpecialLecture,
      englishTrack: s.englishTrack,
      studentCount: s.studentCount,
      students: s.students,
    });
  }

  const slots: ScheduleSlotWithStudents[] = [];
  const unresolved = new Set<string>();
  let unresolvedSlots = 0;

  for (const p of plan) {
    const meta = metaOf.get(p.classId);
    if (!meta) {
      unresolved.add(p.classId);
      unresolvedSlots++;
      continue;
    }
    slots.push({
      // id는 **계획 슬롯 id** — 화면 키·hover 식별자로만 쓰인다(편집은 개발중 화면에서 꺼져 있다).
      id: p.id,
      classId: p.classId,
      className: meta.className,
      subject: meta.subject,
      dayOfWeek: p.dayOfWeek,
      startTime: withSeconds(p.startTime),
      endTime: withSeconds(p.endTime),
      // 담임 이름은 반 기본값. ⚠️ 계획의 **칸 단위 강사 override(`teacherId`)는 이름으로 못 푼다**
      // (id→이름 맵이 이 경로엔 없다) — 표시용 `slotTeacherLabel`이 있으면 그쪽이 우선이라 대부분의
      // 화면은 옳게 보인다. 라벨 없이 id만 있는 칸은 담임 이름으로 보인다(알려진 한계).
      teacherName: meta.teacherName,
      classroomName: meta.classroomName,
      studentCount: meta.studentCount,
      slotTeacherLabel: p.slotTeacherLabel,
      slotRoomLabel: p.slotRoomLabel,
      slotRoomId: p.classroomId,
      classRoomId: meta.classRoomId,
      classBgColor: meta.classBgColor,
      classTextColor: meta.classTextColor,
      // 인수인계 예약은 **운영 중인 반**의 사실이라 계획 칸엔 붙이지 않는다(미래 달 화면에 오늘의 예약
      // 틴트가 뜨면 "이 계획에 그런 일이 있다"는 거짓 신호가 된다).
      pendingHandover: null,
      isSpecialLecture: meta.isSpecialLecture,
      englishTrack: meta.englishTrack,
      students: meta.students,
    });
  }

  // 렌더 순서를 결정적으로(요일 → 시작시각 → 반 이름) — 계획 표의 반환 순서에 화면이 흔들리지 않게.
  slots.sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) ||
      a.startTime.localeCompare(b.startTime) ||
      a.className.localeCompare(b.className, "ko"),
  );

  return { slots, unresolvedSlots, unresolvedClasses: unresolved.size };
}
