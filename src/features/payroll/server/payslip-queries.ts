import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstMonth } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { appliedRatesOf, computeTeacherTuition } from "@/features/payroll/server/tuition";
import { computeSheetTuition } from "@/features/payroll/server/sheet-tuition";
import { type AttendanceSalaryRates } from "@/features/attendance/salary-rates";
import { computePayslipAmounts } from "@/features/payroll/payslip";
import {
  spanOverlapsMonth,
  studentIdsInMonth,
  withdrawalStats,
  withoutExcludedExits,
  yearlyClassMetrics,
  salaryScopedEnrollments,
  type EnrollSpanRow,
} from "@/features/payroll/payslip-metrics";
import { DEFAULT_CHURN_OPTIONS } from "@/features/teacher-portfolio/evaluation/options";
import { loadEvaluationConfig } from "@/features/teacher-portfolio/server/evaluation-store";
import { currentContract } from "@/features/staff/contract";
import type { PayslipData, PayslipAdjustments } from "@/features/payroll/payslip-view";
import { emptyAdjustments } from "@/features/payroll/payslip-view";
import { PAYSLIP_DENIED_MSG } from "@/features/payroll/payslip-access";
import { canViewPayslipNow } from "@/features/payroll/server/payslip-gate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 급여명세서 데이터 조립 — **원장(master) 전용**.
 *
 * 🔴 금액의 단일 소스는 **고용 형태로 갈린다**(원장 2026-10-06 *"전부 통일 출석부 그대로"* · *"프리랜서만."*):
 *    · **프리랜서** = 그 강사 출석부(강사 전체 보기)의 **실급여 합계** — [`computeSheetTuition`](./sheet-tuition.ts).
 *      화면 합계 칸과 같은 조립·같은 식이라 출석부에서 맞춘 숫자가 그대로 명세서에 선다(영어도 산정된다).
 *    · **그 밖** = 종전 0199a 티어 정산(출석부 하단 정산액과 같은 조립 코드 collectTierRows).
 *    /billing?tab=payroll(강사 정산 면)도 **같은 갈림**이다 — 프리랜서 줄은 같은 `computeSheetTuition`, 그 밖은 티어 정산(tuition-view.ts).
 *    출석부를 금액으로 쓸 수 없는 상태(다른 강사의 보기 · 재료 조회 실패)는 티어로 떨어지지 않고 '산정 불가' + 사유다.
 * 🔴 게이트는 `user.systemRole !== "master"` 직접 비교다 — canWriteTenant("billing")은 admin·accountant를
 *    통과시켜(권한 매트릭스 실측) 급여 PII 게이트로 못 쓴다(class-salary-actions.ts와 같은 선례).
 * 🔴 실패하면 **던진다**. 0원짜리 명세서를 뽑느니 안 뽑는 게 낫다(출석부는 화면을 살리려 접지만 여기는 반대).
 */
export async function getPayslipData(teacherId: string, period: string): Promise<PayslipData> {
  const user = await getCurrentUser();
  if (!user || !(await canViewPayslipNow(user))) throw new Error(PAYSLIP_DENIED_MSG);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("기간 형식이 올바르지 않습니다(YYYY-MM)");

  const supabase = await createClient();
  /**
   * 🔴 단가표(`salary_tiers`)·명세서(`payslips`)·계약(`staff_contracts`)은 **master 전용 RLS**다.
   *    지정된 사람이 원장 역할이 아니면 세션 클라이언트로는 **에러 없이 0행**을 받고(정책 미매치),
   *    화면엔 조용히 "산정 불가"만 뜬다([[#104]] — 정책에 안 걸리면 0행이지 에러가 아니다).
   *    그래서 **앱 게이트를 통과한 뒤에만** admin 클라이언트로 읽는다(contract-queries.ts 선례).
   * ⚠️ admin은 RLS를 우회하므로 **tenant_id를 명시 필터**해야 한다 — 아래 모든 admin 조회에 걸려 있다.
   */
  const admin = createAdminClient();
  const year = Number(period.slice(0, 4));

  // 서로 독립이라 병렬(B4).
  const [teacherRes, classesRes, settings, adjRes, contractsRes] = await Promise.all([
    supabase
      .from("users")
      .select("id, display_name, hire_date, department, employment_type, commission_rate, commission_rates")
      .eq("id", teacherId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle(),
    // ⚠️ **is_active=true + teacher_id** — 출석부 정산액이 쓰는 것과 같은 반 집합이라야 금액이 일치한다
    //    (시트 대조 4인 검증치가 이 집합에 걸려 있다). 돈은 담임을 따라가므로 임시 위임은 보지 않는다.
    supabase
      .from("classes")
      .select("id, class_name, subject, is_special")
      .eq("tenant_id", user.tenantId)
      .eq("teacher_id", teacherId)
      .eq("is_active", true)
      .order("class_name"),
    getTenantSettings(),
    // 0205a 미적용이어도 명세서는 떠야 한다(#95) — 조회 실패 = '조정 없음'.
    admin
      .from("payslips")
      .select("incentive, other_deduction, blog_written_on, rate_penalty_points, rate_penalty_reason, memo, status, issued_at, print_payload")
      .eq("tenant_id", user.tenantId)
      .eq("user_id", teacherId)
      .eq("period", period)
      .maybeSingle()
      .then((r) => r, () => ({ data: null, error: null })),
    admin
      .from("staff_contracts")
      .select("id, seq, kind, start_date, end_date, terms, memo, line_no")
      .eq("tenant_id", user.tenantId)
      .eq("user_id", teacherId),
  ]);

  const teacher = teacherRes.data;
  if (!teacher) throw new Error("강사를 찾을 수 없습니다");

  const classes = (classesRes.data ?? []).map((c) => ({
    id: c.id as string,
    className: c.class_name as string,
    subject: (c.subject as string | null) ?? null,
    isSpecial: c.is_special === true,
  }));
  const classIds = classes.map((c) => c.id);

  const adjustments: PayslipAdjustments = adjRes?.data
    ? {
        incentive: Number(adjRes.data.incentive ?? 0),
        otherDeduction: Number(adjRes.data.other_deduction ?? 0),
        blogWrittenOn: (adjRes.data.blog_written_on as string | null) ?? null,
        ratePenaltyPoints: Number(adjRes.data.rate_penalty_points ?? 0),
        ratePenaltyReason: (adjRes.data.rate_penalty_reason as string | null) ?? null,
        memo: (adjRes.data.memo as string | null) ?? null,
        status: (adjRes.data.status as "draft" | "issued") ?? "draft",
        issuedAt: (adjRes.data.issued_at as string | null) ?? null,
      }
    : emptyAdjustments();

  /**
   * 🔴 발행된 명세서는 **그때 저장한 스냅샷**을 그대로 돌려준다 — 여기서 다시 계산하면
   *    지급·서명이 끝난 뒤 출결을 한 건만 고쳐도 같은 URL이 다른 금액을 인쇄한다(0205a가 표를 만든 이유).
   */
  if (adjustments.status === "issued" && adjRes?.data?.print_payload) {
    const frozen = adjRes.data.print_payload as PayslipData;
    return { ...frozen, adjustments, frozen: true };
  }

  // 계약 비율(users.commission_rates) — **패널티는 여기에 얹지 않는다**(계약은 계약대로 남긴다).
  // 적용 비율 = 계약 − 패널티 — 수납 '강사 정산' 면과 **같은 함수**(`appliedRatesOf`, 원장 2026-09-28 "급여는 출석부 기준").
  const penalty = adjustments.ratePenaltyPoints;
  const {
    groupRates: appliedRates,
    defaultRate: appliedDefault,
    baseRates,
    baseDefault,
  } = appliedRatesOf(teacher, penalty);

  const warnings: string[] = [];

  // ── 정산 · 지표 · 신상 ───────────────────────────────────────────────────────
  // 셋은 서로 독립이라 병렬(B4) — 직렬로 두면 명세서 첫 페인트가 세 왕복을 합산한다.
  // ⚠️ 신상(academy_documents)은 명세서 성패를 좌우하지 않으므로 실패해도 접는다(지어내진 않는다).
  // 티어 정산(종전) — 프리랜서가 아닌 사람, 그리고 출석부로 산정할 수 없는 학원(회차 정산 꺼짐)의 폴백.
  const tierTuition = () =>
    // 수업료 = 정산 면과 같은 함수(`computeTeacherTuition` — collectTierRows 조립 + computeTierSettlement).
    computeTeacherTuition(admin, {
      teacherId,
      period,
      classIds,
      tenantId: user.tenantId,
      subjects: settings.operations.subjects,
      rates: { groupRates: appliedRates, defaultRate: appliedDefault },
    });
  /**
   * 🔴 프리랜서 = 출석부 실급여 합계(원장 2026-10-06). 판정은 출석부가 실급여 열을 세우는 것과 같은 값(`users.employment_type`)이다
   *    — 이력서의 표시용 계약 형태(`rContract.employmentType`)로 가르지 않는다(둘이 다르면 화면과 명세서가 갈린다).
   *    `computeSheetTuition`이 null이면(프리랜서 아님 · 회차 정산 꺼짐) 종전 티어 정산으로 떨어진다.
   */
  const isFreelancer = (teacher.employment_type as string | null) === "프리랜서";
  const tuitionOf = async () => {
    const sheet = isFreelancer
      ? await computeSheetTuition({ tenantId: user.tenantId, teacherId, period, penaltyPoints: penalty, contractRates: baseRates })
      : null;
    return sheet ? { sheet, tier: null } : { sheet: null, tier: await tierTuition() };
  };
  // 지표(수업인원·퇴원)는 수업료와 같은 학년만 센다 — 대상 학년은 수업료 조립이 알려 준다(조회 자체는 나란히 돈다).
  const tuitionPromise = tuitionOf();
  // 퇴원생에서 뺄 사유(강사 탓이 아닌 퇴원) = 강사평가 설정의 퇴원율 세는 법 한 곳. 못 읽으면 기본값(명세서를 막지 않는다).
  const excludeReasons = loadEvaluationConfig(admin, user.tenantId)
    .then((e) => e.config.metrics.churn.churn?.excludeReasons ?? DEFAULT_CHURN_OPTIONS.excludeReasons)
    .catch((err: unknown) => {
      console.error("[payslip] 퇴원 사유 설정 조회 실패 — 기본값 사용", err);
      return DEFAULT_CHURN_OPTIONS.excludeReasons;
    });
  const [tuition, metrics, resume] = await Promise.all([
    tuitionPromise,
    loadMetrics(supabase, period, year, tuitionPromise.then((t) => ({
      levels: t.sheet?.levels, includeSpecial: t.sheet?.includeSpecial, classes: t.sheet?.classScope ?? classes,
    })), excludeReasons),
    supabase
      .from("academy_documents")
      .select("form_data")
      .eq("tenant_id", user.tenantId)
      .eq("form_type", "staff_resume")
      .eq("staff_user_id", teacherId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(
        (r) => (r.data?.form_data ?? null) as Record<string, unknown> | null,
        () => null,
      ),
  ]);

  const settlement = tuition.tier;
  const sheet = tuition.sheet;
  if (sheet) warnings.push(...sheet.warnings);
  else if (classIds.length === 0) warnings.push("담당 반이 없어 수업료를 산정할 수 없습니다.");
  else if (!settlement) warnings.push("그 달 출결이 없거나 단가표가 비어 있어 수업료를 산정할 수 없습니다.");
  else {
    if (settlement.missingTierStudents.length > 0)
      warnings.push(
        `단가 미지정 ${settlement.missingTierStudents.length}명(${settlement.missingTierStudents.join(", ")}) — ${settlement.excludedUnits}시수가 산정에서 빠졌습니다.`,
      );
    if (settlement.missingPriceTiers.length > 0)
      warnings.push(`단가표에 없는 티어: ${settlement.missingPriceTiers.join(", ")}`);
    if (settlement.missingRateGroups.length > 0)
      warnings.push(`배분율이 정해지지 않은 과정: ${settlement.missingRateGroups.join(", ")}`);
  }

  const amounts = computePayslipAmounts({
    tuition: (sheet ? sheet.settlement?.total : settlement?.total) ?? 0,
    incentive: adjustments.incentive,
    otherDeduction: adjustments.otherDeduction,
  });

  if (amounts.netPay < 0)
    warnings.push(
      `기타공제(${amounts.otherDeduction.toLocaleString("ko-KR")}원)가 지급총액보다 커서 실수령액이 음수입니다.`,
    );

  /**
   * 🔴 반 집합은 **현재** 담임·활성 반이다(출석부 정산액과 같은 집합이라야 금액이 맞는다).
   *    그래서 지난 달을 뽑을 땐, 그 사이 인수인계·폐강이 있었으면 금액이 옮겨 다닌다 —
   *    조용히 틀리게 두느니 그럴 수 있다고 적는다. (시점 복원은 후속: features/classes/teacher-as-of.ts)
   */
  // ⚠️ 출석부 기준(프리랜서)엔 해당 없다 — 그 조립은 그 달에 실제로 가르친 반·교시를 담임 이력으로 가린다.
  //    그 대신 담임이 바뀐 반이 있으면 `computeSheetTuition`이 반 이름을 적어 알린다(상대 선생님 명세서와 겹침·누락 확인).
  if (!sheet && period < kstMonth())
    warnings.push(
      "지난 달 명세서입니다 — 반 소유는 현재 담임·활성 반 기준이라, 그 뒤 인수인계·폐강이 있었다면 금액이 달라질 수 있습니다.",
    );

  if (metrics.warning) warnings.push(metrics.warning);

  const rPersonal = (resume?.personal ?? {}) as Record<string, string>;
  const rContract = (resume?.contract ?? {}) as Record<string, string>;

  const contract = currentContract(
    (contractsRes.data ?? []).map((r) => ({
      id: r.id as string,
      seq: Number(r.seq),
      kind: (r.kind as string) === "note" ? "note" : "contract",
      startDate: (r.start_date as string | null) ?? null,
      endDate: (r.end_date as string | null) ?? null,
      terms: (r.terms as string | null) ?? null,
      memo: (r.memo as string | null) ?? null,
      lineNo: (r.line_no as number | null) ?? null,
    })),
    (teacher.hire_date as string | null) ?? null,
  );

  return {
    period,
    company: {
      // 법인명(profile.legalName)이 비면 학원명으로 폴백 — 명세서 머리글이 비는 것보단 낫다.
      name: settings.profile.legalName?.trim() || settings.profile.name,
      representativeName: settings.profile.representativeName || null,
      bizRegNo: settings.profile.bizRegNo || null,
      sealUrl: settings.profile.sealUrl || null,
      signerLabels: settings.profile.payslipSigners || null,
    },
    teacher: {
      id: teacher.id as string,
      name: teacher.display_name as string,
      residentRegNo: rPersonal.residentId?.trim() || null,
      bankName: rContract.bank?.trim() || null,
      accountNumber: rContract.account?.trim() || null,
      employmentType: rContract.employmentType?.trim() || (teacher.employment_type as string | null) || null,
      department: rContract.division?.trim() || (teacher.department as string | null) || null,
      hireDate: rContract.startDate?.trim() || ((teacher.hire_date as string | null) ?? null),
      contractPeriod: contract ? { start: contract.startDate, end: contract.endDate, stored: contract.stored } : null,
      classes,
    },
    amounts,
    // 🔴 total===null(산정 가능한 행 0)이면 **settlement를 통째로 null**로 내린다 —
    //    `settlement?.total ?? 0`로 0을 채우면 화면 가드가 객체 존재만 보고 통과해
    //    "₩0 · 0T"인 겉보기 정상 명세서가 인쇄된다(적대 리뷰가 잡은 치명 버그).
    tuitionBasis: sheet ? "sheet" : "tier",
    settlement: sheet
      ? sheet.settlement
      : settlement && settlement.total !== null
      ? {
          total: settlement.total,
          lines: settlement.lines,
          grossTuition: settlement.grossTuition,
          unitsTotal: settlement.unitsTotal,
          rowCount: settlement.rowCount,
          excludedUnits: settlement.excludedUnits,
          missingTierStudents: settlement.missingTierStudents,
          missingPriceTiers: settlement.missingPriceTiers,
        }
      : null,
    ...(sheet?.levels?.length ? { sheetLevels: sheet.levels } : {}),
    ...(sheet?.includeSpecial ? { sheetIncludeSpecial: true } : {}),
    // 프리랜서는 출석부 비율표를 과정으로 옮긴 값(저장된 표가 없으면 계약 비율과 같다) — 계산에 실제로 쓴 비율을 찍는다.
    rates: sheet
      ? { base: sheet.rates.base, baseDefault, applied: sheet.rates.applied, appliedDefault, penaltyPoints: penalty }
      : { base: baseRates, baseDefault, applied: appliedRates, appliedDefault, penaltyPoints: penalty },
    metrics: metrics.value,
    adjustments,
    warnings,
  };
}

/** 수업인원·퇴원생·연 누적 — 수강 구간을 한 번만 긁어 JS에서 월별로 자른다(월마다 재조회 금지). */
async function loadMetrics(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: string,
  year: number,
  scopeOf: Promise<Pick<AttendanceSalaryRates, "levels" | "includeSpecial"> & {
    classes: { id: string; className: string; isSpecial: boolean }[];
  }>,
  excludeReasons: Promise<readonly string[]>,
): Promise<{ value: PayslipData["metrics"]; warning: string | null }> {
  const empty = {
    value: {
      studentsThisMonth: 0,
      withdrawal: { count: 0, names: [], rate: null, unknownDateCount: 0 },
      cumulativeStudents: 0,
      averageStudents: 0,
      yearlyWithdrawals: 0,
    },
    warning: null as string | null,
  };
  const scope = await scopeOf;
  const classIds = scope.classes.map((c) => c.id);
  if (classIds.length === 0) return empty;

  // 그 해에 걸치는 수강 전건(B2 — 페이징으로 전건, 1000행 절단 방지).
  const spans = await fetchAllPagedInChunks<{
    student_id: string;
    class_id: string;
    start_date: string | null;
    end_date: string | null;
    withdrawal_reason: string | null;
  }>(classIds, (chunk, f, t) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, withdrawal_reason")
      .in("class_id", chunk)
      .lte("start_date", `${year}-12-31`)
      .or(`end_date.is.null,end_date.gte.${year}-01-01`)
      .order("id", { ascending: true })
      .range(f, t),
  );

  let rows: EnrollSpanRow[] = spans
    .filter((s) => !!s.start_date)
    .map((s) => ({ studentId: s.student_id, startDate: s.start_date!, endDate: s.end_date }));

  // 대상 학년을 좁힌 선생님 — 지표도 그 학년 학생만(수업료는 고등학생만인데 수업인원·퇴원율이 전 학년이면 한 장에서 말이 갈린다).
  // 학년을 모르는 학생은 세지 않는다(수업료에서도 '빠진 줄'로 따로 드러난다).
  const levels = scope.levels;
  let scopedClassCount: number | undefined;
  if (levels?.length) {
    const ids = [...new Set(rows.map((r) => r.studentId))];
    const grades = ids.length === 0
      ? []
      : await fetchInChunks<{ id: string; grade: string | null }>(ids, (chunk) => supabase.from("students").select("id, grade").in("id", chunk));
    const scopedSpans = salaryScopedEnrollments(spans, scope, new Map(grades.map((g) => [g.id, g.grade])), new Map(scope.classes.map((c) => [c.id, c])));
    rows = scopedSpans.filter((s) => !!s.start_date).map((s) => ({ studentId: s.student_id, startDate: s.start_date!, endDate: s.end_date }));
    // '담당 반'도 같은 범위로 — 그 달 대상 학년 학생이 한 명이라도 있는 반만 센다.
    scopedClassCount = new Set(
      scopedSpans
        .filter((s) => !!s.start_date && spanOverlapsMonth({ studentId: s.student_id, startDate: s.start_date!, endDate: s.end_date }, period))
        .map((s) => s.class_id),
    ).size;
  }

  const thisMonth = studentIdsInMonth(rows, period);
  const yearly = yearlyClassMetrics(rows, year, period);

  // 퇴원 — **그 해 전체** 학생을 한 번에 받아 월/연 두 지표를 함께 낸다(월마다 재조회하지 않는다, B3 청크).
  const yearStudentIds = [...new Set(rows.map((r) => r.studentId))];
  const withdrawn =
    yearStudentIds.length === 0
      ? []
      : await fetchInChunks<{ id: string; name: string; status: string; withdrawn_at: string | null; reason: string | null }>(
          yearStudentIds,
          (chunk) =>
            supabase.from("students").select("id, name, status, withdrawn_at, reason:withdrawal_metadata->>reason").in("id", chunk).eq("status", "withdrawn"),
        );
  // 강사 탓이 아닌 퇴원(이사·졸업 등)은 그 달·연 누계 모두에서 뺀다(`withoutExcludedExits`).
  const withdrawnRows = withoutExcludedExits(
    withdrawn.map((s) => ({ studentId: s.id, name: s.name, withdrawnAt: s.withdrawn_at, reason: s.reason })),
    spans,
    scope.classes,
    await excludeReasons,
  );

  /**
   * 🔑 정본 판정은 `isSystemBulkWithdrawal` = **일괄 날짜 AND 수강 이력 없음**이다.
   *    명세서가 세는 대상은 정의상 **이 강사 반 수강이 있는 학생**뿐이라 수강 이력이 항상 있다
   *    → 제외 대상이 0건이어야 맞다. 날짜만으로 걸렀더니 2026-07-03에 실제로 수강이 끝나 퇴원한
   *    학생(교정된 실제 날짜)까지 '날짜 미상'으로 지워져 퇴원생 0명이 나왔다(적대 리뷰).
   */
  const w = withdrawalStats(withdrawnRows, thisMonth, period, []);

  // 연 누계 퇴원 — 그 해에 이 강사에게 배우던 학생 중 그 해에 퇴원한 인원(일괄 도장일 제외).
  // 위와 같은 이유로 일괄 날짜 제외를 걸지 않는다(대상이 전부 수강 이력 있는 학생이라 정본 판정이 false).
  const inYear = new Set(yearStudentIds);
  const yearlyWithdrawals = new Set(
    withdrawnRows
      // ⚠️ **명세서 달까지만** 센다 — 연도만 보면 8월에 뽑은 7월 명세서가 8월 퇴원까지 세어
      //    "2026 퇴원생 수"가 그 시점에 없던 값으로 부푼다(수업인원 누적은 이미 period까지만 센다).
      .filter(
        (r) =>
          !!r.withdrawnAt &&
          r.withdrawnAt.slice(0, 4) === String(year) &&
          r.withdrawnAt.slice(0, 7) <= period &&
          inYear.has(r.studentId),
      )
      .map((r) => r.studentId),
  ).size;

  return {
    value: {
      studentsThisMonth: thisMonth.length,
      withdrawal: w,
      cumulativeStudents: yearly.cumulativeStudents,
      averageStudents: yearly.averageStudents,
      yearlyWithdrawals,
      ...(scopedClassCount !== undefined ? { scopedClassCount } : {}),
    },
    warning:
      w.unknownDateCount > 0
        ? `퇴원생 ${w.unknownDateCount}명은 퇴원일이 장부상 일괄 날짜라 집계에서 제외했습니다(실제 시점 미상).`
        : null,
  };
}
