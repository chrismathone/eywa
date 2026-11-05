import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_CHIP_ON,
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_BOX_WRAP,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON,
  TOOLBAR_SEG_ON_PRIMARY,
} from "./toolbar-controls";
import { CONTROL_H, CONTROL_ICON, CONTROL_LABEL } from "./ui/control-scale";

/**
 * 툴바 **부품** — [`toolbar-controls.ts`](./toolbar-controls.ts)의 치수를 감싼 컴포넌트 한 벌.
 *
 * 원장 2026-09-01: *"제멋대로 헤더스타일이 아닌 일관성 있는 헤더스타일로 통일감 상승.
 * **앞으로 탭을 추가하더라도 일관성 생길 수 있게**."* → 상수만 있으면 새 화면이 그걸 **모르고**
 * 자기 클래스를 손으로 적는다(실측: 감사 108건 중 58건이 그렇게 갈렸다). 그래서 규약을
 * **기본 경로**로 만든 것이다 — 새 툴바는 이 부품을 쓰면 치수를 한 글자도 안 적는다.
 *
 * 🔴 이 파일에 `"use client"`도 `import "server-only"`도 붙이지 말 것 — 서버/클라 양쪽 화면이
 *    함께 쓴다([[#61]]·[[#81]]). 부품은 표시만 하고 상태를 안 든다.
 * 🔴 `className`으로 **치수(h-*·rounded-*·py-*)를 덮지 말 것** — 그러면 규약이 아니라 기본값일
 *    뿐이다. 배치(ml-auto·shrink-0·w-*)와 색만 얹는다. 가드가 이 파일을 쓰는 자리의
 *    `rounded-full`·`py-`를 잡는다(`toolbar-canon.test.ts`).
 *
 * 규약 본문(카드 껍데기 금지 · 높이·라벨은 control-scale · 라운드)은 `toolbar-controls.ts` 머리주석이 정본이다.
 */

/**
 * 툴바 **줄** — 필터·컨트롤이 늘어선 가로 한 줄.
 *
 * 🔴 **카드 껍데기(`bg-card`·`shadow-card`·`rounded-2xl`·`border`)를 두지 않는다** — 컨트롤이
 *    저마다 테두리를 갖고 있어 줄은 그대로 읽히고, 아래 목록·칸도 테두리를 가지면 선이 겹친다.
 * ⚠️ `sticky`면 배경은 남긴다(`bg-background`) — 스크롤 내용이 비친다. 그 경우 `sticky` prop을
 *    쓸 것(직접 `bg-*`를 적으면 가드가 못 보고, 붙였다 뗐다 하며 갈린다).
 * ⚠️ 모바일 가로 레일(`.toolbar-rail`)은 기본으로 붙는다 — 폰에서 4줄로 감기는 것을 막는다.
 *    줄이 길어 레일 하나로 부족하면 `<ToolbarRow>`로 쪼갠다(데스크톱은 `display:contents`라 무영향).
 */
export function Toolbar({
  children,
  className = "",
  gap = "gap-3 compact-chrome:gap-2",
  sticky = false,
  rail = true,
}: {
  children: ReactNode;
  /** 배치만. 치수(높이·라운드)나 카드 껍데기를 얹지 말 것. */
  className?: string;
  /**
   * 간격 유틸 — 기본값을 **덮어쓴다**(덧붙이지 않는다).
   * 🔴 `className`으로 `gap-*`를 얹지 말 것: 같은 축의 유틸이 겹치면 승자를 문자열 순서가 아니라
   *    **생성된 CSS 순서**가 정해서 눈으로 못 읽는 버그가 된다([[#116]]).
   */
  gap?: string;
  /** 스크롤에 붙는 툴바 — 배경을 남긴다(내용이 비치는 것 방지). */
  sticky?: boolean;
  /** 모바일 가로 레일. 칩이 두어 개뿐이라 감겨도 되는 줄은 `false`. */
  rail?: boolean;
}) {
  return (
    <div
      data-toolbar=""
      className={`flex shrink-0 flex-wrap items-center px-1 py-1 compact-chrome:px-0.5 compact-chrome:py-0.5 ${gap} ${
        rail ? "toolbar-rail" : ""
      } ${sticky ? "bg-background sticky top-0 z-10" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * 툴바 컨트롤 자리 **스켈레톤** — `loading.tsx`의 툴바 줄은 실물 `<Toolbar>`에 이것을 늘어놓는다(줄 여백·간격·레일이 실물과 같다).
 * 높이는 실 컨트롤과 같은 변수(`CONTROL_H` = `--control-h`) · 라운드는 칩·드롭다운과 같은 `rounded-lg`. 폭만 `className`(w-*)으로.
 * 🔴 2026-11-05 스켈레톤 2차 검수: 툴바를 `<Toolbar>` 없이 손으로 그린 스켈레톤들이 `py-1`을 빠뜨려 8px 낮았다.
 */
export function ToolbarSkeletonItem({ className = "w-36" }: { className?: string }) {
  return <div aria-hidden className={`bg-bg-soft ${CONTROL_H} shrink-0 animate-pulse rounded-lg ${className}`} />;
}

/**
 * 긴 툴바를 모바일에서만 여러 레일로 쪼개는 줄 래퍼(`.toolbar-rail-row`).
 * 데스크톱·창은 `display:contents`라 이 래퍼가 없는 것과 같다 — DOM 순서를 그대로 둘 것.
 */
export function ToolbarRow({
  children,
  first = false,
}: {
  children: ReactNode;
  /** 모바일에서 이 줄을 맨 앞으로 당긴다(`.rail-row-first`). */
  first?: boolean;
}) {
  return <div className={`toolbar-rail toolbar-rail-row ${first ? "rail-row-first" : ""}`}>{children}</div>;
}

/** 툴바 안 세로 구분선 — 묶음 사이를 가른다. */
export function ToolbarDivider() {
  return <span className="bg-line h-4 w-px shrink-0" aria-hidden />;
}

/**
 * 세그먼트 **묶음 상자**(뷰 토글·기간 프리셋). 안쪽은 [`ToolbarSegmentItem`].
 * 🔴 알약(`rounded-full`)이 아니다 — 툴바는 버튼·입력 계열이라 `rounded-lg`다.
 */
export function ToolbarSegment({
  children,
  className = "",
  wrap = false,
  label,
  title,
}: {
  children: ReactNode;
  className?: string;
  /** 항목 수가 설정을 따라 늘어나는 묶음(줄바꿈 허용). */
  wrap?: boolean;
  /** 묶음 앞 소라벨(예: "보기"). 있으면 라벨+묶음을 한 덩어리로 감싼다. */
  label?: ReactNode;
  /** 묶음 전체에 붙는 설명(마우스 오버). */
  title?: string;
}) {
  const box = (
    <div title={title} className={`${wrap ? TOOLBAR_SEG_BOX_WRAP : TOOLBAR_SEG_BOX} ${label ? "" : className}`}>
      {children}
    </div>
  );
  if (!label) return box;
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="micro shrink-0">{label}</span>
      {box}
    </div>
  );
}

/**
 * 세그먼트 묶음 **안쪽** 칩. `href`가 있으면 링크, 없으면 버튼.
 *
 * ⚠️ 톤이 **두 벌**이다 — 옮겨 붙일 땐 **그 화면이 쓰던 쪽**을 고를 것(바꾸면 의미색 캐논을
 *    말없이 뒤집는 색 변경이다): `invert`(등록상담 계열, 검정 반전) / `primary`(학원색).
 */
export function ToolbarSegmentItem({
  active,
  tone = "primary",
  href,
  className = "",
  children,
  ...rest
}: {
  active: boolean;
  tone?: "invert" | "primary";
  href?: string;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children">) {
  const cls = `${TOOLBAR_SEG_ITEM} ${
    active ? (tone === "invert" ? TOOLBAR_SEG_ON : TOOLBAR_SEG_ON_PRIMARY) : TOOLBAR_SEG_OFF
  } ${className}`;
  if (href !== undefined) {
    return (
      <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} aria-pressed={active} {...rest}>
      {children}
    </button>
  );
}

/**
 * 묶음에 안 들어간 **홀로 선 토글 칩**("미수강 제외"·"퇴원 감추기"). 눌러서 상태가 남으므로
 * 칩이지만, 툴바 한 줄에 서므로 높이·라운드는 버튼 계열을 따른다.
 */
export function ToolbarChip({
  active,
  href,
  className = "",
  children,
  ...rest
}: {
  active: boolean;
  href?: string;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children">) {
  const cls = `${TOOLBAR_CHIP} gap-1.5 ${active ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF} ${className}`;
  if (href !== undefined) {
    return (
      <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} aria-pressed={active} {...rest}>
      {children}
    </button>
  );
}

/**
 * 툴바 **액션 버튼**(엑셀 내려받기·인쇄·새로 만들기…). 공용 `<Button>`과 같은 치수(control-scale)다.
 * 🔴 세로 패딩으로 높이를 만들지 말 것 — 글자 크기가 바뀌면 같이 흔들려 줄이 울퉁불퉁해진다.
 */
export function ToolbarButton({
  variant = "neutral",
  href,
  className = "",
  children,
  ...rest
}: {
  variant?: "neutral" | "primary";
  href?: string;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children">) {
  const cls = `inline-flex ${CONTROL_H} ${CONTROL_LABEL} ${CONTROL_ICON} shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium whitespace-nowrap transition disabled:opacity-50 ${
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/85"
      : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft border"
  } ${className}`;
  if (href !== undefined) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
