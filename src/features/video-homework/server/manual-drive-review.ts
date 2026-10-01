import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type ManualDriveReviewItem = {
  id: string;
  driveFileId: string | null;
  fileName: string | null;
  reason: string | null;
  folderName: string | null;
  /** 같은 영상이 이미 있어 세지 않은 파일(이름을 고쳐도 풀리지 않는다 — 지워도 된다). */
  duplicate: boolean;
};
/** fixable = 파일 이름으로 학생·반을 못 찾음(이름을 고치면 다시 판정) · duplicates = 같은 영상이 이미 있음. */
export type ManualDriveReview = { fixable: number; duplicates: number; items: ManualDriveReviewItem[] };

/** 안내에 펼쳐 보일 최대 개수 — 건수는 따로 센다(#89: 잘린 목록 길이를 건수로 쓰지 않는다). */
export const MANUAL_DRIVE_REVIEW_LIMIT = 30;

type Row = { id: string; drive_file_id: string | null; file_name: string | null; reason: string | null; folder_name: string | null;
  duplicate_of: string | null };

/**
 * 담임 폴더에 **직접 올렸지만 세지 못한** 숙제 영상(0324a `status='review'`, 워커 video-manual-scan이 10분마다 다시 판정 — 여기는 읽기만).
 * 출처는 `route->>source`로 거른다(0324a 전에도 있는 칸이라 SQL 전후 둘 다 돈다 · 제출 링크 등 다른 출처의 확인 필요는 섞지 않는다).
 * 못 읽으면 null — 안내만 빠지고 화면은 그대로.
 */
export async function getManualDriveReview(tenantId: string): Promise<ManualDriveReview | null> {
  try {
    const db = createAdminClient();
    const count = () => db.from("student_homework_videos").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "review").eq("route->>source", "drive");
    const [list, fixable, duplicates] = await Promise.all([
      db.from("student_homework_videos")
        .select("id,drive_file_id,file_name:route->>fileName,reason:route->>reason,folder_name:route->>folderName,duplicate_of:route->>duplicateOf")
        .eq("tenant_id", tenantId).eq("status", "review").eq("route->>source", "drive")
        .order("updated_at", { ascending: false }).order("id").limit(MANUAL_DRIVE_REVIEW_LIMIT),
      count().is("route->>duplicateOf", null),
      count().not("route->>duplicateOf", "is", null),
    ]);
    for (const result of [list, fixable, duplicates]) if (result.error) throw result.error;
    const rows = (list.data ?? []) as unknown as Row[];
    return { fixable: fixable.count ?? 0, duplicates: duplicates.count ?? 0, items: rows.map((row) => ({ id: row.id,
      driveFileId: row.drive_file_id, fileName: row.file_name, reason: row.reason, folderName: row.folder_name,
      duplicate: !!row.duplicate_of })) };
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomework.manualDriveReview", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}
