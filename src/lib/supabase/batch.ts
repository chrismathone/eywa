import "server-only";

/**
 * Supabase(PostgREST) 대량 조회 안전 헬퍼.
 *
 * 두 가지 함정을 막는다:
 *  1) 수백~수천 개 id를 단일 `.in(col, ids)`에 넣으면 GET 쿼리스트링이 HTTP 414(URI Too Long)로
 *     실패하고, 그 error를 `data ?? []`로 삼키면 데이터가 통째로 비어 조용히 오작동한다.
 *  2) `.in()`/필터 없이 전건을 가져오면 PostgREST 기본 max-rows(≈1000)에 silent 절단된다.
 *
 * 어느 헬퍼든 error를 절대 삼키지 않고 throw 한다.
 */

const DEFAULT_CHUNK = 100; // 100 UUID ≈ 4KB URL(414 안전), 청크당 행 수도 보통 1000 미만
const PAGE_SIZE = 1000;

type Res<T> = { data: T[] | null; error: { message: string } | null };

/** id 배열을 청크로 나눠 `.in()` 쿼리를 병렬 실행 후 합친다(414 + 1000행 한도 회피). */
export async function fetchInChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<Res<T>>,
  chunkSize: number = DEFAULT_CHUNK,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map((c) => run(c)));
  const out: T[] = [];
  for (const r of results) {
    if (r.error) throw new Error(`fetchInChunks: ${r.error.message}`);
    if (r.data) out.push(...r.data);
  }
  return out;
}

/**
 * `.range(from, to)`로 페이지네이션해 1000행 한도를 넘어 전건을 가져온다.
 * `run(from, to)`는 .range(from, to)를 적용한 쿼리(빌더)를 반환해야 한다.
 */
export async function fetchAllPaged<T>(
  run: (from: number, to: number) => PromiseLike<Res<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) throw new Error(`fetchAllPaged: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
