import "server-only";

/**
 * 지점 계정 연결의 **접근 토큰 발급** — 갱신 토큰(DB 금고) + 클라이언트 비밀(서버 env) → 약 1시간짜리 접근 토큰.
 * 워커 `oauthRefreshAuth`와 같은 요청이지만, 발송 PC에 **실제 남은 수명**을 알려 줘야 해서 만료 시각을 함께 돌려준다.
 *
 * 캐시 열쇠 = `연결:토큰 번호` — 다시 연결하면 번호가 올라가 옛 토큰을 쓰지 않는다. 계정이 다르면 열쇠가 달라 섞이지 않는다.
 * 🔴 갱신 토큰·비밀·접근 토큰·응답 본문을 오류 문장·로그에 싣지 않는다.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_ENTRIES = 200;
/** 웹 요청은 몇 초면 끝난다 — 남은 수명이 2분 넘으면 캐시를 쓴다. 발송 PC에 줄 때는 호출부가 더 길게 요구한다. */
const DEFAULT_MIN_REMAINING_MS = 120_000;

/** Google이 그 허락을 더는 받지 않는다(취소·만료) — 계정을 다시 연결해야 한다. */
export class VideoDriveReauthError extends Error {
  constructor() { super("Drive 계정을 다시 연결해야 합니다."); }
}
/** 일시 장애(네트워크·Google 오류·앱 설정) — 다음에 다시 시도한다. */
export class VideoDriveTokenError extends Error {
  constructor() { super("Drive 인증 토큰을 받지 못했습니다."); }
}

export type MintedToken = { accessToken: string; expiresAt: number };
export type MintInput = {
  connectionId: string; tokenVersion: number; clientId: string; clientSecret: string; refreshToken: string;
  minRemainingMs?: number; fetchImpl?: typeof fetch; now?: () => number;
};

const cache = new Map<string, { minted?: MintedToken; pending?: Promise<MintedToken> }>();
const keyOf = (connectionId: string, tokenVersion: number): string => `${connectionId}:${tokenVersion}`;

async function refresh(input: MintInput, now: () => number): Promise<MintedToken> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(30_000),
      body: new URLSearchParams({
        client_id: input.clientId, client_secret: input.clientSecret, refresh_token: input.refreshToken, grant_type: "refresh_token",
      }).toString(),
    });
  } catch { throw new VideoDriveTokenError(); }
  const data = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown } | null;
  if (!response.ok) {
    if (data?.error === "invalid_grant") throw new VideoDriveReauthError();
    throw new VideoDriveTokenError();
  }
  if (typeof data?.access_token !== "string" || !data.access_token) throw new VideoDriveTokenError();
  const seconds = Number(data.expires_in);
  // 수명을 안 알려 주면 짧게 잡는다(오래 쓸 수 있다고 추정하지 않는다).
  return { accessToken: data.access_token, expiresAt: now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 300) * 1000 };
}

/** 이 연결·이 토큰 번호의 접근 토큰. 남은 수명이 `minRemainingMs`보다 길면 캐시, 아니면 새로 받는다(동시 요청은 한 번만 갱신). */
export async function mintConnectionAccessToken(input: MintInput): Promise<MintedToken> {
  const now = input.now ?? Date.now;
  const key = keyOf(input.connectionId, input.tokenVersion);
  // 같은 연결의 옛 번호는 버린다 — 다시 연결한 뒤 옛 토큰이 남지 않게.
  for (const other of cache.keys()) if (other !== key && other.startsWith(`${input.connectionId}:`)) cache.delete(other);
  const entry = cache.get(key) ?? {};
  const minRemaining = input.minRemainingMs ?? DEFAULT_MIN_REMAINING_MS;
  if (entry.minted && entry.minted.expiresAt - now() > minRemaining) return entry.minted;
  if (!entry.pending) {
    entry.pending = refresh(input, now)
      .then((minted) => { entry.minted = minted; return minted; })
      .finally(() => { entry.pending = undefined; });
    if (!cache.has(key) && cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, entry);
  }
  return entry.pending;
}

/** 그 연결의 캐시를 버린다 — Google이 토큰을 거절했을 때(다음 요청이 죽은 토큰을 다시 쓰지 않게). */
export function forgetConnectionToken(connectionId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${connectionId}:`)) cache.delete(key);
}

/** 테스트 전용 — 캐시 리셋. */
export function _resetVideoDriveTokensForTest(): void {
  cache.clear();
}
