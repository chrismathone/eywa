/** `/spreadsheets/d/{id}` — 문서 id. 뒤에 `/edit`·`/view`가 붙어도 id만 집는다. */
const SHEET_ID_RE = /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/;
/** 주소가 아니라 id만 붙여넣은 경우(연동 설정에 저장된 값이 그렇다). */
const BARE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
/** `#gid=123`(해시) — 구글이 탭을 옮길 때 갱신하는 쪽. */
const GID_HASH_RE = /#(?:.*&)?gid=(\d+)/;
/** `?gid=123`·`&gid=123`(쿼리) — 해시가 없을 때의 폴백. */
const GID_QUERY_RE = /[?&]gid=(\d+)/;

/** 문서의 탭 한 줄(Sheets `sheets[].properties`) — 주소의 gid를 탭 이름으로 잇는 유일한 통로. */
export type SheetTab = { gid: number; title: string };

export type SheetUrlTarget = {
  spreadsheetId: string;
  /** 탭 번호. 주소에 없으면 null → 호출부가 탭을 고르게 한다(첫 탭을 임의로 집지 않는다). */
  gid: number | null;
};

/**
 * 원장이 주소창에서 복사해 붙여넣는 주소 한 줄을 문서 id + 탭 번호로 가른다.
 * 예: `https://docs.google.com/spreadsheets/d/1-1JHC…/edit?gid=661682520#gid=661682520`
 *
 * 🔑 **gid는 해시(`#gid=`)를 우선**하고 쿼리(`?gid=`)는 폴백이다 — 구글 시트에서 탭을 바꾸면 주소의 해시가
 *    갱신되고 쿼리는 처음 열었던 탭에 남는 경우가 있다(둘이 다르면 사람이 지금 보고 있는 탭 = 해시).
 * ⚠️ 스킴이 붙은 주소는 **구글 문서만** 받는다 — 다른 도메인의 비슷한 경로를 삼키면 서비스계정이 엉뚱한
 *    문서를 긁으러 간다. 스킴이 없으면(=id만 붙여넣음) id 형식으로만 판정한다.
 */
export function parseSheetUrl(
  input: string | null | undefined,
): SheetUrlTarget | null {
  const s = String(input ?? "").trim();
  if (!s) return null;

  const scheme = s.match(/^[a-zA-Z][\w+.-]*:\/\/([^/]+)/);
  if (scheme) {
    const host = scheme[1]!.split(":")[0]!.toLowerCase();
    if (!/(^|\.)google\.com$/.test(host)) return null;
  }

  const idMatch = s.match(SHEET_ID_RE);
  const spreadsheetId = idMatch ? idMatch[1]! : BARE_ID_RE.test(s) ? s : null;
  if (!spreadsheetId) return null;

  const raw = s.match(GID_HASH_RE)?.[1] ?? s.match(GID_QUERY_RE)?.[1] ?? null;
  const gid = raw === null ? null : Number(raw);
  return {
    spreadsheetId,
    gid: gid !== null && Number.isFinite(gid) ? gid : null,
  };
}
