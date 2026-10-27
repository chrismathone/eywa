/**
 * 정류장 앞 **"들어갔다 같은 길로 되나오기"(왕복 꼬리)** 잘라내기(순수 · Vitest) — 사용자 2026-10-21
 * *"도로 주변으로 마커를 찍었는데 지금 안쪽까지 들어가는데?"*.
 *
 * 카카오 다중 경유지 길찾기는 경유지 좌표에서 **가장 가까운 도로 위 한 점까지 반드시 갔다가** 다음으로 간다. 핀을 큰길가에
 * 찍어도 더 가까운 골목·단지 안 도로가 있으면 그 안까지 들어갔다 **같은 길로** 나온다(실측: 대구역센트럴자이 파리바게트 —
 * 이름 없는 길 142m 들어갔다 같은 142m로 나옴). 버스는 실제로 그러지 않는다.
 *
 * 🔑 구간 i의 꼬리와 구간 i+1의 머리가 **같은 길을 반대로** 지나는 만큼을 둘 다에서 잘라 큰길 갈림목에서 바로 잇는다.
 * 🔴 **같은 길을 되짚는 경우만** 자른다(TOL_M 안에서 겹치는 동안) — 다른 길로 빠져나가는 경로는 그대로다.
 * 🔴 겹침이 MAX_SPUR_M보다 길면 자르지 않는다 — 정말로 그 길을 왕복하는 노선일 수 있다.
 * 🔑 자른 만큼 구간 거리·예상 시간을 길이 비율로 줄인다(정차 시간 제외 추정치라 비율 근사로 충분).
 */
export type Leg = { path: [number, number][]; distanceM: number; durationS: number };

export const TOL_M = 12;
export const MAX_SPUR_M = 400;

const rad = (d: number) => (d * Math.PI) / 180;
function dist(a: [number, number], b: [number, number]): number {
  const x = rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2));
  const y = rad(b[0] - a[0]);
  return Math.hypot(x, y) * 6_371_000;
}

function lengthOf(path: readonly [number, number][]): number {
  let m = 0;
  for (let i = 0; i + 1 < path.length; i++) m += dist(path[i]!, path[i + 1]!);
  return m;
}

/** 선을 따라 앞에서 d미터 지점 + 그 지점이 놓인 선분 번호(점 i와 i+1 사이). */
function pointAt(path: readonly [number, number][], d: number): { p: [number, number]; seg: number } | null {
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const L = dist(path[i]!, path[i + 1]!);
    if (acc + L >= d) {
      const t = L === 0 ? 0 : (d - acc) / L;
      const a = path[i]!;
      const b = path[i + 1]!;
      return { p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], seg: i };
    }
    acc += L;
  }
  return null;
}

const STEP_M = 4;

export function trimSpurs<T extends Leg>(legs: readonly T[]): T[] {
  const out = legs.map((l) => ({ ...l, path: [...l.path] }));
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!.path;
    const b = out[i + 1]!.path;
    if (a.length < 2 || b.length < 2) continue;
    // 🔑 **같은 거리만큼** 되짚는 동안만 왕복이다 — a의 끝에서 거꾸로 d미터 지점과 b의 처음에서 d미터 지점이 TOL_M 안에 있는 동안.
    //    (들어간 길과 나온 길이 일부만 같으면 거기서 멈춘다 — 한쪽만 길게 자르면 두 끝이 떨어져 직선으로 이어진다.)
    const aRev = [...a].reverse();
    let spur = 0;
    for (let d = STEP_M; d <= MAX_SPUR_M + STEP_M; d += STEP_M) {
      const pa = pointAt(aRev, d);
      const pb = pointAt(b, d);
      if (!pa || !pb || dist(pa.p, pb.p) > TOL_M) break;
      spur = d;
    }
    if (spur < TOL_M || spur > MAX_SPUR_M) continue;
    const ca = pointAt(aRev, spur)!;
    const cb = pointAt(b, spur)!;
    const join = ca.p; // 큰길 갈림목 — 두 구간이 여기서 만난다
    // aRev의 seg번 선분 위 → 원래 a에서는 (a.length - 2 - seg)번 선분. 그 앞 점들까지 남기고 갈림목을 끝점으로.
    const aKeep: [number, number][] = [...a.slice(0, a.length - 1 - ca.seg), join];
    const bKeep: [number, number][] = [join, ...b.slice(cb.seg + 1)];
    const ratioA = lengthOf(a) > 0 ? lengthOf(aKeep) / lengthOf(a) : 1;
    const ratioB = lengthOf(b) > 0 ? lengthOf(bKeep) / lengthOf(b) : 1;
    out[i] = { ...out[i]!, path: aKeep, distanceM: Math.round(out[i]!.distanceM * ratioA), durationS: Math.round(out[i]!.durationS * ratioA) };
    out[i + 1] = { ...out[i + 1]!, path: bKeep, distanceM: Math.round(out[i + 1]!.distanceM * ratioB), durationS: Math.round(out[i + 1]!.durationS * ratioB) };
  }
  return out as T[];
}
