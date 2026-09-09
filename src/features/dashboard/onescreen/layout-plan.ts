/**
 * 대시보드 **한 화면 격자** — "권한을 먼저 확정하고 그 다음에 격자를 만든다"의 단일 소스(순수·Vitest).
 *
 * 원장 2026-09-09: *"스크롤 없이 한 화면에"* + *"열린 창이 없을 때 바탕에 대시보드가 보이게"*.
 * 바탕화면이 되면 이 화면은 **접히지도 스크롤되지도 않는다** — 칸이 하나 더 켜질 때마다 남은 칸이
 * 좁아진다. 그래서 "무엇을 그릴지"를 화면 파일에서 조건부 렌더로 흩어 두면, 권한 조합마다 빈 칸이
 * 생기거나 12열이 안 맞는다. 여기서 **먼저 계획을 세우고** 화면은 그 계획을 그대로 그린다.
 *
 * 🔴 **꺼진 칸의 조회는 만들지 않는다** — "조회해 놓고 감추기"는 권한 누출 경로다([[#77]]).
 *    페이지는 `planIncludes(plan, …)`로 물어보고 필요한 것만 `Promise.all`에 넣는다.
 * 🔴 **빠진 칸의 자리를 남기지 않는다** — "권한 없음" 빈 상자를 세우면 못 보는 사람에게 있다는 사실만
 *    알려 주고 한 화면을 낭비한다. 남은 칸이 그 폭을 먹는다.
 * 🔴 **켜진 칸의 0건은 다르다** — 그 칸은 그대로 서고 '미기록 없음'처럼 사실을 적는다(0건·조회 실패·
 *    권한 없음 셋을 같은 초록으로 그리면 아무도 전화를 안 한다).
 * 🔴 **역할별 페이지를 만들지 않는다** — 권한이 여럿이면 **합집합 격자**다(분기 페이지는 한쪽만 고쳐진다).
 */

/**
 * 이 화면이 다루는 영역 플래그. `DashboardAccess`(메뉴 권한)에서 **한 번** 접어 만든다 —
 * 여기서 `canAccess`를 다시 부르지 않는다(같은 판정을 두 곳에서 하면 언젠가 갈린다).
 */
export type DashboardAreas = {
  /** 출결: 오늘 출결 타일 · 7일 출석률 선 · 살펴볼 학생의 결석 갈래. */
  attendance: boolean;
  /** 수납: 이번 달 수납 타일 · (좁은 권한일 때) 미납 상위 목록. */
  billing: boolean;
  /** 학생: 재원생 타일 · 4주 등록/퇴원 막대 · 살펴볼 학생. */
  students: boolean;
  /** 상담: 살펴볼 학생의 후속조치 갈래. */
  consultations: boolean;
  /** 직원: 휴가 승인 등 '오늘 할 일'에 실리는 직원 신호. */
  staff: boolean;
  /**
   * 일일 브리핑을 보여도 되는가. 🔴 브리핑은 **통짜 서술이라 권한 밖 정보가 샌다** —
   * payload가 master 관점 전신호(0114a)라, 그 권한 범위로 생성된 판이 있을 때만 켠다.
   */
  briefing: boolean;
};

export type KpiKey = "students" | "attendance" | "billing" | "todo";
export type BodyKey = "todo" | "watchlist" | "briefing" | "outstanding";
export type ChartKey = "attendance7d" | "enroll4w";

/** 12열 격자 위의 한 칸. `span`은 12분율이고 한 행의 합은 언제나 12다(가드가 잠근다). */
export type GridCell<K extends string> = { key: K; span: number };

export type DashboardPlan = {
  /** 행1(88px 고정) — 최대 4칸. */
  kpis: GridCell<KpiKey>[];
  /** 행2(1fr) — 목록. 이 화면의 본문이다. */
  body: GridCell<BodyKey>[];
  /** 행3(168px) — 차트 최대 2개. 비면 행 자체가 없어지고 행2가 그 높이를 먹는다. */
  charts: GridCell<ChartKey>[];
  /** 아무 칸도 못 세우는 권한 — 화면을 마운트하지 말 것(빈 격자를 그리지 않는다). */
  empty: boolean;
};

/**
 * 한 행의 폭 배분. 🔑 **칸 수로만 정한다** — 화면 폭이 아니라 칸 수가 정하므로 서버에서 계산할 수 있고
 * (첫 페인트에 이미 맞는 격자가 나온다) 창 크기를 바꿔도 칸이 재배치되지 않는다.
 *
 * 3칸이 `5/4/3`인 이유: 본문 첫 칸(오늘 할 일 목록)만 열 줄까지 서고 나머지는 이름 목록이라 4열이면
 * 한글 이름+학년이 들어간다. 넷이면 균등(3/3/3/3) — 1120폭에서 260px씩이라 KPI 숫자가 산다.
 */
function distribute(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [12];
  if (count === 2) return [6, 6];
  if (count === 3) return [5, 4, 3];
  if (count === 4) return [3, 3, 3, 3];
  // 🔴 다섯 칸부터는 **설계 밖**(1120폭에서 한 칸이 200px 아래로 떨어져 숫자가 죽는다)이지만, 그렇다고
  //    span을 비워 두면 그 칸이 폭 0으로 **조용히 사라진다**. 균등 배분 + 나머지를 앞쪽에 얹어 합 12를
  //    지킨다 — 좁아서 못 읽는 편이 없어진 것보다 낫고, 가드가 "한 행 4칸 이하"를 따로 잠근다.
  const base = Math.floor(12 / count);
  const rest = 12 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

function laneOf<K extends string>(keys: K[]): GridCell<K>[] {
  const spans = distribute(keys.length);
  return keys.map((key, i) => ({ key, span: spans[i] ?? 0 }));
}

/** '오늘 할 일'에 실릴 신호가 하나라도 있는 권한인가 — 없으면 그 타일도 목록도 세우지 않는다. */
function hasAnySignal(a: DashboardAreas): boolean {
  return a.attendance || a.billing || a.students || a.consultations || a.staff;
}

export function buildDashboardPlan(areas: DashboardAreas): DashboardPlan {
  // ── 행1 KPI ────────────────────────────────────────────────────────────────
  // 순서는 **바탕화면에서 눈이 지나가는 순서**: 규모 → 오늘 → 돈 → 할 일.
  const tiles: KpiKey[] = [];
  if (areas.students) tiles.push("students");
  if (areas.attendance) tiles.push("attendance");
  if (areas.billing) tiles.push("billing");
  // 🔴 '오늘 할 일' 타일은 **다른 타일이 2개 이상일 때만** 세운다 — 바로 아래가 같은 숫자를 푼
  //    목록이라, 타일이 그것뿐이면 한 화면에 같은 값이 두 번 적힌다(§2 "같은 값 두 번 금지").
  if (hasAnySignal(areas) && tiles.length >= 2) tiles.push("todo");

  // ── 행2 본문 ──────────────────────────────────────────────────────────────
  const body: BodyKey[] = [];
  if (hasAnySignal(areas)) body.push("todo");
  // 살펴볼 학생 = 결석 위험 ∪ 상담 후속. **이름을 알아도 되는 사람**(학생 열람)에게만, 그리고
  // 두 갈래 중 하나라도 볼 수 있을 때만 — 학생만 보이고 출결·상담이 다 막히면 담을 것이 없다.
  if (areas.students && (areas.attendance || areas.consultations)) body.push("watchlist");
  if (areas.briefing) body.push("briefing");
  // 🔑 미납 상위 목록은 **전권한 화면에선 버린 것**이다(수납 타일 하나로 충분하고 본문 세 칸이 꽉 찬다).
  //    수납만 보이는 역할(회계)에선 그 화면이 타일 하나로 끝나 버리므로 여기서 되살린다.
  if (areas.billing && body.length < 2) body.push("outstanding");

  // ── 행3 차트 ──────────────────────────────────────────────────────────────
  const charts: ChartKey[] = [];
  if (areas.attendance) charts.push("attendance7d");
  if (areas.students) charts.push("enroll4w");

  return {
    kpis: laneOf(tiles),
    body: laneOf(body),
    charts: laneOf(charts),
    empty: tiles.length === 0 && body.length === 0 && charts.length === 0,
  };
}

/** 그 칸이 계획에 있나 — 페이지가 **조회를 만들기 전에** 물어보는 자리다. */
export function planIncludes(
  plan: DashboardPlan,
  key: KpiKey | BodyKey | ChartKey,
): boolean {
  return (
    plan.kpis.some((c) => c.key === key) ||
    plan.body.some((c) => c.key === key) ||
    plan.charts.some((c) => c.key === key)
  );
}
