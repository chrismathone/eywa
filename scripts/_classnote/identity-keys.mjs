/**
 * scripts/_classnote/identity-keys.mjs — eywa 학생 ↔ ClassNote 원아 **이름 매칭 키**(순수, 의존성 0).
 *
 * 왜 별도 모듈인가: `childKeys`는 원래 [classnote-admin-core.mjs]에 있었는데 그 파일은 **@playwright/test를
 * import**한다. 순수 판정 모듈(offboard-safety.mjs)이 거기서 가져오면 "순수 유지" 원칙이 깨지고 테스트가
 * playwright를 끌어온다(board-safety.mjs의 같은 규칙). 그래서 규칙만 이 모듈로 **이동**하고 admin-core는
 * 여기서 **재수출**한다 — 독립 재구현이 아니라 이동인 이유는 F6 하드닝(별명 괄호 승격 금지) 같은 미묘한
 * 규칙이 두 곳에서 갈라지면 안 되기 때문.
 *
 * ⚠️ **부분 문자열 매칭 금지.** `이윤` vs `이윤건`은 다른 사람이다. 매칭은 항상 **키 집합 교집합**으로만.
 */
import { normBoard } from "./board-safety.mjs";

/** eywa 유효이름의 동명이인 접미사(0088a 관례) — 학부모는 ClassNote 가입 시 이 알파벳을 안 붙인다. */
const SUFFIX_RE = /^(.*[가-힣].*)([A-G])$/;

/** ClassNote 원아 표시명 → 매칭 키 집합(원문·알파벳 제거·영문닉(한글)의 괄호 한글).
 *  ⚠️ 괄호 추출은 **영문닉(한글) 형식 한정**(적대 감사 F6) — "박지민(지민)"·"김하늘(동생)" 같은
 *  한글(별명) 표기에서 별명을 이름 키로 승격시키면 다른 학생과 오매칭 연료가 된다.
 *
 *  ⚠️ **공백을 그대로 남긴다**(정규화하지 않음) — `planChildMatches`가 "원문 키 그대로"를 전제로
 *  eywa 이름과 비교하므로 여기서 공백을 지우면 기존 소비처가 조용히 깨진다. 정규화가 필요한 쪽은
 *  아래 `childIdentityKeys`/`studentIdentityKeys`를 쓴다. */
export function childKeys(name) {
  const keys = new Set();
  const t = (name || "").trim();
  if (!t) return keys;
  keys.add(t);
  const stripped = t.replace(/[a-zA-Z]/g, "").replace(/[()]/g, "").trim();
  if (stripped) keys.add(stripped);
  const paren = t.match(/^[A-Za-z .]+\(([가-힣]{2,6})\)$/);
  if (paren) keys.add(paren[1]);
  return keys;
}

/** 공백까지 정규화한 키 집합 — 교집합 비교 전용(내부 공백 차이 "김 민수"↔"김민수" 흡수). */
export function childIdentityKeys(name) {
  const out = new Set();
  for (const k of childKeys(name)) {
    const n = normBoard(k);
    if (n) out.add(n);
  }
  return out;
}

/**
 * eywa 학생 → 매칭 키 집합. 유효이름(`classnote_name || name`) 원문 + **A–G 접미사를 뗀 base** + 라틴 제거본.
 *
 * 접미사 base가 핵심이다: eywa는 동명이인을 `박서준`/`박서준C`로 구분하지만 **학부모는 가입할 때
 * 알파벳을 안 붙인다**(그냥 "박서준"). 그래서 두 학생이 **같은 원아 "박서준"의 후보**가 되고,
 * 호출부의 카디널리티 검사(후보가 정확히 1명)가 그 모호성을 잡는다.
 * ⚠️ `boardNameAmbiguity`는 이 방향성이 한쪽(`박서준`→`박서준C`)만 성립해서 offboard 판정엔 못 쓴다.
 */
export function studentIdentityKeys(name, classnoteName) {
  const out = new Set();
  const eff = String(classnoteName || name || "").trim();
  if (!eff) return out;
  const norm = normBoard(eff);
  if (norm) out.add(norm);
  // **파생 키는 최소 2자**(한글 이름 최소 길이) — 1자 키는 남의 이름에 걸릴 수 있어 승격시키지 않는다.
  // 원문 키에는 이 제한을 걸지 않는다(있는 이름 그대로는 언제나 자기 자신).
  const addDerived = (v) => {
    const n = normBoard(v ?? "");
    if (n.length >= 2) out.add(n);
  };
  const m = SUFFIX_RE.exec(eff);
  if (m) addDerived(m[1]);
  addDerived(eff.replace(/[a-zA-Z]/g, ""));
  return out;
}

/** 두 키 집합의 교집합이 비지 않는가(= 같은 사람 후보인가). 부분 문자열 비교를 하지 않는 것이 요점. */
export function matchesIdentity(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const k of small) if (big.has(k)) return true;
  return false;
}
