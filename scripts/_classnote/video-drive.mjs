import { open, readFile } from "node:fs/promises";
import { fileDigests } from "./video-download.mjs";
import { DRIVE_API as API, driveClient as client, driveJson as json } from "./video-drive-http.mjs";
import { writeVideoState } from "./video-state.mjs";

const FIELDS = "id,name,size,md5Checksum,webViewLink,trashed,parents,appProperties,properties";
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
  return { id: file.id, name: file.name, webViewLink: file.webViewLink, bytes: Number(file.size), compression: file.properties?.aywaCompressed ?? null };
}

/**
 * 이미 Drive에 있는 파일 확인(중복·재시도) — 원본 그대로 올린 파일이거나, **같은 원본에서 만든 압축본**이면 인정한다.
 * 압축본은 올릴 때 남긴 원본 지문(aywaSourceMd5·Bytes)이 이 원본과 같고, Drive 해시가 올릴 때 적은 값(aywaUploadMd5·Bytes)과
 * 같아야 한다 — 압축본 md5는 실행마다 같다는 보장이 없어서 로컬에서 다시 만든 압축본과는 대조하지 않는다.
 * 🔴 지문은 공개 `properties`에 둔다 — `appProperties`는 OAuth 클라이언트(앱)마다 비공개라, 인증 방식을 바꾸면(gcloud↔OAuth)
 *    새 앱에 안 보여 압축본이 영구히 "원본과 다름"이 된다. 값은 해시·크기·표식뿐이다(학생 정보 없음).
 */
function verifyExisting(file, video, folderId) {
  const p = file.properties ?? {};
  const derived = p.aywaSourceMd5 === video.md5 && Number(p.aywaSourceBytes) === video.bytes &&
    typeof file.md5Checksum === "string" && p.aywaUploadMd5 === file.md5Checksum && Number(p.aywaUploadBytes) === Number(file.size);
  return verify(file, derived ? { md5: file.md5Checksum, bytes: Number(file.size) } : video, folderId);
}

/**
 * 열린 재개 전송 세션(`session`)으로 파일을 8MiB 조각씩 보낸다 — 처음과 끊긴 뒤엔 받은 위치를 물어(probe) 이어 보낸다.
 * 세션이 사라지면(404) `restart()`가 새 세션 주소를 돌려주고 처음부터 보낸다. 끝나면(200·201) 돌아오고, 그 밖은 던진다.
 * 새 파일 업로드(아래)와 `/v` 영상 사후 압축의 내용 교체(video-drive-replace.mjs)가 같이 쓴다.
 * `options.signal`(선택)이 끊기면 보내던 조각도 끊고 멈춘다(ClassNote 업로드는 넘기지 않아 종전 그대로).
 */
export async function sendResumableFile(request, filePath, bytes, { session, restart, sleep: wait = sleep, signal } = {}) {
  let url = session;
  let offset = 0;
  let failures = 0;
  let needsProbe = true;
  const file = await open(filePath, "r");
  try {
    for (;;) {
      signal?.throwIfAborted();
      let response;
      try {
        if (needsProbe) {
          response = await request(url, { method: "PUT", signal, headers: { "Content-Length": "0", "Content-Range": `bytes */${bytes}` } });
        } else {
          const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, bytes - offset));
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          if (!bytesRead) throw new Error("전송할 영상 데이터가 없습니다.");
          response = await request(url, { method: "PUT", signal, headers: { "Content-Type": "video/mp4",
            "Content-Length": String(bytesRead), "Content-Range": `bytes ${offset}-${offset + bytesRead - 1}/${bytes}` }, body: buffer.subarray(0, bytesRead) });
        }
      } catch (error) {
        // '나중에'(잠금·인증 사정 — `/v` 사후 압축)는 연결 실패로 바꾸지 않고 그대로 올린다. ClassNote 업로드는 이런 오류를 내지 않는다.
        if (error?.later) throw error;
        if (++failures > 3) throw new Error("Drive 전송 연결 실패 — 재실행하면 이어서 업로드합니다.");
        needsProbe = true; await wait(1000 * 2 ** failures); continue;
      }
      if (response.status === 200 || response.status === 201) return;
      if (response.status === 308) {
        const range = response.headers.get("range");
        const nextOffset = range ? Number(/^bytes=0-(\d+)$/.exec(range)?.[1]) + 1 : 0;
        if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset >= bytes) throw new Error("Drive 이어올리기 위치가 올바르지 않습니다.");
        if (!needsProbe && nextOffset <= offset) {
          if (++failures > 3) throw new Error("Drive 업로드가 진행되지 않아 중단했습니다. 작업 상태를 보존했습니다.");
          needsProbe = true; await wait(1000 * 2 ** failures); continue;
        }
        offset = nextOffset;
        needsProbe = false; continue;
      }
      if (response.status === 404 && ++failures <= 3) { url = await restart(); offset = 0; needsProbe = true; continue; }
      if ((response.status === 429 || response.status >= 500) && ++failures <= 3) {
        needsProbe = true; await wait(1000 * 2 ** failures); continue;
      }
      throw new Error(`Drive 업로드 HTTP ${response.status} — 작업 상태를 보존했습니다.`);
    }
  } finally { await file.close(); }
}

/**
 * 1건 업로드: 원본 키 중복 방지, 고정 Drive ID, 재시작 가능한 전송 세션, 업로드 후 해시 대조.
 * `options.prepareUpload(video)`(선택, video-compress.mjs)는 **정말 올려야 할 때만** 불린다 — 압축본을 돌려주면 그 파일을 올리고,
 * 중복·예약·재시도 판정은 끝까지 원본 지문(video.md5·bytes)으로 한다.
 */
export async function uploadVideoToDrive(video, folderId, options) {
  await checkDriveFolder(folderId, options);
  const digest = await fileDigests(video.filePath);
  if (digest.md5 !== video.md5 || digest.bytes !== video.bytes) throw new Error("업로드 전 로컬 영상 검증 실패");
  const request = client(options);
  if (options.existingFileId) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(options.existingFileId)) throw new Error("기존 영상 파일 ID가 올바르지 않습니다.");
    return { ...verifyExisting(await json(await request(`${API}/files/${options.existingFileId}?supportsAllDrives=true&fields=${FIELDS}`), "같은 내용 영상 확인"), video, folderId), status: "already-uploaded" };
  }
  const sourceKey = `classnote:${video.centerId}:${video.videoId}`;
  if (!/^classnote:[1-9]\d*:[1-9]\d*$/.test(sourceKey)) throw new Error("영상 식별자가 올바르지 않습니다.");
  const query = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false and appProperties has { key='aywaSource' and value='${sourceKey}' }`,
    fields: `files(${FIELDS}),nextPageToken`, pageSize: "2", spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const existing = await json(await request(`${API}/files?${query}`), "Drive 중복 확인");
  if (existing.nextPageToken || existing.files?.length > 1) throw new Error("같은 원본의 Drive 검색 결과가 여러 개이거나 불완전하여 확인이 필요합니다.");
  if (existing.files?.[0]) return { ...verifyExisting(existing.files[0], video, folderId), status: "already-uploaded" };

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
  if (prior.ok) return { ...verifyExisting(await prior.json(), video, folderId), status: "already-uploaded" };
  if (prior.status !== 404) throw new Error(`Drive 기존 작업 확인 HTTP ${prior.status}`);
  // 올릴 내용(원본 또는 압축본). 내용이 지난 전송 세션과 다르면(압축본을 다시 만듦) 세션을 버리고 같은 ID로 새로 보낸다 —
  // 다른 내용의 조각을 이어 붙이면 파일이 깨진다.
  const prepared = options.prepareUpload ? await options.prepareUpload(video) : null;
  const body = prepared?.filePath ? prepared : video;
  const marker = typeof prepared?.marker === "string" ? prepared.marker : null;
  if ((state.uploadMd5 ?? state.md5) !== body.md5) state = { ...state, session: null };
  state = { ...state, uploadMd5: body.md5 };
  await persist();

  async function start() {
    const response = await request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=${FIELDS}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(body.bytes) },
      body: JSON.stringify({ id: state.fileId, name: video.name, mimeType: "video/mp4", parents: [folderId],
        appProperties: { aywaSource: sourceKey, aywaSha256: video.sha256 },
        properties: { aywaSourceMd5: video.md5, aywaSourceBytes: String(video.bytes), aywaUploadMd5: body.md5, aywaUploadBytes: String(body.bytes),
          ...(marker ? { aywaCompressed: marker } : {}) } }),
    });
    if (!response.ok) throw new Error(`Drive 업로드 시작 HTTP ${response.status}`);
    const session = response.headers.get("location");
    if (!session || new URL(session).origin !== "https://www.googleapis.com") throw new Error("Drive 업로드 세션 응답이 올바르지 않습니다.");
    state.session = session; await persist();
  }
  if (state.session && new URL(state.session).origin !== "https://www.googleapis.com") throw new Error("저장된 Drive 세션 주소가 올바르지 않습니다.");
  if (!state.session) await start();
  await sendResumableFile(request, body.filePath, body.bytes, {
    session: state.session, restart: async () => { await start(); return state.session; }, sleep: options.sleep,
  });
  const saved = verify(await json(await request(fileUrl), "Drive 저장 확인"), body, folderId);
  state.session = null; state.completed = true; await persist();
  return { ...saved, status: "uploaded" };
}
