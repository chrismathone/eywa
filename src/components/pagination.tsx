import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { DEFAULT_SHEET_LANG, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/**
 * 목록 페이지 공용 페이지네이션 (서버 컴포넌트) — **앱 전역 페이저 표준 스타일**.
 *
 * 모든 페이지네이션(학생·수납·상담·등록상담 칸반 등)이 이 룩을 쓴다: 테두리 없는 이전 / N / M /
 * 다음 + hover 배경. 클라이언트 state 페이저(등록상담 칸반 column-cards)도 같은 클래스를 복제해
 * 시각을 일치시킨다(거긴 href가 아니라 onClick이라 컴포넌트 직접 재사용은 불가).
 * 페이저 버튼 클래스 = `PAGER_STEP_*`(아래)로 단일화 — 새 페이저는 이 상수를 쓸 것.
 *
 * `hrefForPage`는 현재 필터를 보존한 채 `page`만 바꾼 href를 돌려주는 함수(서버 컴포넌트끼리 함수 prop
 * 전달은 안전). `total`을 주면 페이지 표시 옆에 "· N건"을 덧붙인다(없으면 page/total만).
 *
 * 표준 사용 패턴 (CLAUDE.md "목록 페이지네이션 표준" 참고):
 *   const PAGE_SIZE = 50;
 *   const page = Math.max(1, Number(sp.page) || 1);
 *   const { rows, total } = await getXPage(filters, page, PAGE_SIZE);
 *   const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
 *   const pageHref = (p: number) => buildHref(filters, p);   // p>1일 때만 page 파라미터
 *   ...
 *   <Pagination page={page} totalPages={totalPages} total={total} hrefForPage={pageHref} />
 *
 * ⚠️ 위치 고정: 마지막 페이지가 짧아 목록이 줄면 페이저가 위로 튄다 → 클라 state 페이저(버튼이
 * 커서 밑에서 움직임)는 목록 영역을 **고정 높이**로(예: column-cards `h-[56vh] overflow-y-auto`).
 * 서버 href 페이저는 페이지 전환=리로드라 버튼이 커서 밑에서 안 움직여 영향이 작다.
 */

// 페이저 스텝 버튼 공통 클래스(서버 Link / 클라 button 양쪽에서 동일 룩으로 복제).
export const PAGER_STEP_BASE = "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition";
export const PAGER_STEP_ENABLED = "text-text-dim hover:text-foreground hover:bg-bg-soft";
export const PAGER_STEP_DISABLED = "text-text-faint cursor-default opacity-40";
export const PAGER_LABEL = "num text-text-faint whitespace-nowrap px-1 text-xs";

export function Pagination({
  page,
  totalPages,
  hrefForPage,
  total,
  lang = DEFAULT_SHEET_LANG,
  scroll,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
  /** 있으면 페이지 표시 옆에 "· N건" 총 개수를 덧붙인다(없으면 page/total만). */
  total?: number;
  /**
   * 강사뷰 화면 언어. 🔴 **여기서 직접 읽지 않는다** — 이 모듈은 클라 컴포넌트도 import하므로
   * (PAGER_STEP_*·PageStep) server-only 조회를 넣으면 빌드가 깨진다([[#61]]). 안 주면 한국어라
   * 사무실 화면·기존 호출부는 한 글자도 안 바뀐다.
   */
  lang?: SheetLang;
  /** 같은 화면의 명단만 넘길 때 false로 지정해 읽던 스크롤 위치를 유지한다. */
  scroll?: boolean;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      className="mx-auto flex max-w-xs items-center justify-between gap-2 pt-2"
      aria-label={sheetT(lang, "common.pageAria")}
    >
      <PageStep href={hrefForPage(page - 1)} disabled={page <= 1} scroll={scroll}>
        <EyIcon name="chevronLeft" size={12} />
        {sheetT(lang, "common.prev")}
      </PageStep>
      <span className={PAGER_LABEL}>
        {page} / {totalPages}
        {total != null ? sheetTf(lang, "common.pageCount", { n: total }) : ""}
      </span>
      <PageStep href={hrefForPage(page + 1)} disabled={page >= totalPages} scroll={scroll}>
        {sheetT(lang, "common.next")}
        <EyIcon name="chevronRight" size={12} />
      </PageStep>
    </nav>
  );
}

/** 페이저 스텝 단추(이전/다음) — 하단 표준 페이저 외에 목록 헤더의 컴팩트 페이저에서도 재사용. */
export function PageStep({
  href,
  disabled,
  children,
  scroll,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  if (disabled) {
    return <span className={`${PAGER_STEP_BASE} ${PAGER_STEP_DISABLED}`}>{children}</span>;
  }
  return (
    <Link href={href} scroll={scroll} className={`${PAGER_STEP_BASE} ${PAGER_STEP_ENABLED}`}>
      {children}
    </Link>
  );
}
