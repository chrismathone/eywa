import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DutyItemView, DutyKind, DutyPeriod, DutyStatus } from "../kinds";
import type { DutyWeekCell } from "../view";

/**
 * 의무 장부 조회 — 표는 서버 전용(s2_0041 정책 0개)이라 관리 키로 읽는다. 🔴 모든 조회에 지점(tenant_id) 조건 —
 * 사람 확인(내 것 / 현황 권한)은 부르는 쪽이 `getStaffTaskViewer`로 먼저 한다(할 일과 같은 문).
 */
export type DutyCount = { ownerId: string | null; kind: string; period: DutyPeriod; total: number; done: number; late: number };

/** 담당자(없으면 전원) × 종류 집계 — 회차 창(날짜 범위) 안. DB가 센다(B2). */
export async function countDuties(tenantId: string, ownerId: string | null, from: string, to: string): Promise<DutyCount[]> {
  const { data, error } = await createAdminClient().rpc("duty_counts", { p_tenant: tenantId, p_owner: ownerId, p_from: from, p_to: to });
  if (error) throw new Error(`의무 집계: ${error.message}`);
  return ((data ?? []) as { owner_id: string | null; kind: string; period: DutyPeriod; total: number; done: number; late: number }[])
    .map((r) => ({ ownerId: r.owner_id, kind: r.kind, period: r.period, total: Number(r.total), done: Number(r.done), late: Number(r.late) }));
}

/** 접은 숫자 — 강사 홈 한 줄("오늘 내 업무 14/22 · 기한 초과 2"). void는 total에 안 든다. */
export function foldCounts(rows: readonly DutyCount[]): { total: number; done: number; late: number } {
  return rows.reduce((acc, r) => ({ total: acc.total + r.total, done: acc.done + r.done, late: acc.late + r.late }), { total: 0, done: 0, late: 0 });
}

type ItemRow = {
  id: string; kind: string; period: DutyPeriod; cycle: string; status: DutyStatus; due_at: string; done_at: string | null; void_reason: string | null; student_id: string | null; class_id: string | null; subject: string | null; escalation: number;
  student: { name: string | null; school: string | null; grade: string | null } | { name: string | null; school: string | null; grade: string | null }[] | null;
  class: { class_name: string | null } | { class_name: string | null }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const COLS = "id,kind,period,cycle,status,due_at,done_at,void_reason,student_id,class_id,subject,escalation,student:students!duty_items_student_id_fkey(name,school,grade),class:classes!duty_items_class_id_fkey(class_name)";
const toView = (r: ItemRow): DutyItemView => {
  const st = one(r.student);
  return { id: r.id, kind: r.kind as DutyKind, period: r.period, cycle: r.cycle, status: r.status, dueAt: r.due_at, doneAt: r.done_at, voidReason: r.void_reason,
    studentId: r.student_id, studentName: st?.name ?? null, school: st?.school ?? null, grade: st?.grade ?? null,
    classId: r.class_id, className: one(r.class)?.class_name ?? null, subject: r.subject, escalation: r.escalation };
};
/** void는 빼되 기한 지남 확정(expired)은 미완으로, 결석(absent)은 "결석"으로 보이게 싣는다. 집계(weekCells)는 expired만 센다. */
const VISIBLE = "status.neq.void,void_reason.eq.expired,void_reason.eq.absent";

/** 한 사람의 그날(일간 회차) 의무 목록 — 학생 이름·학교·학년·반 이름을 붙여 내려준다(임베드는 FK 이름 명시 · #94). */
export async function listOwnerDuties(tenantId: string, ownerId: string, cycle: string): Promise<DutyItemView[]> {
  const { data, error } = await createAdminClient().from("duty_items").select(COLS)
    .eq("tenant_id", tenantId).eq("owner_id", ownerId).eq("period", "daily").eq("cycle", cycle).or(VISIBLE)
    .order("kind").order("due_at").limit(1000);
  if (error) throw new Error(`의무 목록: ${error.message}`);
  return ((data ?? []) as unknown as ItemRow[]).map(toView);
}

/** 한 사람의 이번 달 의무(월간 회차 = 그 달) + 건별 의무(신규생 콜 — 열린 것과 이번 달에 끝난 것). */
export async function listOwnerMonthDuties(tenantId: string, ownerId: string, month: string): Promise<DutyItemView[]> {
  const admin = createAdminClient();
  const [monthly, cases] = await Promise.all([
    admin.from("duty_items").select(COLS).eq("tenant_id", tenantId).eq("owner_id", ownerId).eq("period", "monthly").eq("cycle", month).or(VISIBLE).order("kind").limit(1000),
    admin.from("duty_items").select(COLS).eq("tenant_id", tenantId).eq("owner_id", ownerId).eq("period", "case").or(VISIBLE)
      .or(`status.eq.open,done_at.gte.${month}-01T00:00:00+09:00`).order("due_at").limit(1000),
  ]);
  if (monthly.error) throw new Error(`이번 달 의무: ${monthly.error.message}`);
  if (cases.error) throw new Error(`건별 의무: ${cases.error.message}`);
  return [...((monthly.data ?? []) as unknown as ItemRow[]), ...((cases.data ?? []) as unknown as ItemRow[])].map(toView);
}

/** 최근 며칠의 학생별 완료 비율 재료(학생 × 날 · 전체/완료) — 카드의 '최근 7일' 띠. 한 사람 × 7일이라 작다(상한 5,000행). */
export async function weekCells(tenantId: string, ownerId: string, from: string, to: string): Promise<DutyWeekCell[]> {
  const { data, error } = await createAdminClient().from("duty_items").select("cycle,status,student_id,class_id,void_reason,kind,due_at,student:students!duty_items_student_id_fkey(name),class:classes!duty_items_class_id_fkey(class_name)")
    .eq("tenant_id", tenantId).eq("owner_id", ownerId).eq("period", "daily").gte("cycle", from).lte("cycle", to).or(VISIBLE).limit(5000);
  if (error) throw new Error(`의무 주간: ${error.message}`);
  const out = new Map<string, DutyWeekCell>();
  const now = Date.now();
  type WeekRowRaw = { cycle: string; status: DutyStatus; void_reason: string | null; student_id: string | null; class_id: string | null; kind: string; due_at: string;
    student: { name: string | null } | { name: string | null }[] | null; class: { class_name: string | null } | { class_name: string | null }[] | null };
  for (const r of (data ?? []) as unknown as WeekRowRaw[]) {
    if (r.status === "void" && r.void_reason !== "expired") continue;
    const studentKey = r.student_id ?? `class:${r.class_id}`;
    // 칸 = 학생 × 반 × 날(같은 학생이 두 반을 들으면 반마다 줄).
    const key = `${studentKey}|${r.class_id ?? ""}|${r.cycle}`;
    const c = out.get(key) ?? { day: r.cycle, studentKey, total: 0, done: 0, kinds: [], studentName: one(r.student)?.name ?? null, classId: r.class_id, className: one(r.class)?.class_name ?? null };
    c.total++;
    if (r.status === "done") c.done++;
    c.kinds!.push({ kind: r.kind, state: r.status === "done" ? "done" : Date.parse(r.due_at) < now ? "late" : "open" });
    out.set(key, c);
  }
  return [...out.values()];
}

/** 반이 수업하는 요일(그 주에 살아 있는 배치) — 주간 표의 '예정'을 수업 있는 요일에만 적는다(원장 2026-11-10). */
export async function classWeekdays(tenantId: string, classIds: readonly string[], weekStart: string, weekEnd: string): Promise<Record<string, string[]>> {
  if (!classIds.length) return {};
  const { fetchInChunks } = await import("@/lib/supabase/batch");
  const rows = await fetchInChunks<{ class_id: string; day_of_week: string }>([...new Set(classIds)], (chunk) =>
    createAdminClient().from("class_schedules").select("class_id,day_of_week").eq("tenant_id", tenantId).in("class_id", chunk)
      .or(`valid_from.is.null,valid_from.lte.${weekEnd}`).or(`valid_to.is.null,valid_to.gte.${weekStart}`));
  const out: Record<string, Set<string>> = {};
  for (const r of rows) (out[r.class_id] ??= new Set()).add(r.day_of_week);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/** 학생 × 반의 등원 요일 = 반 수업 요일 ∩ 수강의 분리등원 요일(없으면 전부) — 주간 표 '등원 요일' 열(원장 2026-11-10). 열쇠 `<학생>|<반>`. */
export async function studentWeekdays(tenantId: string, classIds: readonly string[], classDays: Record<string, string[]>): Promise<Record<string, string[]>> {
  if (!classIds.length) return {};
  const { fetchInChunks } = await import("@/lib/supabase/batch");
  const rows = await fetchInChunks<{ student_id: string; class_id: string; attendance_days: string[] | null; end_date: string | null }>([...new Set(classIds)], (chunk) =>
    createAdminClient().from("enrollments").select("student_id,class_id,attendance_days,end_date").eq("tenant_id", tenantId).in("class_id", chunk));
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const base = classDays[r.class_id] ?? [];
    const days = r.attendance_days?.length ? base.filter((d) => r.attendance_days!.includes(d)) : base;
    out[`${r.student_id}|${r.class_id}`] = days;
  }
  return out;
}
