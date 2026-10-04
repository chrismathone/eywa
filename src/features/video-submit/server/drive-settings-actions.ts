"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { logAction } from "@/features/audit/server/log";
import { driveRequest } from "./drive-api";
import { readSelectedVideoDriveCredential } from "./drive-credentials";
import { getVideoDriveSetting, type VideoDriveSetting } from "./drive-settings";
import { parseVideoFolder, VideoFolderValidationError } from "./drive-folder-validation";
import { verifyCandidateRoot, verifyPendingLegacyRoots, type VerifiedRootClaim } from "./drive-root-claims";
import { readVideoOAuthConfig } from "./oauth/config";

type State = { ok?: boolean; error?: string; nonce?: number };
type Db = ReturnType<typeof createAdminClient>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 발송 PC가 살아 있다고 보는 창 — 발송 PC용 토큰 API와 같은 값. */
const WORKER_ONLINE_MS = 180_000;

/** 화면용 조회 — `oauthReady` = Google 계정 연결에 필요한 앱 설정이 서버에 있나(없으면 연결 버튼 대신 '준비 중'). */
export async function getVideoDriveSettingsView(): Promise<{ setting: VideoDriveSetting; readOnly: boolean; oauthReady: boolean }> {
  const user = await getCurrentUser();
  if (!user || !(await canAccessTenant(user.systemRole, "integration_settings")) || !classnoteModuleOn(await getTenantSettings()))
    throw new Error("사용할 수 없는 기능입니다.");
  return {
    setting: await getVideoDriveSetting(user.tenantId),
    readOnly: !(await canWriteTenant(user.systemRole, "integration_settings")),
    oauthReady: !!readVideoOAuthConfig(),
  };
}

/** 계정별 저장 폴더를 모르는 옛 발송 PC가 켜져 있으면 저장을 막는다(그 PC는 새 폴더·새 계정을 무시한다). 꺼져 있던 PC는 DB가 막는다. */
async function oldWorkerOnline(db: Db, tenantId: string): Promise<boolean> {
  const workers = await db.from("classnote_workers").select("last_results")
    .eq("tenant_id", tenantId).gte("last_seen", new Date(Date.now() - WORKER_ONLINE_MS).toISOString());
  if (workers.error) throw new Error("발송 PC 연결을 확인하지 못했습니다.");
  return !!workers.data?.some((worker) => worker.last_results?.postMode === true && worker.last_results?.caps?.homeworkVideoTenantAccounts !== true);
}

/**
 * 저장 폴더 저장·해제. 폴더는 **이 지점이 연결한 Google 계정의 자격으로** 확인한다(다른 계정·기존 env 연결로 확인하지 않는다).
 * 지점은 로그인한 계정에서만 정한다 — 화면이 보낸 지점 값은 읽지 않는다.
 */
export async function saveVideoDriveSetting(_previous: State | undefined, form: FormData): Promise<State> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다." };
  if (!(await canWriteTenant(user.systemRole, "integration_settings"))) return { error: "연동 설정을 변경할 권한이 없습니다." };
  if (!classnoteModuleOn(await getTenantSettings())) return { error: "사용할 수 없는 기능입니다." };
  const version = String(form.get("version") ?? "").trim();
  const intent = form.get("intent");
  if ((version && !UUID_RE.test(version)) || (intent !== "save" && intent !== "disconnect")) return { error: "설정 값을 다시 확인해 주세요." };
  const db = createAdminClient();
  let stage = "read-setting";
  try {
    const before = await getVideoDriveSetting(user.tenantId, db);
    if (!before.accountReady) return { error: "영상 폴더 설정을 아직 준비 중입니다. 잠시 후 다시 시도해 주세요." };
    if (before.version !== (version || null)) return { error: "다른 화면에서 설정이 변경되었습니다. 새로고침해 주세요." };
    const enabled = intent === "save";
    const rootId = enabled ? parseVideoFolder(String(form.get("folder") ?? "")) : null;
    if (enabled && !rootId) return { error: "Drive 폴더 주소 또는 폴더 번호를 입력해 주세요." };
    const verified: VerifiedRootClaim[] = [];
    if (enabled && rootId) {
      const connectionId = before.connectionId;
      if (!connectionId) return { error: "Google 계정을 먼저 연결해 주세요." };
      if (before.accountStatus !== "ready") return { error: "Google 계정을 다시 연결한 뒤 저장 폴더를 정해 주세요." };
      stage = "read-workers";
      if (await oldWorkerOnline(db, user.tenantId)) return { error: "발송 PC 프로그램을 업데이트한 뒤 저장 폴더를 정해 주세요." };
      stage = "read-credential";
      const credential = await readSelectedVideoDriveCredential(db, user.tenantId, connectionId);
      if (!credential) return { error: "영상 저장 연결이 준비되지 않았습니다. Google 계정 연결 상태를 확인해 주세요." };
      stage = "verify-drive";
      verified.push(await verifyCandidateRoot({ db, request: driveRequest(credential.accessToken), tenantId: user.tenantId, connectionId, rootId }));
      stage = "verify-existing-root";
      verified.push(...(await verifyPendingLegacyRoots(db, rootId)));
    }
    stage = "save-setting";
    const result = await db.rpc("save_homework_video_drive_account_setting", {
      p_tenant: user.tenantId, p_expected_version: version || null, p_connection: enabled ? before.connectionId : null,
      p_root: rootId, p_enabled: enabled, p_verified_roots: verified,
    });
    if (result.error) {
      console.error(JSON.stringify({ scope: "videoDrive.setting", stage, code: result.error.code }));
      const message = result.error.code === "P0001" ? result.error.message : "영상 폴더 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return { error: message };
    }
    await logAction({ action: "integration_video_drive_setting", targetType: "integration", targetLabel: "숙제영상 드라이브", metadata: { enabled, folderName: verified.find((root) => root.rootId === rootId)?.folderName ?? null } });
    revalidatePath("/owner");
    revalidatePath("/v");
    return { ok: true, nonce: Date.now() };
  } catch (error) {
    console.error(JSON.stringify({ scope: "videoDrive.setting", stage, kind: error instanceof VideoFolderValidationError ? "validation" : "lookup" }));
    if (error instanceof VideoFolderValidationError) return { error: error.message };
    // Google 응답·주소·인증 정보는 오류 화면과 로그로 전달하지 않는다.
    return { error: "영상 폴더를 확인하지 못했습니다. 폴더 주소와 연결한 Google 계정의 접근 권한을 확인해 주세요." };
  }
}
