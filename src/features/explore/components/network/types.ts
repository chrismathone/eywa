import type { ExploreCenter, ExploreModel, ExploreTarget, ExploreTone, SectorState } from "../../model";

/** 네트워크 판의 자료 모양과 점 id 규칙 — 순수 모듈(서버·클라 겸용). 규약 설명은 [`graph.ts`](./graph.ts) 머리. */

export type NetAnalysis = { id: string; title: string; detail: string; evidence: string[]; kind?: "ai" | "rule" };
/** 온톨로지 사실 — `target`이 있으면(형제 원생) 더블클릭·패널 '중심으로 보기'가 그 대상을 중심으로 연다. */
export type NetFact = { id: string; title: string; detail: string; target?: ExploreTarget | null };
export type NetInput = { model: ExploreModel; analyses?: NetAnalysis[]; facts?: NetFact[] };
export type NetViewMode = "records" | "summary";
export type NetPoint = { x: number; y: number };
/** 보기 = 배율(k)과 이동(x·y) — 화면 px = 판 좌표 × k + (x, y). */
export type NetCam = { x: number; y: number; k: number };
/** `group` = 날짜 묶음(연도 · 월 · 같은 날 여러 건이면 일자) — 기록을 한꺼번에 뿌리지 않고 영역 아래 연도 → 월 → 일자로 묶는다(원장 2026-11-06). */
export type NetNodeKind = "root" | "hub" | "record" | "target" | "analysis" | "fact" | "group";
/** 날짜 묶음의 단계. */
export type NetGroupLevel = "year" | "month" | "day";
/** 영역 점을 더블클릭하면 — 영역이 중심(흡수) · 그 대상이 중심 · 원본 화면 열기(영역 중심 안의 통계·기록 조각). */
export type NetHubOpen = "absorb" | "center" | "link";

export type NetNode = {
  id: string;
  title: string;
  kind: NetNodeKind;
  tone: ExploreTone;
  /** 기록·대상·사실·날짜 묶음이 속한 영역 점 id(맨 위 영역). */
  hub?: string;
  /** 바로 위 점(영역 · 연도 · 월 · 일자) — 배치·펼치기의 축. 없으면 `hub`. */
  parent?: string;
  /** 판에 적는 짧은 이름(없으면 `title`) — 묶음 아래 기록은 '7일 · 제목', 값이 있는 줄은 '총 청구 5건'. */
  label?: string;
  /** 날짜 묶음의 단계 · 영역 점을 더블클릭했을 때 할 일 · 영역의 한 줄 요약(도넛 조각과 같은 글). */
  level?: NetGroupLevel;
  open?: NetHubOpen;
  /** `open = "center"`일 때 중심이 될 대상 이름(과목 조각은 첫 반). */
  openTo?: string;
  summary?: string | null;
  /** 날짜 묶음·영역 아래 기록 수 — 묶음 이름의 'N건'과 hover 카드가 같은 값을 쓴다. 영역의 대상(수업·강사·원생) 수는 `members`. */
  tally?: number;
  members?: number;
  /** 영역의 날짜 없는 항목(통계·속성 줄) 수 · 영역 중심에서 더 좁은 영역으로 옮겨 선 기록 수 · 조각 자체가 기록 하나인가(영역 중심 `r:<줄 id>`). */
  items?: number;
  moved?: number;
  self?: boolean;
  /** 영역 중심에서 이 영역의 기록이 더 작은 영역으로 옮겨 섰으면 그 영역 이름들(hover 카드 안내). */
  movedTo?: string[];
  /** 영역 점이면 그 조각 key · 기록·대상이면 처음 속한 조각 key. */
  sectorKey?: string;
  /** 영역 점 더블클릭 때 넘기는 선택 key(작은 조각이 있으면 첫 작은 조각 — 시안). */
  zoomKey?: string;
  /** 영역 점의 조회 상태 — 권한 없음·실패를 0건으로 꾸미지 않게 hover 카드가 밝힌다. */
  state?: SectorState;
  /** 온톨로지 사실 영역(모델 밖). */
  virtual?: boolean;
  /** 주체별 요약 판의 영역 기록 수. */
  count?: number;
  rowId?: string;
  detail?: string | null;
  date?: string | null;
  body?: string | null;
  target?: ExploreTarget | null;
  /** 전환 프레임 값 — 불투명도 · 반지름 배율. */
  op?: number;
  rScale?: number;
};
export type NetEdge = { from: string; to: string; rel: string; w?: number; op?: number };
export type NetGraph = { nodes: NetNode[]; edges: NetEdge[] };
export type NetBoard = NetGraph & {
  centerId: string;
  mode: NetViewMode;
  pos: Record<string, NetPoint>;
  adjacency: Map<string, Set<string>>;
  view: NetCam;
  hover: string | null;
  morphing?: boolean;
};
export type NetSize = { w: number; h: number };

export const ONTOLOGY_HUB = "hub:ontology";
export const netRootId = (c: Pick<ExploreCenter, "kind" | "id" | "group">) => (c.group ? `${c.kind}:${c.id}:${c.group}` : `${c.kind}:${c.id}`);
export const netTargetId = (t: Pick<ExploreTarget, "kind" | "id">) => `${t.kind}:${t.id}`;
export const netHubId = (sectorKey: string) => `hub:${sectorKey}`;
/** 고른·연 점의 정보(패널·상세가 읽는다) — `id` = 점 id(그대로 `record` prop으로 돌려주면 그 점이 강조된다). */
export type NetRecordInfo = {
  id: string;
  /** 기록 · 대상(수업·강사·원생) · 분석 · 온톨로지 사실(영역 점 포함) · 날짜 묶음. */
  kind: "record" | "target" | "analysis" | "fact" | "group";
  title: string;
  date: string | null;
  detail: string | null;
  body: string | null;
  /** 속한 조각 key — 분석·사실은 빈 문자열. */
  sectorKey: string;
  target: ExploreTarget | null;
};

/** `unit` = 날짜 묶음이면 그 단계 이름('월' · '일자') — 기록 패널이 '일자 12개 · 기록 3건'처럼 센다. */
export type NetNeighbor = { id: string; title: string; rel: string; tone: ExploreTone; date?: string | null; unit?: string };

/** 도구줄 머리 — '98개 기록 · 121개 연결선 · 중심 김서연' · 요약은 '11개 영역 · 26개 연결'. */
export type NetHead = { mode: NetViewMode; nodes: number; hubs: number; edges: number; name: string };

/** 판이 부모에게 알리는 일(고르기·열기). */
export type NetCallbacks = {
  onSelectSector: (selKey: string | null) => void;
  onSelectRecord: (rec: NetRecordInfo | null) => void;
  onZoomSector: (selKey: string) => void;
  onOpenTarget: (t: ExploreTarget, viaNodeId: string) => void;
  onOpenRecord: (rec: NetRecordInfo) => void;
  onCenterZoom: () => void;
};

/** `ExploreNetwork`의 props — 고른 영역·기록 · 보기 · 넓게 보기 · 색상·이름 표시 · 전환 효과 생략은 부모 상태(계정 귀속 저장도 부모). */
export type ExploreNetworkProps = NetInput & {
  /** 고른 조각(선택 key: '조각 key' 또는 '조각 key#작은 조각 key'). */
  selected: string | null;
  /** 고른 기록 = 점 id(`onSelectRecord`가 준 `id` 그대로). */
  record: string | null;
  onSelectSector: (selKey: string | null) => void;
  onSelectRecord: (rec: NetRecordInfo | null) => void;
  onZoomSector: (selKey: string) => void;
  onOpenTarget: (t: ExploreTarget, viaNodeId: string) => void;
  onOpenRecord: (rec: NetRecordInfo) => void;
  onCenterZoom: () => void;
  onBack: () => void;
  view: "records" | "summary";
  onViewChange: (v: "records" | "summary") => void;
  wide: boolean;
  onWideChange: (w: boolean) => void;
  instant: boolean;
  colored: boolean;
  labels: boolean;
  onColoredChange: (b: boolean) => void;
  onLabelsChange: (b: boolean) => void;
};
