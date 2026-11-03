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
  /** 전문(상담 요약·메모·진도) — 영역 중심에서 이 줄을 고르면 패널에 그대로 펼친다(원장 2026-11-03 *"선택했을 때 자세히"*). */
  body?: string | null;
  /** 이 줄의 내역(출결 '기록' 33건의 날짜·반·상태 …) — 영역 중심에서 이 줄을 고르면 패널이 이 목록을 펼친다. */
  items?: ExploreRow[];
};

/**
 * 조각 상태 — 🔴 **조회 실패를 '0건'으로 꾸미지 않는다**. 비어 있음(`empty`) · 권한 없음(`denied`) · 실패(`error`)를 가른다.
 */
export type SectorState = "ready" | "empty" | "denied" | "error";

export type ExploreLink = { href: string; label: string };

/** 같은 과목 안의 반 하나 — 조각을 다시 n분할한 작은 조각(원장 2026-11-03 *"같은 과목이면 그 안에서 다시 n분할"*). `rows` = 패널에 펼칠 그 반 요약. */
export type ExplorePart = { key: string; label: string; summary: string; target: ExploreTarget; rows?: ExploreRow[] };

export type ExploreSector = {
  key: string;
  label: string;
  icon: AywaIconName;
  tone: ExploreTone;
  /** 조각 안의 한 줄 요약(길면 화면이 말줄임). */
  summary: string;
  state: SectorState;
  /** 있으면 이 조각을 각도로 n분할해 작은 조각마다 다른 대상(반)을 둔다 — 각 작은 조각이 더블클릭 흡수의 단위. */
  parts?: ExplorePart[];
  /** 실제 대상 — 하나면 바로 중심 전환, 여럿이면 패널 목록. */
  targets?: ExploreTarget[];
  /** 패널 제목이 곧 이 대상일 때(반 하나짜리 조각 · 2단계 조각) — 이름을 되풀이하지 않고 '중심으로 보기' 동작만 둔다. */
  focus?: ExploreTarget;
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
  /** 영역 중심(2단계 도넛)이면 그 영역의 조각 key — 예: 김민서G의 '수업'. 실제 대상 중심이면 없음. */
  group?: string;
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
  /** 아무 조각도 안 골랐을 때 패널에 펼칠 것 — 영역 중심은 그 영역 전체(목록·링크), 없으면 `defaultSector` 조각. */
  panelDefault?: ExploreSector;
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

/** 원생 도넛의 과목 조각 key — `subject:<과목 키>`(원장 2026-11-03 *"다른 과목이면 n분할을 한 칸 더"*). */
export const subjectSectorKey = (subjectKey: string) => `subject:${subjectKey}`;
export const subjectOfSectorKey = (key: string): string | null => (key.startsWith("subject:") ? key.slice("subject:".length) : null);
/** 조각 key 모양 — 표의 고정 key 또는 `subject:<키>`. 주소에서 온 값은 이 모양만 받는다. */
const SECTOR_KEY_OK = /^[a-z_]+(?::[A-Za-z0-9_-]{1,40})?$/;
export const isSectorKeyShape = (v: string) => SECTOR_KEY_OK.test(v);

/** 조각 안 작은 조각(반)의 선택 key — `<조각 key>#<작은 조각 key>`. */
export const partSelKey = (sectorKey: string, partKey: string) => `${sectorKey}#${partKey}`;
export function splitSelKey(sel: string): { sectorKey: string; partKey: string | null } {
  const at = sel.indexOf("#");
  return at < 0 ? { sectorKey: sel, partKey: null } : { sectorKey: sel.slice(0, at), partKey: sel.slice(at + 1) };
}

/** 화면이 그리는 쐐기 하나 — 조각 그대로이거나, 조각을 n분할한 작은 조각(반). */
export type Wedge = {
  selKey: string;
  sector: ExploreSector;
  part: ExplorePart | null;
  angles: SectorAngles;
  label: string;
  summary: string;
  /** 작은 조각이면 위에 작게 적는 과목 이름. */
  eyebrow: string | null;
  icon: AywaIconName;
  tone: ExploreTone;
};

/**
 * 조각 목록 → 쐐기 목록. 조각은 같은 크기로 n등분(맨 위부터 시계 방향), `parts`가 있는 조각은 **그 각도 안에서** 다시 k등분.
 * 🔑 돌출·올리기·흡수·펼치기 모두 쐐기 단위다(작은 조각 하나가 곧 더블클릭 흡수의 단위).
 */
export function wedgesOf(sectors: readonly ExploreSector[]): Wedge[] {
  const n = sectors.length;
  const out: Wedge[] = [];
  sectors.forEach((s, i) => {
    const a = sectorAngles(n, i);
    const parts = s.parts && s.parts.length > 0 ? s.parts : null;
    if (!parts) {
      out.push({ selKey: s.key, sector: s, part: null, angles: a, label: s.label, summary: s.summary, eyebrow: null, icon: s.icon, tone: s.tone });
      return;
    }
    // 반이 하나뿐인 과목도 같은 꼴(작게 과목명 · 굵게 수업명)로 — 반 수에 따라 생김새가 갈리지 않게(원장 2026-11-03 *"수학과 영어의 일관성"*).
    const step = (a.end - a.start) / parts.length;
    parts.forEach((p, j) => {
      const start = a.start + step * j;
      out.push({
        selKey: partSelKey(s.key, p.key),
        sector: s,
        part: p,
        angles: { start, end: start + step, mid: start + step / 2 },
        label: p.label,
        summary: p.summary,
        eyebrow: s.label,
        icon: s.icon,
        tone: s.tone,
      });
    });
  });
  return out;
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

/** 고리 조각(피자 조각에서 가운데를 뺀 모양)의 SVG path. 조각이 하나(360°)면 호가 제자리로 돌아와 안 그려지므로 반씩 두 호로. */
export function sectorPath(cx: number, cy: number, rInner: number, rOuter: number, startDeg: number, endDeg: number): string {
  const f = (n: number) => n.toFixed(2);
  if (endDeg - startDeg >= 360) {
    const mid = startDeg + 180;
    const o1 = polar(cx, cy, rOuter, startDeg);
    const o2 = polar(cx, cy, rOuter, mid);
    const i1 = polar(cx, cy, rInner, startDeg);
    const i2 = polar(cx, cy, rInner, mid);
    return [
      `M ${f(o1.x)} ${f(o1.y)}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${f(o2.x)} ${f(o2.y)}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${f(o1.x)} ${f(o1.y)}`,
      "Z",
      `M ${f(i1.x)} ${f(i1.y)}`,
      `A ${rInner} ${rInner} 0 1 0 ${f(i2.x)} ${f(i2.y)}`,
      `A ${rInner} ${rInner} 0 1 0 ${f(i1.x)} ${f(i1.y)}`,
      "Z",
    ].join(" ");
  }
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, startDeg);
  const o2 = polar(cx, cy, rOuter, endDeg);
  const i1 = polar(cx, cy, rInner, endDeg);
  const i2 = polar(cx, cy, rInner, startDeg);
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

/** 중심 하나 — 실제 대상(`kind:id`) 또는 영역 중심(`kind:id:sector`, 예: 김민서G의 '수업'). */
export type TrailItem = { kind: ExploreKind; id: string; sector?: string };
export type TrailLabel = TrailItem & { label: string };

/** 탐색 경로에 남기는 이전 중심의 수 — 그보다 길면 오래된 것부터 버린다. */
export const TRAIL_MAX = 8;
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

export const sameCenter = (a: TrailItem, b: TrailItem) => a.kind === b.kind && a.id === b.id && (a.sector ?? "") === (b.sector ?? "");

/** `?t=student:<id>,class:<id>,student:<id>:classes` → 항목. 모르는 종류·이상한 id·모르는 영역은 조용히 버린다(주소는 누구나 적는다). */
export function parseTrail(raw: string | string[] | undefined | null): TrailItem[] {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return [];
  const out: TrailItem[] = [];
  for (const part of text.split(",")) {
    // `kind:id` 또는 `kind:id:<조각 key>` — 조각 key 자체에 `:`가 있을 수 있어(`subject:math`) 앞 둘만 자르고 나머지는 통째로.
    const [kind, id, ...sectorParts] = part.split(":");
    if (!kind || !id || !isExploreKind(kind) || !ID_OK.test(id)) continue;
    const sector = sectorParts.length > 0 ? sectorParts.join(":") : undefined;
    if (sector !== undefined && !isSectorKeyShape(sector)) continue;
    const item: TrailItem = sector ? { kind, id, sector } : { kind, id };
    if (out.some((o) => sameCenter(o, item))) continue;
    out.push(item);
  }
  return out.slice(-TRAIL_MAX);
}

export function encodeTrail(items: readonly TrailItem[]): string {
  return items.map((i) => (i.sector ? `${i.kind}:${i.id}:${i.sector}` : `${i.kind}:${i.id}`)).join(",");
}

/**
 * 다음 중심으로 갈 때의 경로 — 이미 경로에 있던 대상으로 돌아가면 **그 자리까지 잘라** 되감는다(빵 부스러기처럼),
 * 아니면 지금 중심을 뒤에 붙인다. 같은 대상이면 그대로.
 */
export function nextTrail(trail: readonly TrailItem[], current: TrailItem, target: TrailItem): TrailItem[] {
  if (sameCenter(current, target)) return [...trail];
  const at = trail.findIndex((t) => sameCenter(t, target));
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
  // 영역 key(`subject:math`)의 `:`는 id처럼 인코딩 — Next 16은 경로 매개변수를 디코딩하지 않고 `subject%3Amath`로 넘긴다(받는 쪽이 푼다).
  const path = `/explore/${target.kind}/${encodeURIComponent(target.id)}${target.sector ? `/${encodeURIComponent(target.sector)}` : ""}`;
  return `${path}${q ? `?${q}` : ""}`;
}

/** 영역 중심의 이름 — "김민서G · 수업". 경로(빵 부스러기)와 가운데 원이 같은 말을 쓴다. */
export function groupCenterName(parentName: string, sectorLabel: string): string {
  return `${parentName} · ${sectorLabel}`;
}

/** 조각 key의 화면 이름 — 표의 고정 조각은 표에서, 과목 조각은 과목 라벨로(호출부가 `labelOf`를 준다). */
export function sectorLabelOf(kind: ExploreKind, key: string, subjectLabelOf: (k: string) => string): string {
  const subject = subjectOfSectorKey(key);
  if (subject) return subjectLabelOf(subject);
  return SECTOR_DEFS[kind].find((d) => d.key === key)?.label ?? key;
}

/** 2단계 도넛의 조각 수 상한 — 그보다 많으면 마지막 조각이 '나머지 N'을 맡고 전체는 패널 목록에. */
export const GROUP_PIECE_MAX = 12;
const PIECE_TONES: readonly ExploreTone[] = ["blue", "green", "purple", "rose", "gold", "primary", "amber"];

/**
 * 영역 중심 모델(원장 2026-11-03 *"전부 다 더블클릭 흡수 동작"*) — 실제 대상 중심의 조각 하나를 가운데로 놓고, 그 조각의
 * 연결 대상(실제 대상 → 더블클릭하면 그 대상이 중심) · 묶음(배정 예정 · 지난 수업) · 읽기 줄(출결 통계 등) · 링크를 주변 조각으로 펼친다.
 * 서버 조회는 그대로 쓴다(같은 모델에서 자른다) — 숫자·문구가 1단계와 같다.
 */
export function buildGroupModel(parent: ExploreModel, sectorKey: string): ExploreModel | null {
  const sector = parent.sectors.find((s) => s.key === sectorKey);
  if (!sector) return null;
  const pieces: ExploreSector[] = [];
  const tone = () => PIECE_TONES[pieces.length % PIECE_TONES.length];
  const pushTarget = (t: ExploreTarget, meta?: string | null, rows?: ExploreRow[]) =>
    pieces.push({
      key: `t:${t.kind}:${t.id}:${pieces.length}`,
      label: t.label,
      icon: KIND_ICON[t.kind],
      tone: tone(),
      summary: [meta ?? t.meta, t.detail].filter(Boolean).join(" · ") || KIND_LABEL[t.kind],
      state: "ready",
      // 패널 제목이 곧 이 대상 — 이름을 되풀이하지 않고(원장 2026-11-03) 요약 줄 + '중심으로 보기'만.
      focus: { ...t, ...(meta ? { meta } : {}) },
      rows: rows ?? [{ id: "about", title: t.detail || KIND_LABEL[t.kind], detail: meta ?? t.meta ?? null }, ...(t.facts ?? []).map((f, i) => ({ id: `f${i}`, title: f }))],
      note: `더블클릭하면 ${t.label}이(가) 중심이 됩니다.`,
    });
  // 작은 조각(같은 과목의 반들)이 있으면 그것이 곧 대상 목록이다(targets에도 같은 반이 있어 둘 다 돌면 겹친다).
  if (sector.parts && sector.parts.length > 0) for (const p of sector.parts) pushTarget(p.target, null, p.rows);
  else for (const t of sector.targets ?? []) pushTarget(t);
  for (const g of sector.groups ?? []) for (const t of g.targets) pushTarget(t, `${g.label}${t.meta ? ` · ${t.meta}` : ""}`);
  for (const r of sector.rows ?? [])
    pieces.push({
      key: `r:${r.id}`,
      label: r.title,
      icon: sector.icon,
      tone: tone(),
      summary: [r.right, r.date, r.detail].filter(Boolean).join(" · ") || sector.label,
      state: "ready",
      // 요약함 — 내역(items)이 있으면 그 목록, 전문(body)이 있으면 그대로, 아니면 그 줄 하나.
      rows: r.items && r.items.length > 0 ? r.items : [r],
      note: r.items && r.items.length > 0 ? `${r.title} ${r.items.length}건` : null,
    });
  if (pieces.length === 0)
    for (const l of sector.links ?? [])
      pieces.push({ key: `l:${l.href}`, label: l.label, icon: sector.icon, tone: tone(), summary: "더블클릭하면 엽니다", state: "ready", links: [l] });
  if (pieces.length === 0) pieces.push({ key: "empty", label: sector.label, icon: sector.icon, tone: tone(), summary: sector.summary, state: sector.state });
  const shown = pieces.length > GROUP_PIECE_MAX
    ? [...pieces.slice(0, GROUP_PIECE_MAX - 1), { key: "more", label: `나머지 ${pieces.length - (GROUP_PIECE_MAX - 1)}`, icon: sector.icon, tone: "primary" as const, summary: "패널 목록에서 고르세요", state: "ready" as const, targets: sector.targets, groups: sector.groups, rows: sector.rows }]
    : pieces;
  return {
    center: {
      kind: parent.center.kind,
      id: parent.center.id,
      name: groupCenterName(parent.center.name, sector.label),
      subtitle: sector.summary,
      status: parent.center.status,
      icon: sector.icon,
      detailHref: sector.links?.[0]?.href ?? parent.center.detailHref,
      detailLabel: sector.links?.[0]?.label ?? parent.center.detailLabel,
      group: sectorKey,
    },
    sectors: shown,
    defaultSector: shown[0].key,
    asOf: parent.asOf,
    aside: parent.aside,
    panelDefault: sector,
  };
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
