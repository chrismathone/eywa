import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkDriveFolder } from "./video-drive.mjs";
import { DRIVE_API as API, driveClient, driveJson } from "./video-drive-http.mjs";
import { writeVideoState } from "./video-state.mjs";

const MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,parents,trashed,appProperties,capabilities(canAddChildren),webViewLink";
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** 담임 ID를 키로 폴더를 재사용한다. 이름 변경·동명이인·생성 응답 유실에도 키는 유지된다. */
export async function ensureTeacherFolder(rootId, route, centerId, stateDir, options) {
  if (!uuid(route.tenantId) || route.teacherId !== null && !uuid(route.teacherId) || !/^[1-9]\d*$/.test(centerId))
    throw new Error("담임 폴더의 지점·기관·담임 식별자가 올바르지 않습니다.");
  await checkDriveFolder(rootId, options);
  const request = driveClient(options);
  const key = `${route.tenantId}:${centerId}:${route.teacherId ?? "unassigned"}`;
  const verify = (folder, explicit = false) => {
    if (folder.trashed || folder.mimeType !== MIME || !folder.parents?.includes(rootId) ||
      ((!explicit || folder.appProperties?.aywaTeacher) && folder.appProperties?.aywaTeacher !== key) || !folder.capabilities?.canAddChildren)
      throw new Error("담임 폴더의 위치·담임 연결·쓰기 권한을 확인해야 합니다.");
    return { id: folder.id, name: folder.name, webViewLink: folder.webViewLink };
  };
  // 연결된 Drive 앱으로 먼저 만든 시험 폴더는 확정 ID로만 이어받는다. 이름 검색으로 기존 폴더를 채택하지 않는다.
  const bindings = options.teacherFolders ?? JSON.parse(process.env.CLASSNOTE_VIDEO_TEACHER_FOLDERS || "{}");
  const boundId = bindings[key];
  if (boundId) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(boundId)) throw new Error("지정된 담임 폴더 ID가 올바르지 않습니다.");
    const result = verify(await driveJson(await request(`${API}/files/${boundId}?supportsAllDrives=true&fields=${FIELDS}`), "연결한 담임 폴더 조회"), true);
    if (options.folderRegistry && await options.folderRegistry.reserve(key, boundId) !== boundId) throw new Error("기존 담임 폴더 연결과 다릅니다.");
    return result;
  }
  const registeredId = await options.folderRegistry?.find(key);
  if (registeredId) {
    const response = await request(`${API}/files/${registeredId}?supportsAllDrives=true&fields=${FIELDS}`);
    if (response.ok) return verify(await response.json(), true);
    if (response.status !== 404) throw new Error(`등록한 담임 폴더 조회 HTTP ${response.status}`);
    // 생성 전에 DB에 번호부터 저장한 작업은 아래에서 같은 번호로 완료한다.
  }
  const query = new URLSearchParams({
    q: `'${rootId}' in parents and trashed = false and appProperties has { key='aywaTeacher' and value='${key}' }`,
    fields: `files(${FIELDS}),nextPageToken`, pageSize: "2", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  const found = await driveJson(await request(`${API}/files?${query}`), "담임 폴더 검색");
  if (found.nextPageToken || found.files?.length > 1) throw new Error("동일 담임의 자동 폴더가 여러 개여서 확인이 필요합니다.");
  if (found.files?.[0]) {
    const result = verify(found.files[0]);
    if (options.folderRegistry && await options.folderRegistry.reserve(key, result.id) !== result.id) throw new Error("담임 폴더 번호가 충돌합니다.");
    return result;
  }

  const hash = createHash("sha256").update(`${rootId}:${key}`).digest("hex").slice(0, 32);
  const statePath = path.join(stateDir, `.drive-folder-${hash}.json`);
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (state && (state.key !== key || state.rootId !== rootId || registeredId && state.folderId !== registeredId))
    throw new Error("담임 폴더의 저장된 상태가 다릅니다.");
  if (state && options.folderRegistry && await options.folderRegistry.reserve(key, state.folderId) !== state.folderId)
    throw new Error("담임 폴더 번호가 충돌합니다.");
  if (!state) {
    const ids = registeredId ? { ids: [registeredId] } : await driveJson(await request(`${API}/files/generateIds?count=1&space=drive&type=files`), "폴더 ID 발급");
    if (!ids.ids?.[0]) throw new Error("담임 폴더 ID를 발급받지 못했습니다.");
    const folderId = options.folderRegistry ? await options.folderRegistry.reserve(key, ids.ids[0]) : ids.ids[0];
    state = { rootId, key, folderId };
    await writeVideoState(statePath, state, { createOnly: true });
  }
  const url = `${API}/files/${state.folderId}?supportsAllDrives=true&fields=${FIELDS}`;
  const existing = await request(url);
  if (existing.ok) return verify(await existing.json());
  if (existing.status !== 404) throw new Error(`담임 폴더 확인 HTTP ${existing.status}`);
  if (state.completed) throw new Error("기존 담임 폴더를 찾지 못했습니다. 이동·삭제·접근 권한을 확인하세요.");
  const created = await request(`${API}/files?supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: state.folderId, name: route.folderName, mimeType: MIME,
      parents: [rootId], appProperties: { aywaTeacher: key } }),
  });
  if (!created.ok && created.status !== 409) throw new Error(`담임 폴더 생성 HTTP ${created.status} — 재실행하면 같은 ID로 확인합니다.`);
  const result = verify(await driveJson(await request(url), "생성한 담임 폴더 검증"));
  state.completed = true;
  await writeVideoState(statePath, state);
  return result;
}
