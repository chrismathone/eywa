/** 401은 처리 API의 쓰기 전 인증 문에서 반환된다. 이 경우에만 실제 로그인 세션을 갱신하고 같은 요청을 한 번 더 보낸다. */
export async function adviceRequest(url: string, init: RequestInit): Promise<Response> {
  const options = { ...init, credentials: "same-origin" as const };
  const response = await fetch(url, options);
  if (response.status !== 401 || init.signal?.aborted) return response;
  let onAbort: (() => void) | undefined;
  try {
    const { createClient } = await import("@/lib/supabase/client");
    if (init.signal?.aborted) return response;
    const refresh = createClient().auth.refreshSession();
    if (init.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const result = init.signal ? await Promise.race([refresh, new Promise<null>(resolve => {
      onAbort = () => resolve(null);
      init.signal!.addEventListener("abort", onAbort, { once: true });
    })]) : await refresh;
    if (!result) throw new DOMException("Request aborted", "AbortError");
    const { data, error } = result;
    if (error || !data.session || init.signal?.aborted) return response;
  } catch {
    if (init.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    return response;
  } finally {
    if (onAbort) init.signal?.removeEventListener("abort", onAbort);
  }
  // 403·409·500·통신 끊김은 재송신하지 않는다. 이미 저장됐는지 모르는 요청을 반복하지 않는다.
  return fetch(url, options);
}
