import "server-only";
import { revalidatePath } from "next/cache";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import type { VideoOAuthConfig } from "./config";
import type { VideoOAuthDoneStatus } from "./done-page";
import { exchangeGoogleCode, fetchDrivePermissionId, fetchGoogleIdentity, VideoOAuthError, type VideoOAuthFailure } from "./google-flow";
import { ensureLegacyAccountClaim } from "./legacy-claim";

type Db = ReturnType<typeof createAdminClient>;

const FAILURE_STATUS: Record<VideoOAuthFailure, VideoOAuthDoneStatus> = {
  consent: "consent", scope: "scope", identity: "identity", drive: "failed", google: "failed",
};
const log = (stage: string, extra: Record<string, unknown> = {}) =>
  console.error(JSON.stringify({ scope: "videoDrive.oauth.connect", stage, ...extra }));

/** '다시 연결'은 지금 연결된 그 계정이어야 한다 — 다른 계정이면 아무것도 바꾸지 않는다(계정 전환은 따로 확인을 받고 시작한다). */
async function sameAccountAsCurrent(db: Db, tenantId: string, subject: string): Promise<boolean> {
  const setting = await db.from("homework_video_drive_settings").select("connection_id").eq("tenant_id", tenantId).maybeSingle();
  if (setting.error) throw new Error("setting");
  const connectionId = (setting.data?.connection_id as string | null | undefined) ?? null;
  if (!connectionId) return false;
  const connection = await db.from("homework_video_drive_connections").select("google_subject").eq("tenant_id", tenantId).eq("id", connectionId).maybeSingle();
  if (connection.error) throw new Error("connection");
  return connection.data?.google_subject === subject;
}

/**
 * 소비된 시도의 뒷부분 — 코드 교환 → 계정 확인(Google UserInfo) → Drive 확인 → 기존 연결 계정 등록 → 연결 저장(설정 버전 CAS).
 * 반환 = 결과 화면의 상태 이름. 🔴 실패는 지금 설정을 건드리지 않는다. 방금 받은 토큰은 저장에 성공했을 때만 금고로 간다.
 * 🔴 실패해도 Google 허락을 자동으로 취소하지 않는다 — 취소는 그 계정이 이 앱에 준 허락 전체를 없애 쓰고 있는 연결까지 끊는다.
 */
export async function completeVideoDriveConnection(input: {
  db: Db; config: VideoOAuthConfig; tenantId: string; code: string; verifier: string;
  intent: "reconnect" | "switch"; expectedVersion: string | null; fetchImpl?: typeof fetch;
}): Promise<VideoOAuthDoneStatus> {
  const { db, config, tenantId, intent } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  let tokens: { accessToken: string; refreshToken: string };
  let identity: { subject: string; email: string };
  let permissionId: string;
  try {
    tokens = await exchangeGoogleCode({ config, code: input.code, verifier: input.verifier, fetchImpl });
    identity = await fetchGoogleIdentity(tokens.accessToken, fetchImpl);
    permissionId = await fetchDrivePermissionId(tokens.accessToken, fetchImpl);
  } catch (error) {
    const kind = error instanceof VideoOAuthError ? error.kind : "google";
    log("google", { kind });
    return FAILURE_STATUS[kind];
  }
  try {
    if (intent === "reconnect" && !(await sameAccountAsCurrent(db, tenantId, identity.subject))) return "other_account";
  } catch {
    log("current-account");
    return "failed";
  }
  try {
    await ensureLegacyAccountClaim(db, fetchImpl);
  } catch {
    log("legacy-claim");
    return "legacy";
  }
  const saved = await Promise.resolve(db.rpc("connect_homework_video_drive_account", {
    p_tenant: tenantId, p_expected_version: input.expectedVersion, p_google_subject: identity.subject, p_permission_id: permissionId,
    p_email: identity.email, p_oauth_client_id: config.clientId, p_refresh_token: tokens.refreshToken, p_intent: intent,
  })).catch(() => ({ data: null, error: { code: "network" } }));
  if (saved.error) {
    log("save", { code: saved.error.code });
    // 다른 지점이 쓰는 계정·그사이 바뀐 설정·다른 계정으로 한 '다시 연결' — DB가 거절했다.
    return saved.error.code === "P0001" ? "rejected" : "failed";
  }
  await logAction({ action: "integration_video_drive_account", targetType: "integration", targetLabel: "숙제영상 드라이브", metadata: { intent, email: identity.email } });
  revalidatePath("/owner");
  revalidatePath("/v");
  return "connected";
}
