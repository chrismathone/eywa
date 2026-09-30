export const DRIVE_API = "https://www.googleapis.com/drive/v3";

export function driveClient({ accessToken, fetchImpl = fetch }) {
  return async (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(120_000),
    headers: { ...options.headers, Authorization: `Bearer ${await accessToken()}` } });
}

export async function driveJson(response, stage) {
  if (!response.ok) throw new Error(`${stage} HTTP ${response.status}`);
  return response.json();
}
