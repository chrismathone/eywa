import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import type { TenantSettings } from "@/features/owner/settings-types";
import { type VideoDriveConfig } from "./drive-config";
import { videoDriveForTenant } from "./drive-credentials";
import { resolveVideoCenterId } from "./folder-registry";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 제출 링크를 지금 쓸 수 있나 — **한 판정**(학생 상세 버튼·공개 화면·업로드 시작·보고서 줄이 모두 이것을 본다).
 *  · module_off  = 이 학원에 ClassNote(숙제 영상 수집) 기능이 없다 → 흔적 없이(버튼 없음·공개 화면 404).
 *  · no_config   = 이 지점에 저장 폴더가 없다(정하지 않음·해제) 또는 그 폴더의 자격이 이 지점 것이 아니다 → 기능이 없는 것처럼.
 *  · setup_pending = Google 계정은 골랐는데 **저장 폴더를 아직 정하지 않았다**(계정을 연결·바꾼 직후) → 잠시 못 받음.
 *                    🔴 없는 지점으로 치지 않는다 — 올리기 사이트가 남은 한 지점으로 저절로 정해지면 안 된다.
 *  · reauth      = 연결한 Google 계정을 **다시 연결해야 한다** → 잠시 못 받음("지금은 받을 수 없습니다" — 없는 주소로 치지 않는다).
 *  · no_schema   = 0324a(영상 출처 칸)·0325a(링크 표) 적용 전([[#95]]) → 위와 같다.
 *  · no_center   = 워커가 아직 이 지점 영상을 한 번도 보관하지 않아 담임 폴더 열쇠를 못 만든다 → 위와 같다.
 */
export type SubmitAvailability =
  | { ok: true; drive: VideoDriveConfig; centerId: string }
  | { ok: false; reason: "module_off" | "no_config" | "setup_pending" | "reauth" | "no_schema" | "no_center" };

let schemaKnownReady = false;
const centerByTenant = new Map<string, string>();

/** 표·칸이 있나 — 있으면 기억한다(생기기만 한다). 없거나 못 읽으면 false(이번만). */
export async function videoSubmitSchemaReady(db: Db): Promise<boolean> {
  if (schemaKnownReady) return true;
  const [links, uploads, source] = await Promise.all([
    db.from("homework_video_links").select("id").limit(1),
    db.from("homework_video_link_uploads").select("id").limit(1),
    db.from("student_homework_videos").select("source,source_ref").limit(1),
  ]);
  schemaKnownReady = !links.error && !uploads.error && !source.error;
  return schemaKnownReady;
}

export async function videoSubmitAvailability(
  tenantId: string, settings: Pick<TenantSettings, "modules">, db: Db = createAdminClient(),
): Promise<SubmitAvailability> {
  if (!classnoteModuleOn(settings)) return { ok: false, reason: "module_off" };
  const active = await videoDriveForTenant(tenantId, db);
  if (!active.ok) return { ok: false, reason: active.reason };
  const { drive } = active;
  if (!(await videoSubmitSchemaReady(db))) return { ok: false, reason: "no_schema" };
  const known = centerByTenant.get(`${tenantId}:${drive.rootId}`);
  const centerId = known ?? (await resolveVideoCenterId(db, tenantId, drive.rootId));
  if (!centerId) return { ok: false, reason: "no_center" };
  centerByTenant.set(`${tenantId}:${drive.rootId}`, centerId);
  return { ok: true, drive, centerId };
}

/** 테스트 전용 — 기억 리셋. */
export function _resetVideoSubmitAvailabilityForTest(): void {
  schemaKnownReady = false;
  centerByTenant.clear();
}
