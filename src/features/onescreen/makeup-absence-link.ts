/**
 * 보강 ↔ 결석분 연결 메모 — 순수 함수(Vitest).
 *
 * 원장 2026-08-06 사양(현재 구글시트 출석부 운영과 동일):
 *   *"A반 수업을 7/16에 결석해서 7/31에 했을 경우 — 7/16에 결석이였으니 0 이였을테고, 거기에 메모로
 *   '7/31 보강 예정'. 그리고 7/31에 해당 A반 수업의 학생 출결에 1이 더 카운트 되고 메모로
 *   '7/16 결석분 보강'."*
 *
 * 🔴 **결석 칸은 건드리지 않는다**(상태 결석·시수 0 그대로) — 메모만 붙는다. 소급해서 0을 1로 바꾸면
 *    그 달 출석률·시수(=급여·청구 재료)가 뒤로 움직인다. 시수는 **보강을 실제로 한 날** 칸에 얹는다.
 * 🔴 메모는 **덮어쓰지 않고 이어붙인다** — 그 칸에 이미 다른 사유("병결" 등)가 적혀 있을 수 있고,
 *    그건 보강 연결보다 먼저 있던 사실이다. 같은 문장이 이미 있으면 다시 붙이지 않는다(멱등 =
 *    두 번 눌러도 메모가 두 줄로 늘지 않는다).
 */

/** 메모용 짧은 날짜 "7/16" — 연도는 생략(같은 학년도 안에서 오간다). 형식이 아니면 원문 그대로. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** 결석한 날 칸에 남길 메모 — "7/31 보강 예정". */
export function absenceMemo(makeupDate: string): string {
  return `${shortDate(makeupDate)} 보강 예정`;
}

/** 보강한 날 칸에 남길 메모 — "7/16 결석분 보강". */
export function makeupMemo(absentDate: string): string {
  return `${shortDate(absentDate)} 결석분 보강`;
}

/**
 * 기존 메모에 한 줄 덧붙인다 — 이미 있으면 그대로(멱등). 빈 메모면 덧붙일 문장만.
 * ⚠️ 부분 일치가 아니라 **줄 단위** 비교다 — "7/1 보강 예정"이 "7/16 보강 예정"에 걸리면 안 된다.
 */
export function appendMemo(existing: string | null | undefined, addition: string): string {
  const base = (existing ?? "").trim();
  if (!base) return addition;
  const lines = base.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(addition)) return base;
  return `${base}\n${addition}`;
}

/** 그 칸에 이 보강 연결이 이미 적혀 있는가 — 시수를 두 번 더하지 않기 위한 판정(줄 단위). */
export function hasMemoLine(existing: string | null | undefined, line: string): boolean {
  return (existing ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .includes(line);
}

/**
 * 보강 뒤 그 칸의 시수 = 현재 시수(미입력=1) + 이번 보강 시수.
 *
 * 🔴 **보강분을 1로 박지 말 것** (원장 2026-08-06: *"1.5는 3시간 수업건에 대해서 1.5로 입력되고 있음 —
 *    즉 0.5당 1시간이라 생각하면 됨. 수학은"*). 시수는 **수업 길이**다. 3시간짜리 수학 반의 보강을 1로
 *    적으면 그 반 급여가 매번 0.5씩 모자란다. 그래서 강사가 다이얼로그에서 값을 고르고(기본 = 그 반
 *    정규 1회와 같은 값) 그 값이 여기로 온다. 부동소수 오차(0.1+0.2)는 0.5 단위 입력이라 나지 않는다.
 */
export function unitsAfterMakeup(current: number | null | undefined, addUnits: number): number {
  return (current ?? 1) + addUnits;
}
