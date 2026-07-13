// 반별 참고 청구액 — invoice.line_items(수납명 문자열)에서 그 반에 해당하는 라인 금액만 합산(순수·Vitest).
// ⚠️ 이건 "참고값"이다(N2: 청구액과 자동 일치화 금지). 확정값(회차×단가)이 진실이고, 이 금액은 대조 힌트일 뿐.
// makeedu 수납명은 구조화 키가 없어 문자열 매칭이 불가피 — attendance가 사고 8번 낸 지대라, **못 맞추면 절대
// 지어내지 말고 null(미상)**을 돌린다. 부풀린 오답보다 "—"가 낫다.

export type LineItemLike = { description?: string | null; name?: string | null; amount?: number | null };

/** 반 코드 = 반명의 마지막 영숫자 토큰(예: "개별(초등M) 초5 BS2C"→"BS2C", "중등M 중2 PS2S-1"→"PS2S"). 없으면 null. */
export function classCode(className: string): string | null {
  const toks = className.replace(/[()]/g, " ").trim().split(/\s+/);
  const last = (toks[toks.length - 1] ?? "").replace(/-\d+$/, "");
  // 영문과 숫자가 섞인 토큰만 코드로 인정(한글 서술명 "의치대"·"심화" 등은 제외).
  return /[A-Za-z]/.test(last) && /\d/.test(last) ? last : null;
}

const norm = (s: string) => s.replace(/\s+/g, "").trim();

/**
 * 그 반에 해당하는 line_items 금액 합계. 매칭 2단계:
 *  ① 코드 있는 반: 수납명 토큰에 그 코드가 정확히 들어간 라인(예 "초등M 초5 BS2C 월목" ∋ "BS2C").
 *  ② 코드 없는 반(영어 서술명 등): 수납명이 반명(공백무시)으로 시작/포함하는 라인.
 * 매칭 라인이 0개면 null(미상, "—"로 표시). 학생 청구서 전체가 아니라 반 라인만 — makeedu 행과 직접 대조 가능.
 */
export function classInvoiceAmount(className: string, lineItems: LineItemLike[]): number | null {
  if (!className || lineItems.length === 0) return null;
  const code = classCode(className);
  const nClass = norm(className);

  let sum = 0;
  let matched = 0;
  for (const li of lineItems) {
    const desc = (li.description ?? li.name ?? "").toString();
    if (!desc) continue;
    let hit = false;
    if (code) {
      // 코드가 공백 구분 토큰으로 등장(부분문자열 오매칭 방지 — JJ3J≠JJ3K).
      hit = desc.split(/\s+/).includes(code);
    } else {
      hit = norm(desc).includes(nClass);
    }
    if (hit) {
      sum += Number(li.amount) || 0;
      matched++;
    }
  }
  return matched > 0 ? sum : null;
}
