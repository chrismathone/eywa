import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readVideoDriveAuth, videoDriveConfigFor, type VideoDriveConfig } from "./drive-config";

type Db = ReturnType<typeof createAdminClient>;
export type VideoDriveSetting = {
  ready: boolean; enabled: boolean; rootId: string | null; folderName: string | null;
  version: string | null; source: "saved" | "legacy" | "none"; authReady: boolean;
};
export function missingDriveSettingSchema(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
const empty = (ready: boolean): VideoDriveSetting => ({
  ready, enabled: false, rootId: null, folderName: null, version: null, source: "none", authReady: !!readVideoDriveAuth(),
});

/** 명시적으로 해제한 설정은 이전 연결로 되돌리지 않는다. 조회 장애도 미설정으로 취급하지 않는다. */
export async function getVideoDriveSetting(tenantId: string, db: Db = createAdminClient()): Promise<VideoDriveSetting> {
  const { data, error } = await db.from("homework_video_drive_settings")
    .select("enabled,root_folder_id,version").eq("tenant_id", tenantId).maybeSingle();
  if (error && !missingDriveSettingSchema(error)) throw new Error("영상 폴더 설정을 확인하지 못했습니다.");
  const ready = !error;
  if (data) {
    if (!data.enabled) return { ...empty(ready), source: "saved", version: data.version };
    const root = await db.from("homework_video_drive_roots").select("tenant_id,folder_name")
      .eq("root_folder_id", data.root_folder_id).maybeSingle();
    if (root.error) throw new Error("영상 폴더 소유 정보를 확인하지 못했습니다.");
    if (root.data?.tenant_id !== tenantId) return { ...empty(ready), source: "saved", version: data.version };
    return { ...empty(ready), enabled: true, rootId: data.root_folder_id, folderName: root.data.folder_name || null, source: "saved", version: data.version };
  }
  const legacy = videoDriveConfigFor(tenantId);
  if (!legacy) return empty(ready);
  const owner = await db.from("homework_video_drive_roots").select("tenant_id,folder_name")
    .eq("root_folder_id", legacy.rootId).maybeSingle();
  if (owner.error && !missingDriveSettingSchema(owner.error)) throw new Error("영상 폴더 소유 정보를 확인하지 못했습니다.");
  if (!owner.error && !owner.data) return empty(ready);
  if (owner.data && owner.data.tenant_id !== tenantId) return empty(ready);
  // 구 스키마에도 등록부의 다른 지점 소유를 무시하지 않는다.
  const other = await db.from("classnote_video_folders").select("tenant_id").eq("root_folder_id", legacy.rootId).neq("tenant_id", tenantId).limit(1);
  if (other.error) throw new Error("영상 폴더 소유 정보를 확인하지 못했습니다.");
  if (other.data?.length) return empty(ready);
  return { ...empty(ready), enabled: true, rootId: legacy.rootId, folderName: owner.data?.folder_name || null, source: "legacy" };
}

export async function videoDriveForTenant(tenantId: string, db: Db): Promise<VideoDriveConfig | null> {
  const setting = await getVideoDriveSetting(tenantId, db);
  const auth = readVideoDriveAuth();
  return setting.enabled && setting.rootId && auth ? { tenantId, rootId: setting.rootId, accessToken: auth.accessToken } : null;
}

/** 시작한 업로드는 해제·폴더 변경 이후에도 지점이 소유한 원래 폴더에서 완료한다. */
export async function videoDriveOwnsRoot(tenantId: string, rootId: string, db: Db): Promise<boolean> {
  const result = await db.from("homework_video_drive_roots").select("tenant_id").eq("root_folder_id", rootId).maybeSingle();
  if (result.error && !missingDriveSettingSchema(result.error)) throw new Error("영상 폴더 소유 정보를 확인하지 못했습니다.");
  if (result.data) return result.data.tenant_id === tenantId;
  if (!result.error) return false;
  const legacy = videoDriveConfigFor(tenantId);
  if (legacy?.rootId !== rootId) return false;
  const registry = await db.from("classnote_video_folders").select("tenant_id").eq("root_folder_id", rootId).neq("tenant_id", tenantId).limit(1);
  if (registry.error) throw new Error("영상 폴더 소유 정보를 확인하지 못했습니다.");
  return !registry.data?.length;
}
