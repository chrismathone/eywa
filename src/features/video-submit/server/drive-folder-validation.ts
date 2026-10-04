import "server-only";
import { DRIVE_ID_RE } from "./drive-config";
import { DRIVE_API, FOLDER_MIME, getDriveFile, type DriveRequest } from "./drive-api";

/** 화면에 전달해도 되는 고정 안내 문장만 이 오류를 사용한다. */
export class VideoFolderValidationError extends Error {}

export function parseVideoFolder(input: string): string | null {
  const value = input.trim();
  if (value.length > 300) return null;
  if (DRIVE_ID_RE.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com") return null;
    const id = /^\/(?:drive\/(?:u\/\d+\/)?folders|folders)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    return id && DRIVE_ID_RE.test(id) ? id : null;
  } catch { return null; }
}

/** 부모 전체를 확인해야 빈 하위 폴더를 다른 지점 루트로 등록하는 것도 막을 수 있다. */
export async function verifyVideoFolder(request: DriveRequest, rootId: string, writable = false): Promise<{ folderName: string; ancestorIds: string[] }> {
  const ancestorIds: string[] = [];
  let current: string | undefined = rootId;
  let folderName = "";
  while (current) {
    if (ancestorIds.includes(current) || ancestorIds.length >= 64) throw new VideoFolderValidationError("폴더 경로를 확인할 수 없습니다.");
    const file = await getDriveFile(request, current, true);
    if (!file || file.trashed || file.mimeType !== FOLDER_MIME) throw new VideoFolderValidationError("사용할 수 있는 Drive 폴더를 지정해 주세요.");
    if (current === rootId) {
      if (writable && file.capabilities?.canAddChildren !== true) throw new VideoFolderValidationError("연동 계정이 파일을 추가할 수 있는 폴더를 지정해 주세요.");
      folderName = file.name ?? rootId;
    }
    ancestorIds.push(current);
    if ((file.parents?.length ?? 0) > 1) throw new VideoFolderValidationError("폴더 경로를 확인할 수 없습니다.");
    current = file.parents?.[0];
  }
  return { folderName, ancestorIds };
}

export async function requireEmptyVideoFolder(request: DriveRequest, rootId: string): Promise<void> {
  if (!DRIVE_ID_RE.test(rootId)) throw new Error("폴더 번호가 올바르지 않습니다.");
  const params = new URLSearchParams({ q: `'${rootId}' in parents and trashed=false`, pageSize: "1", fields: "files(id),nextPageToken", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const response = await request(`${DRIVE_API}/files?${params}`);
  if (!response.ok) throw new Error("폴더 내용을 확인하지 못했습니다. 연결 권한을 확인해 주세요.");
  const result = await response.json() as { files?: { id: string }[]; nextPageToken?: string };
  if (result.files?.length || result.nextPageToken) throw new VideoFolderValidationError("새로 연결할 폴더는 비어 있어야 합니다. 지점 전용 빈 폴더를 지정해 주세요.");
}
