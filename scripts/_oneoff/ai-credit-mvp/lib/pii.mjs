// 외부 AI 전송 금지 정보 검사(CLAUDE.md 'AI 모델 정책' — 주민번호·계좌/카드·급여·이력서·환불 계좌) — 칸뿐 아니라 자유 글 안에서도.
// 걸리면 그 행은 **보내지 않고 보류**한다(가리고 보내지 않는다 — 문맥에 남은 조각이 샐 수 있다). 전화번호는 금지 목록이 아니지만
// 판정에 필요 없어 가린다(`[전화번호]`). 순수 함수 — 단위 확인은 smoke-pii.mjs.

const RRN = /(?<!\d)\d{6}\s*-\s*[1-8][\d*]{6}(?!\d)/; // 주민·외국인 등록번호(뒷자리 가림 포함)
const CARD = /(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}(?!\d)/;
const BANK = /(국민|신한|우리|하나|농협|기업|카카오|토스|대구|부산|경남|광주|전북|제주|새마을|신협|우체국|수협|씨티|SC제일|케이뱅크|산업)(은행|뱅크)?\s*[:：]?\s*\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,8}/;
const ACCOUNT_WORD = /(계좌|입금\s*계좌|환불\s*계좌)\s*(번호)?\s*[:：]?\s*\d{2,}/;
// '시급'은 '보완이 시급합니다'와 갈리게 금액 문맥일 때만(재리뷰 2026-10-26).
const PAY = /(급여|월급|연봉|강사료|인건비|급여명세|시급\s*[:：]?\s*\d)/;
const PHONE = /(?<!\d)01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)/g;

/** 글 하나 → 걸린 종류 목록(빈 배열 = 통과). */
export function piiHits(text) {
  const s = String(text ?? "");
  const hits = [];
  if (RRN.test(s)) hits.push("주민번호");
  if (CARD.test(s)) hits.push("카드번호");
  if (BANK.test(s) || ACCOUNT_WORD.test(s)) hits.push("계좌번호");
  if (PAY.test(s)) hits.push("급여");
  return hits;
}

/** 보내도 되는 글로 — 전화번호만 가린다(금지 정보는 piiHits가 행째 보류시킨다). */
export function maskPhones(text) {
  return String(text ?? "").replace(PHONE, "[전화번호]");
}

/** 객체의 모든 글 값을 훑어 걸린 칸 → 종류. */
export function scanRecord(obj, path = "") {
  const out = [];
  if (obj == null) return out;
  if (typeof obj === "string") { const h = piiHits(obj); if (h.length) out.push({ field: path || "(값)", kinds: h }); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => out.push(...scanRecord(v, `${path}[${i}]`))); return out; }
  if (typeof obj === "object") for (const [k, v] of Object.entries(obj)) out.push(...scanRecord(v, path ? `${path}.${k}` : k));
  return out;
}
