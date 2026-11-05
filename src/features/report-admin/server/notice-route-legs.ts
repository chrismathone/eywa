import "server-only";

/**
 * 공지 삼자 일치(보내는 선생님 – 반 – 학생)의 **두 다리 재료** — 수학 반 보드 경로([`notice-class-route.ts`](./notice-class-route.ts))와
 * 영어 반 방 경로([`notice-english-route.ts`](./notice-english-route.ts))가 **같은 판정**을 쓴다(따로 구현하면 한쪽만 고쳐진다 — [[#112]]).
 *  · 학생 다리 = 그 학생이 **오늘 다니는 반**(시작 전·휴원·끝난 수강 제외 — 반이동 당일의 옛 반은 이미 아니다, [[#125]]).
 *  · 선생님 다리 = 그 반의 담임 ∪ 오늘 유효한 교시 담당 ∪ 오늘 위임.
 * ⚠️ admin 클라이언트 + tenant 필터(호출부가 넘긴다) — 강사 RLS로는 다른 강사 반의 수강·교시·위임 행이 안 보여 판정이 사람마다 달라진다.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { isDelegationActiveOn } from "@/features/classes/delegation-window";

type Admin = ReturnType<typeof createAdminClient>;
type EnrollmentRow = {
  id: string; class_id: string; student_id: string; start_date: string | null; end_date: string | null;
  is_transferred: boolean | null; on_hold: boolean | null;
};
type SlotRow = { id: string; class_id: string; teacher_id: string | null };
type DelegationRow = { class_id: string; delegate_user_id: string | null; from_date: string; to_date: string; revoked_at: string | null };

/** 학생 다리 조회 — 그 학생들의 수강 전부(학생 id 청크 × 페이징, B2·B3). 판정은 `attendingClassesOf`. */
export function studentLegQuery(admin: Admin, tenantId: string, studentIds: readonly string[]): Promise<EnrollmentRow[]> {
  return fetchAllPagedInChunks<EnrollmentRow>([...studentIds], (chunk, from, to) =>
    admin
      .from("enrollments")
      .select("id, class_id, student_id, start_date, end_date, is_transferred, on_hold")
      .eq("tenant_id", tenantId)
      .in("student_id", chunk)
      .order("id")
      .range(from, to),
  );
}

/** 학생 → 오늘 다니는 반(순수). 종료 규약은 단일 소스(`isEnrollmentEndedOn`) · 휴원·시작 전은 다니는 반이 아니다. */
export function attendingClassesOf(rows: readonly EnrollmentRow[], date: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of rows) {
    if (e.on_hold) continue;
    if (e.start_date && e.start_date > date) continue;
    if (isEnrollmentEndedOn(e.end_date, date, !!e.is_transferred)) continue;
    if (!out.has(e.student_id)) out.set(e.student_id, new Set());
    out.get(e.student_id)!.add(e.class_id);
  }
  return out;
}

/**
 * 선생님 다리 조회 두 벌(교시 담당 · 위임) — 호출부의 `Promise.all`에 펼쳐 넣는다(B4). 요청한 선생님들만 읽고, 선생님이 없으면 조회하지 않는다.
 * 교시 표는 이력을 함께 담는다 — 오늘 유효한 행만([[#88]]) · 반 id 청크 × 페이징(B2·B3).
 * 위임도 **오늘 걸친 행만** 읽는다(`from_date <= 오늘 <= to_date` — delegation-window.ts가 적은 SQL 규약). 지난 위임까지 다 읽으면 쌓일수록
 * 한 청크가 1,000행에서 잘려 오늘 위임이 빠질 수 있다(B2 · 리뷰 2026-11-04). 최종 판정은 그대로 `isDelegationActiveOn`.
 */
export function teacherLegQueries(
  admin: Admin,
  tenantId: string,
  classIds: readonly string[],
  teacherIds: readonly string[],
  date: string,
): [Promise<SlotRow[]>, Promise<DelegationRow[]>] {
  if (!teacherIds.length || !classIds.length) return [Promise.resolve([]), Promise.resolve([])];
  const ids = [...classIds];
  const teachers = [...teacherIds];
  return [
    fetchAllPagedInChunks<SlotRow>(ids, (chunk, from, to) =>
      admin
        .from("class_schedules")
        .select("id, class_id, teacher_id")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .in("teacher_id", teachers)
        .lte("valid_from", date)
        .or(`valid_to.is.null,valid_to.gte.${date}`)
        .order("id")
        .range(from, to),
    ),
    fetchInChunks<DelegationRow>(ids, (chunk) =>
      admin
        .from("class_delegations")
        .select("class_id, delegate_user_id, from_date, to_date, revoked_at")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .in("delegate_user_id", teachers)
        .is("revoked_at", null)
        .lte("from_date", date)
        .gte("to_date", date),
    ),
  ];
}

/** 반 → 그 반 담당(담임 ∪ 오늘 교시 담당 ∪ 오늘 위임) 중 **요청한 선생님들만**(순수). */
export function teachersByClass(a: {
  /** 후보 반(담임 = `teacher_id`). */
  classes: Iterable<{ id: string; teacher_id: string | null }>;
  slots: readonly SlotRow[];
  delegations: readonly DelegationRow[];
  teacherIds: readonly string[];
  date: string;
}): Map<string, Set<string>> {
  const wanted = new Set(a.teacherIds);
  const out = new Map<string, Set<string>>();
  const add = (classId: string, teacherId: string | null) => {
    if (!teacherId || !wanted.has(teacherId)) return;
    if (!out.has(classId)) out.set(classId, new Set());
    out.get(classId)!.add(teacherId);
  };
  for (const c of a.classes) add(c.id, c.teacher_id);
  for (const s of a.slots) add(s.class_id, s.teacher_id);
  for (const d of a.delegations)
    if (isDelegationActiveOn({ fromDate: d.from_date, toDate: d.to_date, revokedAt: d.revoked_at }, a.date)) add(d.class_id, d.delegate_user_id);
  return out;
}
