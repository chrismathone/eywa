import "server-only";

/**
 * **월간계획** — 그 반의 교재 배정에서 *계산해* 낸다. 🔴 **저장하지 않는다.**
 *
 * 원장 2026-09-22: *"영어강사시트 실제(강사가 실제나간 진도)와 월간계획 이렇게 나눠서 쓰고싶음 …
 * 기본적으로 월간계획에서 교재배정을 해놓고 그걸 각자 월간계획에서 가저오기 해서 실제수업에서
 * 변동사항이 있으면 변경 후 사용가능하도록"*.
 *
 * 🔑 **계획은 파생값이다**(원장 선택 2026-09-22, "표 신설 없음") — 배정 한 건(`class_textbook_plans`)이
 *    곧 그 반의 월간계획이고, 여기서 (날짜, 교시) → 차수로 펼친다. 그래서 배정을 고치면 계획이
 *    **즉시 따라오고**, 계획과 배정이 어긋나는 상태 자체가 없다(저장했다면 반드시 생겼을 문제다).
 * 🔴 **실제와 섞지 않는다** — 실제는 `class_sheet_plan_lines` 하나뿐이고, 계획이 거기 들어가는 길은
 *    사람이 누르는 [가져오기]뿐이다(`importPlannedSlot`). 배정만으로 실제가 채워지면 작성률이
 *    "계획을 세웠다"만으로 올라 *"강사가 실제 나간 진도"*라는 말이 거짓이 된다.
 * 🔑 배분 규칙은 [`buildLessonSchedule`](../lesson-schedule.ts) **한 곳**을 그대로 탄다 — 미리보기·계획·
 *    가져오기가 같은 함수를 써야 세 화면이 같은 답을 낸다.
 * ⚠️ 0266a/0268a 미적용이어도 **절대 throw하지 않는다**([[#95]]) — 영어 강사 전원이 매일 여는 화면이
 *    이걸 읽는다. 못 읽으면 계획이 빈 채로 시트가 그대로 돈다.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { buildLessonSchedule, MAX_LOOKAHEAD_DAYS } from "../lesson-schedule";
import type { LessonPace, SlotAxis } from "../lesson-schedule";
import { isMissingTextbookTable } from "./access";
import type { TextbookTableStatus } from "../types";

/** 계획 한 줄 — 그 날 그 교시에 **오기로 되어 있는** 차수. 실제 줄(`class_sheet_plan_lines`)이 아니다. */
export type PlannedLine = {
  /** 몇 차수인가(교재의 N차수). */
  lessonNo: number;
  date: string;
  /** `"HH:MM"` — 계획 줄 `slot_start`와 같은 표기. */
  slotStart: string;
  /** 구분(vocab·writing…) — 실제 줄의 `skill_area`와 같은 값이라 가져오기가 줄을 맞춰 넣는다. */
  skillArea: string;
  title: string;
  pageTime: string | null;
  progress: string | null;
  homework: string | null;
  termMode: "regular" | "exam";
};

export type MonthPlanResult = {
  status: TextbookTableStatus;
  /** `"YYYY-MM-DD|HH:MM"` → 그 칸에 올 계획 줄(구분·교재명 순). */
  byCell: Record<string, PlannedLine[]>;
};

const EMPTY: MonthPlanResult = { status: "ok", byCell: {} };

/** `class_textbook_plans` 한 줄이 계산에 필요로 하는 것만. */
type PlanRow = {
  textbook_id: string;
  slot_axis: string;
  pace: string;
  term_mode: string;
  start_date: string;
  start_lesson_no: number;
  slot_picks?: unknown;
};

const BASE_COLS = "textbook_id, slot_axis, pace, term_mode, start_date, start_lesson_no";

/** 며칠 앞까지 훑을지 — 달 끝까지 닿기만 하면 된다(상한은 스케줄러와 같다). */
function lookaheadFor(startDate: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return MAX_LOOKAHEAD_DAYS;
  return Math.max(1, Math.min(MAX_LOOKAHEAD_DAYS, Math.floor(ms / 86_400_000) + 1));
}

/**
 * 그 반의 `[from, to]` 구간 월간계획.
 *
 * 🔴 **게이트는 호출부가 이미 걸었다** — 이 함수는 시트·월간 뷰가 반을 연 뒤에 부르는 읽기라
 *    `tenantId`를 인자로 받는다(admin 클라이언트는 RLS 우회라 필터가 곧 격리다).
 */
export async function getClassPlannedLines(input: {
  tenantId: string;
  /** 교시 라벨 표가 과목별이라 필요하다(`weekdayTableFor`) — 지금은 영어만 쓴다. */
  subject: string;
  classId: string;
  from: string;
  to: string;
}): Promise<MonthPlanResult> {
  const { tenantId, classId, from, to } = input;
  if (!from || !to || from > to) return EMPTY;
  const admin = createAdminClient();

  // 배정 목록 — 0268a 적용 전이면 `slot_picks` 없이 한 번 더(그 배정은 옛 축 방식으로 읽힌다, [[#95]]).
  const readPlans = (cols: string) =>
    admin
      .from("class_textbook_plans")
      .select(cols)
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .range(0, 199);
  let planRes: { data: unknown; error: { code?: string; message?: string } | null } = await readPlans(
    `${BASE_COLS}, slot_picks`,
  );
  if (planRes.error && (planRes.error.code === "42703" || planRes.error.code === "PGRST204")) {
    planRes = await readPlans(BASE_COLS);
  }
  // 🔴 표가 없거나(0266a 미적용) 실패면 **빈 계획**으로 돈다 — 시트를 죽이지 않는다.
  if (planRes.error) {
    return { status: isMissingTextbookTable(planRes.error) ? "missing-table" : "failed", byCell: {} };
  }
  const plans = ((planRes.data ?? []) as unknown as PlanRow[]) ?? [];
  if (plans.length === 0) return EMPTY;

  const bookIds = [...new Set(plans.map((p) => String(p.textbook_id)))];
  const [bookRes, lessonRows, settings, schedRes] = await Promise.all([
    admin
      .from("textbooks")
      .select("id, title, page_time, skill_area, session_count")
      .eq("tenant_id", tenantId)
      .in("id", bookIds),
    // 차수는 교재마다 최대 200줄이라 청크 페이지 순회로 전건을 받는다(B2·B3).
    fetchAllPagedInChunks<{ textbook_id: string; lesson_no: number; progress: string | null; homework: string | null }>(
      bookIds,
      (chunk, f, t) =>
        admin
          .from("textbook_lessons")
          .select("textbook_id, lesson_no, progress, homework")
          .eq("tenant_id", tenantId)
          .in("textbook_id", chunk)
          .order("textbook_id", { ascending: true })
          .order("lesson_no", { ascending: true })
          .range(f, t),
    ).catch(() => null),
    getTenantSettings(),
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, slot_room_label")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true })
      .range(0, 499),
  ]);
  if (bookRes.error || schedRes.error) return { status: "failed", byCell: {} };
  // 🔴 차수 조회가 실패하면 **계획을 그리지 않는다** — 진도·과제가 빠진 계획을 보여 주면 강사가
  //    그걸 가져와 빈 칸을 채운 줄 알고 넘어간다(빈 계획이 거짓 계획보다 낫다).
  if (lessonRows === null) return { status: "failed", byCell: {} };

  const books = new Map(
    (bookRes.data ?? []).map((b) => [
      String(b.id),
      {
        title: String(b.title),
        pageTime: (b.page_time as string | null) ?? null,
        skillArea: (b.skill_area as string | null) ?? null,
        sessionCount: Number(b.session_count ?? 0),
      },
    ]),
  );
  const lessonsByBook = new Map<string, Map<number, { progress: string | null; homework: string | null }>>();
  for (const l of lessonRows) {
    const key = String(l.textbook_id);
    const m = lessonsByBook.get(key) ?? new Map();
    m.set(Number(l.lesson_no), { progress: l.progress ?? null, homework: l.homework ?? null });
    lessonsByBook.set(key, m);
  }

  const schedules = (schedRes.data ?? []).map(
    (r): MonthScheduleRow => ({
      dayOfWeek: String(r.day_of_week),
      startTime: String(r.start_time),
      endTime: r.end_time ? String(r.end_time) : null,
      validFrom: r.valid_from ? String(r.valid_from) : null,
      validTo: r.valid_to ? String(r.valid_to) : null,
      slotTeacherLabel: (r.slot_teacher_label as string | null) ?? null,
      slotRoomLabel: (r.slot_room_label as string | null) ?? null,
    }),
  );
  const holidays = buildHolidayMap(settings.operations.holidays);

  const byCell: Record<string, PlannedLine[]> = {};
  for (const p of plans) {
    const book = books.get(String(p.textbook_id));
    // 구분·차수가 없는 교재는 애초에 배정이 거절되지만, 나중에 지워졌을 수 있다 — 조용히 건너뛴다.
    if (!book || !book.skillArea || book.sessionCount < 1) continue;

    const startDate = String(p.start_date).slice(0, 10);
    // 달이 시작일보다 앞이면 그 달엔 계획이 없다(스케줄러는 시작일부터만 앉힌다).
    if (startDate > to) continue;

    const startNo = Math.max(1, Math.min(200, Number(p.start_lesson_no ?? 1)));
    const lessonNos: number[] = [];
    for (let n = startNo; n <= book.sessionCount; n += 1) lessonNos.push(n);
    if (lessonNos.length === 0) continue;

    const picks = Array.isArray(p.slot_picks) ? (p.slot_picks as unknown[]).map((v) => String(v)) : null;
    const schedule = buildLessonSchedule({
      startDate,
      lessonNos,
      schedules,
      holidays,
      axis: (p.slot_axis === "jj" ? "jj" : "class") as SlotAxis,
      slotPicks: picks,
      pace: (p.pace === "day" ? "day" : "period") as LessonPace,
      lookaheadDays: lookaheadFor(startDate, to),
    });

    const lessons = lessonsByBook.get(String(p.textbook_id));
    const termMode = p.term_mode === "exam" ? "exam" : "regular";
    for (const t of schedule.targets) {
      if (t.date < from || t.date > to) continue;
      const l = lessons?.get(t.lessonNo);
      const key = `${t.date}|${t.slotStart}`;
      (byCell[key] ??= []).push({
        lessonNo: t.lessonNo,
        date: t.date,
        slotStart: t.slotStart,
        skillArea: book.skillArea,
        title: book.title,
        pageTime: book.pageTime,
        progress: (l?.progress ?? null) || null,
        homework: (l?.homework ?? null) || null,
        termMode,
      });
    }
  }

  // 칸 안 순서를 고정한다 — 구분 → 교재명. 호출마다 줄 순서가 흔들리면 화면이 깜빡이고 비교가 안 된다.
  for (const key of Object.keys(byCell)) {
    byCell[key]!.sort((a, b) =>
      a.skillArea !== b.skillArea ? a.skillArea.localeCompare(b.skillArea) : a.title.localeCompare(b.title, "ko"),
    );
  }
  return { status: "ok", byCell };
}
