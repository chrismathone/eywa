// 발송 PC가 받는 것은 짧은 접근 토큰뿐이다. 갱신 토큰·메일·클라이언트 비밀은 내려오지 않는다.
// 하트비트의 호스트 이름 확인은 지점·폴더·연결이 우연히 섞이지 않게 하는 장치다.
// 요청 본문의 호스트 이름은 흉내 낼 수 있고, PC는 공유 비밀과 DB 접근을 가진다. 그 컴퓨터임을 증명하지 않으며 탈취된 PC를 막는 격리가 아니다.
import os from "node:os";
import { videoDriveAuth } from "./video-drive-auth.mjs";
import { workerVideoTargetMatches } from "./video-drive-settings.mjs";

const MAX_TTL_SEC = 3300;
const TOKEN_WAIT_MS = 30_000;
const TRANSIENT = "영상 저장 연결을 확인하지 못했습니다.";
const cache = new Map();
const inflight = new Map();

const coded = (code, message) => Object.assign(new Error(message), { code });

/** 소켓이 신호 취소를 무시해도 같은 한도로 끝낸다. 오류 문장에는 주소·시크릿·본문을 넣지 않는다. */
function waitBound(timeoutMs) {
  let timer;
  const signal = AbortSignal.timeout(timeoutMs);
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(coded("transient", TRANSIENT)), timeoutMs);
  });
  expired.catch(() => {});
  return { signal, limit: (work) => Promise.race([work, expired]), stop: () => clearTimeout(timer) };
}

export function resetTenantDriveTokenCache() { cache.clear(); inflight.clear(); }

export function rejectCachedTenantToken(connectionId, tokenVersion) {
  const prefix = connectionId ? `${connectionId}:` : "legacy";
  for (const key of cache.keys()) {
    if (key === "legacy" && !connectionId) cache.delete(key);
    else if (connectionId && key.startsWith(prefix) && (tokenVersion == null || key === `${connectionId}:${tokenVersion}`)) cache.delete(key);
  }
}

function endpoint(env) {
  const base = String(env.CLASSNOTE_SHARE_BASE || env.CLASSNOTE_SCREENSHOT_BASE || "").trim().replace(/\/$/, "");
  return base ? `${base}/api/internal/video-drive-token` : "";
}

function cacheKey(connectionId, tokenVersion) {
  return connectionId ? `${connectionId}:${tokenVersion ?? "pending"}` : "legacy";
}

function dropOtherVersions(connectionId, tokenVersion) {
  if (!connectionId || tokenVersion == null) return;
  const keep = cacheKey(connectionId, tokenVersion);
  for (const key of cache.keys()) if (key.startsWith(`${connectionId}:`) && key !== keep) cache.delete(key);
}

function peekFresh(identity, options) {
  const key = cacheKey(identity.connectionId ?? null, Number.isInteger(identity.tokenVersion) ? identity.tokenVersion : null);
  const hit = cache.get(key);
  return hit && hit.expiresAt > options.now() ? hit : null;
}

/** 만료되면 같은 지점·폴더·연결로만 다시 받는다. 번호가 바뀌면 옛 캐시를 버린다. 동시에 여러 번 불러도 요청은 하나다. */
function ensureFresh(identity, options) {
  if (!options.sql) {
    const hit = peekFresh(identity, options);
    if (hit) return Promise.resolve(hit);
  }
  const flightKey = identity.connectionId ?? "legacy";
  const current = inflight.get(flightKey);
  if (current) return current;
  const flight = loadFresh(identity, options).finally(() => {
    if (inflight.get(flightKey) === flight) inflight.delete(flightKey);
  });
  inflight.set(flightKey, flight);
  return flight;
}

async function loadFresh(identity, options) {
  const connectionId = identity.connectionId ?? null;
  let version = Number.isInteger(identity.tokenVersion) ? identity.tokenVersion : null;
  if (connectionId && options.sql) {
    const read = await readTokenVersion(options.sql, identity.tenantId, connectionId);
    if (read.schemaFallback) throw coded("transient", "영상 저장 계정 연결을 확인하지 못했습니다.");
    if (read.missing) throw coded("mismatch", "영상 저장 계정을 확인하지 못했습니다.");
    if (Number.isInteger(read.tokenVersion)) version = read.tokenVersion;
  }
  dropOtherVersions(connectionId, version);
  const hit = cache.get(cacheKey(connectionId, version));
  if (hit && hit.expiresAt > options.now()) return hit;
  return storeFromNetwork(identity, options);
}

function seal(identity, options, tokenVersion) {
  const state = { tokenVersion };
  return {
    kind: "tenant-oauth",
    connectionId: identity.connectionId ?? null,
    get tokenVersion() { return state.tokenVersion; },
    async accessToken() {
      const stored = await ensureFresh({ ...identity, tokenVersion: state.tokenVersion }, options);
      state.tokenVersion = stored.tokenVersion;
      return stored.accessToken;
    },
  };
}

async function readTokenVersion(sql, tenantId, connectionId) {
  if (!sql || !connectionId) return {};
  try {
    const [row] = await sql`select token_version from homework_video_drive_connections where tenant_id = ${tenantId} and id = ${connectionId} limit 1`;
    if (!row) return { missing: true };
    const tokenVersion = Number(row.token_version);
    return Number.isInteger(tokenVersion) ? { tokenVersion } : { missing: true };
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703" || /relation "[^"]+" does not exist/i.test(String(error?.message ?? "")))
      return { schemaFallback: true };
    throw coded("transient", "영상 저장 계정 연결을 확인하지 못했습니다.");
  }
}

async function storeFromNetwork(identity, options) {
  const connectionId = identity.connectionId ?? null;
  const secret = String(options.env.CLASSNOTE_INTERNAL_SECRET ?? "").trim();
  const url = endpoint(options.env);
  if (!secret || !url) throw coded("transient", "영상 저장 연결 설정을 확인하지 못했습니다.");
  const bound = waitBound(options.timeoutMs);
  try {
    const posted = await bound.limit(Promise.resolve().then(() => options.fetchImpl(url, {
      method: "POST", cache: "no-store",
      redirect: "error", headers: { "content-type": "application/json", "x-eywa-internal": secret },
      body: JSON.stringify({ tenantId: identity.tenantId, rootId: identity.rootId, connectionId, hostname: options.hostname }),
      signal: bound.signal,
    })).then((value) => ({ value })).catch(() => ({ failed: true })));
    if (!posted?.value) throw coded("transient", TRANSIENT);
    const response = posted.value;
    if (response.status === 401) throw coded("unauthorized", "영상 저장 연결 인증에 실패했습니다.");
    if (response.status === 403) throw coded("mismatch", "영상 저장 폴더와 계정이 맞지 않습니다.");
    if (response.status === 409) throw coded("reauth", "영상 저장 계정을 다시 연결해야 합니다.");
    if (response.status === 503 || response.status >= 500) throw coded("transient", TRANSIENT);
    if (!response.ok) throw coded("transient", TRANSIENT);
    const parsed = await bound.limit(Promise.resolve().then(() => response.json()).then((value) => ({ value })).catch(() => ({ value: null })));
    const payload = parsed?.value ?? null;
    const ttl = Number(payload?.expiresIn);
    const tokenVersion = Number(payload?.tokenVersion);
    const sameConnection = connectionId == null ? payload?.connectionId == null : payload?.connectionId === connectionId;
    if (!payload?.accessToken || !sameConnection || !Number.isInteger(tokenVersion) || !Number.isFinite(ttl) || ttl <= 0)
      throw coded("transient", "영상 저장 접근 토큰 응답이 올바르지 않습니다.");
    dropOtherVersions(connectionId, tokenVersion);
    const stored = {
      accessToken: payload.accessToken, connectionId: payload.connectionId ?? null, tokenVersion,
      expiresAt: options.now() + Math.min(MAX_TTL_SEC, ttl) * 1000,
    };
    cache.set(cacheKey(connectionId, tokenVersion), stored);
    return stored;
  } finally {
    bound.stop();
  }
}

/** 서버가 준 expiresIn(실제 남은 초, 상한 3300) 동안만 캐시한다. 만료되거나 tokenVersion 이 바뀌면 같은 연결로 다시 받는다. */
export async function fetchTenantCredential(input, options = {}) {
  const resolved = {
    env: process.env, fetchImpl: fetch, now: Date.now, hostname: os.hostname(), timeoutMs: TOKEN_WAIT_MS, ...options,
  };
  const stored = await ensureFresh(input, resolved);
  return seal(input, resolved, stored.tokenVersion);
}

/**
 * 연결이 있으면 토큰 API만 쓴다. 실패해도 이 PC의 기존 인증으로 돌아가지 않는다.
 * 연결이 없는 루트는 기존 PC 인증이다. 스키마가 완성됐으면 이 지점의 연결 없는 루트인지 확인한 뒤에만 쓴다.
 */
export async function credentialForVideoTarget(target, options = {}) {
  const connectionId = target.connectionId ?? null;
  if (!connectionId) {
    if (target.schema === "complete") {
      const owned = await workerVideoTargetMatches(options.sql, target.tenantId, {
        rootId: target.rootId, connectionId: null,
      }, { schema: "complete" }, options);
      if (!owned) throw coded("mismatch", "영상 저장 폴더와 계정이 맞지 않습니다.");
    }
    return videoDriveAuth(options.env ?? process.env);
  }
  const version = await readTokenVersion(options.sql, target.tenantId, connectionId);
  if (version.schemaFallback && connectionId) throw coded("transient", "영상 저장 계정 연결을 확인하지 못했습니다.");
  if (version.missing) throw coded("mismatch", "영상 저장 계정을 확인하지 못했습니다.");
  return fetchTenantCredential({ ...target, connectionId, tokenVersion: version.tokenVersion ?? null }, options);
}
