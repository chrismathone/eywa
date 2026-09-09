import type { CSSProperties, ReactNode } from "react";

/**
 * 한 화면 대시보드의 **격자 셸** — 12열 · 스크롤 0.
 *
 * 원장 2026-09-09: *"스크롤 없이 한 화면에"* + *"열린 창이 없을 때 대시보드가 보이게"*(바탕화면).
 * 무엇을 어느 칸에 세울지는 [`layout-plan`](@/features/dashboard/onescreen/layout-plan)이 **권한에서
 * 먼저 계산**하고, 이 파일은 그 계획을 그대로 그리기만 한다.
 *
 * 🔴 **폭을 `col-span-{n}` 클래스로 주지 않는다** — Tailwind는 소스에 **글자 그대로** 있는 클래스만
 *    만들어서, `col-span-${n}`처럼 조립한 이름은 CSS가 아예 안 나오고 **에러도 없이** 칸이 폭 1로
 *    쪼그라든다. 계획이 주는 숫자는 런타임 값이므로 인라인 `gridColumn`으로 준다(값이 12분율 하나라
 *    인라인이 오히려 읽기 쉽다).
 * 🔴 **이 화면만 셸의 하단 여백을 덮는다** — 앱 전역 규약은 `main`의 `pb-8`이지만(끝까지 내렸을 때
 *    마지막 카드가 바닥에 안 붙게), 여기는 애초에 내릴 것이 없는 화면이고 그 여백이 곧 세로 낭비다.
 *    등록상담 목록뷰가 같은 이유로 `h-full`을 쓴다(원장 *"이 어색한 여백은 뭐야"*).
 */

/** 행1 — KPI 타일. 88px은 숫자 28px + 라벨/보조 두 줄이 들어가는 최소치다. */
const KPI_ROW = "88px";
/** 행3 — 차트. 168px 미만이면 7일 선의 y축 변화가 눈에 안 보인다(창일 때). */
const CHART_ROW = "168px";

export function OneScreenGrid({
  kpis,
  body,
  charts,
}: {
  kpis: ReactNode;
  body: ReactNode;
  /** 차트 행 — 볼 수 있는 과거 데이터가 없으면 `null`이고, 그러면 **행 자체가 없어져** 본문이 그 높이를 먹는다. */
  charts: ReactNode | null;
}) {
  const rows = charts ? `${KPI_ROW} minmax(0,1fr) ${CHART_ROW}` : `${KPI_ROW} minmax(0,1fr)`;
  return (
    <div
      className="grid h-full min-h-0 grid-cols-12 gap-2"
      style={{ gridTemplateRows: rows }}
    >
      {kpis}
      {body}
      {charts}
    </div>
  );
}

/**
 * 격자 한 칸. `span`은 12분율이고 한 행의 합은 언제나 12다(`layout-plan`의 가드가 잠근다).
 *
 * ⚠️ `min-h-0`·`min-w-0`이 **둘 다** 필요하다 — 격자 자식의 기본 최소 크기는 `auto`(내용 크기)라,
 *    안쪽 목록이 길면 칸이 늘어나 행 높이를 밀어내고 결국 화면에 스크롤이 생긴다. 이 화면에서
 *    스크롤은 곧 실패다.
 */
export function Cell({
  span,
  className = "",
  style,
  children,
}: {
  span: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col ${className}`}
      style={{ gridColumn: `span ${span} / span ${span}`, ...style }}
    >
      {children}
    </div>
  );
}
