import type { ReactNode } from "react";
import { SheetText } from "@/features/teacher-view/interface-label";

/**
 * BigStat — Editorial 문법 ②(빅 스탯: 큰 tabular 숫자 + 작은 라벨 + 보조 라인).
 * 화면마다 중복 정의되던 Stat 5곳(staff·meetings·consultations·withdrawals·attendance)과
 * 운영실 KpiCard의 공용 수렴 지점. 시맨틱 컬러는 값이 아니라 아이콘 칩 톤에 — 숫자는 잉크
 * (강조가 필요한 값만 valueClass, 예: 미수 text-danger).
 */
/**
 * ⚠️ v4에서 `green`을 추가했다 — 종전 톤엔 "정상·완료"를 나타낼 색이 아예 없어서, 수납 완료·출석률
 * 같은 긍정 지표가 전부 primary(네이비)나 gold로 칠해졌다(의미색 캐논의 positive가 표현 불가였다).
 */
export type BigStatTone =
  | "neutral"
  | "primary"
  | "green"
  | "gold"
  | "blue"
  | "purple"
  | "rose"
  | "amber"
  | "danger";

const ICON_TONE: Record<BigStatTone, string> = {
  neutral: "bg-bg-soft text-text-dim",
  primary: "bg-primary-soft text-primary",
  green: "bg-green-soft text-green",
  gold: "bg-gold-soft text-gold",
  blue: "bg-blue-soft text-blue",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
};

/**
 * 누를 수 있는 스탯 카드의 **튀어나온 블록** 모양(원장 2026-09-04 재고관리 캡처: *"누를 수 있다는 이펙트를 주기 위해 3d블럭처럼
 * 튀어나와있으면 좋을듯"*) — 헤어라인 링 아래에 **블러 없는 단색 그림자 4px**(v5 카드 규칙 "블러 그림자 없음"은 지킨다)을 깔고,
 * 누르는 동안 3px 내려앉는다. 눌러서 무언가 여는 카드에만 쓴다(정보만 보이는 카드에 붙이면 "왜 안 눌리지"가 된다).
 */
// ⚠️ `shadow-card`(헤어라인 링)와 **함께 적지 않는다** — 둘 다 `--tw-shadow`를 쓰는 유틸이라 승자를 CSS 순서가 정한다([[#116]]).
//    링(1px)은 이 그림자 안에 첫 레이어로 들어 있다.
const RAISED =
  "cursor-pointer text-left shadow-[0_0_0_1px_var(--line),0_4px_0_0_var(--line-strong)] transition-[transform,box-shadow] duration-100 hover:-translate-y-px active:translate-y-[3px] active:shadow-[0_0_0_1px_var(--line),0_1px_0_0_var(--line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function BigStat({
  label,
  value,
  unit,
  sub,
  icon,
  tone = "neutral",
  valueClass,
  size = "md",
  onClick,
  ariaLabel,
}: {
  label: string;
  value: string | number;
  unit?: string;
  /** 보조 라인 — 델타·건수·기준일 등. ReactNode라 링크/모달 트리거도 허용. */
  sub?: ReactNode;
  /** 우측 상단 아이콘 칩 내용(예: <EyIcon name="users" size={16} />). */
  icon?: ReactNode;
  tone?: BigStatTone;
  /** 값 강조색(미수 danger 등). 기본은 잉크. */
  valueClass?: string;
  size?: "md" | "lg";
  /** 주면 카드가 **버튼**이 되고 튀어나온 블록 모양(RAISED)을 입는다 — 눌러서 무언가를 여는 카드에만. */
  onClick?: () => void;
  /** 버튼일 때의 접근성 이름(예: "조치가 필요한 자산 목록 열기"). 없으면 라벨·값이 그대로 읽힌다. */
  ariaLabel?: string;
}) {
  // compact-chrome(창·모바일·강사 미니셸) — 크롬이 이미 밖에 있는 화면에선 카드가 세로 110px을 먹을 이유가
  // 없다. 값·라벨·보조라인은 **그대로 두고 밀도만** 올린다(정보를 지우지 않는다). 아이콘 칩만 한 단계 축소.
  const Shell = onClick ? "button" : "div";
  /**
   * 버튼은 **phrasing content**만 담을 수 있어서, 누를 수 있는 카드의 안쪽 묶음은 `<span>`이어야 한다
   * (재리뷰 2026-09-04 — `<div>`는 브라우저가 견딜 뿐 무효한 HTML이다).
   * ⚠️ 반대로 **그냥 카드일 땐 `<div>` 그대로** 둔다 — 호출부가 `sub`에 컴포넌트를 넘기는 자리가 있어
   *    (운영실 `command-band`) 늘 `<span>`으로 감싸면 이번엔 span 안에 블록이 들어가 같은 문제가 뒤집혀 난다.
   *    그래서 누를 수 있는 카드의 `sub`엔 블록 요소를 넘기지 말 것(지금은 전부 문자열).
   */
  const Box = onClick ? "span" : "div";
  return (
    <Shell
      data-stat=""
      data-stat-action={onClick ? "" : undefined}
      {...(onClick ? { type: "button" as const, onClick, "aria-label": ariaLabel } : {})}
      className={`bg-card block w-full rounded-2xl p-4 compact-chrome:p-3 xl:p-5 ${onClick ? RAISED : "shadow-card"}`}
    >
      <Box data-stat-label="" className="flex items-center justify-between gap-2">
        <span className="text-text-dim text-sm font-medium compact-chrome:text-xs"><SheetText value={label} /></span>
        {icon ? (
          <span
            className={`${ICON_TONE[tone]} flex size-8 shrink-0 items-center justify-center rounded-xl compact-chrome:size-6 compact-chrome:rounded-lg`}
            aria-hidden="true"
            data-stat-icon=""
          >
            {icon}
          </span>
        ) : null}
      </Box>
      <Box data-stat-value="" className={`${size === "lg" ? "mt-3" : "mt-2.5"} flex items-baseline gap-1 compact-chrome:mt-1`}>
        <span
          className={`num font-bold leading-none tracking-tight compact-chrome:text-2xl ${
            size === "lg" ? "text-4xl" : "text-3xl"
          } ${valueClass ?? "text-foreground"}`}
        >
          {value}
        </span>
        {unit ? <span className="text-text-dim text-sm font-medium compact-chrome:text-xs"><SheetText value={unit} /></span> : null}
      </Box>
      {/* 보조라인 자리는 값이 없을 때 **비워두되 높이를 잡아** 카드 4장의 밑선을 맞춘다 — 컴팩트에선 그
          예약 높이를 없애고(min-h-0) 실제 내용이 있을 때만 차지하게 한다. */}
      <Box data-stat-sub="" className="text-text-faint mt-1.5 block min-h-[17px] text-xs compact-chrome:mt-0.5 compact-chrome:min-h-0">
        {sub ?? null}
      </Box>
    </Shell>
  );
}
