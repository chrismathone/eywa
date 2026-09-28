import "server-only";

/**
 * **월간계획 대비 현황** — 한 달 동안 선생님별로 실제 수업이 원래 월간계획과 얼마나 달랐나(원장 2026-09-28
 * *"월간계획과 선생님별 실제계획과 어느정도 틀린지 월별로 바로바로 볼수있는 페이지"*).
 *
 * 🔑 판정은 [`compareCell`](../plan-compare.ts) 단일 소스 — 주간·달력의 [계획 비교] 모달과 같은 답이다.
 * 🔑 기준은 **원래 계획**(미루기 미반영) — 미루면 그만큼 '늦음'으로 잡힌다(그게 이 페이지가 보여 줄 사실이다).
 * 🔑 선생님 = 그 **교시의 담당**(주간 시트·월간 달력과 같은 순서: 시간표 라벨 → 교시 담당 → 담임).
 *    담임으로만 묶으면 원어민이 들어가는 교시가 담임 몫으로 잡힌다.
 * 🔴 분모는 **지난 칸**(오늘 포함)뿐 — 아직 안 온 칸을 미작성으로 세면 월초엔 모두가 나빠 보인다.
 * 🔴 반 목록은 ECS 랜딩과 같은 스코프(`ecsVisibleClassFilter`) — 강사는 자기가 볼 수 있는 반만 보인다.
 * ⚠️ 배정(0266a)이 없거나 조회가 실패하면 **빈 현황 + 사유**를 돌려준다(throw하지 않는다, [[#95]]).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstMonth, kstToday, monthRange } from "@/lib/date-kst";
import { getTeacherLabelMap } from "@/features/timetable/server/queries";
import { resolveTeacherLabel } from "@/features/timetable/lib/teacher-label";
import { ecsVisibleClassFilter } from "@/features/class-sheets/server/access";
import { normalizeMonth, rangeDates } from "@/features/class-sheets/lib/month";
import { slotKey, slotsByDateOf, type MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { addToTally, compareCell, emptyTally, mergeTally, type CellVerdict, type CompareTally } from "../plan-compare";
import { loadPlanMaterials, planCellsOf } from "./month-plan";

export type PlanGapCell = { date: string; slotStart: string; verdict: CellVerdict; lag: number };

export type PlanGapClassRow = {
  classId: string;
  className: string;
  tally: CompareTally;
  /** 어긋난 칸(늦음·빠름·다름·미작성)만 — 날짜순. 표에서 펼쳐 볼 재료. */
  misses: PlanGapCell[];
};

export type PlanGapTeacherRow = {
  teacher: string;
  tally: CompareTally;
  classes: PlanGapClassRow[];
};

export type PlanGapResult =
  | {
      ok: true;
      month: string;
      today: string;
      teachers: PlanGapTeacherRow[];
      total: CompareTally;
      /** 배정이 있는 반 수(스코프 안). 0이면 화면이 "배정된 월간계획이 없다"고 말한다. */
      classCount: number;
    }
  | { ok: false; error: string };

/** 담당을 모르는 교시의 묶음 이름 — 화면이 번역한다(키 문자열이라 DB 값과 안 겹친다). */
export const UNKNOWN_TEACHER = "__unknown__";

export async function getPlanGapBoard(monthRaw: string | null): Promise<PlanGapResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const tenantId = user.tenantId;
  const today = kstToday();
  const month = normalizeMonth(monthRaw, kstMonth());
  const { from, to } = monthRange(month);

  const visible = await ecsVisibleClassFilter();
  const materials = await loadPlanMaterials({ tenantId, classIds: visible.classIds, to });
  if (materials.status === "missing-table") return { ok: false, error: "교재 배정 준비가 아직 적용되지 않았습니다" };
  if (materials.status !== "ok") return { ok: false, error: "월간계획을 읽지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };

  const classIds = [...materials.byClass.entries()].filter(([, m]) => m.plans.length > 0).map(([id]) => id);
  if (classIds.length === 0) {
    return { ok: true, month, today, teachers: [], total: emptyTally(), classCount: 0 };
  }

  const admin = createAdminClient();
  let classRows: { id: string; class_name: string; teacher_id: string | null }[];
  let actualRows: {
    class_id: string;
    plan_date: string;
    slot_start: string;
    skill_area: string;
    textbook: string | null;
    progress: string | null;
  }[];
  try {
    [classRows, actualRows] = await Promise.all([
      fetchInChunks<{ id: string; class_name: string; teacher_id: string | null }>(classIds, (chunk) =>
        admin.from("classes").select("id, class_name, teacher_id").eq("tenant_id", tenantId).in("id", chunk),
      ),
      // 한 달 × 반 수십 개 = 수천 줄 — 페이지 순회로 전건(B2). `class_sheet_*`는 RLS 0개라 admin([[#104]]).
      fetchAllPagedInChunks(classIds, (chunk, f, t) =>
        admin
          .from("class_sheet_plan_lines")
          .select("id, class_id, plan_date, slot_start, skill_area, textbook, progress")
          .eq("tenant_id", tenantId)
          .eq("term_mode", "regular")
          .in("class_id", chunk)
          .gte("plan_date", from)
          .lte("plan_date", to)
          .order("id", { ascending: true })
          .range(f, t),
      ),
    ]);
  } catch {
    return { ok: false, error: "실제 수업계획을 읽지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  }

  // 담당 표시 이름 — 월간 달력과 **같은 순서**(라벨 → 교시 담당 FK → 담임). 이름 조회 실패는 삼킨다(표시용).
  const userIds = new Set<string>();
  for (const c of classRows) if (c.teacher_id) userIds.add(c.teacher_id);
  for (const id of classIds) {
    for (const r of materials.byClass.get(id)?.scheduleRows ?? []) {
      if (r.teacher_id) userIds.add(String(r.teacher_id));
    }
  }
  const [labelMap, userRows] = await Promise.all([
    getTeacherLabelMap({ supabase: admin, tenantId }).catch(() => undefined),
    fetchInChunks<{ id: string; display_name: string | null }>([...userIds], (chunk) =>
      admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk),
    ).catch(() => [] as { id: string; display_name: string | null }[]),
  ]);
  const nameOf = new Map(userRows.map((u) => [u.id, u.display_name ?? null]));

  const actualByCell = new Map<string, { skillArea: string; textbook: string | null; progress: string | null }[]>();
  for (const r of actualRows) {
    const key = `${r.class_id}#${slotKey(String(r.plan_date).slice(0, 10), String(r.slot_start))}`;
    const list = actualByCell.get(key) ?? [];
    list.push({ skillArea: String(r.skill_area), textbook: r.textbook ?? null, progress: r.progress ?? null });
    actualByCell.set(key, list);
  }

  const dates = rangeDates(from, to);
  const teacherMap = new Map<string, Map<string, PlanGapClassRow>>();
  const classById = new Map(classRows.map((c) => [c.id, c]));

  for (const classId of classIds) {
    const cls = classById.get(classId);
    const m = materials.byClass.get(classId);
    if (!cls || !m) continue;
    const homeroom = cls.teacher_id ? (nameOf.get(cls.teacher_id) ?? null) : null;
    // 교시 담당을 **표시 이름**으로 바꾼 시간표 — `slotsByDateOf`가 그 날 살아 있는 행의 담당을 골라 준다.
    const named: MonthScheduleRow[] = m.scheduleRows.map((r, i) => {
      const label = resolveTeacherLabel((r.slot_teacher_label as string | null) ?? null, labelMap);
      const fk = r.teacher_id ? (nameOf.get(String(r.teacher_id)) ?? null) : null;
      return { ...m.schedules[i]!, slotTeacherLabel: label ?? fk ?? homeroom };
    });
    const slots = slotsByDateOf(dates, named);
    const { baselineByCell, lessonIndex } = planCellsOf(materials, classId, from, to);

    for (const [key, baseline] of Object.entries(baselineByCell)) {
      const [date, slotStart] = key.split("|") as [string, string];
      const c = compareCell({
        baseline,
        actual: actualByCell.get(`${classId}#${key}`) ?? [],
        lessonIndex,
        isFuture: date > today,
      });
      const slot = (slots[date] ?? []).find((s) => s.slotStart === slotStart);
      const teacher = slot?.teacherLabel ?? homeroom ?? UNKNOWN_TEACHER;
      const byClass = teacherMap.get(teacher) ?? new Map<string, PlanGapClassRow>();
      teacherMap.set(teacher, byClass);
      const row = byClass.get(classId) ?? { classId, className: cls.class_name, tally: emptyTally(), misses: [] };
      byClass.set(classId, row);
      addToTally(row.tally, c);
      if (c.verdict !== "match" && c.verdict !== "upcoming" && c.verdict !== "noPlan") {
        row.misses.push({ date, slotStart, verdict: c.verdict, lag: c.lag });
      }
    }
  }

  const total = emptyTally();
  const teachers: PlanGapTeacherRow[] = [...teacherMap.entries()].map(([teacher, byClass]) => {
    const tally = emptyTally();
    const classes = [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className, "ko"));
    for (const c of classes) {
      c.misses.sort((a, b) => (a.date === b.date ? a.slotStart.localeCompare(b.slotStart) : a.date.localeCompare(b.date)));
      mergeTally(tally, c.tally);
    }
    mergeTally(total, tally);
    return { teacher, tally, classes };
  });
  // 어긋난 칸이 많은 선생님이 위로 — 이 페이지는 "어디가 얼마나 틀렸나"를 보러 오는 곳이다.
  const misses = (t: CompareTally) => t.due - t.match;
  teachers.sort((a, b) => misses(b.tally) - misses(a.tally) || a.teacher.localeCompare(b.teacher, "ko"));

  return { ok: true, month, today, teachers, total, classCount: classIds.length };
}
