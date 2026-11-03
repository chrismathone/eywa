import type { AywaIconName } from "@/components/icons/aywa-icons";
import type { PillColor } from "@/components/atoms/pill";

/**
 * 연결 탐색(도넛) — **공용 계약**(서버 조회 · 클라 화면 · 창 해석이 함께 읽는 순수 모듈).
 *
 * 화면은 "선택한 실제 대상(원생·수업·강사)이 늘 도넛 가운데"이고, 주변 조각은 그 대상에서 이어지는 영역이다.
 * 조각의 **제목·그림·색**은 여기 표(`SECTOR_DEFS`)가 정하고, **요약·상태·연결 대상**은 서버 조회
 * ([`server/queries.ts`](./server/queries.ts))가 기존 조회 함수로 채운다 — 어느 조각이 어느 조회에서 오는지는
 * 그 파일의 `build*Sectors`에서 한 조각씩 따라갈 수 있다.
 *
 * ⚠️ `"use client"`도 `server-only`도 붙이지 말 것 — 창 해석(`window-link.tsx`)과 서버 페이지가 둘 다 읽는다([[#61]]·[[#81]]).
 */

export const EXPLORE_KINDS = ["student", "class", "teacher"] as const;
export type ExploreKind = (typeof EXPLORE_KINDS)[number];

export function isExploreKind(v: string | undefined | null): v is ExploreKind {
  return !!v && (EXPLORE_KINDS as readonly string[]).includes(v);
}

export const KIND_LABEL: Record<ExploreKind, string> = { student: "원생", class: "수업", teacher: "강사" };
export const KIND_ICON: Record<ExploreKind, AywaIconName> = { student: "user", class: "graduationCap", teacher: "user" };
/** 화면 제목 — 시안의 "수업 연결 탐색" · "강사 연결 탐색". */
export const KIND_TITLE: Record<ExploreKind, string> = {
  student: "원생 연결 탐색",
  class: "수업 연결 탐색",
  teacher: "강사 연결 탐색",
};

/** 창(iframe) 제목 · 메뉴 밖 화면이라 창 id는 경로 하나("explore")다 — [`windowIdForHref`](../../components/workspace/window-link.tsx). */
export const EXPLORE_WINDOW_LABEL = "연결 탐색";

/**
 * 조각 색 — 팔레트 v4의 **소프트 토큰만** 쓴다(시안의 민트·하늘·연보라에 해당하는 옅은 면색). 선택한 조각은 `primary` 단색.
 * 🔴 화면 파일에 hex를 적지 않는다(디자인 lint `shadcn/no-raw-colors`).
 */
export type ExploreTone = "primary" | "blue" | "green" | "purple" | "rose" | "gold" | "amber";
export const TONE_FILL: Record<ExploreTone, string> = {
  primary: "var(--primary-soft)",
  blue: "var(--blue-soft)",
  green: "var(--green-soft)",
  purple: "var(--purple-soft)",
  rose: "var(--rose-soft)",
  gold: "var(--gold-soft)",
  amber: "var(--amber-soft)",
};
export const TONE_INK_CLASS: Record<ExploreTone, string> = {
  primary: "text-primary",
  blue: "text-blue",
  green: "text-green",
  purple: "text-purple",
  rose: "text-rose",
  gold: "text-gold",
  amber: "text-amber",
};
export const TONE_BG_CLASS: Record<ExploreTone, string> = {
  primary: "bg-primary-soft",
  blue: "bg-blue-soft",
  green: "bg-green-soft",
  purple: "bg-purple-soft",
  rose: "bg-rose-soft",
  gold: "bg-gold-soft",
  amber: "bg-amber-soft",
};

/** 실제 대상 하나 — 누르면 **그 대상이 새 중심**이 된다. */
export type ExploreTarget = {
  kind: ExploreKind;
  id: string;
  label: string;
  /** 보조 한 줄(학교학년 · 과목 등). */
  detail?: string | null;
  /** 관계 이름(담임 · 교시 담당 · 임시 위임 …) — 같은 관계로 뭉뚱그리지 않는다. */
  meta?: string | null;
  /** 짧은 사실 칩(요일·시각 · 원생 N명 · 강의실). */
  facts?: string[];
  badge?: { label: string; color: PillColor } | null;
};

/** 상세 패널의 읽기 전용 한 줄(출결 통계 · 상담 요약 · 메모 …). */
export type ExploreRow = {
  id: string;
  title: string;
  detail?: string | null;
  date?: string | null;
  right?: string | null;
};

/**
 * 조각 상태 — 🔴 **조회 실패를 '0건'으로 꾸미지 않는다**. 비어 있음(`empty`) · 권한 없음(`denied`) · 실패(`error`)를 가른다.
 */
export type SectorState = "ready" | "empty" | "denied" | "error";

export type ExploreLink = { href: string; label: string };

export type ExploreSector = {
  key: string;
  label: string;
  icon: AywaIconName;
  tone: ExploreTone;
  /** 조각 안의 한 줄 요약(길면 화면이 말줄임). */
  summary: string;
  state: SectorState;
  /** 실제 대상 — 하나면 바로 중심 전환, 여럿이면 패널 목록. */
  targets?: ExploreTarget[];
  /** 주 목록 뒤에 따로 묶어 보이는 대상(배정 예정 · 지난 수업 …). */
  groups?: { label: string; targets: ExploreTarget[] }[];
  rows?: ExploreRow[];
  /** 기존 업무 화면으로 가는 문(출석부 · 시간표 · 강사 시트 …). */
  links?: ExploreLink[];
  note?: string | null;
};

export type ExploreCenter = {
  kind: ExploreKind;
  id: string;
  name: string;
  subtitle: string | null;
  status: { label: string; color: PillColor } | null;
  icon: AywaIconName;
  /** 기존 상세 화면(원생 상세 · 수업 상세 · 직원 상세). 권한이 없으면 null. */
  detailHref: string | null;
  detailLabel: string;
};

/** 넓은 화면 왼쪽 열(원장 2026-11-03 *"공간이 많이 남으니까"*) — 고정 사실 몇 줄 + (원생) AI 흐름 분석 카드. */
export type ExploreAside = {
  facts: { label: string; value: string }[];
  /** 원생 중심만 — 상담·타임라인 흐름 분석(저장된 결과만 · 페이지 로드로 AI를 부르지 않는다). */
  flow?: {
    state: "ready" | "denied" | "error";
    items: import("./flow-insight").FlowInsightView[];
    /** '다시 분석' 버튼(원생상담 쓰기 권한). */
    canRefresh: boolean;
  };
};

export type ExploreModel = {
  center: ExploreCenter;
  sectors: ExploreSector[];
  defaultSector: string;
  /** 판정 기준일(KST). */
  asOf: string;
  aside?: ExploreAside;
};

// ───────────────────────── 조각 표(제목 · 그림 · 색 · 시계 방향 순서) ─────────────────────────

export type SectorDef = { key: string; label: string; icon: AywaIconName; tone: ExploreTone };

/**
 * 조각은 **맨 위 조각부터 시계 방향**이다(시안과 같은 차례). 원생 8 · 수업 6 · 강사 6.
 * 🔴 조각을 더하거나 이름을 바꾸면 `server/queries.ts`의 `build*Sectors`가 **같은 key**를 채워야 한다(가드 `model.test.ts`).
 */
export const SECTOR_DEFS: Record<ExploreKind, readonly SectorDef[]> = {
  student: [
    { key: "classes", label: "수업", icon: "graduationCap", tone: "blue" },
    { key: "attendance", label: "출결", icon: "calendarCheck", tone: "green" },
    { key: "grades", label: "성적", icon: "barChart", tone: "primary" },
    { key: "progress", label: "진도", icon: "layers", tone: "purple" },
    { key: "consultations", label: "상담", icon: "message", tone: "blue" },
    { key: "memos", label: "특이사항", icon: "alertCircle", tone: "rose" },
    { key: "billing", label: "수납", icon: "wallet", tone: "green" },
    { key: "timeline", label: "타임라인", icon: "clock", tone: "gold" },
  ],
  class: [
    { key: "students", label: "수강 원생", icon: "users", tone: "blue" },
    { key: "teacher", label: "담임 강사", icon: "user", tone: "green" },
    { key: "timetable", label: "시간표", icon: "calendar", tone: "primary" },
    { key: "room", label: "강의실", icon: "doorOpen", tone: "purple" },
    { key: "attendance", label: "출석부", icon: "clipboardCheck", tone: "rose" },
    { key: "sheet", label: "강사 시트", icon: "spreadsheet", tone: "green" },
  ],
  teacher: [
    { key: "classes", label: "담당 수업", icon: "graduationCap", tone: "blue" },
    { key: "timetable", label: "수업 시간표", icon: "calendar", tone: "green" },
    { key: "students", label: "담당 원생", icon: "users", tone: "primary" },
    { key: "sheet", label: "강사 시트", icon: "spreadsheet", tone: "purple" },
    { key: "reports", label: "수업보고서", icon: "report", tone: "rose" },
    { key: "staff", label: "직원 정보", icon: "userSettings", tone: "green" },
  ],
};

/** 처음 열 때 패널에 펼치는 조각 — 시안: 원생은 수업 · 수업은 수강 원생 · 강사는 담당 수업. */
export const DEFAULT_SECTOR: Record<ExploreKind, string> = { student: "classes", class: "students", teacher: "classes" };

export function sectorDef(kind: ExploreKind, key: string): SectorDef {
  const def = SECTOR_DEFS[kind].find((d) => d.key === key);
  if (!def) throw new Error(`연결 탐색: 모르는 조각 ${kind}/${key}`);
  return def;
}

// ───────────────────────── 도넛 기하(순수) ─────────────────────────

/** 도넛 좌표계 — viewBox 한 변. 조각 돌출(px)은 이 단위라, 640px 안팎으로 그려지는 화면에서 시안의 12~18px와 같다. */
export const DONUT_SIZE = 640;
export const DONUT_CENTER = DONUT_SIZE / 2;
export const DONUT_OUTER = 300;
export const DONUT_INNER = 130;
/** 라벨(그림·제목·요약)의 중심 반지름 — 고리의 한가운데보다 살짝 바깥(안쪽은 가운데 원에 붙는다). */
export const DONUT_LABEL_R = (DONUT_OUTER + DONUT_INNER) / 2 + 6;
export const OFFSET_SELECTED = 16;
export const OFFSET_HOVER = 10;

export type SectorAngles = { start: number; end: number; mid: number };

/** `count`개를 같은 크기로 나눠 `index`번째 조각의 각도(도) — 0번 조각이 **맨 위 가운데**에 오고 시계 방향으로 돈다. */
export function sectorAngles(count: number, index: number): SectorAngles {
  if (!Number.isInteger(count) || count <= 0) throw new Error("조각 수는 1 이상의 정수여야 합니다");
  const step = 360 / count;
  const start = -90 - step / 2 + index * step;
  return { start, end: start + step, mid: start + step / 2 };
}

export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** 고리 조각(피자 조각에서 가운데를 뺀 모양)의 SVG path. */
export function sectorPath(cx: number, cy: number, rInner: number, rOuter: number, startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, startDeg);
  const o2 = polar(cx, cy, rOuter, endDeg);
  const i1 = polar(cx, cy, rInner, endDeg);
  const i2 = polar(cx, cy, rInner, startDeg);
  const f = (n: number) => n.toFixed(2);
  return [
    `M ${f(o1.x)} ${f(o1.y)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${f(o2.x)} ${f(o2.y)}`,
    `L ${f(i1.x)} ${f(i1.y)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${f(i2.x)} ${f(i2.y)}`,
    "Z",
  ].join(" ");
}

/** 조각의 바깥 방향 이동량(돌출) — 모양은 그대로 두고 각도 중심선을 따라 `offset`만큼. */
export function sectorOffset(midDeg: number, offset: number): { dx: number; dy: number } {
  const rad = (midDeg * Math.PI) / 180;
  return { dx: Math.cos(rad) * offset, dy: Math.sin(rad) * offset };
}

// ───────────────────────── 주소 · 탐색 경로(순수) ─────────────────────────

export type TrailItem = { kind: ExploreKind; id: string };
export type TrailLabel = TrailItem & { label: string };

/** 탐색 경로에 남기는 이전 중심의 수 — 그보다 길면 오래된 것부터 버린다. */
export const TRAIL_MAX = 8;
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

/** `?t=student:<id>,class:<id>` → 항목. 모르는 종류·이상한 id는 조용히 버린다(주소는 누구나 적는다). */
export function parseTrail(raw: string | string[] | undefined | null): TrailItem[] {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return [];
  const out: TrailItem[] = [];
  for (const part of text.split(",")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const kind = part.slice(0, at);
    const id = part.slice(at + 1);
    if (!isExploreKind(kind) || !ID_OK.test(id)) continue;
    if (out.some((o) => o.kind === kind && o.id === id)) continue;
    out.push({ kind, id });
  }
  return out.slice(-TRAIL_MAX);
}

export function encodeTrail(items: readonly TrailItem[]): string {
  return items.map((i) => `${i.kind}:${i.id}`).join(",");
}

/**
 * 다음 중심으로 갈 때의 경로 — 이미 경로에 있던 대상으로 돌아가면 **그 자리까지 잘라** 되감는다(빵 부스러기처럼),
 * 아니면 지금 중심을 뒤에 붙인다. 같은 대상이면 그대로.
 */
export function nextTrail(trail: readonly TrailItem[], current: TrailItem, target: TrailItem): TrailItem[] {
  if (current.kind === target.kind && current.id === target.id) return [...trail];
  const at = trail.findIndex((t) => t.kind === target.kind && t.id === target.id);
  if (at >= 0) return trail.slice(0, at);
  return [...trail, current].slice(-TRAIL_MAX);
}

export function exploreHref(
  target: TrailItem,
  opts: { trail?: readonly TrailItem[]; sector?: string | null; embed?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (opts.trail && opts.trail.length > 0) params.set("t", encodeTrail(opts.trail));
  if (opts.sector) params.set("sector", opts.sector);
  if (opts.embed) params.set("embed", "1");
  const q = params.toString();
  return `/explore/${target.kind}/${encodeURIComponent(target.id)}${q ? `?${q}` : ""}`;
}

export function exploreLandingHref(embed = false): string {
  return embed ? "/explore?embed=1" : "/explore";
}

// ───────────────────────── 요약 문구(순수) ─────────────────────────

/** "김민준 외 7명" · "수학 심화 A 외 1개" · 하나면 그 이름 · 없으면 빈 문자열. */
export function othersLabel(names: readonly string[], unit: "명" | "개"): string {
  const list = names.filter((n) => n.trim().length > 0);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list[0]} 외 ${list.length - 1}${unit}`;
}

/** `2026-11-01` → `11월 1일` (시안의 "최근 상담 11월 1일"). 날짜가 아니면 그대로. */
export function monthDayKo(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}

/** 긴 글을 한 줄 요약으로 — 줄바꿈을 접고 `max`자에서 말줄임. */
export function oneLine(text: string | null | undefined, max = 40): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
