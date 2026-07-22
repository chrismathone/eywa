// 반 안에서 **요일별 안분** — "그 반의 주말 수업분만 비율제" 케이스. 순수 함수(Vitest).
//
// 원장 2026-07-21: 이성우 선생님은 주말만 비율제인데 담당 반 하나가 **토+수 복합**이라 반 단위로 안 갈린다.
// → 그 반의 지급 기준액 중 **적용 요일 시수 비중**만 비율제로 인정한다.

/** 세션 하나의 시수(그 반, 그 달). date는 "YYYY-MM-DD". */
export type SessionUnit = { date: string; units: number };

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** "YYYY-MM-DD" → 요일 키. 결정적 UTC 산술(날짜만 다루므로 타임존 무관). */
export function dowKeyOf(date: string): string | null {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return DOW_KEYS[new Date(t).getUTCDay()] ?? null;
}

/**
 * 적용 요일 시수 비중(0~1). `applies`가 비면 1(전 요일 = 안분 없음).
 *
 * ⚠️ 시수 기록이 아예 없으면 **null**을 돌려준다 — 비중을 0으로 지어내면 급여가 조용히 사라지고,
 *    1로 지어내면 평일분까지 비율제로 나간다. 어느 쪽도 거짓이라 호출부가 "산정 보류"로 처리해야 한다.
 *
 * ⚠️ `opts.scheduledDows`(그 반의 시간표 요일)를 주면 **"주말 반인데 주말 출석이 아직 안 들어온"** 경우도
 *    null(보류)로 승격한다 — 시간표상 적용 요일(예 토/일)에 수업이 잡혀 있는데 그 요일 시수가 0이면
 *    "비율제 몫 0"이 아니라 **출석 미입력**일 가능성이 크다. 반대로 시간표가 순수 평일이면 0이 정답
 *    (그 반은 애초에 비율제 대상이 아니다 = 원장 규칙: 비율제는 주말 수업분에만). 2026-07-22.
 */
export function dowApportionRatio(
  sessions: readonly SessionUnit[],
  applies: readonly string[] | null | undefined,
  opts?: { scheduledDows?: readonly string[] | null },
): number | null {
  if (!applies || applies.length === 0) return 1;
  let total = 0;
  let hit = 0;
  for (const s of sessions) {
    const u = Number.isFinite(s.units) && s.units > 0 ? s.units : 0;
    if (u === 0) continue;
    total += u;
    const k = dowKeyOf(s.date);
    if (k && applies.includes(k)) hit += u;
  }
  if (total <= 0) return null; // 시수 기록 없음 → 판정 불가
  if (hit === 0) {
    // 적용 요일 시수가 0. 시간표가 적용 요일(주말 등)에 잡혀 있으면 = 출석 미입력일 개연 → 보류(0 지어내기 금지).
    // 시간표가 순수 평일이면(또는 시간표 정보가 없으면) 종전대로 0(비율제 몫 없음).
    const scheduledOnApplies = (opts?.scheduledDows ?? []).some((d) => applies.includes(d));
    if (scheduledOnApplies) return null;
  }
  return hit / total;
}

/** 요일 키 → 한글 라벨(화면·툴팁 공용, raw 코드 노출 금지). */
const DOW_LABEL: Record<string, string> = {
  sun: "일",
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
};

export function formatDowKeys(keys: readonly string[] | null | undefined): string {
  if (!keys || keys.length === 0) return "전체";
  return DOW_KEYS.filter((k) => keys.includes(k))
    .map((k) => DOW_LABEL[k])
    .join("·");
}
