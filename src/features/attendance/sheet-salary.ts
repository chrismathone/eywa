/**
 * 강사 전체 보기의 **실급여**를 줄마다 — 출석부 합계 행의 '실급여'와 **같은 식·같은 재료**(순수 · Vitest).
 *
 * 원장 2026-10-06(프리랜서 강의용역수수료 명세서가 '산정 불가'인 캡처): *"수수료 명세서도 배선해주고"* →
 * *"전부 통일 출석부 그대로"* · *"프리랜서만."* — 프리랜서 명세서의 수업료 = 그 강사 출석부(강사 전체 보기)의 실급여 합계.
 *
 * 🔑 식은 화면과 한 벌이다 — 줄 = `actualLessonSalary(확정 단가, 수업 차수, 비율, 이 선생님 몫의 청구액)`
 *    ([`salary-rates.ts`](./salary-rates.ts) · 화면은 `live-totals.tsx`의 합계 칸이 같은 함수를 부른다), 합계 = `sumSalaryAmounts`(줄의 합을 원 단위로 내림).
 *    수업 차수는 화면 첫 렌더와 같은 `countMarks`(그 강사 교시 칸만 — 매트릭스가 이미 그 렌즈로 온다).
 * 🔴 여기서 식을 새로 만들지 않는다 — 단가·상한·라운딩을 바꾸려면 `salary-rates.ts`를 고친다(그래야 화면과 명세서가 함께 움직인다).
 * ⚠️ 줄이 산정에서 빠지는 이유는 화면과 같다: 회차 확정 단가가 하나로 안 정해짐(미확정·월 정액·옛 일수 기준·단가 여럿) · 비율 없음.
 *    빠진 줄은 0원으로 치지 않고 따로 적는다(`excluded`).
 */
import type { AttendanceConfirmedPrice, AttendanceTermSessions } from "./class-billing";
import { rowKey } from "./grid/model";
import { countMarks } from "./grid/totals";
import {
  actualLessonSalary,
  actualSalaryBase,
  attendanceRateLevel,
  attendanceSalaryRate,
  salaryBilledCap,
  salaryRowOutOfScope,
  sumSalaryAmounts,
  type AttendanceSalaryRates,
} from "./salary-rates";

/** 표의 한 묶음(반) — 출석부 화면이 표에 넘기는 것과 같은 재료. */
export type SheetSalaryGroup = {
  classId: string;
  /** 🔴 **원래 반 이름** — 특강 판정(`isSpecialLecture`)이 이름을 읽는다. */
  className: string;
  isSpecial?: boolean;
  students: readonly { id: string; name: string; grade: string | null }[];
  marks: Readonly<Record<string, Record<string, string>>>;
  units: Readonly<Record<string, Record<string, number>>>;
};

export type SheetSalaryLine = {
  classId: string;
  studentId: string;
  studentName: string;
  /** 수업 차수 — 그 강사 칸의 시수 합. */
  units: number;
  unitPrice: number;
  /** 적용 비율(%). */
  rate: number;
  /** 실급여의 바탕 금액 = 실수업액(단가 × 시수)과 이 선생님 몫의 청구액 중 작은 쪽. */
  base: number;
  /** 청구액 상한에 걸렸나(실수업액 > 청구액). */
  capped: boolean;
  /** 청구액을 몰라 **상한 없이** 실수업액 그대로 계산했나(화면과 같은 규칙 — 모르는 것을 0으로 읽지 않는다). */
  capUnknown: boolean;
  /** 이 줄의 실급여 = floor1(바탕 × 0.911 × 비율%). */
  amount: number;
};

export type SheetSalaryExcluded = {
  classId: string;
  studentId: string;
  studentName: string;
  units: number;
  /**
   * `no-price` 회차 확정 단가를 하나로 못 정함 · `no-rate` 비율 없음 ·
   * `no-level` 대상 학년을 좁힌 선생님인데 이 학생의 학년이 비었거나 초·중·고로 분류되지 않는다(예: 7세 — 대상인지 확인할 수 없어 계산하지 않았다).
   */
  reason: "no-price" | "no-rate" | "no-level";
};

export type SheetSalaryResult = {
  /** 실급여 합계(원, 내림) — 산정된 줄이 하나도 없으면 null(0원을 지어내지 않는다). */
  total: number | null;
  lines: SheetSalaryLine[];
  /** 산정된 줄의 시수 합 · 바탕 금액 합. */
  unitsTotal: number;
  baseTotal: number;
  /** 시수가 있는데 산정에서 빠진 줄. */
  excluded: SheetSalaryExcluded[];
  excludedUnits: number;
  /**
   * **대상 학년 밖**이라 처음부터 계산하지 않은 줄(대상 학년을 좁힌 선생님만 — `rates.levels`). 빠진 줄(`excluded`)과 다르다:
   * 고칠 것이 아니라 이 선생님의 실급여에 원래 들어가지 않는 줄이다. 확인용으로 사람 수·시수만 센다.
   */
  outOfScope: { students: number; units: number };
};

export function teacherSheetSalary(input: {
  groups: readonly SheetSalaryGroup[];
  billed: Readonly<Record<string, number>>;
  terms: Readonly<Record<string, AttendanceTermSessions>>;
  prices: Readonly<Record<string, readonly AttendanceConfirmedPrice[]>>;
  rates: AttendanceSalaryRates;
  /**
   * 그 달 명세서의 배분율 차감(%p) — 출석부 화면은 0이다. 비율을 고른 **뒤에** 뺀다(`adjustRate`).
   * 생략하면 화면과 같은 값.
   */
  adjustRate?: (rate: number) => number;
}): SheetSalaryResult {
  const lines: SheetSalaryLine[] = [];
  const excluded: SheetSalaryExcluded[] = [];
  let unitsTotal = 0;
  let baseTotal = 0;
  let excludedUnits = 0;
  const outStudents = new Set<string>();
  let outUnits = 0;
  for (const g of input.groups) {
    for (const s of g.students) {
      const key = rowKey(g.classId, s.id);
      const units = countMarks(g.marks[s.id] ?? {}, g.units[s.id] ?? {}).units;
      // 🔴 시수가 없는 줄은 빠진 것도 산정된 것도 아니다 — 받을 것이 없는 줄이다. 줄로 세우면 단가·비율만 갖춘
      //    0시수 줄들이 합계를 null이 아니라 **0원**으로 만들어, 출결이 아직 없는 달에 "₩0 · 0시수" 명세서가 발행된다.
      if (!(units > 0)) continue;
      // 대상 학년 밖(원장 2026-10-07 — 고등학생에게만 프리랜서를 적용하는 선생님) — 산정도 '빠진 줄'도 아니다.
      if (salaryRowOutOfScope(input.rates, s.grade)) {
        outStudents.add(s.id);
        outUnits += units;
        continue;
      }
      const prices = input.prices[key];
      const picked = attendanceSalaryRate(input.rates, { classId: g.classId, className: g.className, isSpecial: g.isSpecial, grade: s.grade });
      const rate = picked == null ? null : input.adjustRate ? input.adjustRate(picked) : picked;
      const cap = salaryBilledCap(input.billed[key], input.terms[key]);
      const base = actualSalaryBase(prices, units, cap);
      const amount = actualLessonSalary(prices, units, rate, cap);
      if (amount === null || base === null || rate === null) {
        const noLevel = !!input.rates.levels?.length && attendanceRateLevel(s.grade) === null;
        excluded.push({ classId: g.classId, studentId: s.id, studentName: s.name, units, reason: noLevel ? "no-level" : base === null ? "no-price" : "no-rate" });
        excludedUnits += units;
        continue;
      }
      unitsTotal += units;
      baseTotal += base.base;
      lines.push({ classId: g.classId, studentId: s.id, studentName: s.name, units, unitPrice: prices![0]!.unitPrice, rate, base: base.base, capped: base.capped, capUnknown: cap === undefined, amount });
    }
  }
  return {
    total: lines.length > 0 ? sumSalaryAmounts(lines.map((line) => line.amount)) : null,
    lines,
    unitsTotal: Math.round(unitsTotal * 10) / 10,
    baseTotal,
    excluded,
    excludedUnits: Math.round(excludedUnits * 10) / 10,
    outOfScope: { students: outStudents.size, units: Math.round(outUnits * 10) / 10 },
  };
}
