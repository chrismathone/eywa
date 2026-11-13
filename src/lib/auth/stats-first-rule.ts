import type { SystemRole } from "@/lib/permissions";

/** 메뉴를 열면 통계가 먼저 뜨는 역할 — 원장·관리자(원장 2026-11-13). 매니저 이하는 종전대로 목록. */
export const STATS_FIRST_ROLES: readonly SystemRole[] = ["master", "admin"];

/** 통계 화면 '목록으로'가 싣는 표식 — 이게 있으면 목록에 머문다(통계로 되돌려 보내지 않는다). */
export const LIST_MARK = "list";

/** 메뉴로 그냥 연 주소인가 — 창 표식(`embed`) 말고는 값이 하나도 없을 때만. */
export function isBareEntry(sp: Record<string, unknown>): boolean {
  return Object.entries(sp).every(([k, v]) => k === "embed" || v === undefined);
}

/** 요청이 같은 목록 화면에서 왔나(`referer` 경로가 목록 경로와 같다) — 목록 안 이동·새로고침은 통계로 보내지 않는다. */
export function cameFromSamePage(referer: string | null, listPath: string): boolean {
  if (!referer) return false;
  try {
    return new URL(referer).pathname === listPath;
  } catch {
    return false;
  }
}

/** '목록으로' 주소에 목록 표식을 붙인다(해시는 뒤에 그대로). */
export function withListMark(href: string): string {
  const hashAt = href.indexOf("#");
  const [path, hash] = hashAt < 0 ? [href, ""] : [href.slice(0, hashAt), href.slice(hashAt)];
  const qAt = path.indexOf("?");
  const params = new URLSearchParams(qAt < 0 ? "" : path.slice(qAt + 1));
  params.set(LIST_MARK, "1");
  return `${qAt < 0 ? path : path.slice(0, qAt)}?${params.toString()}${hash}`;
}
