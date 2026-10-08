import "server-only";
import { loadAttendanceSalaryRates } from "@/features/attendance/server/salary-rates";
import { loadSubstituteCells } from "@/features/attendance/server/substitute-cells";
import { loadTeacherSheet, sheetSalaryOf } from "@/features/attendance/server/teacher-sheet";
import { ATTENDANCE_RATE_LEVELS, salaryScopeLabel, type AttendanceRateLevel, type AttendanceSalaryRates } from "@/features/attendance/salary-rates";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { TeacherSheetError } from "@/features/attendance/teacher-sheet-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { foldedReason } from "@/lib/folded-read";
import { isModuleEnabled } from "@/lib/modules";
import { applyRatePenalty } from "@/features/payroll/payslip";
import type { PayslipData } from "@/features/payroll/payslip-view";
import type { GroupRates } from "@/features/payroll/salary-group";
import { SESSION_PRICE_LABEL } from "@/features/payroll/tier-settlement";

/**
 * **프리랜서 명세서의 수업료 = 그 강사 출석부(강사 전체 보기)의 실급여 합계**
 * (원장 2026-10-06, 영어 프리랜서 명세서가 '산정 불가'인 캡처: *"수수료 명세서도 배선해주고"* → *"전부 통일 출석부 그대로"* · *"프리랜서만."*).
 *
 * 🔑 식·반 목록·칸·청구액 상한·비율 전부 **출석부와 한 벌**이다 — 조립은 [`loadTeacherSheet`](@/features/attendance/server/teacher-sheet)
 *    (화면과 같은 호출), 줄·합계는 `teacherSheetSalary`(화면 합계 칸과 같은 함수), 비율은 출석부 실급여 비율표(없으면 계약 비율).
 *    그래서 종전 티어 정산(`computeTeacherTuition`)과는 다음이 다르다(의도된 변경 — 돈 산식이 바뀐다):
 *     · 반 범위: 현재 담임 반 → **그 달에 실제로 가르친 반·교시**(담임 ∪ 교시 담당 ∪ 그 달의 이전 담임, 그 달 뒤에 받은 반 제외)
 *     · 단가: 수강 티어 → **회차 확정 단가만**(단가가 하나로 확정된 줄만 산정)
 *     · 상한: 없음 → **이 선생님 몫의 청구액**(실수업액이 청구액보다 많으면 청구액으로 — 원장 2026-09-21 "받은 돈보다 많이 지급 안 함")
 *     · 비율 축: 단가로 고른 과정 → **학생 학년**(초·중·고) · 특강 반 · 반별 지정
 *     · **다른 반 대신 보강**(`taught_by`) 칸: 보강한 강사 몫으로 지급 → **들어가지 않는다**(그 칸은 학생의 반 출석부에 있어 이 강사 표에 없다).
 *       빠진 시수는 '발행 전 확인'에 적는다 — 줄로 넣을지는 원장 결정 대기(2026-10-06, 그날까지 운영 기록 0건).
 * 🔴 **프리랜서만**이다 — 프리랜서가 아니면 null을 돌려 호출부가 종전 티어 정산을 쓴다(정규직·요일 한정 급여 반은 그대로).
 * 🔴 회차 정산 기능이 꺼진 학원도 null(출석부에 단가·실급여가 없다 → 종전 계산). 이 판정은 **출석부 조립 결과보다 먼저** 한다 —
 *    조립이 던진 뒤에 보면 꺼진 학원의 프리랜서가 티어 정산 대신 '산정 불가'가 된다(설정을 못 읽었을 땐 알 수 없으므로 멈춘다).
 * 🔴 **출석부를 금액으로 쓸 수 없는 상태**(`TeacherSheetError` — 다른 강사의 보기 · 재료 조회 실패)는 null이 **아니다**:
 *    `settlement: null` + 사유 경고를 돌려 호출부가 '산정 불가'로 세운다. null로 돌리면 프리랜서가 말없이 종전 티어 정산으로
 *    떨어져 다른 식의 금액이 발행된다.
 * ⚠️ 그 달 명세서의 배분율 차감(%p, 블로그 미작성)은 여기서 비율에 얹는다 — 출석부는 차감을 모르므로 차감이 있는 달은
 *    출석부 합계와 그만큼만 다르다(종전 명세서와 같은 규약).
 */
export type SheetTuition = {
  /** null = 산정할 줄이 없다(0원을 지어내지 않는다). */
  settlement: PayslipData["settlement"];
  warnings: string[];
  /** 대상 학년을 좁힌 선생님이면 그 학년(없으면 전체) — 별지가 같은 학년 학생만 싣는다. */
  levels?: AttendanceRateLevel[];
  includeSpecial?: boolean;
  /** 실제 그 달 강사 출석부의 반 범위(종강·담임 이력 포함) — 명세서 지표도 같은 반을 센다. */
  classScope?: { id: string; className: string; isSpecial: boolean }[];
  /** 명세서 비율표에 찍을 값 — 출석부 비율표를 과정(초등·중등·고등·특강)으로 옮긴 것. 옮길 수 없는 칸은 계약 비율 그대로. */
  rates: { base: GroupRates; applied: GroupRates };
};

/** `가, 나, 다 외 2명` — 경고 한 줄이 명세서를 넘기지 않게. */
function names(list: readonly string[], max = 6, unit = "명"): string {
  const unique = [...new Set(list)];
  return unique.length <= max ? unique.join(", ") : `${unique.slice(0, max).join(", ")} 외 ${unique.length - max}${unit}`;
}

/**
 * 출석부 비율표 → 명세서 비율표(과정별). 초·중·고는 학년별 정규 비율, 특강은 세 학년의 특강 비율이 **같을 때만** 한 값으로 옮긴다.
 * 옮기지 못한 칸(수능 · 학년마다 다른 특강)은 계약 비율을 그대로 둔다.
 */
export function sheetRatesAsGroups(rates: AttendanceSalaryRates, contract: GroupRates): GroupRates {
  const out: GroupRates = { ...contract };
  for (const level of ATTENDANCE_RATE_LEVELS) {
    const v = rates.regular[level];
    if (v !== undefined) out[level] = v;
  }
  // 대상 학년을 좁힌 선생님 — 대상이 아닌 학년의 비율은 표에서 뺀다(계산에 쓰지 않는 비율이 명세서에 찍히지 않게).
  const inScope = rates.levels?.length ? ATTENDANCE_RATE_LEVELS.filter((level) => rates.levels!.includes(level)) : ATTENDANCE_RATE_LEVELS;
  for (const level of ATTENDANCE_RATE_LEVELS) if (!inScope.includes(level)) delete out[level];
  const specialLevels = rates.includeSpecial ? ATTENDANCE_RATE_LEVELS : inScope;
  const specials = new Set(specialLevels.map((level) => rates.special[level]).filter((v): v is number => v !== undefined));
  if (specials.size === 1) out["특강"] = [...specials][0]!;
  return out;
}

export async function computeSheetTuition(args: {
  tenantId: string;
  teacherId: string;
  period: string;
  penaltyPoints: number;
  /** 계약 비율(과정별) — 비율표에서 출석부가 다루지 않는 칸(수능)을 채운다. */
  contractRates: GroupRates;
}): Promise<SheetTuition | null> {
  // 비율(프리랜서 판정 포함)과 출석부 조립은 서로 독립(B4). 출석부를 금액으로 쓸 수 없는 상태는 사유로 받는다(던지지 않는다).
  const [loaded, settings, assembled] = await Promise.all([
    loadAttendanceSalaryRates(args.tenantId, args.teacherId),
    getTenantSettings(),
    loadTeacherSheet(args.tenantId, args.teacherId, args.period).then(
      (sheet) => ({ sheet, unavailable: null }),
      (e: unknown) => {
        if (e instanceof TeacherSheetError) return { sheet: null, unavailable: e.message };
        throw e;
      },
    ),
  ]);
  if (!loaded) return null;
  // 회차 정산이 꺼진 학원 — 출석부로 산정하지 않는다(종전 티어 정산). 설정을 못 읽었으면 꺼짐 여부를 모르므로 아래에서 멈춘다.
  if (!foldedReason(settings) && !isModuleEnabled(settings.modules.disabled, "session_billing")) return null;
  const penalty = Math.max(0, args.penaltyPoints);
  const base = sheetRatesAsGroups(loaded.rates, args.contractRates);
  const applied: GroupRates = Object.fromEntries(Object.entries(base).map(([group, rate]) => [group, applyRatePenalty(rate, penalty)]));
  const sheet = assembled.sheet;
  const levels = loaded.rates.levels?.length ? loaded.rates.levels : undefined;
  const includeSpecial = loaded.rates.includeSpecial || undefined;
  if (!sheet) return { settlement: null, warnings: [assembled.unavailable ?? "출석부를 불러오지 못해 수업료를 산정하지 않았습니다."], rates: { base, applied }, levels, includeSpecial };
  if (!sheet.sessionBillingOn) return null;
  const salary = sheetSalaryOf(sheet, loaded.rates, penalty > 0 ? (rate) => applyRatePenalty(rate, penalty) : undefined);
  // 다른 반 대신 보강 칸 — 이 강사 표에 없는 반의 것만(표에 선 반의 칸은 격자가 이미 센다). 금액에는 안 들어가는 알림 재료라
  // 조회가 실패해도 산정은 하되, "없음"으로 접지 않고 **확인하지 못했다**고 적는다(null).
  const substitutes = await loadSubstituteCells(
    {
      tenantId: args.tenantId,
      teacherId: args.teacherId,
      month: args.period,
      excludeClassIds: sheet.groups.filter((g) => !g.makeupPool).map((g) => g.classId),
    },
    { strict: true },
  ).catch(() => null);

  const warnings: string[] = [];
  // 대상 학년만 산정한 명세서라는 사실을 먼저 적는다 — 읽는 사람이 다른 학년 학생이 왜 없는지 묻지 않게.
  if (levels) {
    const out = salary.outOfScope;
    warnings.push(
      `${salaryScopeLabel(loaded.rates)}${includeSpecial ? "을" : ""} 산정한 명세서입니다(출석부 '비율 설정'의 대상 학년)` +
        (out.students > 0 ? ` — 그 밖 학년${includeSpecial ? "의 정규 수업" : ""} ${out.students}명 · ${formatSessionUnits(out.units)}시수는 들어 있지 않습니다.` : "."),
    );
  }
  const noPrice = salary.excluded.filter((e) => e.reason === "no-price");
  const noRate = salary.excluded.filter((e) => e.reason === "no-rate");
  if (salary.total === null) {
    warnings.push("그 달 출석부에 산정할 수 있는 줄이 없어 수업료를 산정할 수 없습니다 — 출결과 수납관리 '회차 확정'(단가)을 확인하세요.");
  }
  if (noPrice.length > 0) {
    const units = Math.round(noPrice.reduce((sum, e) => sum + e.units, 0) * 10) / 10;
    warnings.push(`회차 확정 단가가 없어 빠진 ${new Set(noPrice.map((e) => e.studentId)).size}명(${names(noPrice.map((e) => e.studentName))}) — ${units}시수가 산정에서 빠졌습니다.`);
  }
  const noLevel = salary.excluded.filter((e) => e.reason === "no-level");
  if (noLevel.length > 0) {
    const units = Math.round(noLevel.reduce((sum, e) => sum + e.units, 0) * 10) / 10;
    // 학년이 비었거나, 값은 있는데 초·중·고가 아닌 경우(예: 7세) 둘 다다 — "입력하면 풀린다"고만 말하면 뒤의 경우엔 따를 수 없는 안내가 된다(재리뷰).
    warnings.push(`학년이 비어 있거나 초·중·고로 분류되지 않아(예: 7세) 대상 학년인지 판정하지 못한 ${new Set(noLevel.map((e) => e.studentId)).size}명(${names(noLevel.map((e) => e.studentName))}) — ${units}시수가 산정에서 빠졌습니다.`);
  }
  if (noRate.length > 0) {
    const units = Math.round(noRate.reduce((sum, e) => sum + e.units, 0) * 10) / 10;
    warnings.push(`배분율이 정해지지 않아 빠진 ${new Set(noRate.map((e) => e.studentId)).size}명(${names(noRate.map((e) => e.studentName))}) — ${units}시수가 산정에서 빠졌습니다.`);
  }
  const capped = salary.lines.filter((line) => line.capped);
  if (capped.length > 0) {
    warnings.push(`실수업액이 청구액보다 많아 청구액으로 계산한 줄이 ${capped.length}개 있습니다(${names(capped.map((line) => line.studentName))}).`);
  }
  const capUnknown = salary.lines.filter((line) => line.capUnknown);
  if (capUnknown.length > 0) {
    warnings.push(`청구액을 확인할 수 없어 실수업액 그대로 계산한 줄이 ${capUnknown.length}개 있습니다(${names(capUnknown.map((line) => line.studentName))}).`);
  }
  if (Object.keys(loaded.rates.classes).length > 0) {
    warnings.push("반별로 따로 정한 비율이 있어 아래 비율표와 다르게 계산된 줄이 있습니다(출석부 '비율' 설정).");
  }
  if (sheet.handovers.length > 0) {
    warnings.push(
      `담임이 바뀐 반이 ${sheet.handovers.length}개 있습니다(${names(sheet.handovers.map((h) => h.className || "이름 없는 반"), 6, "개")}) — 담임 몫 수업은 선생님이 담임이던 날의 것만 이 명세서에 들어 있습니다. 상대 선생님 명세서와 겹치거나 빠진 수업이 없는지 확인하세요.`,
    );
  }
  if (substitutes === null) {
    warnings.push("다른 반 학생을 대신 보강한 시수가 있는지 확인하지 못했습니다 — 그 시수는 이 명세서에 들어 있지 않으니, 발행 전에 다시 열어 확인하세요.");
  } else {
    const substituteUnits = substitutes.reduce((sum, cell) => sum + cell.units, 0);
    if (substituteUnits > 0) {
      warnings.push(
        `다른 반 학생을 대신 보강한 ${formatSessionUnits(substituteUnits)}시수(${names(substitutes.filter((cell) => cell.units > 0).map((cell) => cell.studentName || "이름 없음"))})는 이 명세서에 들어 있지 않습니다 — 그 칸은 학생의 반 출석부에 있어 이 선생님 출석부의 실급여에 없습니다.`,
      );
    }
  }

  return {
    settlement:
      salary.total === null
        ? null
        : {
            total: salary.total,
            lines: salary.lines.map((line) => ({
              studentId: line.studentId,
              studentName: line.studentName,
              classId: line.classId,
              tierLabel: SESSION_PRICE_LABEL,
              units: line.units,
              unitPrice: line.unitPrice,
              priceSource: "session" as const,
              group: null,
              rate: line.rate,
              // 바탕 금액(청구액 상한 적용 후) — 이 값 × 0.911 × 비율이 줄 금액이다.
              gross: line.base,
              amount: line.amount,
            })),
            grossTuition: salary.baseTotal,
            unitsTotal: salary.unitsTotal,
            rowCount: salary.lines.length,
            excludedUnits: salary.excludedUnits,
            missingTierStudents: [...new Set(noPrice.map((e) => e.studentName))],
            missingPriceTiers: [],
            unitSuffix: sheet.unitSuffix,
          },
    warnings,
    rates: { base, applied },
    levels,
    includeSpecial,
    classScope: sheet.groups.filter((g) => !g.makeupPool).map((g) => ({ id: g.classId, className: g.className, isSpecial: g.isSpecial })),
  };
}
