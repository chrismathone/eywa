import { open, readFile } from "node:fs/promises";
import { fileDigests } from "./video-download.mjs";
import { DRIVE_API as API, driveClient as client, driveJson as json } from "./video-drive-http.mjs";
import { writeVideoState } from "./video-state.mjs";

const FIELDS = "id,name,size,md5Checksum,webViewLink,trashed,parents,appProperties";
const CHUNK_BYTES = 8 * 1024 * 1024; // Drive: 256KiB 배수
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkDriveFolder(folderId, options) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) throw new Error("Drive 폴더 ID가 필요합니다.");
  const request = client(options);
  const folder = await json(await request(`${API}/files/${folderId}?supportsAllDrives=true&fields=id,mimeType,driveId,trashed,capabilities(canAddChildren)`), "Drive 폴더 조회");
  if (folder.trashed || folder.mimeType !== "application/vnd.google-apps.folder" || !folder.capabilities?.canAddChildren)
    throw new Error("지정한 Drive 폴더에 파일을 추가할 권한이 없습니다.");
  if (options.kind === "service-account" && !folder.driveId)
    throw new Error("개인 내 드라이브에는 OAuth 로그인이 필요합니다. 서비스계정은 Workspace 공유 드라이브를 지정하세요.");
  return folder;
}

function verify(file, video, folderId) {
  if (file.trashed || !file.parents?.includes(folderId) || Number(file.size) !== video.bytes || file.md5Checksum !== video.md5)
    throw new Error("Drive 저장 파일의 위치·크기·해시가 원본과 다릅니다.");
  return { id: file.id, name: file.name, webViewLink: file.webViewLink, bytes: Number(file.size) };
}

/** 1건 업로드: 원본 키 중복 방지, 고정 Drive ID, 재시작 가능한 전송 세션, 업로드 후 해시 대조. */
export async function uploadVideoToDrive(video, folderId, options) {
  await checkDriveFolder(folderId, options);
  const digest = await fileDigests(video.filePath);
  if (digest.md5 !== video.md5 || digest.bytes !== video.bytes) throw new Error("업로드 전 로컬 영상 검증 실패");
  const request = client(options);
  if (options.existingFileId) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(options.existingFileId)) throw new Error("기존 영상 파일 ID가 올바르지 않습니다.");
    return { ...verify(await json(await request(`${API}/files/${options.existingFileId}?supportsAllDrives=true&fields=${FIELDS}`), "같은 내용 영상 확인"), video, folderId), status: "already-uploaded" };
  }
  const sourceKey = `classnote:${video.centerId}:${video.videoId}`;
  if (!/^classnote:[1-9]\d*:[1-9]\d*$/.test(sourceKey)) throw new Error("영상 식별자가 올바르지 않습니다.");
  const query = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false and appProperties has { key='aywaSource' and value='${sourceKey}' }`,
    fields: `files(${FIELDS}),nextPageToken`, pageSize: "2", spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const existing = await json(await request(`${API}/files?${query}`), "Drive 중복 확인");
  if (existing.nextPageToken || existing.files?.length > 1) throw new Error("같은 원본의 Drive 검색 결과가 여러 개이거나 불완전하여 확인이 필요합니다.");
  if (existing.files?.[0]) return { ...verify(existing.files[0], video, folderId), status: "already-uploaded" };

  const statePath = `${video.filePath}.drive-state.json`;
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (state && (state.folderId !== folderId || state.md5 !== video.md5 || state.sourceKey !== sourceKey))
    throw new Error("기존 업로드 작업의 폴더/원본과 다릅니다. 상태 파일을 보존했습니다.");
  if (!state) {
    const ids = await json(await request(`${API}/files/generateIds?count=1&space=drive&type=files`), "Drive ID 발급");
    if (!ids.ids?.[0]) throw new Error("Drive 파일 ID를 발급받지 못했습니다.");
    state = { sourceKey, folderId, md5: video.md5, fileId: ids.ids[0], session: null };
  }
  if (options.fileRegistry) {
    const id = await options.fileRegistry.reserve(folderId, video, state.fileId);
    if (state.fileId !== id) state = { ...state, fileId: id, session: null };
  }
  const persist = () => writeVideoState(statePath, state);
  await persist();
  const fileUrl = `${API}/files/${state.fileId}?supportsAllDrives=true&fields=${FIELDS}`;
  const prior = await request(fileUrl);
  if (prior.ok) return { ...verify(await prior.json(), video, folderId), status: "already-uploaded" };
  if (prior.status !== 404) throw new Error(`Drive 기존 작업 확인 HTTP ${prior.status}`);

  async function start() {
    const response = await request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=${FIELDS}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(video.bytes) },
      body: JSON.stringify({ id: state.fileId, name: video.name, mimeType: "video/mp4", parents: [folderId],
        appProperties: { aywaSource: sourceKey, aywaSha256: video.sha256 } }),
    });
    if (!response.ok) throw new Error(`Drive 업로드 시작 HTTP ${response.status}`);
    const session = response.headers.get("location");
    if (!session || new URL(session).origin !== "https://www.googleapis.com") throw new Error("Drive 업로드 세션 응답이 올바르지 않습니다.");
    state.session = session; await persist();
  }
  if (state.session && new URL(state.session).origin !== "https://www.googleapis.com") throw new Error("저장된 Drive 세션 주소가 올바르지 않습니다.");
  if (!state.session) await start();
  let offset = 0;
  let failures = 0;
  let complete = false;
  let needsProbe = true;
  const file = await open(video.filePath, "r");
  try {
    while (!complete) {
      let response;
      try {
        if (needsProbe) {
          response = await request(state.session, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${video.bytes}` } });
        } else {
          const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, video.bytes - offset));
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          if (!bytesRead) throw new Error("전송할 영상 데이터가 없습니다.");
          response = await request(state.session, { method: "PUT", headers: { "Content-Type": "video/mp4",
            "Content-Length": String(bytesRead), "Content-Range": `bytes ${offset}-${offset + bytesRead - 1}/${video.bytes}` }, body: buffer.subarray(0, bytesRead) });
        }
      } catch {
        if (++failures > 3) throw new Error("Drive 전송 연결 실패 — 재실행하면 이어서 업로드합니다.");
        needsProbe = true; await (options.sleep ?? sleep)(1000 * 2 ** failures); continue;
      }
      if (response.status === 200 || response.status === 201) { complete = true; break; }
      if (response.status === 308) {
        const range = response.headers.get("range");
        const nextOffset = range ? Number(/^bytes=0-(\d+)$/.exec(range)?.[1]) + 1 : 0;
        if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset >= video.bytes) throw new Error("Drive 이어올리기 위치가 올바르지 않습니다.");
        if (!needsProbe && nextOffset <= offset) {
          if (++failures > 3) throw new Error("Drive 업로드가 진행되지 않아 중단했습니다. 작업 상태를 보존했습니다.");
          needsProbe = true; await (options.sleep ?? sleep)(1000 * 2 ** failures); continue;
        }
        offset = nextOffset;
        needsProbe = false; continue;
      }
      if (response.status === 404 && ++failures <= 3) { await start(); offset = 0; needsProbe = true; continue; }
      if ((response.status === 429 || response.status >= 500) && ++failures <= 3) {
        needsProbe = true; await (options.sleep ?? sleep)(1000 * 2 ** failures); continue;
      }
      throw new Error(`Drive 업로드 HTTP ${response.status} — 작업 상태를 보존했습니다.`);
    }
  } finally { await file.close(); }
  const saved = verify(await json(await request(fileUrl), "Drive 저장 확인"), video, folderId);
  state.session = null; state.completed = true; await persist();
  return { ...saved, status: "uploaded" };
}
