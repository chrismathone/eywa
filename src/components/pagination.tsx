import Link from "next/link";

/**
 * 목록 페이지 공용 페이지네이션 (서버 컴포넌트).
 *
 * 모든 페이지네이션 목록(학생·수납·상담 등)이 이 컴포넌트를 써서 스타일을 통일한다.
 * `hrefForPage`는 현재 필터를 보존한 채 `page`만 바꾼 href를 돌려주는 함수 —
 * 서버 컴포넌트끼리는 함수 prop 전달이 안전하므로 페이지마다 작은 헬퍼로 넘긴다.
 *
 * 표준 사용 패턴 (CLAUDE.md "목록 페이지네이션 표준" 참고):
 *   const PAGE_SIZE = 50;
 *   const page = Math.max(1, Number(sp.page) || 1);
 *   const { rows, total } = await getXPage(filters, page, PAGE_SIZE);
 *   const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
 *   const pageHref = (p: number) => buildHref(filters, p);   // p>1일 때만 page 파라미터
 *   ...
 *   <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
 */
export function Pagination({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-1.5 pt-1" aria-label="페이지 이동">
      <PageStep href={hrefForPage(page - 1)} disabled={page <= 1}>
        ← 이전
      </PageStep>
      <span className="text-text-dim num px-2 text-xs">
        {page} / {totalPages}
      </span>
      <PageStep href={hrefForPage(page + 1)} disabled={page >= totalPages}>
        다음 →
      </PageStep>
    </nav>
  );
}

function PageStep({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="border-line text-text-faint cursor-default rounded-md border px-3 py-1.5 text-xs opacity-50">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft rounded-md border px-3 py-1.5 text-xs transition"
    >
      {children}
    </Link>
  );
}
