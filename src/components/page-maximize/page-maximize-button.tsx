"use client";

import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { usePageMaximize } from "./page-maximize-context";

/**
 * **'화면 최대화' ↔ '화면 원래대로'** — 한 버튼이 상태에 따라 라벨·아이콘만 바뀐다(원장 2026-10-01 *"화면 최대화 버튼과
 * 최소화 버튼을 같은 위치에 놔둬야지 이거 위치 못찾겠는데? 그리고 파란색으로 버튼하고. 헤더 우측에 끼워넣어"*).
 * 공용 `PageHeader`(와 그 스켈레톤)가 오른쪽 끝에 그리므로 헤더를 쓰는 모든 메뉴에 저절로 서고, 최대화 중에도 머리글 한 줄이
 * 남아 **같은 자리**에 그대로 있다. 색 = 공용 `<Button>` 기본(primary 파랑) · 크기 = 기본(머리글 동작 버튼과 같은 높이).
 *
 * 안 보이는 곳 — 판정은 여기 한 곳:
 * - 공급자가 없는 셸(창 안 · 강사·학생 미니셸 · 슈퍼관리자) · 창 모드가 켜진 지점 → `usePageMaximize()`가 `null`.
 * - 창(iframe) 안으로 풀셸이 새어 들어온 경우(드릴인으로 embed가 떨어짐) → `useInFrame()`.
 * - 데스크톱이 아닌 화면(좁은 폭·터치) → CSS `hidden desk:inline-flex`(서버 렌더부터 정해져 깜빡임이 없다) · 인쇄 → `print:hidden`.
 * 아이콘 = 플로팅 창 최대화와 같은 사각형 / 되돌리기는 겹친 사각형(창 크롬과 같은 짝).
 * `data-page-maximize-button` = "이 화면엔 머리글 출구가 있다" 표식(globals.css가 출구 줄 `PageMaximizeFallbackBar`를 끈다).
 */
export function PageMaximizeButton() {
  const ctx = usePageMaximize();
  const inFrame = useInFrame();
  if (!ctx || inFrame) return null;
  return <Toggle maximized={ctx.maximized} onToggle={ctx.setMaximized} marker="header" />;
}

/**
 * **출구 줄** — PageHeader가 없는 화면(운영실·월별 출석부·원생상담·상세 화면 등 자체 머리)에서 최대화 상태로 남아도 돌아올 길을
 * 보장한다. 셸 본문(`<main>`) **바로 위** 한 줄(스크롤 밖 — 본문 높이를 쓰는 화면을 밀어 넘치게 하지 않는다), 오른쪽 끝에 같은 파란
 * '화면 원래대로'. 최대화 중이고 그 화면에 머리글 버튼이 **없을 때만** 선다(globals.css `:has([data-page-maximize-button])`) —
 * 머리글이 있는 화면에선 머리글의 같은 버튼이 출구다.
 */
export function PageMaximizeFallbackBar() {
  const ctx = usePageMaximize();
  const inFrame = useInFrame();
  if (!ctx || inFrame || !ctx.maximized) return null;
  return (
    // 셸 크롬 층 — 이용 분석이 이 줄의 입력을 화면 활동으로 세지 않게(결정 tenant.md "새 크롬 층을 만들면 표식").
    // 여백은 globals.css가 준다 — 버튼이 머리글 버튼과 **같은 자리**(위·오른쪽)에 서게(로딩 스켈레톤 → 머리글 없는 화면으로 넘어가도 안 움직인다).
    <div data-maximize-fallback="" data-usage-chrome="" className="hidden shrink-0 justify-end print:hidden">
      <Toggle maximized onToggle={ctx.setMaximized} marker="fallback" />
    </div>
  );
}

function Toggle({
  maximized,
  onToggle,
  marker,
}: {
  maximized: boolean;
  onToggle: (on: boolean, from?: HTMLElement | null) => void;
  marker: "header" | "fallback";
}) {
  return (
    <Button
      type="button"
      data-page-maximize-toggle=""
      {...(marker === "header" ? { "data-page-maximize-button": "" } : {})}
      data-usage-chrome=""
      onClick={(e) => onToggle(!maximized, e.currentTarget)}
      className="hidden print:hidden desk:inline-flex"
    >
      <EyIcon name={maximized ? "copy" : "square"} />
      {maximized ? "화면 원래대로" : "화면 최대화"}
    </Button>
  );
}
