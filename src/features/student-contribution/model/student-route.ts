/** 학생 상세 안에서는 기여도 메뉴·월·필터 이동도 같은 학생 화면 안에서 연다. */
export function studentContributionHref(href: string, studentId: string, back?: string) {
  if (!/^\/student-contribution(?:[/?#]|$)/.test(href)) return href;
  const url = new URL(href, "https://local.invalid"), part = url.pathname.slice("/student-contribution".length).replace(/^\//, "");
  if (part === "ranking") return href;
  if (part.includes("/")) return href;
  const query = url.searchParams;
  query.set("tab", "contribution");
  if (back) query.set("back", back); else query.delete("back");
  if (!part || ["ontology", "referrals", "settings"].includes(part)) {
    query.set("contribution", part || "list");
  } else {
    studentId = decodeURIComponent(part); query.delete("contribution");
  }
  return `/students/${encodeURIComponent(studentId)}?${query}${url.hash}`;
}
