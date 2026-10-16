export const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** 요청마다 120초 상한. 부르는 쪽이 끊기 신호(`options.signal`)를 주면 둘 중 먼저 오는 쪽에서 멈춘다(연동 앱 종료·업데이트). */
export function driveClient({ accessToken, fetchImpl = fetch }) {
  return async (url, options = {}) => {
    const timeout = AbortSignal.timeout(120_000);
    return fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      headers: { ...options.headers, Authorization: `Bearer ${await accessToken()}` } });
  };
}

export async function driveJson(response, stage) {
  if (!response.ok) throw new Error(`${stage} HTTP ${response.status}`);
  return response.json();
}
