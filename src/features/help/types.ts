import type { MenuKey } from "@/lib/permissions";

/** 안내도에 버튼을 그리는 자리 — 머리·필터 줄·표 몸통이 실제 화면과 같은 순서로 선다. */
export type HelpZone = "header" | "toolbar" | "filters" | "board" | "row" | "cell" | "footer";

export type HelpGroup = "창" | "홈" | "수업" | "원생" | "운영" | "지원";

/** 안내도 뼈대 — 그 화면의 큰 덩어리만 흉내 낸다(표·칸반·격자). */
export type HelpLayout = "list" | "grid" | "kanban" | "sheet" | "dashboard" | "workspace";

export type HelpCallout = {
  n: number;
  label: string;
  zone: HelpZone;
  /** 본문. `[[slug]]` 또는 `[[slug|표시]]` + 화면 이름은 자동으로 다른 설명서로 연결된다. */
  body: string;
};

export type HelpFace = {
  title: string;
  summary: string;
  callouts: HelpCallout[];
};

export type HelpManual = {
  slug: string;
  title: string;
  /** 실제 화면 주소 — '이 화면 열기'가 여기를 연다. */
  href: string;
  menuKey: MenuKey | null;
  group: HelpGroup;
  summary: string;
  layout: HelpLayout;
  callouts: HelpCallout[];
  faces?: HelpFace[];
  related: string[];
};

export type HelpToken =
  | { type: "text"; value: string }
  | { type: "term"; slug: string; label: string; current: boolean };
