import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { legacyVideoDriveAuthFor } from "./drive-config";
import { driveRequest, type DriveRequest } from "./drive-api";
import { requireCompleteChain, requireEmptyVideoFolder, verifyVideoFolder, VideoFolderValidationError } from "./drive-folder-validation";

type Db = ReturnType<typeof createAdminClient>;

/** 저장 함수에 넘기는 확인된 폴더 한 줄 — 누구 폴더인지·어느 연결인지·맨 위까지의 경로. */
export type VerifiedRootClaim = {
  tenantId: string; rootId: string; connectionId: string | null; folderName: string; ancestorIds: string[]; chainComplete: boolean;
};

const OWNER_FAILED = "영상 폴더 소유 정보를 확인하지 못했습니다.";
const NOT_ASSIGNABLE = "이 폴더는 지정할 수 없습니다. 비어 있는 새 폴더를 지정해 주세요.";
const LEGACY_UNVERIFIED = "기존 저장 폴더 정보를 확인하지 못했습니다. 연결 상태를 확인해 주세요.";
const LEGACY_INCOMPLETE = "기존 저장 폴더가 그 계정의 내 드라이브 안에 있지 않아 새 폴더를 정할 수 없습니다. 기존 폴더의 위치를 확인해 주세요.";
/** 다시 확인할 기존 폴더는 마이그레이션이 옮겨 온 몇 개뿐이다 — 이보다 많으면 잘못된 상태로 보고 멈춘다(조용히 자르지 않는다). */
const MAX_PENDING = 20;
/** 폴더 하나의 경로 확인은 Drive를 몇 번 부른다 — 서로 독립이라 몇 개씩 함께 한다. */
const PARALLEL = 4;

/**
 * 저장하려는 폴더를 **고른 계정의 자격으로** 확인한다 — 폴더인지·파일을 넣을 수 있는지·새 폴더면 비었는지·경로가 그 계정의 내 드라이브까지 이어지는지.
 * 이미 등록된 폴더는 **이 지점 + 같은 연결**일 때만 다시 고를 수 있다(다른 지점·다른 계정에 묶인 폴더는 옮겨 붙이지 않는다).
 * 🔴 다른 지점의 폴더는 이 계정으로 읽지 않는다 — 겹침은 DB에 저장된 그 폴더의 경로로 본다.
 */
export async function verifyCandidateRoot(input: {
  db: Db; request: DriveRequest; tenantId: string; connectionId: string; rootId: string;
}): Promise<VerifiedRootClaim> {
  const { db, request, tenantId, connectionId, rootId } = input;
  const existing = await db.from("homework_video_drive_roots").select("tenant_id,connection_id").eq("root_folder_id", rootId).maybeSingle();
  if (existing.error) throw new Error(OWNER_FAILED);
  if (existing.data && (existing.data.tenant_id !== tenantId || (existing.data.connection_id ?? null) !== connectionId))
    throw new VideoFolderValidationError(NOT_ASSIGNABLE);
  // 새 폴더만 빈 상태를 요구한다. 이미 이 연결로 쓰던 폴더의 기존 영상은 그대로 둔다.
  if (!existing.data) await requireEmptyVideoFolder(request, rootId);
  const verified = await verifyVideoFolder(request, rootId, true);
  requireCompleteChain(verified);
  return { tenantId, rootId, connectionId, ...verified };
}

/**
 * **경로 확인이 끝나지 않은 기존 폴더**를 그 폴더의 자격(env 기존 연결)으로 확인한다 — 새 폴더를 받기 전에 끝내야 한다
 * (경로를 모르는 폴더가 남아 있으면 새 폴더가 그 안쪽인지 알 수 없고, DB도 그런 폴더가 하나라도 있으면 새 폴더를 켜지 않는다).
 * 대상 = 경로를 확인한 적 없는 폴더(마이그레이션이 번호만 옮겨 온 것) **또는 예전 방식으로 확인만 하고 '맨 위까지 이어지는지'는 보지 않은 폴더**.
 * `exceptRootId` = 지금 저장하려는 폴더(그쪽은 고른 계정으로 따로 확인한다).
 * 🔴 지금 고른 계정으로 기존 폴더를 읽지 않는다. 확인하지 못하면 추정하지 않고 멈춘다.
 */
export async function verifyPendingLegacyRoots(db: Db, exceptRootId: string, fetchImpl: typeof fetch = fetch): Promise<VerifiedRootClaim[]> {
  const { data, error } = await db.from("homework_video_drive_roots").select("root_folder_id,tenant_id,connection_id")
    .or("ancestry_verified.eq.false,chain_complete.eq.false").limit(MAX_PENDING + 2);
  if (error || !data) throw new Error(OWNER_FAILED);
  const rows = (data as { root_folder_id: string; tenant_id: string; connection_id: string | null }[]).filter((row) => row.root_folder_id !== exceptRootId);
  if (rows.length > MAX_PENDING) throw new VideoFolderValidationError(LEGACY_UNVERIFIED);
  const verify = async (row: (typeof rows)[number]): Promise<VerifiedRootClaim> => {
    // 계정을 연결한 폴더가 여기 남아 있을 수는 없다(저장할 때 확인을 마친다) — 있으면 멈춘다. 기존 연결은 env 지점의 것만 쓴다.
    const auth = row.connection_id ? null : legacyVideoDriveAuthFor(row.tenant_id);
    if (!auth) throw new VideoFolderValidationError(LEGACY_UNVERIFIED);
    let verified: Awaited<ReturnType<typeof verifyVideoFolder>>;
    try {
      verified = await verifyVideoFolder(driveRequest(auth.accessToken, fetchImpl), row.root_folder_id);
    } catch {
      throw new VideoFolderValidationError(LEGACY_UNVERIFIED);
    }
    if (!verified.chainComplete) throw new VideoFolderValidationError(LEGACY_INCOMPLETE);
    return { tenantId: row.tenant_id, rootId: row.root_folder_id, connectionId: null, ...verified };
  };
  const claims: VerifiedRootClaim[] = [];
  for (let offset = 0; offset < rows.length; offset += PARALLEL)
    claims.push(...(await Promise.all(rows.slice(offset, offset + PARALLEL).map(verify))));
  return claims;
}
