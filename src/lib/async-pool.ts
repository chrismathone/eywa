/**
 * 독립 작업을 **동시에 최대 `limit`개**씩 돌리고 결과를 **입력 순서대로** 돌려준다(B4 — 직렬 워터폴 대신 · 한꺼번에 수십 개를
 * 쏘지도 않는다). 하나라도 던지면 그 실패를 그대로 던진다(이미 시작한 작업은 끝까지 간다 — 읽기 전용 조회에만 쓸 것).
 */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
