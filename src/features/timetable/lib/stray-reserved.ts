/**
 * 원반 칸이 없는 **보강 예약**(0264a)이 기본뷰 격자에서 앉을 **교시 행** — 순수 규칙(IO 없음, Vitest).
 *
 * 원장 2026-09-14 *"9/17 이수진 선생님 1420-1620 수업에 안엄지가 없음"* → 원반(고등M 개별 TP4E)이 목요일에
 * 안 도는 예약이라, 원반 담임 열의 **그 시각 칸**에 '보강' 박스로 선다([reserved-lines.ts](../server/reserved-lines.ts)).
 *
 * 규칙 = 예약 구간 `[시작, 끝)`과 **겹치는 첫 행**.
 * 🔴 겹침은 **반열림**이다 — `15:20~16:20` 예약은 `14:20~15:20` 교시에 걸리지 않는다(경계가 맞닿는 것은 겹침이
 *    아니다). 안 그러면 앞 교시 칸에 박스가 서서 한 칸 위로 올라간다.
 * 🔴 한 예약이 두 교시에 걸쳐도 **첫 행 하나**만 고른다 — 박스가 두 칸에 서면 같은 학생이 두 번 온 것처럼 읽힌다.
 * 🔴 교시표 밖 시각이면 `-1`(세우지 않는다) — 비표준(`x-`) 행은 **그 시각에 수업이 있어야** 생기므로 앉을 자리가
 *    없다. 그 건은 시간표 '보강' 탭이 요일 × 교시로 세운다(알려진 한계).
 */

/** 격자 교시 행에서 이 규칙이 읽는 것 전부 — `14:20~15:20`(표준) 또는 `14:20`(비표준 폴백 행). */
export type StrayRowLike = { time: string };

/** "HH:MM…" → 자정 기준 분. 형식이 아니면 NaN(비교가 전부 false라 그 행은 안 걸린다). */
function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return (h as number) * 60 + (m as number);
}

/**
 * 병합 표식의 축 — `강사 열::요일::**그 칸의 반 키**`.
 *
 * 🔴 **반이 빠지면 안 된다**(적대 리뷰 2026-09-14 [중]): 축을 (강사, 요일)로만 잡으면 그 열의 **모든 반**에
 *    표식이 붙어, 예약과 아무 상관 없는 반까지 월+목 가로 병합을 잃는다(이름·명단이 두 번 그려지고 칸이 반으로
 *    갈린다). 반 키까지 넣으면 **박스를 실제로 다는 반만** 쪼개진다.
 * 🔴 세로(교시) 축은 넣지 않는다 — 같은 반의 위아래 교시가 갈리면 세로 병합이 깨진다.
 */
export function strayMarkKey(teacherName: string, dayOfWeek: string, classKey: string): string {
  return `${teacherName}::${dayOfWeek}::${classKey}`;
}

/**
 * 이 칸에 '보강' 박스를 **그릴 수 있나** = 표식을 붙일 반이 정확히 하나인가.
 *
 * 🔴 **합반 칸(2반 이상)은 주인이 없다** — 합반 칸은 `HapbanCell`이 그리는데 그쪽은 예약 줄을 받지 않아
 *    박스가 사라진다(칸 주인이 모호해 일부러 그렇게 뒀다 · 폴백은 '보강' 탭). 그런데 표식만 붙이면
 *    **쪼개지기는 하는데 박스는 없는 칸**이 되어, 쪼갬이 막으려던 증상(반 이름·명단 두 번, 칸 폭 반토막)만
 *    이익 없이 남는다(적대 재리뷰 2026-09-14). 그래서 **박스를 못 그릴 칸이면 표식도 붙이지 않는다.**
 * 🔴 빈 칸도 주인이 없다 — 빈 칸은 1×1이라 병합이 없어 표식이 필요 없다.
 */
export function strayOwnerClassKey(classIds: readonly string[]): string | null {
  const uniq = [...new Set(classIds.filter(Boolean))];
  return uniq.length === 1 ? uniq[0]! : null;
}

/**
 * 격자 병합 키 — 박스를 다는 (강사, 요일, 반)에만 표식을 붙인다.
 * 🔴 빈 칸("")은 그대로 — 빈 칸끼리 같은 키가 되면 **없던 병합**이 생겨 격자가 달라진다.
 * 🔴 표식에 **요일을 담는다** — 월·목 양쪽에 예약이 있어도 서로 다른 키라 도로 붙지 않는다(붙으면 월요일 칸에
 *    목요일 예약이 보인다).
 */
export function cellKeyWithStrayMark(
  base: string,
  teacherName: string,
  dayOfWeek: string,
  marks: ReadonlySet<string>,
): string {
  if (base === "") return base;
  return marks.has(strayMarkKey(teacherName, dayOfWeek, base)) ? `${base}#보강${dayOfWeek}` : base;
}

export function strayAnchorRowIndex(
  rows: readonly StrayRowLike[],
  startTime: string,
  endTime: string,
): number {
  const from = toMin(startTime);
  const to = toMin(endTime);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return -1;
  return rows.findIndex((r) => {
    const [rs, re] = r.time.split("~");
    const a = toMin(rs ?? "");
    if (!Number.isFinite(a)) return false;
    // 끝이 없는 폴백 행은 **그 시각 한 점**으로 본다(1분 폭) — 그 시각에 시작하는 예약만 걸린다.
    const z = re ? toMin(re) : a + 1;
    return a < to && z > from;
  });
}
