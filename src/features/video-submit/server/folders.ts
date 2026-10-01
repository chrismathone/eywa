import "server-only";
import { createTeacherFolder, findTeacherFolder, FOLDER_MIME, generateDriveId, getDriveFile, type DriveFile, type DriveRequest } from "./drive-api";

/**
 * 담임 폴더 확보 — 워커 [`ensureTeacherFolder`](../../../../scripts/_classnote/video-drive-folders.mjs)와 같은 순서·같은 등록부
 * (0315a `classnote_video_folders`, 열쇠 `지점:기관:담임`)라 링크 영상과 ClassNote 영상이 **같은 담임 폴더**에 모인다.
 * 서버리스라 로컬 상태 파일이 없다 — 대신 번호를 **만들기 전에 등록부에 먼저 선점**하고(워커도 같은 등록부를 쓴다),
 * 동시에 두 쪽이 만들면 등록부의 승자 번호 하나로 모인다(진 쪽은 그 번호로 같은 폴더를 확인할 뿐 · 409는 이미 있음).
 */
export type FolderRegistry = {
  find(key: string): Promise<string | null>;
  /** 열쇠에 번호를 선점 — 이미 있으면 **있던 번호**를 돌려준다. */
  reserve(key: string, proposedId: string): Promise<string>;
};

function verify(folder: DriveFile | null, rootId: string, key: string, explicit: boolean): { id: string } {
  if (!folder || folder.trashed || folder.mimeType !== FOLDER_MIME || !folder.parents?.includes(rootId) ||
    ((!explicit || folder.appProperties?.aywaTeacher) && folder.appProperties?.aywaTeacher !== key) || !folder.capabilities?.canAddChildren)
    throw new Error("담임 폴더의 위치·담임 연결·쓰기 권한을 확인해야 합니다.");
  return { id: folder.id };
}

export async function ensureLinkTeacherFolder(input: {
  request: DriveRequest; registry: FolderRegistry; rootId: string; key: string; folderName: string;
}): Promise<{ id: string }> {
  const { request, registry, rootId, key, folderName } = input;
  const root = await getDriveFile(request, rootId, true);
  if (!root || root.trashed || root.mimeType !== FOLDER_MIME || !root.capabilities?.canAddChildren)
    throw new Error("영상 저장 폴더에 파일을 추가할 권한이 없습니다.");

  // ① 등록부에 있으면 그 번호(사람이 연결해 둔 폴더는 표식이 없어도 된다 = explicit).
  const registered = await registry.find(key);
  if (registered) {
    const folder = await getDriveFile(request, registered, true);
    if (folder) return verify(folder, rootId, key, true);
    // 번호만 선점되고 아직 안 만들어졌다(워커가 만들다 멈췄거나 지금 만드는 중) — 아래에서 같은 번호로 완성한다.
  } else {
    // ② 등록부엔 없는데 표식이 붙은 폴더가 있으면 그것을 등록한다.
    const found = await findTeacherFolder(request, rootId, key);
    if (found) {
      const result = verify(found, rootId, key, false);
      if ((await registry.reserve(key, result.id)) !== result.id) throw new Error("담임 폴더 번호가 충돌합니다.");
      return result;
    }
  }
  // ③ 번호를 선점하고(이미 있으면 그 번호) 그 번호로 만든다.
  const proposed = registered ?? (await generateDriveId(request));
  const folderId = await registry.reserve(key, proposed);
  const existing = await getDriveFile(request, folderId, true);
  if (existing) return verify(existing, rootId, key, folderId !== proposed);
  await createTeacherFolder(request, { id: folderId, name: folderName, rootId, key });
  return verify(await getDriveFile(request, folderId, true), rootId, key, false);
}
