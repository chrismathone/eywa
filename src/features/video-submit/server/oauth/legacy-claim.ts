import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { legacyAuthFingerprint, readVideoDriveConfig } from "../drive-config";
import { fetchDrivePermissionId } from "./google-flow";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 새 계정을 받기 **전에** 기존 연결(env) 계정의 소유를 등록부에 못박는다 — 다른 지점이 그 계정으로 조용히 로그인해 기존 지점과
 * 용량을 나눠 쓰는 것을 막는다(기존 연결은 Google 번호가 DB에 없어, 등록해 두지 않으면 같은 계정인지 알 수 없다).
 *
 * 한 번 등록하면 **env 자격의 지문이 그대로인 동안 다시 묻지 않는다** — 매번 기존 계정의 Drive를 부르면 그 토큰이 깨진 날
 * 모든 지점의 새 연결이 막힌다. 지문이 바뀌었을 때(다른 계정으로 바꿨을 수 있다)만 다시 확인한다.
 * 🔴 확인해야 하는데 못 하면 **던진다**(호출부가 새 연결을 받지 않는다 — 모르는 채로 받지 않는다).
 *  · 기존 연결 env가 없거나, env 폴더가 그 지점의 기존 폴더로 등록돼 있지 않으면 등록할 것이 없다(기존 연결이 동작하지 않는 상태).
 */
export async function ensureLegacyAccountClaim(db: Db, fetchImpl: typeof fetch = fetch): Promise<void> {
  const legacy = readVideoDriveConfig();
  const fingerprint = legacyAuthFingerprint();
  if (!legacy || !fingerprint) return;
  const root = await db.from("homework_video_drive_roots").select("tenant_id,connection_id,legacy_auth_fingerprint")
    .eq("root_folder_id", legacy.rootId).maybeSingle();
  if (root.error) throw new Error("기존 연결 계정을 확인하지 못했습니다.");
  if (!root.data || root.data.tenant_id !== legacy.tenantId || (root.data.connection_id ?? null) !== null) return;
  if (root.data.legacy_auth_fingerprint === fingerprint) return;
  let permissionId: string;
  try {
    permissionId = await fetchDrivePermissionId(await legacy.accessToken(), fetchImpl);
  } catch {
    throw new Error("기존 연결 계정을 확인하지 못했습니다.");
  }
  const claimed = await db.rpc("claim_homework_video_drive_legacy_account", {
    p_tenant: legacy.tenantId, p_root: legacy.rootId, p_permission_id: permissionId, p_auth_fingerprint: fingerprint,
  });
  if (claimed.error) throw new Error("기존 연결 계정을 등록하지 못했습니다.");
}
