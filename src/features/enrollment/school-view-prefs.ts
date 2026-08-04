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

/** 세는 대상. 퇴원생 기준으로 보면 "어느 학교에서 많이 나갔나"가 보인다(실측 퇴원 418 > 재원 375). */
export const BASES = ["enrolled", "withdrawn", "prospect", "all"] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABEL: Record<Basis, string> = {
  enrolled: "재원생",
  withdrawn: "퇴원생",
  prospect: "예비생",
  all: "전체",
};

export const SORT_KEYS = ["pct", "count"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const SORT_LABEL: Record<SortKey, string> = { pct: "점유율", count: "인원" };

export const SCHOOL_KINDS = ["초", "중", "고"] as const;
export type SchoolKind = (typeof SCHOOL_KINDS)[number];

export type SchoolStatsPrefs = {
  basis: Basis;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  /** 보이는 학교급. `null` = 전체. 빈 배열도 전체로 취급 — 전부 끄면 빈 화면이라 설정으로서 의미가 없다. */
  kinds: SchoolKind[] | null;
};

export const DEFAULT_SCHOOL_PREFS: SchoolStatsPrefs = {
  basis: "enrolled",
  sortBy: "count",
  sortDir: "desc",
  kinds: null,
};

/** 저장된 jsonb → 안전한 설정값. 모르는 값은 기본값으로 되돌린다(손장난으로 화면이 깨지지 않게). */
export function parseSchoolStatsPrefs(raw: unknown): SchoolStatsPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const basis = (BASES as readonly string[]).includes(String(o.basis))
    ? (o.basis as Basis)
    : DEFAULT_SCHOOL_PREFS.basis;
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
  return { basis, sortBy, sortDir, kinds };
}

export type SchoolCounts = { enrolled: number; withdrawn: number; prospect: number };

export type SchoolRow = {
  key: string;
  label: string;
  kind: SchoolKind | null;
  /** 전교생 수(학교알리미 공시). null = 공시에 없는 학교 — 점유율을 만들지 않는다. */
  total: number | null;
  counts: SchoolCounts;
};

export function countFor(c: SchoolCounts, basis: Basis): number {
  return basis === "all" ? c.enrolled + c.withdrawn + c.prospect : c[basis];
}

export type SchoolViewRow = SchoolRow & { n: number; pct: number | null };

/**
 * 필터 + 정렬을 한 곳에서. 서버가 아니라 여기서 도는 이유: 학교가 40여 개뿐이라 왕복 없이 즉시 바뀐다.
 *
 * ⚠️ 점유율 정렬에서 **전교생 미상(pct=null)은 항상 끝**에 둔다 — 모르는 값을 0으로 취급해 맨 아래
 * 또는 맨 위에 섞으면 "점유율 0%인 학교"처럼 읽힌다.
 */
export function applySchoolPrefs(rows: SchoolRow[], prefs: SchoolStatsPrefs): SchoolViewRow[] {
  const kinds = prefs.kinds;
  const out: SchoolViewRow[] = [];
  for (const r of rows) {
    if (kinds && (!r.kind || !kinds.includes(r.kind))) continue;
    const n = countFor(r.counts, prefs.basis);
    // 그 기준으로 0명인 학교는 목록에 넣지 않는다(퇴원생 기준인데 퇴원자 0인 학교가 줄줄이 뜨면 방해).
    if (n === 0) continue;
    out.push({ ...r, n, pct: r.total && r.total > 0 ? Math.round((n / r.total) * 1000) / 10 : null });
  }
  // asc면 작은 값이 앞(a-b), desc면 큰 값이 앞(b-a) — 부호 하나로 뒤집는다.
  const dir = prefs.sortDir === "asc" ? 1 : -1;
  return out.sort((a, b) => {
    if (prefs.sortBy === "pct") {
      // 전교생 미상은 **방향과 무관하게** 항상 끝. 0으로 취급하면 "점유율 0%"로 읽힌다.
      if (a.pct === null && b.pct === null) return (a.n - b.n) * dir;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      if (a.pct !== b.pct) return (a.pct - b.pct) * dir;
      return (a.n - b.n) * dir; // 동률이면 인원으로
    }
    if (a.n !== b.n) return (a.n - b.n) * dir;
    return a.label.localeCompare(b.label, "ko"); // 동률은 이름순(순서가 매 렌더 흔들리지 않게)
  });
}
