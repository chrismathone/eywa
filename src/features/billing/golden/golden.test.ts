// 골든마스터(N6) — 돈 계산 회귀 게이트. docs/per-session-billing-plan.md N6 + attendance R2 이식.
//
// ⚠️ 이 테스트가 깨지면 "테스트를 고치기" 전에 "돈 계산이 왜 달라졌는지"부터 설명해야 한다.
//    픽스처는 injaewon 실데이터 동결 스냅샷(2026-07-16 채취) — 라이브 DB는 makeedu 동기화로 변동하므로
//    여기 있는 파일이 기준이다. 의도적 산식 변경 시에만 핀을 갱신하고, 변경 사유를 커밋 메시지에 남길 것.
//
// attendance R2의 3케이스(김도윤·조아영·김지호 — 수동 live 검증)를 eywa에선 자동화로 승격:
//   [A] 반 라인 매칭(수납명 문자열 지대 — attendance 사고 8건의 근원)
//   [B] 계획 N(스케줄×기간∩청구월−공휴일, 반 단위 비합산)
//   [C] 회차 검증·강사 분배(**하류 산식 동결** — RPC 축은 0263a로 갈라졌다, 부족·초과 양방향)
//   [D] 수납 지표(실 401행 월 스냅샷 — 유령 미수 등 실데이터 특이 케이스 포함)
import { describe, expect, it } from "vitest";
import invoicesFixture from "./fixtures/invoices-2026-07.json";
import planFixture from "./fixtures/plan-cases.json";
import lineFixture from "./fixtures/class-amount-cases.json";
import auditFixture from "./fixtures/session-audit-cases.json";
import { summarizeInvoices, invoiceOutstanding, paymentRateOf, type InvoiceSummaryInput } from "../calc";
import { classInvoiceAmount, classCode } from "../session-terms/class-amount";
import { planTermsForMonth, type PlanEnrollment } from "../session-terms/plan";
import { mergeHolidays } from "../tuition-calc";
import { classifyVerification } from "../session-terms/verification";
import { aggregateTeacherAllocations } from "../session-terms/allocation";
import { computeSplitRows, totalSplits } from "../session-terms/splits";
import { computeTeacherSettlements, totalSettlements, type TeacherComp } from "@/features/payroll/settlement";

// ─────────────────── [A] 반 라인 매칭 — classInvoiceAmount ───────────────────

type LineCase = { student: string; lineItems: { description: string | null; amount: number | null }[] };
const linesOf = (student: string) =>
  (lineFixture as LineCase[]).find((c) => c.student === student)!.lineItems;

describe("골든 [A] 반 라인 매칭 — 실 line_items(강수정·이시우 2026-07)", () => {
  it("코드 토큰 정확 일치 — 반명과 수납명이 달라도 코드(BS2C)로 매칭: 192,150원", () => {
    expect(classInvoiceAmount("개별(초등M) 초5 BS2C", linesOf("강수정"))).toBe(192150);
    expect(classInvoiceAmount("초등M 개별 JJ1H", linesOf("강수정"))).toBe(85000);
  });

  it("유사 코드 오매칭 방어 — JJ2B가 MS2B 라인에 붙지 않는다(null = 지어내지 않음)", () => {
    expect(classInvoiceAmount("초등M 초6 JJ2B", linesOf("이시우"))).toBeNull();
    expect(classInvoiceAmount("중등M 초6 MS2B", linesOf("이시우"))).toBe(324000);
  });

  it("매칭 실패는 null — 다른 학생 수납에서 값을 지어내지 않는다", () => {
    expect(classInvoiceAmount("LS2b", linesOf("강수정"))).toBeNull();
    expect(classInvoiceAmount("개별(초등M) 초5 BS2C", linesOf("이시우"))).toBeNull();
  });

  it("서술형 반명(코드 없음)은 공백무시 포함 경로 — 브릿지 B 288,000원", () => {
    expect(classCode("중등E_초등 브릿지 B")).toBeNull();
    expect(classInvoiceAmount("중등E_초등 브릿지 B", linesOf("이시우"))).toBe(288000);
  });

  it("빈 라인/이중 인코딩 방어 — 배열이 아니면 소비처가 []로 흡수(합성 케이스)", () => {
    expect(classInvoiceAmount("개별(초등M) 초5 BS2C", [])).toBeNull();
    const doubleEncoded: unknown = JSON.stringify(linesOf("강수정"));
    const absorbed = Array.isArray(doubleEncoded) ? (doubleEncoded as LineCase["lineItems"]) : [];
    expect(classInvoiceAmount("개별(초등M) 초5 BS2C", absorbed)).toBeNull();
  });
});

// ─────────────────── [B] 계획 N — planTermsForMonth (JJ2B·조은호 실 스냅샷) ───────────────────

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
type PlanFixture = typeof planFixture;
const weekdaysByClass = new Map<string, number[]>(
  (planFixture as PlanFixture).classes.map((c) => [
    c.id,
    [...new Set((c.schedules ?? []).map((s) => DOW[s.dayOfWeek]!))],
  ]),
);
const enrOf = (name: string): PlanEnrollment[] =>
  (planFixture as PlanFixture).enrollments
    .filter((e) => e.name === name)
    .map((e) => ({
      classId: e.class_id,
      subject: (planFixture as PlanFixture).classes.find((c) => c.id === e.class_id)!.subject,
      startDate: String(e.start_date).slice(0, 10),
      endDate: e.end_date ? String(e.end_date).slice(0, 10) : null,
      weekdays: weekdaysByClass.get(e.class_id) ?? [],
    }));
const HOLIDAYS_2026 = mergeHolidays(2026, (planFixture as PlanFixture).holidays.map((h) => h.date), true);
const JJ2B = "5b1cb60f-83c3-4031-bafe-d102429a512d";
const SPECIAL_S = "2859b774-0e33-4a71-a805-3b0b1c0338bd";
const REGULAR_A = "34630db9-92fe-4d47-a416-0c10197987a9";

describe("골든 [B] 계획 N — 실 스케줄·수강·공휴일 동결(서버 조립과 동일 규칙)", () => {
  it("공휴일 병합 — 양력 고정 8일 + 테넌트 2일(대통령선거·제헌절)", () => {
    expect(HOLIDAYS_2026).toEqual([
      "2026-01-01", "2026-03-01", "2026-05-05", "2026-06-06",
      "2026-08-15", "2026-10-03", "2026-10-09", "2026-12-25",
      "2026-06-03", "2026-07-17",
    ]);
  });

  it("JJ2B(월·목) 2026-07 = 9회 — DB 저장 planned와 일치(회차 확정 프리필 근거)", () => {
    expect(planTermsForMonth("2026-07", enrOf("이시우"), HOLIDAYS_2026)).toEqual([
      { subject: "math", classId: JJ2B, plannedSessions: 9 },
    ]);
  });

  it("월중 종료(류다인 ~06-02 = 1회) / 월중 시작(이시우 06-15~ = 5회) proration", () => {
    expect(planTermsForMonth("2026-06", enrOf("류다인"), HOLIDAYS_2026)).toEqual([
      { subject: "math", classId: JJ2B, plannedSessions: 1 },
    ]);
    expect(planTermsForMonth("2026-06", enrOf("이시우"), HOLIDAYS_2026)).toEqual([
      { subject: "math", classId: JJ2B, plannedSessions: 5 },
    ]);
  });

  it("월중 반이동(조은호 2026-04: 정규A ~04-06 + 특별S 04-07~) = 두 행 — 반 단위 절대 비합산", () => {
    expect(planTermsForMonth("2026-04", enrOf("조은호"), HOLIDAYS_2026)).toEqual([
      { subject: "english", classId: SPECIAL_S, plannedSessions: 6 },
      { subject: "english", classId: REGULAR_A, plannedSessions: 1 },
    ]);
  });

  it("공휴일 차감 — 특별S(금·토) 2026-07 = 8회(제헌절 7/17 금요일 차감)", () => {
    // ⚠️ DB에 저장된 planned=9는 제헌절이 설정에 추가되기 전의 stale 값 — 엔진 정답은 8.
    //    "계획 갱신"을 다시 돌리면 8로 갱신된다(확정값 아님·프리필 전용이라 무해, N1).
    expect(planTermsForMonth("2026-07", enrOf("조은호"), HOLIDAYS_2026)).toEqual([
      { subject: "english", classId: SPECIAL_S, plannedSessions: 8 },
    ]);
  });
});

// ─────────────── [C] 회차 검증·강사 분배·splits — 하류 산식 동결(RPC 축은 0263a로 갈라짐) ───────────────

type AuditCase = (typeof auditFixture)["cases"][number];

// 🔴 제목을 "삼중 일치"로 되돌리지 말 것 — 0263a 이후 RPC 축은 갈라졌고, 이 픽스처가 잠그는 것은
//    "소비 숫자가 주어졌을 때의 하류 계산"이다(픽스처 note와 같은 말). 제목을 믿고 rpcConsumed를
//    지금 RPC에 맞춰 갱신하면 돈 계산 회귀 게이트가 조용히 풀린다.
describe("골든 [C] 회차 검증·분배·splits — 하류 산식 동결(입력은 2026-07-16 실E2E 수학 JJ2B·영어 특별S)", () => {
  for (const c of auditFixture.cases as AuditCase[]) {
    it(c.name, () => {
      // RPC 출력(numeric 문자열) → Number 변환은 소비처(verification-queries)와 동일 규칙
      const rows = c.rows.map((r) => ({ ...r, actualConsumed: Number(r.rpcConsumed) || 0 }));

      // ① 판정(classifyVerification)
      const verdicts = rows.map((r) => classifyVerification(r.confirmedSessions, r.actualConsumed));
      expect(verdicts.map((v) => ({ status: v.status, diff: v.diff }))).toEqual(c.expected.verdicts);

      // ② 강사별 분배 집계(참고 표) — teacherId 그룹
      const allocations = aggregateTeacherAllocations(
        rows.map((r) => ({
          className: r.className,
          teacherId: r.teacherId,
          teacherName: r.teacherName,
          confirmedSessions: r.confirmedSessions,
          unitPrice: r.unitPrice,
          amount: r.amount,
          actualConsumed: r.actualConsumed,
        })),
      );
      expect(allocations).toHaveLength(1);
      expect(allocations[0]).toMatchObject(c.expected.allocation);

      // ③ splits(저장 행) — 확정 행만, 반 단위 유지
      const splits = computeSplitRows(rows);
      expect(splits.map((s) => ({
        confirmedAmount: s.confirmedAmount,
        actualUnits: s.actualUnits,
        actualAmount: s.actualAmount,
        diffAmount: s.diffAmount,
      }))).toEqual(c.expected.splits);
      expect(totalSplits(splits)).toEqual(c.expected.splitTotals);

      // ④ R3 확장 — 청구 기준과 실측 기준은 절대 합산 금지: 합산값이 어느 기준과도 다름을 명시
      const t = totalSplits(splits);
      if (t.diffAmount !== 0) {
        expect(t.confirmedAmount + t.actualAmount).not.toBe(t.confirmedAmount);
        expect(t.confirmedAmount + t.actualAmount).not.toBe(t.actualAmount);
      }
    });
  }
});

// ─────────────────── [D] 수납 지표 — 2026-07 실 401행 동결 ───────────────────

describe("골든 [D] 수납 지표 — injaewon 2026-07 전건 스냅샷(401행)", () => {
  const rows = invoicesFixture.rows as InvoiceSummaryInput[];

  it("summarizeInvoices 전체 요약 핀 — 총액·수납·할인·미수·수납률·상태 분포", () => {
    expect(summarizeInvoices(rows, "2026-07")).toEqual({
      period: "2026-07",
      totalCount: 401,
      paidCount: 363,
      partialCount: 11,
      unpaidCount: 27,
      totalBilled: 161122025,
      totalCollected: 145437525,
      totalDiscount: 2632863,
      outstanding: 12860387,
      paymentRate: 91.7649656069227,
    });
  });

  it("유령 미수 방어 — paid인데 적립금 잔차(191,250원)가 남은 실측 1행은 미수 0", () => {
    const ghosts = rows.filter((r) => r.status === "paid" && r.amountPaid < r.amountTotal - r.amountDiscount);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.amountTotal - ghosts[0]!.amountDiscount - ghosts[0]!.amountPaid).toBe(191250);
    expect(invoiceOutstanding(ghosts[0]!)).toBe(0);
  });

  it("미수 합 = unpaid+partial 행의 net 잔액 합(paid/refunded/void 제외 규칙 고정)", () => {
    const manual = rows
      .filter((r) => r.status !== "paid" && r.status !== "refunded" && r.status !== "void")
      .reduce((s, r) => s + Math.max(0, r.amountTotal - r.amountDiscount - r.amountPaid), 0);
    expect(manual).toBe(12860387);
  });

  it("paymentRateOf 경계 — 100% 상한·0-나눗셈 방어", () => {
    expect(paymentRateOf(145437525, 161122025 - 2632863)).toBeCloseTo(91.7649656069227, 10);
    expect(paymentRateOf(200, 100)).toBe(100);
    expect(paymentRateOf(100, 0)).toBe(0);
  });
});

// ─────────────────── [E] 강사 정산(급여) — splits 확정치 → 급여 산정값 동결 ───────────────────
// 실E2E splits(수학 JJ2B 박민엽 확정 150,000 / 영어 특별S Elsa 확정 60,000)에 가상 급여정책을 적용해
// 세 모델(비율제·급여제·혼합)의 산정값을 핀. confirmed 기준·actual 신호 분리(P1/P2)를 회귀로 고정.
//
// ⚠️ **핀 갱신 2026-07-21 (2차) — 지급 기준액이 `청구`에서 `min(실측, 청구)`로 바뀌었다.**
// 원장: *"실제 수업한 기준으로 급여가 발생해야 한다. 아무리 많이 수업해도 청구액을 넘는 분은 지급하지 않는다."*
// 실E2E 박민엽 행은 실측 137,500 < 청구 150,000이라 **지급 기준 = 137,500**이 된다(구 급여 시트와 동일 규약).
//
// ⚠️ **핀 갱신 2026-07-21 (1차) — 원장 확정 산식에 결제 수수료가 들어갔다: 급여 = 지급기준 × 0.911(수수료 8.9%) × 비율.**
// 이전 핀은 수수료 없이 `청구 × 비율`이었다(비율제 75,000 · 혼합 1,560,000). 결제수단을 가리지 않고 전 건
// 일괄 적용하는 것도 원장 지시다. 급여제(월 고정급)는 청구와 무관하므로 값이 그대로다.

describe("골든 [E] 강사 정산 — splits confirmed_amount → 급여(비율제/급여제/혼합)", () => {
  // 실E2E splits를 강사별로 집계한 정산 입력(수학 JJ2B 이시우 100,000 + 이재용 50,000 = 박민엽 150,000 청구,
  // actual 100,000+37,500 = 137,500). 담당 강사 박민엽(t-park).
  const parkRows = [
    { teacherId: "t-park", teacherName: "박민엽", classId: "cls-jj2b", confirmedAmount: 100000, actualAmount: 100000 },
    { teacherId: "t-park", teacherName: "박민엽", classId: "cls-jj2b", confirmedAmount: 50000, actualAmount: 37500 },
  ];
  const comp = (over: Partial<TeacherComp>): Map<string, TeacherComp> =>
    new Map([["t-park", { salaryType: "commission", commissionRate: 50, monthlyBase: 0, ...over }]]);

  it("비율제 50% — 지급기준 min(실측 137,500, 청구 150,000) × 0.911 × 50% = 62,631", () => {
    const [s] = computeTeacherSettlements(parkRows, comp({ salaryType: "commission", commissionRate: 50 }));
    expect(s).toMatchObject({
      teacherName: "박민엽",
      confirmedTotal: 150000,
      actualTotal: 137500,
      diffTotal: -12500,
      payableTotal: 137500, // min(실측 137,500, 청구 150,000)
      netBase: 125263, // 137,500 × 0.911
      commissionAmount: 62631,
      settlement: 62631,
      status: "computed",
    });
  });

  it("급여제 — 월 고정급 2,800,000 (splits 무관)", () => {
    const [s] = computeTeacherSettlements(
      parkRows,
      comp({ salaryType: "fixed", monthlyBase: 2800000, commissionRate: null }),
    );
    expect(s!.settlement).toBe(2800000);
    expect(s!.commissionAmount).toBe(0);
  });

  it("혼합 — 기본급 1,500,000 + 지급기준 137,500 × 0.911 × 40% = 1,550,105", () => {
    const [s] = computeTeacherSettlements(
      parkRows,
      comp({ salaryType: "hybrid", monthlyBase: 1500000, commissionRate: 40 }),
    );
    expect(s!.commissionAmount).toBe(50105);
    expect(s!.settlement).toBe(1550105);
  });

  it("합계 — 산정된 급여만 합산(비율제 62,631), 청구 총액 별도", () => {
    const rows = computeTeacherSettlements(parkRows, comp({ commissionRate: 50 }));
    expect(totalSettlements(rows)).toEqual({
      teacherCount: 1,
      settledTotal: 62631,
      confirmedTotal: 150000,
      pendingCount: 0,
    });
  });
});
