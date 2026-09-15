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
 *
 * 🔴 **가로 병합을 쪼개지 않는다**(원장 2026-09-15 *"이렇게 붙어있는 수업은 그냥 붙어있게 표시해줘 다른 퇴원이나
 *    대기처럼"*): 월+목 한 칸인 반에 목요일 예약이 걸리면 종전엔 그 반만 요일별 두 칸으로 갈랐는데(병합 표식),
 *    원장이 화면에서 보고 **붙여 두라**고 정했다. 어느 요일 보강인지는 줄 끝의 **요일 표식**이 말한다
 *    ([reserved-section.tsx](<../../../app/(shell)/timetable/_components/reserved-section.tsx>)) — 퇴원·대기 박스가
 *    반 칸 하나에 서는 것과 같은 모양이다. 🔴 `strayMarkKey`·`cellKeyWithStrayMark`·`strayOwnerClassKey`를
 *    되살리지 말 것(그 함수들이 병합을 쪼개던 자리다).
 */

/** 격자 교시 행에서 이 규칙이 읽는 것 전부 — `14:20~15:20`(표준) 또는 `14:20`(비표준 폴백 행). */
export type StrayRowLike = { time: string };

/** "HH:MM…" → 자정 기준 분. 형식이 아니면 NaN(비교가 전부 false라 그 행은 안 걸린다). */
function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return (h as number) * 60 + (m as number);
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
