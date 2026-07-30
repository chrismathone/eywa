import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";

/**
 * 출석부 '강사 전체 보기'의 금액 열 — **급여 계산 재료**(원장 전용).
 *
 * ⚠️ 이 화면은 금액을 **반에 배분하지 않는다.** 청구서(invoices)는 학생×월 단위라 어느 반 몫인지가 데이터에
 * 없고(2026-07 실측: line_items에 과목 문자열이 401건 중 1건), 재원생 345명 중 **153명(44%)이 강사 2~3명에
 * 걸쳐 있다**. 그 상태로 학생 청구액을 강사 행에 그대로 더하면 전 강사 합이 실제 매출의 1.5~2배가 된다
 * (이 프로젝트는 이미 confirmed/actual 합산으로 +60.5M 이중계상 사고를 냈다 — P2/R3).
 *
 * 그래서 규칙은:
 *  · 학생 행 금액 = **그 학생의 그 달 청구서 전액**(다른 과목 포함) — 반 몫이 아니라는 `shared` 표식을 함께 준다.
 *  · 합계 = **고유 학생 1회만** 합산(같은 학생이 여러 반에 나와도 중복 가산 금지).
 *  · 강사 몫(정산액)은 여기서 계산하지 않는다 — 반×강사 배분은 `invoice_teacher_splits`(회차 확정)가 단일 소스다.
 */
export type StudentMoney = {
  billed: number; // 청구(amount_total)
  paid: number; // 납입(amount_paid)
  /** 이 학생이 2명 이상의 강사에게 배우는가 — 청구서가 여러 강사에 걸쳐 있다는 경고. */
  shared: boolean;
};

export type TeacherMoney = {
  byStudent: Record<string, StudentMoney>;
  /** 고유 학생 기준 합계(중복 가산 없음). */
  totals: { billed: number; paid: number; students: number; sharedStudents: number };
  /** 반×강사 배분(회차 확정) 행 수 — 0이면 정산액을 낼 수 없다. */
  splitRows: number;
  /** 강사 배분율(%). null = 급여정책 미설정. */
  commissionRate: number | null;
};

export async function getTeacherMoney(
  month: string,
  teacherId: string,
  studentIds: string[],
): Promise<TeacherMoney> {
  const supabase = await createClient();
  const empty: TeacherMoney = {
    byStudent: {},
    totals: { billed: 0, paid: 0, students: 0, sharedStudents: 0 },
    splitRows: 0,
    commissionRate: null,
  };
  if (studentIds.length === 0) return empty;

  // 청구서(학생×월) · 이 학생들이 듣는 활성 반의 담당 강사(다중 여부) · 회차 확정 분배 행 수 · 급여정책.
  // 서로 독립이라 병렬(B4). id 목록이 수십~수백이라 `.in()`은 청크(B3).
  const [invoices, enrollRows, splits, comp] = await Promise.all([
    fetchInChunks<{ student_id: string; amount_total: number | null; amount_paid: number | null }>(
      studentIds,
      (chunk) =>
        supabase
          .from("invoices")
          .select("student_id, amount_total, amount_paid")
          .eq("period", month)
          // void = makeedu에서 삭제된 청구(동기화가 무효 처리) — 수납·대시보드·리텐션·학생상세와
          // **같은 집합**을 봐야 한다. 빠져 있으면 삭제 반영을 켜는 순간 이 금액 열만 무효 청구를
          // 계속 더해 급여 재료가 부풀고, /billing과 다른 금액을 말하게 된다(2026-07-30 적대 리뷰).
          .neq("status", "void")
          .in("student_id", chunk),
    ),
    fetchInChunks<{ student_id: string; class: { teacher_id: string | null } | { teacher_id: string | null }[] | null }>(
      studentIds,
      (chunk) =>
        supabase
          .from("enrollments")
          .select("student_id, class:class_id!inner ( teacher_id, is_active )")
          .in("student_id", chunk)
          .is("end_date", null)
          .eq("on_hold", false)
          .eq("class.is_active", true),
    ),
    supabase
      .from("invoice_teacher_splits")
      .select("*", { count: "exact", head: true })
      .eq("period", month)
      .eq("teacher_id", teacherId),
    supabase.from("users").select("commission_rate").eq("id", teacherId).maybeSingle(),
  ]);

  // 학생 → 담당 강사 집합(활성 반 기준). 2명 이상이면 청구서가 그 강사만의 것이 아니다.
  const teachersOf = new Map<string, Set<string>>();
  for (const e of enrollRows) {
    const k = (Array.isArray(e.class) ? e.class[0] : e.class) as { teacher_id: string | null } | undefined;
    if (!k?.teacher_id) continue;
    (teachersOf.get(e.student_id) ?? teachersOf.set(e.student_id, new Set()).get(e.student_id)!).add(k.teacher_id);
  }

  const byStudent: Record<string, StudentMoney> = {};
  for (const inv of invoices) {
    const cur = byStudent[inv.student_id] ?? { billed: 0, paid: 0, shared: false };
    cur.billed += Number(inv.amount_total ?? 0);
    cur.paid += Number(inv.amount_paid ?? 0);
    byStudent[inv.student_id] = cur;
  }
  let billed = 0;
  let paid = 0;
  let sharedStudents = 0;
  for (const [id, m] of Object.entries(byStudent)) {
    m.shared = (teachersOf.get(id)?.size ?? 0) > 1;
    if (m.shared) sharedStudents++;
    billed += m.billed; // Object 키가 학생이라 자연히 고유 학생 1회 합산.
    paid += m.paid;
  }

  return {
    byStudent,
    totals: { billed, paid, students: Object.keys(byStudent).length, sharedStudents },
    splitRows: splits.count ?? 0,
    commissionRate:
      comp.data?.commission_rate === null || comp.data?.commission_rate === undefined
        ? null
        : Number(comp.data.commission_rate),
  };
}
