import type { TileTone } from "@/features/dashboard/onescreen/kpi";

/**
 * 한 화면 대시보드의 **껍데기 두 벌** — 원장 2026-09-10: *"색은 너무 알록달록할 필요는 없을것 같은데
 * 두가지다 볼 수 있게 일단 해줘볼래? 하나 없애버리면 될거같으니까."*
 *
 * 🔴 **데이터·판정은 한 벌이다.** 두 안은 클래스 문자열만 다르고 조회·계산·문구는 글자 그대로 같다 —
 *    한쪽을 지울 때 이 파일과 `skin` prop만 걷어내면 되도록(=diff가 작도록) 여기 한 곳에 모았다.
 * 🔴 **새 색을 지어내지 않았다.** 전부 이미 있는 토큰(`--color-primary-soft` 등)이라 "토큰 없는 유틸이
 *    빌드를 통과하고 아무 색도 안 붙는" 함정([[v4 가드]])을 피한다.
 *
 * - `a`  = 팔레트 v4 그대로. 면은 흰색, 구조는 테두리, **색은 의미에만**(왼쪽 3px).
 * - `bi` = 밀도를 올린 비교안. 간격을 좁히고 숫자를 키우고 라벨을 짧게, KPI **머리에 옅은 남색 띠**.
 *          🔴 알록달록하게 만들지 않는다 — 띠는 브랜드 한 계열 하나뿐이고 의미색은 그 띠의 **위 테두리**로
 *          그대로 남는다(색이 늘어난 게 아니라 자리만 옮겼다).
 */
export const ONESCREEN_SKINS = ["a", "bi"] as const;
export type OneScreenSkin = (typeof ONESCREEN_SKINS)[number];

/** `?skin=` 값 해석 — 모르는 값은 기본안으로(주소를 잘못 쳐서 화면이 안 뜨는 일이 없게). */
export function resolveSkin(raw: string | undefined | null): OneScreenSkin {
  return raw === "bi" ? "bi" : "a";
}

export type SkinClasses = {
  key: OneScreenSkin;
  /** 격자 간격 — 밀도의 절반은 여기서 나온다. */
  gridGap: string;
  /** 카드 공통(면·둥글기). */
  card: string;
  /** KPI 타일 안쪽 여백. */
  kpiPad: string;
  /** KPI 주숫자 크기 — 🔴 토큰만(임의 px 금지, 가드가 잡는다). */
  kpiValue: string;
  /** KPI 의미색이 붙는 자리. */
  kpiAccent: Record<TileTone, string>;
  /** `bi`에서만 쓰는 머리 띠(라벨 줄 배경). 기본안은 빈 문자열. */
  kpiHead: string;
  /** 패널·띠 칸 안쪽 여백. */
  panelPad: string;
  /** 패널 제목 크기. */
  panelTitle: string;
  /** 짧은 라벨을 쓰는가(밀도안). */
  shortLabels: boolean;
};

/**
 * 기본안의 의미색 = **옅은 바탕**. 🔴 왼쪽 색 띠는 금지다(원장 2026-09-16) — 띠만 빼면 타일에 tone을 따라 칠해지는 것이
 * 하나도 없어 경고 타일이 평범한 타일과 똑같아진다(적대 리뷰), 그래서 뜻을 바탕으로 옮겼다. 이름은 소비처가 많아 그대로 둔다.
 */
const ACCENT_LEFT: Record<TileTone, string> = {
  positive: "bg-green-soft",
  caution: "bg-amber-soft",
  critical: "bg-danger-soft",
  inert: "",
};

/** 머리 띠 위 3px — 밀도안. 색의 **뜻**은 그대로고 자리만 옮긴다. */
const ACCENT_TOP: Record<TileTone, string> = {
  positive: "border-t-[3px] border-t-green",
  caution: "border-t-[3px] border-t-amber",
  critical: "border-t-[3px] border-t-danger",
  inert: "border-t-[3px] border-t-line-strong",
};

export const SKINS: Record<OneScreenSkin, SkinClasses> = {
  a: {
    key: "a",
    gridGap: "gap-2",
    card: "bg-card rounded-2xl",
    kpiPad: "px-3 py-2",
    kpiValue: "text-2xl",
    kpiAccent: ACCENT_LEFT,
    kpiHead: "",
    panelPad: "px-3",
    panelTitle: "text-sm",
    shortLabels: false,
  },
  bi: {
    key: "bi",
    gridGap: "gap-1",
    card: "bg-card rounded-lg",
    kpiPad: "px-2 py-1",
    kpiValue: "text-3xl",
    kpiAccent: ACCENT_TOP,
    kpiHead: "bg-primary-soft",
    panelPad: "px-2",
    panelTitle: "text-xs",
    shortLabels: true,
  },
};
