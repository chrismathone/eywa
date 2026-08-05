/**
 * 학교별 점유율 보기 설정 — 계정 귀속(`users.ui_prefs.enrollmentStats`).
 *
 * 원장 지시(2026-08-04, 상시): *"모든 뷰 세팅은 계정 귀속"* — 정렬·필터는 localStorage가 아니라 DB다.
 * localStorage는 **포트까지 포함한 origin 단위**라 dev/프로덕션·포트가 바뀌면 조용히 리셋되고,
 * 다른 PC에서 열면 남처럼 보인다(gotcha #90).
 *
 * ⚠️ 일반 모듈이어야 한다 — 서버(초기값 로드)와 클라(컨트롤)가 같이 쓴다. `import "server-only"`를
 * 붙이면 클라 번들에서 런타임 undefined가 되고 타입체크는 통과한다(#61·#81).
 */

// 🔴 '기준(재원생/퇴원생/예비생)' 축은 **제거했다**(원장 2026-08-05: "재원생 퇴원생 분석은 여기서
// 하는게 아니지. 지금 대분류가 등록상담인데"). 등록상담 화면은 상담을 센다 — 재원생·퇴원생 분포는
// 학생목록에서 다룰 것. 되살리지 말 것.

export const SORT_KEYS = ["pct", "count"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const SORT_LABEL: Record<SortKey, string> = { pct: "점유율", count: "인원" };

export const SCHOOL_KINDS = ["초", "중", "고"] as const;
export type SchoolKind = (typeof SCHOOL_KINDS)[number];

export type SchoolStatsPrefs = {
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  /** 보이는 학교급. `null` = 전체. 빈 배열도 전체로 취급 — 전부 끄면 빈 화면이라 설정으로서 의미가 없다. */
  kinds: SchoolKind[] | null;
  /** 월별 추이 차트에 막대를 그릴지. 기본 켜짐(원장 2026-08-05: *"기본적으로 막대그래프"*). */
  bars: boolean;
  /**
   * 월별 추이 차트에 **전환율 추세곡선**을 겹쳐 그릴지. 기본 꺼짐
   * (원장 2026-08-05: *"추세곡선을 on/off 토글하도록 · 기본적으로 막대그래프"*).
   */
  trendLine: boolean;
};

export const DEFAULT_SCHOOL_PREFS: SchoolStatsPrefs = {
  sortBy: "count",
  sortDir: "desc",
  kinds: null,
  bars: true,
  trendLine: false,
};

/** 저장된 jsonb → 안전한 설정값. 모르는 값은 기본값으로 되돌린다(손장난으로 화면이 깨지지 않게). */
export function parseSchoolStatsPrefs(raw: unknown): SchoolStatsPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const sortBy = (SORT_KEYS as readonly string[]).includes(String(o.sortBy))
    ? (o.sortBy as SortKey)
    : DEFAULT_SCHOOL_PREFS.sortBy;
  const sortDir = o.sortDir === "asc" ? "asc" : "desc";
  let kinds: SchoolKind[] | null = null;
  if (Array.isArray(o.kinds)) {
    const picked = o.kinds.filter((k): k is SchoolKind =>
      (SCHOOL_KINDS as readonly string[]).includes(String(k)),
    );
    // 빈 배열 = 전체(스스로를 빈 화면에 가두지 못하게).
    kinds = picked.length > 0 && picked.length < SCHOOL_KINDS.length ? picked : null;
  }
  // 막대는 기본 켜짐이라 `!== false`, 추세선은 기본 꺼짐이라 `=== true` — 저장 전 계정도 각자의 기본값으로.
  return { sortBy, sortDir, kinds, bars: o.bars !== false, trendLine: o.trendLine === true };
}

