/**
 * 월별 출석부 **이월 표식 카드** — 등록 차수 칸(주황)에 마우스를 올리면 뜨는 카드의 재료(순수 모듈, Vitest).
 *
 * 원장 2026-10-06: *"출석부에 이월 처리된 회차가 있다고 색으로 표시해주면 좋을것 같은데, 이월처리된 회차가 있으면
 * 등록차수에 셀 색을 주황색으로 해주고, 마우스오버시에 몇회차 이월됐는지 표시해줘"*.
 *
 * 🔑 이월은 **금액**으로 저장된다(0278a — 회차 확정 화면이 '금액 이월'이라 부르는 그것. 회차(시수) 이월 0134a와는 다른 물건이다).
 *    회차는 그 금액을 그 줄의 확정 단가로 나눈 값이라, 단가를 하나로 못 정하는 줄(미확정·월 정액·단가 여럿·옛 일수 기준)은
 *    금액만 적는다 — 회차를 지어내지 않는다.
 * 🔴 **표시 전용**이다 — 등록 차수 숫자는 회차 확정의 확정 시수 그대로다(이월했다고 저절로 늘지 않는다). 카드가 그 사실을 적는다.
 */
import type { TipCard, TipRow } from "@/components/hover-tip/tip";
import { sheetMonthLabel, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import type { AttendanceCarryMark, AttendanceCarryPart } from "./class-billing";
import { formatMoney } from "./money-format";
import { formatUnitsWithSuffix, type AttendanceUnitSuffix } from "./unit-suffix";

/** `2026-08` → `8월`(영어 `August 2026`). 형식이 아니면 null — 달을 지어내지 않는다. */
function monthOf(period: string, lang: SheetLang): string | null {
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.exec(period);
  return m ? sheetMonthLabel(period, `${Number(m[1])}월`, lang) : null;
}

/** 회차로 적을 수 있나 — 단가를 못 정했거나, 0.1 단위로 반올림하면 0이 되는 작은 금액(`약 0.0`은 아무 말도 아니다)은 금액만. */
function showsUnits(part: AttendanceCarryPart): part is AttendanceCarryPart & { units: number } {
  return part.units !== null && Number.isFinite(part.units) && Math.round(part.units * 10) >= 1;
}

/** `2.0 U · 25,000원` — 0.1 단위로 안 떨어지면 `약`을 붙이고, 회차를 못 구하면 금액만. */
function partValue(part: AttendanceCarryPart, suffix: AttendanceUnitSuffix, lang: SheetLang): string {
  const amount = formatMoney(part.amount);
  if (!showsUnits(part)) return sheetTf(lang, "att.row.carry.amountOnly", { amount });
  const exact = Math.abs(part.units * 10 - Math.round(part.units * 10)) < 1e-6;
  return sheetTf(lang, exact ? "att.row.carry.value" : "att.row.carry.valueApprox", {
    units: formatUnitsWithSuffix(part.units, suffix),
    amount,
  });
}

/**
 * 이월 표식 → 카드. `notes`는 그 칸이 원래 띄우던 설명(강사 몫·배분 확인·일수 기준)이다 — 카드를 띄우는 칸에선
 * `title`을 같이 달 수 없어 카드 줄로 옮겨 싣는다.
 */
export function carryTipCard(
  mark: AttendanceCarryMark,
  suffix: AttendanceUnitSuffix,
  lang: SheetLang,
  notes: readonly (string | null | undefined)[] = [],
): TipCard {
  const row = (part: AttendanceCarryPart, known: "att.row.carry.in" | "att.row.carry.out", unknown: "att.row.carry.inUnknown" | "att.row.carry.outUnknown"): TipRow => {
    const month = monthOf(part.period, lang);
    return [month ? sheetTf(lang, known, { month }) : sheetT(lang, unknown), partValue(part, suffix, lang)];
  };
  const parts = [...mark.ins, ...(mark.out ? [mark.out] : [])];
  return {
    title: sheetT(lang, "att.row.carry.title"),
    rows: [
      ...mark.ins.map((part) => row(part, "att.row.carry.in", "att.row.carry.inUnknown")),
      mark.out ? row(mark.out, "att.row.carry.out", "att.row.carry.outUnknown") : null,
    ],
    lines: [
      // 받은 이월이 청구액에 안 실린 이유 — 배분을 저장하면 실리는 줄과, 환불이라 싣지 않는 줄은 할 일이 다르다.
      mark.ins.length > 0 && mark.inState === "pending" ? sheetT(lang, "att.row.carry.notApplied") : null,
      mark.ins.length > 0 && mark.inState === "refunded" ? sheetT(lang, "att.row.carry.refunded") : null,
      // 회차를 적은 줄이 있을 때만 — 금액만 적은 카드엔 나눈 값 설명이 설 자리가 없다.
      parts.some(showsUnits) ? sheetT(lang, "att.row.carry.unitsNote") : null,
      ...notes,
    ],
  };
}
