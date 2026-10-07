/**
 * **동학년 대비** — 같은 학년 응시자들의 종합 수준 분포와 내 위치(원장 2026-10-07 *"동학년 대비 나의 실력 비교"*).
 *
 * 🔑 비교 집단은 호출부가 정한다(우리 학원 같은 학년 응시자 · 나중에 외부 기준표). 여기는 숫자만 낸다.
 * 🔴 인원이 적으면 **석차를 내지 않는다**(`MIN_PEERS`) — 3명 중 1등을 "상위 33%"로 적으면 학부모에겐 거짓 정밀도다.
 *    분포 그래프도 같은 문턱을 쓴다(한 번에 같이 사라져야 화면이 스스로 모순되지 않는다).
 */
import { LEVELS, type Level } from "./levels";

export const MIN_PEERS = 10;

export type PeerGroup = {
  size: number;
  /** 수준별 비율(0~1), L1~L9 전부(0인 수준도 — 곡선이 끊기지 않게). */
  distribution: { level: Level; share: number }[];
  /** 평균 수준(소수, 그래프 표시용). */
  avgLevel: number;
};

export function buildPeerGroup(levels: readonly Level[]): PeerGroup | null {
  if (levels.length < MIN_PEERS) return null;
  const count = new Map<Level, number>();
  for (const l of levels) count.set(l, (count.get(l) ?? 0) + 1);
  return {
    size: levels.length,
    distribution: LEVELS.map(({ level }) => ({ level, share: (count.get(level) ?? 0) / levels.length })),
    avgLevel: levels.reduce((s, l) => s + l, 0) / levels.length,
  };
}

/**
 * 상위 몇 %인가 — 나보다 **높거나 같은** 수준의 비율(같은 수준끼리는 같은 석차). 1~100 정수로 올림.
 * 예: 내 수준 이상이 94%면 "상위 94%"(= 아래쪽). NELT 성적표 표기와 같은 방향.
 */
export function topPercent(group: PeerGroup, mine: Level): number {
  const share = group.distribution.filter((d) => d.level >= mine).reduce((s, d) => s + d.share, 0);
  return Math.min(100, Math.max(1, Math.ceil(share * 100)));
}
