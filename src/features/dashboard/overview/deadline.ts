/**
 * 운영실 **렌더 마감** — 카드 하나가 늦는다고 페이지 전체가 죽지 않게.
 *
 * 운영실은 카드마다 조회를 하나씩 띄워 수십 개를 병렬로 돌린 뒤 **전부 끝나야** 화면을 냈다. 개별 예산이 없어서
 * 하나만 늘어져도 세그먼트 상한(`maxDuration = 60`)을 넘겨 **페이지 전체가 504**가 됐다(원장 콘솔 2026-09-16:
 * `dashboard:1 Failed to load resource: 504`). 카드 하나가 비는 것과 운영실이 안 열리는 것은 급이 다르다.
 *
 * 🔑 마감에 걸린 조회는 **취소하지 않는다**(HTTP 요청을 되돌릴 방법이 없다) — 기다리기를 그만두고 그 칸만
 *    '시간 초과'로 비운 뒤 화면을 낸다. 늦게 끝난 조회의 결과는 버린다(그래서 서버가 `sections`를 **복사해서**
 *    돌려준다 — 직렬화 도중에 값이 바뀌면 같은 렌더에서 카드가 실패 → 성공으로 뒤집힌다).
 * 🔴 마감을 늘려 문제를 덮지 말 것 — 20초는 "정상이면 한참 전에 끝난다"는 뜻이지 목표 시간이 아니다. 늘려야 할
 *    상황이면 **그 조회가 무거운 것**이고, 고칠 곳은 여기가 아니라 그 조회다.
 * ⚠️ 상한(60초)의 3분의 1이다 — 응답을 내보내고 나서도 여유가 있어야 게이트웨이가 함수를 죽이지 않는다.
 */

/** 전 카드가 끝나기를 기다리는 한도. 넘으면 못 끝낸 칸만 '시간 초과'로 비우고 화면을 낸다. */
export const OVERVIEW_BUDGET_MS = 20_000;

/** 시작 시각과 예산에서 남은 시간 — 음수가 되지 않는다(이미 지났으면 0 = 즉시 마감). */
export function remainingMs(startedAt: number, budgetMs: number, now: number): number {
  return Math.max(0, startedAt + budgetMs - now);
}

/**
 * 모든 작업이 끝나거나 `ms`가 지나면 돌아온다. **던지지 않는다** — 거절한 작업도 끝난 것으로 본다
 * (호출부가 각자 try/catch로 자기 칸을 채우므로, 여기서 한 건의 거절이 전체를 무너뜨리면 안 된다).
 */
export async function settleWithin(jobs: readonly Promise<unknown>[], ms: number): Promise<void> {
  if (jobs.length === 0) return;
  const settled = Promise.all(jobs.map((job) => job.then(() => undefined, () => undefined)));
  if (ms <= 0) return; // 예산이 이미 바닥 — 기다리지 않는다
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    // 남겨 두면 응답 뒤에도 이벤트 루프가 깨어 있다(서버리스에선 그대로 과금된다).
    if (timer) clearTimeout(timer);
  }
}
