"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { logAction } from "@/features/audit/server/log";
import { readVideoDriveAuth } from "./drive-config";
import { driveRequest } from "./drive-api";
import { getVideoDriveSetting, type VideoDriveSetting } from "./drive-settings";
import { parseVideoFolder, requireEmptyVideoFolder, verifyVideoFolder, VideoFolderValidationError } from "./drive-folder-validation";

type State = { ok?: boolean; error?: string; nonce?: number };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getVideoDriveSettingsView(): Promise<{ setting: VideoDriveSetting; readOnly: boolean }> {
  const user = await getCurrentUser();
  if (!user || !(await canAccessTenant(user.systemRole, "integration_settings")) || !classnoteModuleOn(await getTenantSettings()))
    throw new Error("사용할 수 없는 기능입니다.");
  return { setting: await getVideoDriveSetting(user.tenantId), readOnly: !(await canWriteTenant(user.systemRole, "integration_settings")) };
}

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
    if (!before.ready) return { error: "영상 폴더 설정을 아직 준비 중입니다. 잠시 후 다시 시도해 주세요." };
    if (before.version !== (version || null)) return { error: "다른 화면에서 설정이 변경되었습니다. 새로고침해 주세요." };
    const enabled = intent === "save";
    const rootId = enabled ? parseVideoFolder(String(form.get("folder") ?? "")) : null;
    if (enabled && !rootId) return { error: "Drive 폴더 주소 또는 폴더 번호를 입력해 주세요." };
    const verified: { rootId: string; tenantId: string; folderName: string; ancestorIds: string[] }[] = [];
    if (enabled && rootId) {
      stage = "read-auth";
      const auth = readVideoDriveAuth();
      if (!auth) return { error: "영상 저장 연결이 준비되지 않았습니다. 연결 상태를 확인해 주세요." };
      if (before.rootId !== rootId) {
        stage = "read-workers";
        const workers = await db.from("classnote_workers").select("last_results")
          .eq("tenant_id", user.tenantId).gte("last_seen", new Date(Date.now() - 180_000).toISOString());
        if (workers.error) throw new Error("발송 PC 연결을 확인하지 못했습니다.");
        if (workers.data?.some((worker) => worker.last_results?.postMode === true && worker.last_results?.caps?.homeworkVideoTenantFolders !== true))
          return { error: "발송 PC 프로그램을 업데이트한 뒤 저장 폴더를 변경해 주세요." };
      }
      stage = "read-roots";
      const roots = await db.from("homework_video_drive_roots").select("tenant_id,root_folder_id,ancestry_verified").limit(1000);
      if (roots.error || !roots.data || roots.data.length >= 1000) throw new Error("영상 폴더 소유 정보를 확인하지 못했습니다.");
      const claims = new Map(roots.data.map((row) => [row.root_folder_id as string,
        { tenantId: row.tenant_id as string, ancestryVerified: row.ancestry_verified === true }]));
      if (claims.has(rootId) && claims.get(rootId)?.tenantId !== user.tenantId) return { error: "이 폴더는 지정할 수 없습니다. 비어 있는 새 폴더를 지정해 주세요." };
      const request = driveRequest(auth.accessToken);
      stage = "verify-drive";
      // 새 폴더만 빈 상태를 요구한다. 이미 소유한 폴더의 기존 영상은 그대로 둔다.
      if (!claims.has(rootId)) await requireEmptyVideoFolder(request, rootId);
      claims.set(rootId, { tenantId: user.tenantId, ancestryVerified: false });
      const claimList = [...claims];
      for (let offset = 0; offset < claimList.length; offset += 8) {
        await Promise.all(claimList.slice(offset, offset + 8).map(async ([id, claim]) => {
          try {
            const path = await verifyVideoFolder(request, id, id === rootId);
            verified.push({ rootId: id, tenantId: claim.tenantId, ...path });
          } catch (error) {
            // 저장 대상은 항상 검증한다. 과거 폴더가 사라져도 이미 검증한 경로와 소유권은 DB에 남긴다.
            // 마이그레이션에서 루트 번호만 가져온 미검증 경로는 안전하다고 추정하지 않는다.
            if (id === rootId) throw error;
            if (!claim.ancestryVerified) {
              stage = "verify-existing-root";
              throw new VideoFolderValidationError("기존 저장 폴더 정보를 확인하지 못했습니다. 연결 상태를 확인해 주세요.");
            }
          }
        }));
      }
    }
    stage = "save-setting";
    const result = await db.rpc("save_homework_video_drive_setting", {
      p_tenant: user.tenantId, p_expected_version: version || null, p_root: rootId,
      p_enabled: enabled, p_verified_roots: verified,
    });
    if (result.error) {
      console.error(JSON.stringify({ scope:"videoDrive.setting", stage, code:result.error.code }));
      const message = result.error.code === "P0001" ? result.error.message : "영상 폴더 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return { error: message };
    }
    await logAction({ action: "integration_video_drive_setting", targetType: "integration", targetLabel: "숙제영상 드라이브", metadata: { enabled, folderName: verified.find((root) => root.rootId === rootId)?.folderName ?? null } });
    revalidatePath("/owner");
    revalidatePath("/v");
    return { ok: true, nonce: Date.now() };
  } catch (error) {
    console.error(JSON.stringify({ scope:"videoDrive.setting", stage, kind:error instanceof VideoFolderValidationError ? "validation" : "lookup" }));
    if (error instanceof VideoFolderValidationError) return { error: error.message };
    // Google 응답·주소·인증 정보는 오류 화면과 로그로 전달하지 않는다.
    return { error: "영상 폴더를 확인하지 못했습니다. 폴더 주소와 연동 계정의 접근 권한을 확인해 주세요." };
  }
}
