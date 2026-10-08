import { describe, expect, it } from "vitest";
import { rowKey } from "./grid/model";
import { emptyAttendanceRates, type AttendanceSalaryRates } from "./salary-rates";
import { teacherSheetSalary, type SheetSalaryGroup } from "./sheet-salary";

const C = "c1";
const rates = (over: Partial<AttendanceSalaryRates> = {}): AttendanceSalaryRates => ({ ...emptyAttendanceRates(), regular: { 중등: 45, 고등: 47.5 }, special: { 중등: 50 }, ...over });
const price = (unitPrice: number, over: object = {}) => [{ unitPrice, monthly: false, daysBasis: false, ...over }];
/** 출석 칸 n개(각 1시수)짜리 학생. */
const marksOf = (n: number, units: Record<string, number> = {}) => ({
  marks: Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-09-${String(i + 1).padStart(2, "0")}`, "present"])),
  units,
});
function group(students: { id: string; name: string; grade: string | null; n: number; units?: Record<string, number> }[], over: Partial<SheetSalaryGroup> = {}): SheetSalaryGroup {
  return {
    classId: C, className: "중고E_중3 심화",
    students: students.map(({ id, name, grade }) => ({ id, name, grade })),
    marks: Object.fromEntries(students.map((s) => [s.id, marksOf(s.n).marks])),
    units: Object.fromEntries(students.map((s) => [s.id, s.units ?? {}])),
    ...over,
  };
}

describe("강사 전체 보기 실급여 — 출석부 합계 행과 같은 식(원장 2026-10-06 '프리랜서 명세서 = 출석부 그대로')", () => {
  it("줄 = floor1(min(단가 × 시수, 이 선생님 몫의 청구액) × 0.911 × 비율) — 실측 추민아 9월 세 줄", () => {
    // 공민규: 22시수 · 등록 21/26 · 청구(이월 포함) 325,000 → 상한 262,500 → 107,611.8
    // 김은민: 18시수 · 등록 19/24 · 청구 300,000 → 상한 237,500(안 걸림) → 92,238.7
    // 김윤호: 14시수 · 등록 14/14 · 청구 175,000 → 71,741.2
    const g = group([
      { id: "kong", name: "공민규", grade: "중3", n: 22 },
      { id: "eun", name: "김은민", grade: "중3", n: 18 },
      { id: "yun", name: "김윤호", grade: "중3", n: 14 },
    ]);
    const result = teacherSheetSalary({
      groups: [g],
      billed: { [rowKey(C, "kong")]: 325000, [rowKey(C, "eun")]: 300000, [rowKey(C, "yun")]: 175000 },
      terms: {
        [rowKey(C, "kong")]: { units: 21, daysBasis: false, classUnits: 26 },
        [rowKey(C, "eun")]: { units: 19, daysBasis: false, classUnits: 24 },
        [rowKey(C, "yun")]: { units: 14, daysBasis: false, classUnits: 14 },
      },
      prices: { [rowKey(C, "kong")]: price(12500), [rowKey(C, "eun")]: price(12500), [rowKey(C, "yun")]: price(12500) },
      rates: rates(),
    });
    expect(result.lines.map((l) => [l.studentName, l.amount, l.capped])).toEqual([
      ["공민규", 107611.8, true],
      ["김은민", 92238.7, false],
      ["김윤호", 71741.2, false],
    ]);
    // 합계는 줄의 합을 원 단위로 내림(107,611.8 + 92,238.7 + 71,741.2 = 271,591.7).
    expect(result.total).toBe(271591);
    expect(result.unitsTotal).toBe(54);
    expect(result.baseTotal).toBe(262500 + 225000 + 175000);
    expect(result.excluded).toEqual([]);
  });

  it("칸의 배수를 시수로 센다(화면 첫 렌더와 같은 countMarks) · 결석 칸은 시수가 아니다", () => {
    const g = group([{ id: "s1", name: "가", grade: "중1", n: 2, units: { "2026-09-01": 1.5 } }]);
    g.marks.s1!["2026-09-03"] = "absent";
    const r = teacherSheetSalary({ groups: [g], billed: {}, terms: {}, prices: { [rowKey(C, "s1")]: price(20000) }, rates: rates() });
    expect(r.lines[0]!.units).toBe(2.5);
    // 청구액을 모르면 상한이 없다(모르는 것을 0으로 읽지 않는다) — 그 사실은 줄에 남긴다(명세서가 알린다).
    expect(r.lines[0]!.base).toBe(50000);
    expect(r.lines[0]!.capUnknown).toBe(true);
    const known = teacherSheetSalary({ groups: [g], billed: { [rowKey(C, "s1")]: 60000 }, terms: {}, prices: { [rowKey(C, "s1")]: price(20000) }, rates: rates() });
    expect(known.lines[0]!.capUnknown).toBe(false);
  });

  it("🔴 시수가 없는 줄은 줄로 세우지 않는다 — 단가·비율만 갖춘 0시수 줄이 합계를 0원으로 만들지 않는다", () => {
    // 회차 확정은 끝났고 출결이 아직 없는 달: 전 줄이 0시수 → 합계는 0이 아니라 null(산정 불가).
    const empty = group([{ id: "s1", name: "가", grade: "중1", n: 0 }, { id: "s2", name: "나", grade: "중1", n: 0 }]);
    const prices = { [rowKey(C, "s1")]: price(20000), [rowKey(C, "s2")]: price(20000) };
    const none = teacherSheetSalary({ groups: [empty], billed: {}, terms: {}, prices, rates: rates() });
    expect(none.total).toBeNull();
    expect(none.lines).toEqual([]);
    expect(none.excluded).toEqual([]);
    // 시수 있는 줄이 하나라도 있으면 그 줄만 선다(0시수 줄은 합계에 아무것도 더하지 않는다).
    const mixed = group([{ id: "s1", name: "가", grade: "중1", n: 0 }, { id: "s2", name: "나", grade: "중1", n: 2 }]);
    const some = teacherSheetSalary({ groups: [mixed], billed: {}, terms: {}, prices, rates: rates() });
    expect(some.lines.map((l) => l.studentName)).toEqual(["나"]);
    expect(some.unitsTotal).toBe(2);
  });

  it("🔴 단가를 하나로 못 정하거나 비율이 없는 줄은 0원으로 치지 않고 빠진 줄로 적는다", () => {
    const g = group([
      { id: "noprice", name: "단가없음", grade: "중1", n: 3 },
      { id: "monthly", name: "월정액", grade: "중1", n: 3 },
      { id: "norate", name: "비율없음", grade: "초3", n: 2 },
      { id: "zero", name: "시수없음", grade: "중1", n: 0 },
      { id: "ok", name: "정상", grade: "중1", n: 1 },
    ]);
    const r = teacherSheetSalary({
      groups: [g], billed: {}, terms: {},
      prices: { [rowKey(C, "monthly")]: price(250000, { monthly: true }), [rowKey(C, "norate")]: price(20000), [rowKey(C, "ok")]: price(20000) },
      rates: rates(),
    });
    expect(r.lines.map((l) => l.studentName)).toEqual(["정상"]);
    expect(r.excluded.map((e) => [e.studentName, e.reason, e.units])).toEqual([
      ["단가없음", "no-price", 3],
      ["월정액", "no-price", 3],
      ["비율없음", "no-rate", 2],
    ]);
    expect(r.excludedUnits).toBe(8);
  });

  it("산정된 줄이 하나도 없으면 합계는 null — 0원을 지어내지 않는다", () => {
    const r = teacherSheetSalary({ groups: [group([{ id: "s1", name: "가", grade: "중1", n: 3 }])], billed: {}, terms: {}, prices: {}, rates: rates() });
    expect(r.total).toBeNull();
    expect(r.excludedUnits).toBe(3);
  });

  it("비율은 화면과 같은 축 — 학년(초·중·고) · 특강 반 · 반별 지정이 이긴다", () => {
    const special = group([{ id: "s1", name: "가", grade: "중2", n: 1 }], { classId: "sp", className: "[특강] 중2 문제풀이", isSpecial: true });
    const override = group([{ id: "s1", name: "가", grade: "고1", n: 1 }], { classId: "ov", className: "고등M 개별" });
    const r = teacherSheetSalary({
      groups: [special, override], billed: {}, terms: {},
      prices: { [rowKey("sp", "s1")]: price(10000), [rowKey("ov", "s1")]: price(10000) },
      rates: rates({ classes: { ov: 40 } }),
    });
    expect(r.lines.map((l) => l.rate)).toEqual([50, 40]);
  });

  it("명세서의 배분율 차감(%p)은 비율을 고른 뒤에 뺀다 — 출석부(차감 없음)와 그만큼만 다르다", () => {
    const g = group([{ id: "s1", name: "가", grade: "중1", n: 10 }]);
    const args = { groups: [g], billed: {}, terms: {}, prices: { [rowKey(C, "s1")]: price(10000) }, rates: rates() };
    expect(teacherSheetSalary(args).lines[0]!.rate).toBe(45);
    const penalized = teacherSheetSalary({ ...args, adjustRate: (rate) => Math.max(0, rate - 2) });
    expect(penalized.lines[0]!.rate).toBe(43);
    expect(penalized.total).toBe(Math.floor(Math.floor(100000 * 0.911 * 0.43 * 10) / 10));
  });
});

/** 원장 2026-10-07 *"이성우 선생님은 … 고등학생에 대해서만 급여 명세서가 나오도록"* — 대상 학년(`rates.levels`). */
describe("대상 학년 — 고른 학년의 학생 줄만 실급여에 들어간다", () => {
  it("받은 금액이 있는 중등 특강은 포함하고 같은 학생의 중등 정규는 제외한다 — 상한·0원·미확정은 유지", () => {
    const student = { id: "s1", name: "학생", grade: "중3", n: 4 };
    const regular = group([student], { classId: "regular", className: "고등M 개별" });
    const special = group([student], { classId: "special", className: "주말내신특강(중3) (~26.09.19)" });
    const input = { groups: [regular, special], billed: { [rowKey("special", "s1")]: 60000 }, terms: {}, prices: { [rowKey("special", "s1")]: price(20000), [rowKey("regular", "s1")]: price(20000) }, rates: rates({ levels: ["고등"], includeSpecial: true }) };
    const result = teacherSheetSalary(input);
    expect(result.lines).toEqual([expect.objectContaining({ classId: "special", amount: 27330, base: 60000, capped: true })]);
    expect(result.outOfScope).toEqual({ students: 1, units: 4 });
    expect(teacherSheetSalary({ ...input, billed: { [rowKey("special", "s1")]: 0 } }).total).toBe(0);
    expect(teacherSheetSalary({ ...input, prices: {} }).excluded).toEqual([expect.objectContaining({ classId: "special", reason: "no-price" })]);
    expect(teacherSheetSalary({ ...input, rates: rates({ levels: ["고등"] }) }).total).toBeNull();
  });
  const mixed = group([
    { id: "h1", name: "고일", grade: "고1", n: 8 },
    { id: "h2", name: "고이", grade: "고2", n: 4 },
    { id: "m1", name: "중삼", grade: "중3", n: 8 },
    { id: "m2", name: "중이", grade: "중2", n: 6 },
    { id: "u1", name: "학년없음", grade: null, n: 2 },
  ], { className: "고등M 단체 BS4F" });
  const all = Object.fromEntries(["h1", "h2", "m1", "m2", "u1"].map((id) => [rowKey(C, id), price(30000)]));
  const run = (over: Partial<AttendanceSalaryRates>) => teacherSheetSalary({ groups: [mixed], billed: {}, terms: {}, prices: all, rates: rates(over) });

  it("고등만 고르면 고등학생 줄만 — 다른 학년은 '빠진 줄'도 아니고 금액에도 없다('고등M' 반의 중3 포함)", () => {
    const r = run({ levels: ["고등"] });
    expect(r.lines.map((l) => l.studentName)).toEqual(["고일", "고이"]);
    expect(r.unitsTotal).toBe(12);
    // 줄 = floor1(30,000 × 시수 × 0.911 × 47.5%)
    expect(r.total).toBe(Math.floor((Math.round(103854 * 10) + Math.round(51927 * 10)) / 10));
    // 대상 밖 줄은 사람 수·시수만 센다(확인용).
    expect(r.outOfScope).toEqual({ students: 2, units: 14 });
    // 🔴 학년을 모르는 학생은 말없이 빠지지 않는다 — '빠진 줄'(비율 없음)로 드러난다.
    //    사유는 '비율 없음'이 아니라 '학년 모름'이다(비율은 정해져 있다 — 학년을 입력하면 풀린다).
    expect(r.excluded).toEqual([{ classId: C, studentId: "u1", studentName: "학년없음", units: 2, reason: "no-level" }]);
    // 대상을 좁히지 않은 선생님에게 학년 모름은 종전대로 '비율 없음'이다.
    expect(run({}).excluded).toEqual([{ classId: C, studentId: "u1", studentName: "학년없음", units: 2, reason: "no-rate" }]);
  });

  it("대상을 좁히지 않으면 종전 그대로 — 중등·고등 줄이 다 서고 대상 밖은 0", () => {
    const r = run({});
    expect(r.lines.map((l) => l.studentName)).toEqual(["고일", "고이", "중삼", "중이"]);
    expect(r.outOfScope).toEqual({ students: 0, units: 0 });
  });

  it("대상 학년에 아무도 없으면 합계는 null — 0원을 지어내지 않는다", () => {
    const r = run({ levels: ["초등"] });
    expect(r.total).toBeNull();
    expect(r.lines).toEqual([]);
    expect(r.outOfScope).toEqual({ students: 4, units: 26 });
  });
});
