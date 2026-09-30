import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { computeTierSettlement, tierRowsOwnedBy } from "@/features/payroll/tier-settlement";
import { collectTierRows } from "@/features/payroll/server/tier-rows";
import { parseGroupRates } from "@/features/payroll/salary-group";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { ExcludedLineLike, SettlementLineLike } from "@/features/attendance/search-totals";

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

/**
 * 티어(수업 단가) 기반 정산액(0199a) — 시트 산식: Σ floor1(단가 × 시수 × 0.911 × 비율).
 * · unwired = 0199a 스키마 미적용 또는 단가표(salary_tiers)가 비어 있음 → 기존 안내 문구 유지.
 * · ready   = 산정 완료. 단가 미지정 학생이 있으면 **부분합 + 명단**(조용히 0으로 치지 않는다).
 * · hold    = 시수는 있는데 산정 가능한 행이 0(전원 단가·비율 미지정) — 숫자를 지어내지 않는다.
 */
export type TierSettlementInfo =
  | { status: "unwired" }
  | {
      status: "ready";
      total: number;
      unitsTotal: number;
      rowCount: number;
      missingTierStudents: string[];
      /** 미지정 학생 id — 이름 칸 「단가」 라벨 표시용(동명이인 안전). */
      missingTierStudentIds: string[];
      /** 단가 미지정 **반·학생 줄**(`classId|studentId`) — 「단가」 표식은 이걸로 붙인다(학생 단위로 붙이면 모든 반에 번진다). */
      missingTierRowKeys: string[];
      missingPriceTiers: string[];
      excludedUnits: number;
      /** 학생별 티어 라벨(여럿이면 " · " join) — 학교·학년 열 아랫줄 표시용(라벨만, 금액 아님). */
      tierByStudent: Record<string, string>;
      /**
       * 산정된 행별 (학생·시수·금액) — **학생 검색이 걸렸을 때 같은 모수로 다시 접기 위한 재료**(2026-08-20).
       *
       * 🔴 금액은 서버가 이미 `floor1(단가×시수×0.911×비율)`로 확정한 값 **그대로**다. 화면은 고르고
       *    더하기만 한다(`scopedSettlement`) — 산식·반올림 자리를 클라에서 다시 쓰지 않는다.
       * 🔴 전체(모수 없음)로 접으면 위 `total`과 **연산 순서까지 같아** 1원도 안 갈린다.
       * ⚠️ 단가·이름은 안 싣는다 — 이 화면이 필요한 건 "이 학생 몫이 얼마인가"뿐이다.
       */
      settlementLines: SettlementLineLike[];
      /**
       * 반별 정산 시수(산정된 줄만) — 표에 없는 반(다른 반 **대신 보강**, `taught_by` 0315a)이 정산에 얼마 들었는지 화면이 밝히는 재료.
       * 🔴 금액을 반에 나누는 데 쓰지 말 것(청구서는 반 몫이 아니다 — 위 머리 주석). 시수만이다.
       */
      unitsByClass?: Record<string, number>;
      /** 제외된 행 — "단가 미지정 N명 · N시수 제외" 경고를 검색 모수로 다시 세기 위한 재료. */
      excludedLines: ExcludedLineLike[];
    }
  | {
      status: "hold";
      missingTierStudents: string[];
      missingTierStudentIds: string[];
      /** 단가 미지정 **반·학생 줄**(`classId|studentId`) — 「단가」 표식은 이걸로 붙인다(학생 단위로 붙이면 모든 반에 번진다). */
      missingTierRowKeys: string[];
      missingPriceTiers: string[];
      missingRateGroups: string[];
      tierByStudent: Record<string, string>;
    };

export type TeacherMoney = {
  byStudent: Record<string, StudentMoney>;
  /** 고유 학생 기준 합계(중복 가산 없음). */
  totals: { billed: number; paid: number; students: number; sharedStudents: number };
  /** 반×강사 배분(회차 확정) 행 수 — 0이면 정산액을 낼 수 없다. */
  splitRows: number;
  /** 강사 배분율(%). null = 급여정책 미설정. */
  commissionRate: number | null;
  /** 티어 단가 기반 정산액(0199a) — 하단 합계 줄이 소비. */
  tierSettlement: TierSettlementInfo;
};

export async function getTeacherMoney(
  month: string,
  teacherId: string,
  studentIds: string[],
  /** 이 강사의 반 id — 티어 정산(0199a)의 시수·티어 조회 범위. 생략하면 정산액을 계산하지 않는다. */
  classIds: string[] = [],
): Promise<TeacherMoney> {
  const supabase = await createClient();
  const empty: TeacherMoney = {
    byStudent: {},
    totals: { billed: 0, paid: 0, students: 0, sharedStudents: 0 },
    splitRows: 0,
    commissionRate: null,
    tierSettlement: { status: "unwired" },
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
    supabase.from("users").select("commission_rate, commission_rates").eq("id", teacherId).maybeSingle(),
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
    tierSettlement: await computeTierSettlementInfo(supabase, month, classIds, {
      groupRates: parseGroupRates(comp.data?.commission_rates),
      defaultRate:
        comp.data?.commission_rate === null || comp.data?.commission_rate === undefined
          ? null
          : Number(comp.data.commission_rate),
    }, teacherId),
  };
}

/**
 * 티어 단가 기반 정산액(0199a) — 시트 산식 그대로: (학생×반×티어) 행별 floor1(단가×시수×0.911×비율) 합.
 *
 * · 시수 = attendance_records **교시별 유효행**(0196a slot_start — 같은 날 두 교시면 두 행 다 센다.
 *   이수진 4명의 "고등 3T 1T + 중등 3T 0.5T 같은 날"이 정확히 이 경로로 살아난다).
 * · 티어 = 기록 예외(attendance_records.salary_tier) ?? 수강(enrollments.salary_tier).
 * · 단가 = 회차 확정 단가(수학 반, 그 달 회차 전부 확정) ?? 티어 단가표 — 원장 2026-09-18 통일(tier-rows.ts).
 * · 🔴 0199a 스키마가 아직 없거나(선-SQL 배포 안전, [[#95]] expand/contract) 단가표가 비어 있으면
 *   조용히 `unwired` — 기존 화면 문구가 그대로 나온다. 여기서 throw하면 출석부 전체가 죽는다.
 */
async function computeTierSettlementInfo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  month: string,
  classIds: string[],
  rates: { groupRates: ReturnType<typeof parseGroupRates>; defaultRate: number | null },
  /** 이 정산액의 주인 — 대신 보강 칸 귀속(`tierRowsOwnedBy`). */
  teacherId?: string,
): Promise<TierSettlementInfo> {
  try {
    // 행 조립은 공용 모듈이 단일 소스 — 급여명세서(payslip-queries)와 **같은 코드**로 같은 숫자를 낸다.
    // 과목 설정은 요청 캐시(페이지가 이미 읽었다) — 회차 단가를 붙일 수학 반 판정 재료.
    const settings = await getTenantSettings();
    // 🔴 대신 보강(원장 결정 3) — 담임 반의 다른 강사 대신 보강 칸은 빼고, 남의 반에서 이 강사가 한 보강 칸은 넣는다(명세서와 같은 함수).
    const collected = await collectTierRows(supabase, month, classIds, undefined, settings.operations.subjects, {
      substituteTeacherIds: teacherId ? [teacherId] : [],
    });
    if (!collected) return { status: "unwired" };
    const rows = teacherId ? tierRowsOwnedBy(collected.rows, teacherId, new Set(classIds)) : collected.rows;

    const result = computeTierSettlement(rows, collected.priceByTier, rates);
    const tierByStudent = collected.tierByStudent;
    if (result.total === null)
      return {
        status: "hold",
        missingTierStudents: result.missingTierStudents,
        missingTierStudentIds: result.missingTierStudentIds,
        missingTierRowKeys: result.missingTierRowKeys,
        missingPriceTiers: result.missingPriceTiers,
        missingRateGroups: result.missingRateGroups,
        tierByStudent,
      };
    return {
      status: "ready",
      total: result.total,
      unitsTotal: result.unitsTotal,
      rowCount: result.rowCount,
      missingTierStudents: result.missingTierStudents,
      missingTierStudentIds: result.missingTierStudentIds,
      missingTierRowKeys: result.missingTierRowKeys,
      missingPriceTiers: result.missingPriceTiers,
      excludedUnits: result.excludedUnits,
      tierByStudent,
      // ⚠️ 행 순서를 **그대로** 넘긴다 — 정렬하거나 학생별로 미리 접으면 전체 합의 부동소수 결합순서가
      //    달라져 `total`과 1원이 흔들릴 수 있다(search-totals.ts `scopedSettlement` 주석).
      settlementLines: result.lines.map((l) => ({ studentId: l.studentId, units: l.units, amount: l.amount })),
      unitsByClass: result.lines.reduce<Record<string, number>>((acc, l) => {
        acc[l.classId] = (acc[l.classId] ?? 0) + l.units;
        return acc;
      }, {}),
      excludedLines: result.excludedLines,
    };
  } catch {
    // 0199a 미적용(칼럼·표 없음 = PostgREST 400 → 헬퍼 throw) — 정산액만 접고 화면은 산다.
    // ⚠️ 명세서 쪽은 반대로 **던진다**(0원짜리 문서를 뽑으면 안 되므로) — tier-rows.ts 주석 참조.
    return { status: "unwired" };
  }
}
