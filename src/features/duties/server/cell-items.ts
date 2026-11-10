import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import { cellItemState, type CellItem } from "../cell-items";
import type { DutyAdminScope } from "../view-admin";
import { monthHref } from "../view-month";

export type CellFilter = { studentId: string; kind: string | null; classId: string | null; /** 반 없는 의무만(신규생 정착 줄). */ classNone: boolean; owner: string | null; ownerNone: boolean; subject: string | null; subjectNone: boolean };
type Row = { id: string; kind: string; period: string; cycle: string; status: string; void_reason: string | null; due_at: string; done_at: string | null; owner_id: string | null; student_id: string | null; class_id: string | null; subject: string | null;
  class: { class_name: string | null } | { class_name: string | null }[] | null };

/**
 * 학생 표의 칸 하나(학생 × 반 × 종류)가 센 의무들 — 집계(`duty_rollup_student`)와 **같은 창 · 같은 범위**로 장부를 직접 읽는다:
 * 기간 창(일간 = 수업일 · 월간 = 달 · 건별 = 기한일이 그 달 안) · void는 미이행 확정만 · 평가 개시 전 기한은 기간이 통째로 개시 전일 때만 · 과목 범위 · '담당' 권한이면 본인 것만.
 * 바로가기 = 실제 기록이 있는 화면(출결 → 그날 그 반 출석부 · 끝낸 월 상담 → 그 상담 기록 · 월말평가 → 성적 입력 칸). 갈 화면이 마땅치 않으면 null(줄만).
 */
export async function loadDutyCellItems(tenantId: string, from: string, to: string, scope: DutyAdminScope, periods: string[] | null, f: CellFilter): Promise<CellItem[]> {
  const admin = createAdminClient();
  const { data: st, error: stError } = await admin.from("duty_settings").select("live_from").eq("tenant_id", tenantId).maybeSingle();
  if (stError) throw new Error(`장부 설정: ${stError.message}`);
  const live = (st?.live_from as string | null) ?? null;
  const liveDay = live ? new Date(Date.parse(live) + 9 * 3_600_000).toISOString().slice(0, 10) : null;
  const monthEnd = `${addDays(`${to.slice(0, 7)}-01`, 32).slice(0, 7)}-01`; // 다음 달 1일
  const window = [
    `and(period.eq.daily,cycle.gte.${from},cycle.lte.${to})`,
    `and(period.eq.monthly,cycle.gte.${from.slice(0, 7)},cycle.lte.${to.slice(0, 7)})`,
    `and(period.eq.case,due_at.gt.${from}T00:00:00+09:00,due_at.lte.${monthEnd}T00:00:00+09:00)`,
  ].filter((w) => !periods || periods.some((p) => w.includes(`period.eq.${p},`)));
  const rows = await fetchAllPaged<Row>((a, b) => {
    let q = admin.from("duty_items").select("id,kind,period,cycle,status,void_reason,due_at,done_at,owner_id,student_id,class_id,subject,class:classes!duty_items_class_id_fkey(class_name)")
      .eq("tenant_id", tenantId).eq("student_id", f.studentId).or("status.neq.void,void_reason.eq.expired").or(window.join(","));
    if (live && !(liveDay && to < liveDay)) q = q.gte("due_at", live);
    if (scope.subjects) q = q.in("subject", scope.subjects);
    if (scope.ownerId) q = q.eq("owner_id", scope.ownerId); else if (f.ownerNone) q = q.is("owner_id", null); else if (f.owner) q = q.eq("owner_id", f.owner);
    if (f.kind) q = q.eq("kind", f.kind);
    if (f.classNone) q = q.is("class_id", null); else if (f.classId) q = q.eq("class_id", f.classId);
    if (f.subjectNone) q = q.is("subject", null); else if (f.subject) q = q.eq("subject", f.subject);
    return q.order("due_at").order("id").range(a, b);
  });
  // 끝낸 월 상담 → 그 달 그 담당이 쓴 상담 기록(가장 이른 것 — 의무를 닫은 기록).
  const counsel = rows.filter((r) => r.kind === "counsel_monthly" && r.status === "done" && r.owner_id);
  const consultOf = new Map<string, string>();
  if (counsel.length) {
    const months = [...new Set(counsel.map((r) => r.cycle))].sort();
    const next = `${addDays(`${months[months.length - 1]}-01`, 32).slice(0, 7)}-01`;
    const { data, error } = await admin.from("student_consultations").select("id,counselor_id,consulted_at").eq("tenant_id", tenantId).eq("student_id", f.studentId).not("processing_status", "in", "(uploaded,transcribing,analyzing)")
      .gte("consulted_at", `${months[0]}-01T00:00:00+09:00`).lt("consulted_at", `${next}T00:00:00+09:00`).order("consulted_at").limit(500);
    if (error) throw new Error(`상담 기록: ${error.message}`);
    for (const c of (data ?? []) as { id: string; counselor_id: string | null; consulted_at: string }[]) {
      const key = `${new Date(Date.parse(c.consulted_at) + 9 * 3_600_000).toISOString().slice(0, 7)}|${c.counselor_id ?? ""}`;
      if (!consultOf.has(key)) consultOf.set(key, c.id);
    }
  }
  const now = Date.now();
  return rows.map((r): CellItem => {
    const cls = Array.isArray(r.class) ? r.class[0] ?? null : r.class;
    const consult = r.kind === "counsel_monthly" ? consultOf.get(`${r.cycle}|${r.owner_id ?? ""}`) : undefined;
    const href = r.kind === "attendance" && r.class_id ? `/attendance/${r.cycle}/${r.class_id}`
      : consult ? `/consultations/${consult}`
      : r.kind === "exam_monthly" ? monthHref({ kind: r.kind, studentId: r.student_id, classId: r.class_id, cycle: r.cycle, subject: r.subject })
      : null;
    return { id: r.id, kind: r.kind, period: r.period, cycle: r.cycle, state: cellItemState({ status: r.status, voidReason: r.void_reason, dueAt: r.due_at, doneAt: r.done_at }, now),
      dueAt: r.due_at, doneAt: r.done_at, className: cls?.class_name ?? null, href };
  });
}
