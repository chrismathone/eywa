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

/**
 * 지금 도메인(2026-09-21 원장 *"우리 도메인은 aywa.co.kr / www.aywa.co.kr"* · *"앞으로 발송하는 보고서 링크는 새 도메인"*) —
 * env `CLASSNOTE_SHARE_BASE`가 없을 때 발송 워커가 본문에 쓰는 주소이자, 회수가 **env와 무관하게** 늘 대 보는 후보.
 * `www`인 이유 = 옛 별칭(`eywa-alpha.vercel.app`)이 Vercel에서 `www.aywa.co.kr`로 전환되도록 걸려 있다(같은 곳을 기준으로).
 * 도메인을 또 옮기면 이 값을 새 주소로 바꾸고, 지금 값은 `CLASSNOTE_LEGACY_SHARE_BASES`나 아래 목록에 남긴다.
 */
export const CURRENT_SHARE_BASE = "https://www.aywa.co.kr";

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
  push(currentBase || CURRENT_SHARE_BASE);
  // 옛 주소도 **원문 표기 그대로** 먼저 넣는다 — 그 주소를 쓰던 때의 글은 그때 env 원문(끝 슬래시·대문자 포함)으로 박혀 있다
  // (set-share-domain.ps1이 주소를 바꿀 때 옛 원문을 여기로 옮겨 적는다).
  for (const part of String(legacyCsv ?? "").split(",")) {
    const raw = part.trim();
    if (raw && normalizeShareBase(raw) && !out.includes(raw)) out.push(raw);
    push(part);
  }
  // 연동 PC의 env가 옛 주소 그대로여도(또는 새 주소로 바꾼 뒤에도) 두 주소의 글을 다 찾는다 — 어느 쪽으로 나간 글인지
  // 회수 시점엔 모른다(env를 바꾼 날을 경계로 섞인다).
  push(CURRENT_SHARE_BASE);
  push(FIRST_SHARE_BASE);
  return out;
}

/**
 * 같은 보고서 링크의 **다른 주소 표기들** — 발송 워커의 게시 전 중복 확인(멱등)용. 맨 앞은 지금 보낼 링크 그대로.
 *
 * 왜: 중복 확인은 본문이 **글자까지 같은** 글만 "이미 게시됨"으로 본다. 연동 PC의 주소(env)를 바꾸는 날, 바꾸기 직전에
 * 옛 주소로 올라간 뒤 표시를 못 남긴 보고서(워커를 재시작하는 바로 그 순간 게시 중이던 건)가 재시도되면 새 주소로 찾다가
 * 옛 글을 못 알아보고 **같은 보고서를 한 번 더** 올린다(ClassNote 글은 지울 수 없다). 그래서 회수와 같은 후보 목록으로 찾는다.
 * 토큰(`/r/…`)이 같아야만 후보가 되므로 남의 글을 "이미 게시됨"으로 오인하지 않는다.
 * @param {string} shareUrl        지금 보낼 링크(`{주소}/r/{토큰}`)
 * @param {string | undefined | null} currentBase  env CLASSNOTE_SHARE_BASE
 * @param {string | undefined | null} legacyCsv    env CLASSNOTE_LEGACY_SHARE_BASES
 */
export function shareUrlVariants(shareUrl, currentBase, legacyCsv) {
  const url = String(shareUrl ?? "");
  if (!url) return [];
  const m = /\/r\/[^/\s]+$/.exec(url);
  if (!m) return [url];
  const out = [url];
  for (const b of recallShareBases(currentBase, legacyCsv)) {
    const v = `${b}${m[0]}`;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
