/**
 * 저장 중인 칸 키 잠금 — **Set이 아니라 카운터**다.
 *
 * 🔴 왜 카운터인가: ECS의 출결 알약은 재진입을 막지 않아(1클릭 알약, 원장 2026-08-11) 같은 칸을
 *    연달아 고치면 저장이 겹친다. Set이면 **먼저 끝난 저장이 잠금을 풀어** 아직 날아가는 두 번째
 *    저장의 칸이 열린 채로 남고, 그 틈에 상단 출석 스트립 방송이 들어오면 화면만 '출석'으로 바뀐 채
 *    DB와 갈린다(성공 응답은 값을 다시 안 그린다 — 롤백 경로만 있다).
 * ⚠️ 순수 함수(applied-attendance.ts)에는 `snapshot()`으로 넘긴다 — 그쪽 계약은 `ReadonlySet`이고,
 *    방송은 사람이 버튼을 누를 때만 오므로 스냅샷 한 번 만드는 비용은 없는 것과 같다.
 */
export type InflightKeys = {
  /** 이 칸에 내 저장이 하나 더 날아간다. */
  acquire(key: string): void;
  /** 그 저장이 끝났다(성공·실패 무관). 0이 되면 잠금이 풀린다. */
  release(key: string): void;
  /** 지금 잠긴 키들. */
  snapshot(): ReadonlySet<string>;
};

export function createInflightKeys(): InflightKeys {
  const counts = new Map<string, number>();
  return {
    acquire(key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
    release(key) {
      const n = (counts.get(key) ?? 0) - 1;
      if (n > 0) counts.set(key, n);
      else counts.delete(key);
    },
    snapshot() {
      return new Set(counts.keys());
    },
  };
}
