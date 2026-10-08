import { NextResponse } from "next/server";
import { authorizeInternalWorker } from "@/features/sync-agent/server/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { DRIVE_ID_RE } from "@/features/video-submit/server/drive-config";
import { lookupPinnedVideoDriveCredential } from "@/features/video-submit/server/drive-credentials";
import { VideoDriveReauthError } from "@/features/video-submit/server/drive-token";

/**
 * 발송 PC 워커 전용 — 지점이 연결한 Google 계정의 **접근 토큰만**(약 1시간) 내준다. 갱신 토큰·앱 비밀·계정 이메일은 PC로 가지 않는다.
 * ⚠️ 게이트: `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET`(보고서 첨부·스크린샷과 같은 시크릿).
 *
 * 요청 `{tenantId, rootId, connectionId, hostname}` — 그 지점의 그 PC가 **최근 180초 안에** 발송 모드로 살아 있고 계정별 저장을 아는
 * 버전이어야 하며, `(지점, 저장 폴더, 연결)`이 DB에서 정확히 맞아야 한다(Google을 부르기 **전에** 확인한다).
 * 지금 고른 계정이 아니어도 된다 — 계정을 바꾸거나 해제한 뒤에도 이미 시작한 옛 작업은 처음 계정으로 끝낸다.
 * 응답 `{accessToken, expiresIn, connectionId, tokenVersion}` — `expiresIn`은 그 토큰의 **실제 남은 초**(여유를 뺀 값, 최대 3300).
 * 오류: 401 시크릿 · 403 불일치(다른 자격으로 넘어가지 말 것) · 409 `{code:"reauth"}` 계정을 다시 연결해야 함 · 503 일시 장애.
 * 🔴 요청·토큰·사유 원문을 로그·응답에 싣지 않는다. 기존 env 연결(연결 없음)은 이 API를 쓰지 않는다(PC가 자기 값으로 한다).
 * ⚠️ 한계: 시크릿은 전 지점 PC가 같이 쓰고 PC는 DB에도 직접 붙는다 — 이 확인은 잘못 섞이는 것을 막는 장치이지, 탈취된 PC를 막는 벽이 아니다.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKER_ONLINE_MS = 180_000;
/** PC에 주는 토큰은 적어도 이만큼 남아 있어야 한다(받자마자 만료되지 않게). */
const MIN_REMAINING_MS = 10 * 60_000;
const MARGIN_SECONDS = 120;
const MAX_EXPIRES_IN = 3300;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const FORBIDDEN = () => reply({ error: "forbidden" }, 403);
const UNAVAILABLE = () => reply({ error: "unavailable" }, 503);

type WorkerRow = { last_seen: string | null; last_results: { postMode?: unknown; caps?: { homeworkVideoTenantAccounts?: unknown } } | null };

export async function POST(request: Request) {
  const authorization = await authorizeInternalWorker(request.headers.get("x-eywa-internal"));
  if (!authorization)
    return reply({ error: "unauthorized" }, 401);
  const body = (await request.json().catch(() => null)) as { tenantId?: unknown; rootId?: unknown; connectionId?: unknown; hostname?: unknown } | null;
  const { tenantId, rootId, connectionId, hostname } = body ?? {};
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId) || typeof connectionId !== "string" || !UUID_RE.test(connectionId) ||
    typeof rootId !== "string" || !DRIVE_ID_RE.test(rootId) || typeof hostname !== "string" || !hostname || hostname.length > 255)
    return FORBIDDEN();
  if (authorization.tenantId && tenantId !== authorization.tenantId) return FORBIDDEN();
  try {
    if (!classnoteModuleOn(await getTenantSettingsByTenantId(tenantId))) return FORBIDDEN();
    const db = createAdminClient();
    const workers = await db.from("classnote_workers").select("last_seen,last_results")
      .eq("tenant_id", tenantId).eq("hostname", hostname).order("last_seen", { ascending: false }).limit(1);
    if (workers.error) return UNAVAILABLE();
    const worker = (workers.data as WorkerRow[] | null)?.[0];
    const seen = worker?.last_seen ? Date.parse(worker.last_seen) : NaN;
    if (!worker || !Number.isFinite(seen) || Date.now() - seen > WORKER_ONLINE_MS ||
      worker.last_results?.postMode !== true || worker.last_results?.caps?.homeworkVideoTenantAccounts !== true)
      return FORBIDDEN();
    // 소유 확인이 먼저다 — 세 값이 맞지 않으면 Google을 부르지 않는다.
    const found = await lookupPinnedVideoDriveCredential(db, tenantId, rootId, connectionId);
    if (!found.ok) return found.reason === "client" ? UNAVAILABLE() : FORBIDDEN();
    const { credential } = found;
    if (credential.kind !== "tenant-oauth" || credential.connectionId !== connectionId || credential.tokenVersion === null) return FORBIDDEN();
    const minted = await credential.mint(MIN_REMAINING_MS);
    const expiresIn = Math.min(MAX_EXPIRES_IN, Math.floor((minted.expiresAt - Date.now()) / 1000) - MARGIN_SECONDS);
    if (expiresIn <= 0) return UNAVAILABLE();
    return reply({ accessToken: minted.accessToken, expiresIn, connectionId, tokenVersion: credential.tokenVersion }, 200);
  } catch (error) {
    if (error instanceof VideoDriveReauthError) return reply({ code: "reauth" }, 409);
    console.error(JSON.stringify({ level: "error", scope: "videoDrive.token", kind: "unavailable" }));
    return UNAVAILABLE();
  }
}
