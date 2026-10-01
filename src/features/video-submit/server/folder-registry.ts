import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { FolderRegistry } from "./folders";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 워커 [`videoFolderRegistry`](../../../../scripts/_classnote/video-folder-registry.mjs)의 앱판 — 같은 표·같은 열쇠.
 * 워커는 `on conflict … do update … returning`으로 "있던 번호"를 받는다. 여기선 그냥 넣고, 겹치면(23505) 있던 번호를 다시 읽는다
 * (PostgREST upsert의 ignoreDuplicates는 이긴 행을 돌려주지 않는다).
 */
export function linkFolderRegistry(db: Db, tenantId: string, rootId: string): FolderRegistry {
  const find = async (key: string): Promise<string | null> => {
    const { data, error } = await db.from("classnote_video_folders").select("drive_folder_id")
      .eq("tenant_id", tenantId).eq("root_folder_id", rootId).eq("route_key", key).maybeSingle();
    if (error) throw new Error("담임 폴더 등록부를 읽지 못했습니다.");
    return (data?.drive_folder_id as string | undefined) ?? null;
  };
  return {
    find,
    async reserve(key, proposedId) {
      const { error } = await db.from("classnote_video_folders")
        .insert({ tenant_id: tenantId, root_folder_id: rootId, route_key: key, drive_folder_id: proposedId });
      if (!error) return proposedId;
      if (error.code !== "23505") throw new Error("담임 폴더 등록부에 기록하지 못했습니다.");
      const winner = await find(key);
      if (!winner) throw new Error("담임 폴더 번호가 다른 담임과 겹칩니다.");
      return winner;
    },
  };
}

/**
 * 이 지점의 ClassNote 기관 번호 — 폴더 열쇠(`지점:기관:담임`)에 들어간다. 앱은 ClassNote에 로그인하지 않으므로 워커가 남긴 기록에서 읽는다
 * (과거 수집 상태 → 폴더 등록부 순). **하나로 정해질 때만** 쓴다 — 없거나 여럿이면 null(제출 링크를 열지 않는다:
 * 다른 열쇠로 폴더를 만들면 같은 담임 폴더가 둘이 된다).
 */
export async function resolveVideoCenterId(db: Db, tenantId: string, rootId: string): Promise<string | null> {
  const [history, folders] = await Promise.all([
    db.from("classnote_video_history").select("center_id").eq("tenant_id", tenantId).limit(5),
    db.from("classnote_video_folders").select("route_key").eq("tenant_id", tenantId).eq("root_folder_id", rootId).limit(200),
  ]);
  if (history.error || folders.error) return null;
  const ids = new Set<string>();
  for (const row of history.data ?? []) if (/^[1-9]\d*$/.test(String(row.center_id))) ids.add(String(row.center_id));
  for (const row of folders.data ?? []) {
    const middle = String(row.route_key ?? "").split(":")[1] ?? "";
    if (/^[1-9]\d*$/.test(middle)) ids.add(middle);
  }
  return ids.size === 1 ? [...ids][0]! : null;
}
