/**
 * 운영실 배치 편집(학원 설정 '대시보드 관리') — 공용 타입·상수. **순수 모듈**(서버·클라 공용, zod·server-only 없음 — #61).
 *
 * 🔑 배치 = **순서 + 크기**(iOS 위젯처럼 읽는 순서대로 흐른다). 좌표를 저장하지 않는다 — 그래서 "깨진 좌표"가 생길 수 없고,
 *    넓은 창·좁은 창·폰이 **같은 순서**를 열 수만 바꿔 다시 흘린다(`flow.ts`). 줄에 남는 칸은 그 줄 카드들이 나눠 채운다(빈 공간 금지).
 * 격자는 24열이다 — KPI 8칸(3열씩)과 카드 4장(6열씩)이 같은 줄 규칙으로 나눠지는 최소 공배수.
 */
export const GRID_COLS = 24;
/** 카드 높이(줄 수) 상한 — 프리셋이 2줄까지만 있다. */
export const MAX_ROW_SPAN = 2;
export const MAX_ITEMS = 80;

/** 역할 묶음 — 설계 메모(2026-10-01)의 판정 + 그 밖에 운영실을 여는 계정(상담·회계·열람). */
export const BUNDLES = ["super", "owner", "subject", "desk", "manager", "teacher", "counselor", "accountant", "viewer", "student"] as const;
export type Bundle = (typeof BUNDLES)[number];

export const BUNDLE_LABELS: Record<Bundle, string> = {
  super: "슈퍼관리자",
  owner: "원장",
  subject: "관리자 · 과목 운영형",
  manager: "실장",
  desk: "관리자 · 경영지원형",
  teacher: "강사", counselor: "상담", accountant: "회계", viewer: "열람", student: "학생",
};

/** 편집기에 적는 한 줄 — 어떤 사람들인가(판정 기준 = `bundle.ts`). */
export const BUNDLE_RULES: Record<Bundle, string> = {
  super: "총괄 자격을 가진 계정",
  owner: "원장 역할 계정",
  subject: "과목 운영 중심 · 집계 범위는 직원별 담당 범위를 따릅니다",
  manager: "학원 운영·출결·상담 중심",
  desk: "경영지원 중심 · 집계 범위는 직원별 담당 범위를 따릅니다",
  teacher: "강사 전용 화면을 사용합니다 · 현재 대시보드 접근은 잠겨 있습니다",
  counselor: "등록상담·신규생·상담 일정 중심",
  accountant: "수납·행정 중심 · 금액은 카드 설정과 메뉴 권한을 따릅니다",
  viewer: "재원·수업·공지 중심 · 읽기 권한을 따릅니다",
  student: "내 학습 화면을 사용합니다 · 현재 대시보드 접근은 잠겨 있습니다",
};

/**
 * 배치의 한 칸. id = `kpi:<칸>` · `panel:<카드>` · `heading:<이름>`(구역 머리줄 — 제목은 `title`).
 * `w`·`h` = 24열 격자에서의 크기(프리셋 중 하나 — `registry.ts`). `mode: "summary"` = 요약형(숫자 한 줄).
 * `amounts`·`phones` = 카드별 민감 옵션 — 없으면 역할 기본(`optionDefault`: 원장만 보임, 그 밖 가림).
 */
export type Item = {
  id: string;
  w: number;
  h: number;
  mode?: "summary";
  title?: string;
  note?: string;
  amounts?: boolean;
  phones?: boolean;
};

export type RoleLayout = { role: Bundle; items: Item[] };
export type DashboardAssignment = { userId: string; scope: "all" | "subjects" | "unassigned"; subjects: string[]; adminLayout: "subject" | "desk" };
export type DashboardSettings = { version: 1; layouts: RoleLayout[]; assignments?: DashboardAssignment[] };

export const DASHBOARD_VERSION = 1 as const;
export const EMPTY_DASHBOARD: DashboardSettings = { version: DASHBOARD_VERSION, layouts: [], assignments: [] };

export const isHeadingId = (id: string) => id.startsWith("heading:");
export const isKpiId = (id: string) => id.startsWith("kpi:");

/** 격자 위에 놓인 한 칸(흐름이 정한 자리) — x·y·w·h는 24열 격자 기준. */
export type Placed = { id: string; x: number; y: number; w: number; h: number };
