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

/**
 * 행1 — KPI 타일. **104px**: 라벨 + 숫자 + 보조 한 줄 + **막대 한 줄**.
 * 🔴 88px이던 것을 올렸다 — 2026-09-10에 타일 안 막대를 넣으면서 칸을 넘겨,
 *    `overflow-hidden`이 **머리 라벨을 말없이 잘랐다**(원장 제보 "b는 상단 텍스트 짤려").
 *    밀도안(B)은 머리에 색 띠(3px)까지 있어 먼저 터진다.
 * ⚠️ 여기를 다시 줄이려면 막대를 함께 없애야 한다 — 둘은 같은 높이를 나눠 쓴다.
 */
const KPI_ROW = "104px";
/**
 * 행2 — 신규생 케어 · 우선 확인 · 학생 위험. 112px은 **머리 한 줄 + 네 줄 목록**(위험 칸이 가장 길다:
 * 결석·숙제·학부모·퇴원위험)이 들어가는 최소치다 — 여백 12 + 머리 20 + 4 + 줄 4×18 = 108.
 * 🔴 더 키우지 말 것 — 이 화면의 세로는 본문(1fr)에서 그대로 빠진다. 🔴 줄이지도 말 것 — 넘치면
 * `overflow-hidden`이 **말없이 잘라** 마지막 신호(퇴원위험)가 사라진다.
 */
const CARE_ROW = "112px";
/**
 * 마지막 행 — 차트. **남는 높이를 여기가 갖는다**(본문이 아니라).
 *
 * 🔴 2026-09-10 뒤집힘 — 원장 제보 *"이 공간낭비 어쩔꺼야"*. 본문(목록)이 `1fr`이라 8줄짜리
 *    목록이 화면 높이의 70%를 빈 칸으로 들고 있었고, 정작 차트는 168px에 눌려 있었다.
 *    원장이 두 번 보여 준 레퍼런스(HR 대시보드)는 **아래가 차트 격자**다 — 그 자리가 여기다.
 * ⚠️ 차트가 없으면 이 행 자체가 없고 그때는 본문이 남는 높이를 갖는다(아래 `bodyRow`).
 */
const CHART_ROW_MIN = "200px";

export function OneScreenGrid({
  kpis,
  care,
  body,
  charts,
  gap = "gap-2",
}: {
  kpis: ReactNode;
  /** 신규생·위험 행 — 재료가 하나도 없으면 `null`이고, 그러면 **행 자체가 없어진다**. */
  care: ReactNode | null;
  body: ReactNode;
  /** 차트 행 — 볼 수 있는 과거 데이터가 없으면 `null`이고, 그러면 **행 자체가 없어져** 본문이 그 높이를 먹는다. */
  charts: ReactNode | null;
  /** 격자 간격 — 껍데기(skin)가 정한다(밀도안은 더 좁다). */
  gap?: string;
}) {
  // 🔴 본문은 **내용만큼만**, 남는 높이는 차트가 갖는다. 차트가 없을 때만 본문이 1fr이다.
  const bodyRow = charts ? "minmax(120px,auto)" : "minmax(0,1fr)";
  const rows = [KPI_ROW, care ? CARE_ROW : null, bodyRow, charts ? `minmax(${CHART_ROW_MIN},1fr)` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={`grid h-full min-h-0 grid-cols-12 ${gap}`}
      style={{ gridTemplateRows: rows }}
    >
      {kpis}
      {care}
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
