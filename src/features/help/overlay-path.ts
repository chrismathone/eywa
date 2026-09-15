import { MANUALS } from "./manuals";

/**
 * 지금 주소가 가리키는 화면 설명서 슬러그.
 * 정확한 href 가 이기고, 그다음이 가장 긴 접두. `/students` 목록과 상세는 href 가 같아 경로 길이로 가른다.
 */
export function overlaySlugForPath(pathname: string): string | null {
  const path = stripPath(pathname);
  if (path.startsWith("/students/") && path !== "/students") return "student-detail";
  // workspace 설명서도 href 가 `/help` 라 정확 일치가 둘이다 — 허브·게시글·아이콘은 도움말 설명서.
  if (path === "/help" || path.startsWith("/help/")) return "help";

  const exact = MANUALS.filter((m) => stripPath(m.href) === path);
  if (exact.length === 1) return exact[0]!.slug;
  if (exact.length > 1) {
    if (path === "/students") return "students";
    return exact[0]!.slug;
  }

  let best: { slug: string; href: string } | null = null;
  for (const m of MANUALS) {
    const href = stripPath(m.href);
    if (href === "/" || href === path) continue;
    if (path === href || path.startsWith(`${href}/`)) {
      if (!best || href.length > best.href.length) best = { slug: m.slug, href };
    }
  }
  return best?.slug ?? null;
}

function stripPath(pathname: string): string {
  const noQuery = pathname.split("?")[0] ?? pathname;
  const trimmed = noQuery.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}
