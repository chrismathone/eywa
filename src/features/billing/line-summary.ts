/**
 * 청구서 한 건(학생×청구월)의 **라인 접힘 요약** — 순수 함수(Vitest).
 *
 * 원장 2026-08-31: *"기본적으로 접어진 상태로 합계금액이 보이도록 해주고, 클릭하거나 펼쳤을때
 * 세부내역 보이도록."* 수납 표는 라인 하나가 한 줄이라 4항목짜리 청구서 하나가 화면 네 줄을 먹는다.
 * 접었을 때 그 네 줄을 대신할 **한 줄의 값**을 여기서 만든다.
 *
 * 🔴 합계는 **화면에 보이는 라인들**로 낸다(인보이스 컬럼이 아니라). '기한 경과만 보기' 같은 필터가
 *    라인을 걸러내면 인보이스 총액은 화면과 다른 말을 하고, 표 아래 '이 페이지 합계'(라인 합)와도 갈린다.
 *    구데이터(라인별 상세 없음)는 호출부 `toLines`가 **첫 라인에 인보이스 값을 합성**해 넘기므로,
 *    그냥 더해도 인보이스 값과 같아진다(둘째 라인부터의 `undefined`는 0으로 더해진다 = 정확).
 *
 * 🔴 미납은 `undefined`(미상)와 `0`(완납)을 **끝까지 구분**한다 — 구형 3-key 인보이스의 2번째+ 라인은
 *    라인별 미납을 알 수 없다. 전부 미상이면 합계도 `undefined`(화면은 '—')로 남긴다. 0으로 접으면
 *    미상이 '완납'으로 둔갑한다(실측 은폐 사례가 있어 표에 주석까지 달려 있는 자리다).
 */
import type { InvoiceLineItem } from "./server/queries";

export type LineSummary = {
  /** 접힌 라인 수. */
  count: number;
  amount: number;
  discount: number;
  points: number;
  paid: number;
  /** 전 라인이 미상이면 undefined(= 화면 '—'). */
  unpaid: number | undefined;
  /** 라인 구분이 한 종류면 그 값, 섞이면 null(호출부가 '여러 구분'으로 표시). */
  kind: string | null;
  /** 대표 수납명 = 첫 라인. 빈 문자열이면 호출부가 '—'. */
  description: string;
  /** 값이 하나로 모일 때만 — 갈리면 null. */
  method: string | null;
  paidDate: string | null;
  dueDay: number | null;
};

/** 값이 하나로 모이면 그 값, 비었거나 갈리면 null. */
function only<T>(values: readonly (T | null | undefined)[]): T | null {
  const seen = values.filter((v): v is T => v !== null && v !== undefined);
  if (seen.length === 0) return null;
  const first = seen[0]!;
  return seen.every((v) => v === first) ? first : null;
}

export function summarizeLines(lines: readonly InvoiceLineItem[]): LineSummary {
  let amount = 0;
  let discount = 0;
  let points = 0;
  let paid = 0;
  let unpaid = 0;
  let anyUnpaid = false;
  for (const li of lines) {
    amount += li.amount;
    discount += li.discount ?? 0;
    points += li.points ?? 0;
    paid += li.paid ?? 0;
    if (li.unpaid !== undefined) {
      unpaid += li.unpaid;
      anyUnpaid = true;
    }
  }
  return {
    count: lines.length,
    amount,
    discount,
    points,
    paid,
    unpaid: anyUnpaid ? unpaid : undefined,
    kind: only(lines.map((li) => li.kind)),
    description: lines[0]?.description ?? "",
    method: only(lines.map((li) => li.method)),
    paidDate: only(lines.map((li) => li.paidDate)),
    dueDay: only(lines.map((li) => li.dueDay)),
  };
}
