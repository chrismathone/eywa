import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rowKey } from "@/features/attendance/grid/model";
import { emptyAttendanceRates, type AttendanceSalaryRates } from "@/features/attendance/salary-rates";

const mocks = vi.hoisted(() => ({ rates: vi.fn(), sheet: vi.fn(), substitutes: vi.fn(), settings: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: mocks.settings }));
vi.mock("@/features/attendance/server/salary-rates", () => ({ loadAttendanceSalaryRates: mocks.rates }));
vi.mock("@/features/attendance/server/substitute-cells", () => ({ loadSubstituteCells: mocks.substitutes }));
vi.mock("@/features/attendance/server/teacher-sheet", async () => {
  // 조립(`loadTeacherSheet`)만 갈아끼우고, 실급여 계산(`sheetSalaryOf`)은 진짜를 쓴다 — 화면과 같은 식을 지난다.
  const { teacherSheetSalary } = await import("@/features/attendance/sheet-salary");
  return {
    loadTeacherSheet: mocks.sheet,
    sheetSalaryOf: (sheet: FakeSheet, rates: AttendanceSalaryRates, adjustRate?: (rate: number) => number) =>
      teacherSheetSalary({
        groups: sheet.groups.map((g) => ({ classId: g.classId, className: g.className, isSpecial: g.isSpecial, students: g.matrix.students, marks: g.matrix.marks, units: g.matrix.units })),
        billed: sheet.billing.billed,
        terms: sheet.sessionBillingOn ? sheet.billing.confirmedSessions : {},
        prices: sheet.sessionBillingOn ? sheet.billing.confirmedPrices : {},
        rates,
        ...(adjustRate ? { adjustRate } : {}),
      }),
  };
});

import { TeacherSheetError } from "@/features/attendance/teacher-sheet-error";
import { markFolded } from "@/lib/folded-read";
import { computeSheetTuition, sheetRatesAsGroups } from "./sheet-tuition";

type FakeSheet = {
  groups: { classId: string; className: string; subject: string | null; isSpecial: boolean; makeupPool: boolean; matrix: { students: { id: string; name: string; grade: string | null }[]; marks: Record<string, Record<string, string>>; units: Record<string, Record<string, number>> } }[];
  billing: { billed: Record<string, number>; confirmedSessions: Record<string, { units: number; daysBasis: boolean; classUnits?: number }>; confirmedPrices: Record<string, { unitPrice: number; monthly: boolean; daysBasis: boolean }[]> };
  sessionBillingOn: boolean;
  unitSuffix: "U" | "T" | null;
  handovers: { className: string; kind: "took" | "gave"; since: string | null }[];
};

const C = "c1";
const days = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-09-${String(i + 1).padStart(2, "0")}`, "present"]));
/** 추민아 9월 실측 세 줄(공민규 상한 걸림 · 김은민 · 김윤호) + 단가 없는 한 줄. */
function sheet(over: Partial<FakeSheet> = {}): FakeSheet {
  const price = [{ unitPrice: 12500, monthly: false, daysBasis: false }];
  return {
    groups: [{
      classId: C, className: "중고E_중3 심화", subject: "english", isSpecial: false, makeupPool: false,
      matrix: {
        students: [
          { id: "kong", name: "공민규", grade: "중3" }, { id: "eun", name: "김은민", grade: "중3" },
          { id: "yun", name: "김윤호", grade: "중3" }, { id: "new", name: "신입생", grade: "중3" },
        ],
        marks: { kong: days(22), eun: days(18), yun: days(14), new: days(3) },
        units: {},
      },
    }],
    billing: {
      billed: { [rowKey(C, "kong")]: 325000, [rowKey(C, "eun")]: 300000, [rowKey(C, "yun")]: 175000 },
      confirmedSessions: {
        [rowKey(C, "kong")]: { units: 21, daysBasis: false, classUnits: 26 },
        [rowKey(C, "eun")]: { units: 19, daysBasis: false, classUnits: 24 },
        [rowKey(C, "yun")]: { units: 14, daysBasis: false, classUnits: 14 },
      },
      confirmedPrices: { [rowKey(C, "kong")]: price, [rowKey(C, "eun")]: price, [rowKey(C, "yun")]: price },
    },
    sessionBillingOn: true,
    unitSuffix: "U",
    handovers: [],
    ...over,
  };
}
const rates = (over: Partial<AttendanceSalaryRates> = {}): AttendanceSalaryRates => ({ ...emptyAttendanceRates(), regular: { 초등: 45, 중등: 45, 고등: 47.5 }, special: { 초등: 50, 중등: 50, 고등: 50 }, ...over });
const args = { tenantId: "t", teacherId: "minah", period: "2026-09", penaltyPoints: 0, contractRates: { 초등: 45, 중등: 45, 고등: 47.5, 수능: 50, 특강: 50 } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rates.mockResolvedValue({ rates: rates() });
  mocks.sheet.mockResolvedValue(sheet());
  mocks.substitutes.mockResolvedValue([]);
  mocks.settings.mockResolvedValue({ modules: { disabled: [] } });
});

describe("프리랜서 명세서 수업료 = 출석부 실급여 합계(원장 2026-10-06 '전부 통일 출석부 그대로 · 프리랜서만')", () => {
  it("출석부 합계 그대로 — 줄마다 floor1, 합계 내림 · 단위 글자는 그 출석부의 것", async () => {
    const r = (await computeSheetTuition(args))!;
    // 107,611.8 + 92,238.7 + 71,741.2 = 271,591.7
    expect(r.settlement).toMatchObject({ total: 271591, unitsTotal: 54, rowCount: 3, excludedUnits: 3, unitSuffix: "U", grossTuition: 262500 + 225000 + 175000 });
    expect(r.settlement!.lines.map((l) => [l.studentName, l.units, l.unitPrice, l.rate, l.gross, l.amount])).toEqual([
      ["공민규", 22, 12500, 45, 262500, 107611.8],
      ["김은민", 18, 12500, 45, 225000, 92238.7],
      ["김윤호", 14, 12500, 45, 175000, 71741.2],
    ]);
    expect(mocks.sheet).toHaveBeenCalledWith("t", "minah", "2026-09");
  });

  it("🔴 빠진 줄·상한에 걸린 줄을 조용히 넘기지 않는다 — 발행 전 확인에 적는다", async () => {
    const { warnings, settlement } = (await computeSheetTuition(args))!;
    expect(warnings.join("\n")).toContain("회차 확정 단가가 없어 빠진 1명(신입생) — 3시수가 산정에서 빠졌습니다.");
    expect(warnings.join("\n")).toContain("실수업액이 청구액보다 많아 청구액으로 계산한 줄이 1개 있습니다(공민규).");
    expect(settlement!.missingTierStudents).toEqual(["신입생"]);
  });

  it("🔴 프리랜서가 아니면 null — 호출부가 종전 티어 정산을 쓴다(정규직·요일 한정 급여 반은 그대로)", async () => {
    mocks.rates.mockResolvedValue(null);
    expect(await computeSheetTuition(args)).toBeNull();
  });

  it("🔴 혼합 계약(근로 + 용역)인데 용역 학년을 안 골랐으면 산정하지 않고 까닭을 적는다 — 근로 몫 학생까지 프리랜서 금액이 되지 않게", async () => {
    mocks.rates.mockResolvedValue({ rates: rates(), mixed: true });
    const r = (await computeSheetTuition(args))!;
    expect(r.settlement).toBeNull();
    expect(r.warnings.join("\n")).toContain("용역 학년을 골라야 산정합니다");
  });

  it("혼합 계약도 용역 학년을 골랐으면 그 학년 학생만 프리랜서처럼 산정한다", async () => {
    mocks.rates.mockResolvedValue({ rates: { ...rates(), levels: ["중등"] }, mixed: true });
    const r = (await computeSheetTuition(args))!;
    expect(r.levels).toEqual(["중등"]);
    expect(r.warnings.join("\n")).not.toContain("용역 학년을 골라야");
  });

  it("회차 정산이 꺼진 학원도 null — 출석부에 단가·실급여가 없다", async () => {
    mocks.sheet.mockResolvedValue(sheet({ sessionBillingOn: false }));
    expect(await computeSheetTuition(args)).toBeNull();
  });

  it("🔴 판정 순서 — 프리랜서 아님·회차 정산 꺼짐은 출석부 조립이 던져도 null(티어 정산)이다", async () => {
    const lens = new TeacherSheetError("강사뷰 상태에서는 다른 선생님의 출석부 금액을 계산할 수 없습니다");
    // 프리랜서가 아니다 — 조립 결과와 무관하게 종전 계산.
    mocks.rates.mockResolvedValue(null);
    mocks.sheet.mockRejectedValue(lens);
    expect(await computeSheetTuition(args)).toBeNull();
    // 회차 정산이 꺼진 학원의 프리랜서 — 조립이 던졌다고 '산정 불가'가 되면 렌즈와 무관한 티어 금액이 사라진다.
    mocks.rates.mockResolvedValue({ rates: rates() });
    mocks.settings.mockResolvedValue({ modules: { disabled: ["session_billing"] } });
    expect(await computeSheetTuition(args)).toBeNull();
    // 설정을 못 읽었으면 꺼짐 여부를 모른다 — 티어로 떨어뜨리지 않고 멈춘다(조립이 낸 사유 그대로).
    mocks.settings.mockResolvedValue(markFolded({ modules: { disabled: [] } }, "학원 설정을 읽지 못했습니다"));
    const r = await computeSheetTuition(args);
    expect(r?.settlement).toBeNull();
    expect(r?.warnings).toEqual([lens.message]);
  });

  it("산정할 줄이 하나도 없으면 settlement는 null — 0원짜리 명세서를 만들지 않는다", async () => {
    mocks.sheet.mockResolvedValue(sheet({ billing: { billed: {}, confirmedSessions: {}, confirmedPrices: {} } }));
    const r = (await computeSheetTuition(args))!;
    expect(r.settlement).toBeNull();
    expect(r.warnings[0]).toContain("산정할 수 있는 줄이 없어");
  });

  it("그 달 배분율 차감(%p)은 비율에 얹는다 — 출석부 합계와 그만큼만 다르다", async () => {
    const r = (await computeSheetTuition({ ...args, penaltyPoints: 2 }))!;
    expect(r.settlement!.lines.map((l) => l.rate)).toEqual([43, 43, 43]);
    expect(r.rates.base["중등"]).toBe(45);
    expect(r.rates.applied["중등"]).toBe(43);
    expect(r.settlement!.total).toBeLessThan(271591);
  });

  it("비율표는 계산에 쓴 출석부 비율을 과정으로 옮긴 것 — 못 옮기는 칸은 계약 비율 그대로", () => {
    const contract = { 초등: 45, 중등: 45, 고등: 47.5, 수능: 50, 특강: 50 };
    expect(sheetRatesAsGroups(rates({ regular: { 초등: 44, 중등: 46, 고등: 48 } }), contract)).toEqual({ 초등: 44, 중등: 46, 고등: 48, 수능: 50, 특강: 50 });
    // 특강 비율이 학년마다 다르면 한 값으로 옮기지 않는다(계약 비율을 그대로 둔다).
    expect(sheetRatesAsGroups(rates({ special: { 초등: 50, 중등: 52, 고등: 50 } }), contract)["특강"]).toBe(50);
    expect(sheetRatesAsGroups(rates({ special: { 초등: 55, 중등: 55, 고등: 55 } }), contract)["특강"]).toBe(55);
  });

  it("🔴 출석부를 금액으로 쓸 수 없는 상태는 null(티어 폴백)이 아니다 — 산정 불가 + 사유", async () => {
    // 다른 강사의 보기로 들어와 있거나 재료 조회가 접힌 경우: 프리랜서가 말없이 종전 티어 정산으로 떨어지면 다른 식의 금액이 발행된다.
    mocks.sheet.mockRejectedValue(new TeacherSheetError("강사뷰 상태에서는 다른 선생님의 출석부 금액을 계산할 수 없습니다 — 관리자뷰로 돌아간 뒤 다시 열어 주세요."));
    const r = await computeSheetTuition(args);
    expect(r).not.toBeNull();
    expect(r!.settlement).toBeNull();
    expect(r!.warnings).toEqual(["강사뷰 상태에서는 다른 선생님의 출석부 금액을 계산할 수 없습니다 — 관리자뷰로 돌아간 뒤 다시 열어 주세요."]);
    // 비율표는 그대로 찍는다(계약·출석부 비율은 읽혔다).
    expect(r!.rates.base["중등"]).toBe(45);
    // 그 밖의 오류는 삼키지 않는다 — 호출부(명세서)가 던지는 규약 그대로.
    mocks.sheet.mockRejectedValue(new Error("boom"));
    await expect(computeSheetTuition(args)).rejects.toThrow("boom");
  });

  it("🔴 출결이 아직 없는 달(전 줄 0시수)은 0원 명세서가 아니라 산정 불가", async () => {
    const base = sheet();
    base.groups[0]!.matrix.marks = {};
    mocks.sheet.mockResolvedValue(base);
    const r = (await computeSheetTuition(args))!;
    expect(r.settlement).toBeNull();
    expect(r.warnings[0]).toContain("산정할 수 있는 줄이 없어");
  });

  it("담임이 바뀐 반이 있으면 반 이름을 적어 알린다 — 상대 선생님 명세서와 겹침·누락 확인", async () => {
    mocks.sheet.mockResolvedValue(sheet({ handovers: [
      { className: "초등M 개별 JJ1I", kind: "took", since: "2026-09-10" },
      { className: "초등M 개별 JJ2N", kind: "gave", since: null },
    ] }));
    const { warnings } = (await computeSheetTuition(args))!;
    expect(warnings.join("\n")).toContain("담임이 바뀐 반이 2개 있습니다(초등M 개별 JJ1I, 초등M 개별 JJ2N) — 담임 몫 수업은 선생님이 담임이던 날의 것만 이 명세서에 들어 있습니다.");
  });

  it("🔴 다른 반 대신 보강 시수는 출석부 실급여에 없다 — 빠진 시수를 적는다(표에 선 반은 빼고 묻는다)", async () => {
    mocks.substitutes.mockResolvedValue([
      { classId: "other", className: "남의 반", studentId: "x", studentName: "한솔", date: "2026-09-12", status: "makeup", units: 1.5 },
      { classId: "other", className: "남의 반", studentId: "y", studentName: "결석생", date: "2026-09-13", status: "absent", units: 0 },
    ]);
    const { warnings, settlement } = (await computeSheetTuition(args))!;
    expect(warnings.join("\n")).toContain("다른 반 학생을 대신 보강한 1.5시수(한솔)는 이 명세서에 들어 있지 않습니다");
    // 금액은 출석부 합계 그대로다(대신 보강을 더하지 않는다).
    expect(settlement!.total).toBe(271591);
    // 돈 경로는 조회 실패를 '없음'으로 접지 않게 부른다(strict).
    expect(mocks.substitutes).toHaveBeenCalledWith({ tenantId: "t", teacherId: "minah", month: "2026-09", excludeClassIds: [C] }, { strict: true });
  });

  it("🔴 대신 보강 조회가 실패하면 '없음'이 아니라 '확인하지 못했다'고 적는다 — 금액은 그대로 산정한다", async () => {
    mocks.substitutes.mockRejectedValue(new Error("timeout"));
    const { warnings, settlement } = (await computeSheetTuition(args))!;
    expect(warnings.join(" ")).toContain("다른 반 학생을 대신 보강한 시수가 있는지 확인하지 못했습니다");
    expect(settlement!.total).toBe(271591);
  });

  it("청구액을 몰라 상한 없이 계산한 줄은 따로 적는다", async () => {
    const base = sheet();
    delete base.billing.billed[rowKey(C, "yun")];
    mocks.sheet.mockResolvedValue(base);
    const { warnings } = (await computeSheetTuition(args))!;
    expect(warnings.join("\n")).toContain("청구액을 확인할 수 없어 실수업액 그대로 계산한 줄이 1개 있습니다(김윤호).");
  });

  it("반별로 따로 정한 비율이 있으면 비율표와 다를 수 있다고 적는다", async () => {
    mocks.rates.mockResolvedValue({ rates: rates({ classes: { [C]: 40 } }) });
    const r = (await computeSheetTuition(args))!;
    expect(r.settlement!.lines.every((l) => l.rate === 40)).toBe(true);
    expect(r.warnings.join("\n")).toContain("반별로 따로 정한 비율");
  });
});

describe("배선 — 명세서와 강사 정산 면이 같은 갈림을 탄다", () => {
  const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\s+/g, " ");
  const payslip = read("src/features/payroll/server/payslip-queries.ts");
  const face = read("src/features/payroll/server/tuition-view.ts");

  it("🔴 프리랜서·혼합만 출석부 기준이다 — 판정은 출석부가 실급여 열을 세우는 값(`users.employment_type`) 하나(`hasFreelancePart`)", () => {
    expect(payslip).toContain("const isFreelancer = hasFreelancePart(teacher.employment_type as string | null);");
    expect(payslip).toContain("isFreelancer ? await computeSheetTuition(");
    expect(face).toContain('return hasFreelancePart(u.employment_type) && !(slip?.status === "issued" && slip.print_payload);');
    expect(face).toContain("await computeSheetTuition(");
    // 정산 면은 프리랜서 출석부를 몇 명씩만 동시에 조립한다(전원을 한꺼번에 띄우지 않는다).
    expect(face).toContain("for (let i = 0; i < sheetTargets.length; i += SHEET_CONCURRENCY)");
  });

  it("출석부로 산정할 수 없으면(null) 종전 티어 정산으로 떨어진다 — 조용히 0원이 되지 않는다", () => {
    expect(payslip).toContain("return sheet ? { sheet, tier: null } : { sheet: null, tier: await tierTuition() };");
    expect(face).toMatch(/if \(sheet\) \{ return \{[^}]*tuition: sheet\.settlement\?\.total \?\? null/);
    // 🔴 조립에 실패한 프리랜서를 티어 정산으로 떨어뜨리지 않는다 — 다른 식의 금액이 명세서와 갈린다.
    expect(face).toContain('if (sheet === "failed") { return { ...base, unitsTotal: 0, tuition: null,');
  });

  it("🔴 발행 액션은 이동 신호를 삼키지 않는다 — 프리랜서 명세서는 출석부 조회(권한 확인)를 지난다", () => {
    const actions = read("src/features/payroll/server/payslip-actions.ts");
    expect(actions).toMatch(/data = await getPayslipData\(teacherId, period\); \} catch \(e\) \{[^}]*unstable_rethrow\(e\);/);
  });

  it("명세서는 근거를 밝힌다(`tuitionBasis`) — 별지가 같은 출석부를 붙인다", () => {
    expect(payslip).toContain('tuitionBasis: sheet ? "sheet" : "tier",');
    const page = read("src/app/(print)/payroll/[teacherId]/payslip/page.tsx");
    expect(page).toContain('data.tuitionBasis === "sheet" ? loadTeacherSheet(user.tenantId, teacherId, period)');
    // 출석부를 금액으로 쓸 수 없는 상태면 별지를 비우되, 본문이 금액을 보이는 발행본에서는 그 사실을 화면에 적는다 — 그 밖의 오류는 던진다.
    expect(page).toContain("if (e instanceof TeacherSheetError) return { groups: [], missing: true };");
    expect(page).toContain("const appendixMissing = appendixResult.missing && data.settlement !== null;");
    expect(page).toMatch(/\{appendixMissing \? \( <p className="[^"]*print:hidden[^"]*">/);
  });
});

/** 원장 2026-10-07 *"이성우 선생님은 … 고등학생에 대해서만 급여 명세서가 나오도록"* — 대상 학년. */
describe("대상 학년을 좁힌 선생님의 명세서", () => {
  const price = [{ unitPrice: 30000, monthly: false, daysBasis: false }];
  const mixedSheet = () => sheet({
    groups: [{
      classId: C, className: "고등M 단체 BS4F", subject: "math", isSpecial: false, makeupPool: false,
      matrix: {
        students: [{ id: "h1", name: "고일", grade: "고1" }, { id: "m1", name: "중삼", grade: "중3" }, { id: "m2", name: "중이", grade: "중2" }],
        marks: { h1: days(8), m1: days(8), m2: days(6) },
        units: {},
      },
    }],
    billing: { billed: {}, confirmedSessions: {}, confirmedPrices: { [rowKey(C, "h1")]: price, [rowKey(C, "m1")]: price, [rowKey(C, "m2")]: price } },
    unitSuffix: "T",
  });

  it("고등학생 줄만 수업료에 들어가고, 그 사실과 빠진 학년의 사람 수·시수를 적는다", async () => {
    mocks.rates.mockResolvedValue({ rates: rates({ levels: ["고등"] }) });
    mocks.sheet.mockResolvedValue(mixedSheet());
    const r = await computeSheetTuition(args);
    expect(r?.levels).toEqual(["고등"]);
    expect(r?.settlement?.lines.map((l) => l.studentName)).toEqual(["고일"]);
    expect(r?.settlement?.unitsTotal).toBe(8);
    expect(r?.settlement?.total).toBe(103854); // 30,000 × 8 × 0.911 × 47.5%
    expect(r?.warnings[0]).toBe("고등 학생만 산정한 명세서입니다(출석부 '비율 설정'의 대상 학년) — 그 밖 학년 2명 · 14시수는 들어 있지 않습니다.");
    // 다른 학년은 '배분율이 없어 빠진' 줄이 아니다.
    expect(r?.warnings.join("\n")).not.toContain("배분율이 정해지지 않아");
    // 비율표에는 대상 학년만(계산에 쓰지 않는 초등·중등 비율을 찍지 않는다).
    expect(r?.rates.base).toEqual({ 고등: 47.5, 수능: 50, 특강: 50 });
  });
  it("전 학년 특강 예외가 수업료·경고·비율·명세서 범위에 함께 반영된다", async () => {
    mocks.rates.mockResolvedValue({ rates: rates({ levels: ["고등"], includeSpecial: true }) });
    const s = mixedSheet();
    s.groups[0]!.className = "주말내신특강(중3) (~26.09.19)";
    s.groups[0]!.isSpecial = true;
    mocks.sheet.mockResolvedValue(s);
    const r = await computeSheetTuition(args);
    expect(r?.includeSpecial).toBe(true);
    expect(r?.levels).toEqual(["고등"]);
    expect(r?.settlement?.lines.map((l) => l.studentName)).toEqual(["고일", "중삼", "중이"]);
    expect(r?.settlement?.total).toBe(300630); // 22 × 30,000 × 0.911 × 50%
    expect(r?.rates.base).toEqual({ 고등: 47.5, 수능: 50, 특강: 50 });
    expect(r?.classScope).toEqual([{ id: C, className: s.groups[0]!.className, isSpecial: true }]);
    expect(r?.warnings[0]).toContain("고등 학생과 전 학년 특강을 산정한 명세서");
    expect(r?.warnings.join("\n")).not.toContain("그 밖 학년");
  });

  it("학년을 모르는 학생은 '배분율'이 아니라 학년 미입력으로 적는다 — 무엇을 고쳐야 하는지 말한다", async () => {
    mocks.rates.mockResolvedValue({ rates: rates({ levels: ["고등"] }) });
    const s = mixedSheet();
    s.groups[0]!.matrix.students.push({ id: "u1", name: "학년없음", grade: null });
    s.groups[0]!.matrix.marks.u1 = days(2);
    s.billing.confirmedPrices[rowKey(C, "u1")] = price;
    mocks.sheet.mockResolvedValue(s);
    const r = await computeSheetTuition(args);
    const text = r!.warnings.join("\n");
    expect(text).toContain("학년이 비어 있거나 초·중·고로 분류되지 않아(예: 7세) 대상 학년인지 판정하지 못한 1명(학년없음) — 2시수가 산정에서 빠졌습니다.");
    expect(text).not.toContain("배분율이 정해지지 않아");
    expect(r?.settlement?.lines.map((l) => l.studentName)).toEqual(["고일"]);
  });

  it("대상을 좁히지 않은 선생님은 문구도 `levels`도 없다 — 종전 그대로", async () => {
    mocks.sheet.mockResolvedValue(mixedSheet());
    const r = await computeSheetTuition(args);
    expect(r?.levels).toBeUndefined();
    expect(r?.settlement?.lines.map((l) => l.studentName)).toEqual(["고일", "중삼", "중이"]);
    expect(r?.warnings.join("\n")).not.toContain("학생만 산정한 명세서");
  });

  it("비율표 — 대상 밖 학년은 계약 비율도 찍지 않고, 특강은 대상 학년끼리만 같은지 본다", () => {
    const r = rates({ levels: ["중등", "고등"], regular: { 초등: 40, 중등: 45, 고등: 47.5 }, special: { 초등: 55, 중등: 50, 고등: 50 } });
    expect(sheetRatesAsGroups(r, args.contractRates)).toEqual({ 중등: 45, 고등: 47.5, 수능: 50, 특강: 50 });
  });

  it("🔴 명세서 지표(수업인원·퇴원)와 별지도 같은 학년만 — 한 장에서 말이 갈리지 않게(배선)", () => {
    const queries = readFileSync("src/features/payroll/server/payslip-queries.ts", "utf8");
    expect(queries).toContain("loadMetrics(supabase, period, year, tuitionPromise.then((t) => ({");
    expect(queries).toContain("levels: t.sheet?.levels, includeSpecial: t.sheet?.includeSpecial, classes: t.sheet?.classScope ?? classes,");
    expect(queries).toContain("...(sheet?.levels?.length ? { sheetLevels: sheet.levels } : {}),");
    const page = readFileSync("src/app/(print)/payroll/[teacherId]/payslip/page.tsx", "utf8");
    expect(page).toContain("students: g.matrix.students.filter((s) => !salaryRowOutOfScope(salaryScope, s.grade, g))");
    expect(page).toContain("scopeNote={salaryScopeLabel(salaryScope)}");
    // '담당 반'도 대상 학년 학생이 있는 반만 · 비율표의 대상 밖 학년 칸은 기본 비율로도 메우지 않는다.
    expect(queries).toContain("...(scopedClassCount !== undefined ? { scopedClassCount } : {}),");
    const doc = readFileSync("src/app/(print)/payroll/[teacherId]/payslip/payslip-document.tsx", "utf8");
    expect(doc).toContain("{metrics.scopedClassCount ?? data.teacher.classes.length}개");
    expect(doc).toContain("(outOfScope(g) ? undefined : rates.base[g] ?? rates.baseDefault ?? undefined)");
    // 출석부의 대상 밖 줄 '—'는 "대상 학년이 아니다"라고 말한다(단가·비율 미설정 문구가 아니다).
    expect(readFileSync("src/app/(shell)/attendance/_components/matrix-table.tsx", "utf8").split("actualSalaryOutOfScope={showActualSalary && salaryRowOutOfScope(salaryRates!, s.grade, g)}").length - 1).toBe(2);
    expect(readFileSync("src/app/(shell)/attendance/_components/live-totals.tsx", "utf8")).toContain('outOfScope ? "att.row.actualSalaryOutOfScope" : "att.row.actualSalaryUnavailable"');
  });
});
