import "server-only";
import { DRIVE_ID_RE } from "./drive-config";

/**
 * Drive REST 얇은 래퍼(fetch 주입 — 테스트는 가짜 fetch). 워커 `video-drive*.mjs`와 같은 요청 모양이다.
 * 🔴 응답 본문·접근 토큰을 오류 문장에 싣지 않는다(상태 코드와 한글 단계만).
 */
export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
export const FILE_FIELDS = "id,name,size,md5Checksum,parents,trashed,mimeType,appProperties";
const FOLDER_FIELDS = "id,name,mimeType,parents,trashed,appProperties,driveId,capabilities(canAddChildren)";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveRequest = (url: string, init?: RequestInit) => Promise<Response>;
export type DriveFile = {
  id: string; name?: string; size?: string; md5Checksum?: string; parents?: string[]; trashed?: boolean;
  mimeType?: string; appProperties?: Record<string, string>; capabilities?: { canAddChildren?: boolean };
  /** 공유 드라이브 안의 항목이면 그 드라이브 번호(공유 드라이브 최상위 폴더는 번호가 이 값과 같다). */
  driveId?: string;
};

export function driveRequest(accessToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): DriveRequest {
  return async (url, init = {}) => fetchImpl(url, {
    ...init, signal: AbortSignal.timeout(30_000),
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await accessToken()}` },
  });
}

async function json<T>(response: Response, stage: string): Promise<T> {
  if (!response.ok) throw new Error(`${stage} 실패(HTTP ${response.status})`);
  return (await response.json()) as T;
}

/** 파일·폴더 한 개 — 없으면 null(404). 그 밖의 오류는 던진다(없음으로 뭉개지 않는다). */
export async function getDriveFile(request: DriveRequest, id: string, folder = false): Promise<DriveFile | null> {
  if (!DRIVE_ID_RE.test(id)) throw new Error("Drive 번호가 올바르지 않습니다.");
  const response = await request(`${DRIVE_API}/files/${id}?supportsAllDrives=true&fields=${folder ? FOLDER_FIELDS : FILE_FIELDS}`);
  if (response.status === 404) return null;
  return json<DriveFile>(response, "Drive 조회");
}

/**
 * 우리가 연 업로드의 파일을 **휴지통으로**(영구 삭제 아님 — 잘못 판정해도 30일 안에 되살릴 수 있다). 번호 = 서버가 미리 받은 값이라
 * 남의 파일을 고를 길이 없다. 확인에 실패했거나 끊긴 링크로 끝까지 올라온 파일이 담임 폴더에 영상 이름을 달고 남지 않게
 * (적대 리뷰 2026-10-01). 이미 없으면(404) 그대로 성공. 그 밖의 실패는 던진다(호출부가 '실패'로 확정하지 않는다).
 */
export async function trashDriveFile(request: DriveRequest, id: string): Promise<void> {
  if (!DRIVE_ID_RE.test(id)) return;
  const response = await request(`${DRIVE_API}/files/${id}?supportsAllDrives=true&fields=id`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Drive 파일 휴지통 이동 실패(HTTP ${response.status})`);
}

/** 새 파일 번호를 미리 받는다 — 완료 확인을 브라우저 값이 아니라 이 번호로 한다. */
export async function generateDriveId(request: DriveRequest): Promise<string> {
  const body = await json<{ ids?: string[] }>(await request(`${DRIVE_API}/files/generateIds?count=1&space=drive&type=files`), "Drive 번호 발급");
  const id = body.ids?.[0];
  if (!id || !DRIVE_ID_RE.test(id)) throw new Error("Drive 번호를 받지 못했습니다.");
  return id;
}

/** 담임 폴더 찾기(등록부에 없을 때) — 워커와 같은 표식(appProperties.aywaTeacher). 여러 개면 사람이 봐야 한다. */
export async function findTeacherFolder(request: DriveRequest, rootId: string, key: string): Promise<DriveFile | null> {
  if (!DRIVE_ID_RE.test(rootId) || !/^[0-9a-f-]{36}:[0-9]+:([0-9a-f-]{36}|unassigned)$/i.test(key)) throw new Error("담임 폴더 열쇠가 올바르지 않습니다.");
  const query = new URLSearchParams({
    q: `'${rootId}' in parents and trashed = false and appProperties has { key='aywaTeacher' and value='${key}' }`,
    fields: `files(${FOLDER_FIELDS}),nextPageToken`, pageSize: "2", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  const found = await json<{ files?: DriveFile[]; nextPageToken?: string }>(await request(`${DRIVE_API}/files?${query}`), "담임 폴더 검색");
  if (found.nextPageToken || (found.files?.length ?? 0) > 1) throw new Error("같은 담임의 자동 폴더가 여러 개여서 확인이 필요합니다.");
  return found.files?.[0] ?? null;
}

/** 정해 둔 번호로 담임 폴더를 만든다(워커와 같은 표식). 이미 있으면(409 — 워커가 같은 번호로 먼저 만들었다) 그대로 둔다. */
export async function createTeacherFolder(request: DriveRequest, input: { id: string; name: string; rootId: string; key: string }): Promise<void> {
  const response = await request(`${DRIVE_API}/files?supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: input.id, name: input.name, mimeType: FOLDER_MIME, parents: [input.rootId], appProperties: { aywaTeacher: input.key } }),
  });
  if (!response.ok && response.status !== 409) throw new Error(`담임 폴더 만들기 실패(HTTP ${response.status})`);
}

/**
 * 재개 가능 업로드 세션 — 메타데이터(번호·이름·폴더·표식)는 **여기서 서버가 정한다**. 브라우저는 받은 세션 주소로 바이트만 보낸다.
 * `Origin`을 실어야 Google이 그 출처의 브라우저 PUT을 CORS로 받아 준다. 크기는 `X-Upload-Content-Length`로 못박는다(상한은 호출부 — `HOMEWORK_VIDEO_MAX_BYTES`).
 * appProperties `aywaSource=link`·`aywaUpload=<업로드 번호>` — 완료 확인의 대조 근거이자, 나중에 압축 워커가 표시를 더할 자리(막지 않는다).
 */
export async function startResumableSession(request: DriveRequest, input: {
  fileId: string; name: string; mimeType: string; bytes: number; folderId: string; origin: string; uploadId: string;
}): Promise<string> {
  const response = await request(`${DRIVE_UPLOAD_API}?uploadType=resumable&supportsAllDrives=true&fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8", Origin: input.origin,
      "X-Upload-Content-Type": input.mimeType, "X-Upload-Content-Length": String(input.bytes),
    },
    body: JSON.stringify({
      id: input.fileId, name: input.name, mimeType: input.mimeType, parents: [input.folderId],
      appProperties: { aywaSource: "link", aywaUpload: input.uploadId },
    }),
  });
  if (!response.ok) throw new Error(`Drive 업로드 시작 실패(HTTP ${response.status})`);
  const session = response.headers.get("location");
  if (!session || new URL(session).origin !== "https://www.googleapis.com") throw new Error("Drive 업로드 세션 응답이 올바르지 않습니다.");
  return session;
}
