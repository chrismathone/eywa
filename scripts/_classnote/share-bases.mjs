/**
 * 회수 워커가 학부모 게시글을 찾을 때 대 볼 **공유 링크 주소 후보**(순수).
 *
 * 왜 여러 개인가: 수업보고서 게시글의 본문은 `{주소}/r/{토큰}` 한 줄이고, 회수는 그 본문과 **글자까지 같은** 글만 지운다
 * (근사 매칭 금지 — 남의 글을 지우면 되돌릴 수 없다). 그런데 주소는 바뀐다(도메인 이전 — docs/domain-cutover.md):
 *   · 회수가 옛 주소만 알면 → 이전 **뒤에** 올린 글을 못 찾아 "게시글이 이미 없습니다(회수 완료)"로 **거짓 성공**한다.
 *   · 새 주소만 알면 → 이전 **전에** 올린 글을 같은 식으로 놓친다.
 * 그래서 지금 주소(`CLASSNOTE_SHARE_BASE`) + 옛 주소들(`CLASSNOTE_LEGACY_SHARE_BASES`, 쉼표 구분)을 **전부** 대 본다.
 * 옛 주소의 기본값 = 첫 배포 별칭 — env를 안 넣어도 도메인 이전 전 글을 회수할 수 있다.
 *
 * 종전(감사 2026-09-21): 회수만 주소가 코드 리터럴이라 `CLASSNOTE_SHARE_BASE`를 바꿔도 따라오지 않았다.
 */
export const FIRST_SHARE_BASE = "https://eywa-alpha.vercel.app";

/** 끝 슬래시·공백을 떼고 소문자 호스트로 — 본문 비교는 글자 단위라 표기가 흔들리면 못 찾는다. */
export function normalizeShareBase(raw) {
  const s = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * 대 볼 주소 목록 — 지금 주소가 맨 앞, 그다음 옛 주소들(중복 제거).
 * @param {string | undefined | null} currentBase  env CLASSNOTE_SHARE_BASE
 * @param {string | undefined | null} legacyCsv    env CLASSNOTE_LEGACY_SHARE_BASES (쉼표 구분)
 */
export function recallShareBases(currentBase, legacyCsv) {
  const out = [];
  const push = (raw) => {
    const b = normalizeShareBase(raw);
    if (b && !out.includes(b)) out.push(b);
  };
  // 🔴 발송 워커는 env 값을 **가공 없이** 본문에 쓴다(`${CLASSNOTE_SHARE_BASE}/r/…`, classnote-core.mjs) — env에 끝 슬래시나
  //    대문자가 있었다면 글도 그 표기로 박혀 있다. 그래서 지금 주소는 **원문 표기 그대로도** 후보에 넣는다.
  const verbatim = String(currentBase ?? "").trim();
  if (verbatim && normalizeShareBase(verbatim)) out.push(verbatim);
  push(currentBase || FIRST_SHARE_BASE);
  for (const part of String(legacyCsv ?? "").split(",")) push(part);
  push(FIRST_SHARE_BASE);
  return out;
}
