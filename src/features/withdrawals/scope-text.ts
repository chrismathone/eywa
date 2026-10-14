/**
 * 퇴원관리 수치의 **범위 문구**(원장 2026-09-29 *"전체 퇴원 458명이 언제부터의 수치인지? … 학원전체 퇴원생이라는 건지,
 * 수학과목만 한정된 건지? 항상 수치에 관한 구체적인 언급이 필요"*). 순수 함수(Vitest).
 * 카드·차트 머리가 "무엇을·언제부터 센 수인지"를 이 한 벌로 적는다 — 필터가 걸렸는데 '전체'라고 적으면 화면이 거짓말을 한다.
 */
export type ScopeParts = {
  program?: string | null;
  subject?: string | null;
  reason?: string | null;
  consult?: string | null;
  /** 등록 후 조기 퇴원 필터 라벨('1개월 이내' — `early-exit.ts`). */
  early?: string | null;
  q?: string | null;
};

/** 걸린 필터를 한 줄로 — 없으면 '학원 전체'. */
export function scopeText(p: ScopeParts): string {
  const bits = [
    p.program ? `${p.program}만` : null,
    p.subject ? `과목 ${p.subject}` : null,
    p.reason ? `사유 ${p.reason}` : null,
    p.consult ?? null,
    p.early ? `등록 후 ${p.early} 퇴원` : null,
    p.q ? `'${p.q}' 검색` : null,
  ].filter((b): b is string => !!b);
  return bits.length ? bits.join(" · ") : "학원 전체";
}

/** `2026-01-01`~`2026-09-29` → `1/1 ~ 9/29`(같은 해) — 해가 다르면 연도를 붙인다. */
export function spanText(from: string, to: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${md(from)} ~ ${md(to)}` : `${from.slice(0, 4)}.${md(from)} ~ ${to.slice(0, 4)}.${md(to)}`;
}
