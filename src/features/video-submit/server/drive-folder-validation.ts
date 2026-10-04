import "server-only";
import { DRIVE_ID_RE } from "./drive-config";
import { DRIVE_API, FOLDER_MIME, getDriveFile, type DriveFile, type DriveRequest } from "./drive-api";

/** 화면에 전달해도 되는 고정 안내 문장만 이 오류를 사용한다. */
export class VideoFolderValidationError extends Error {}

export type VerifiedFolder = {
  folderName: string;
  /** 폴더 자신부터 맨 위까지 — 다른 지점 폴더와 위·아래로 겹치는지 DB가 이 목록으로 본다. */
  ancestorIds: string[];
  /** 경로가 **그 계정의 내 드라이브 맨 위(또는 공유 드라이브 맨 위)까지 끊기지 않고 이어졌나**. */
  chainComplete: boolean;
};

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

/** 그 계정의 내 드라이브 맨 위 폴더 번호. */
async function myDriveRootId(request: DriveRequest): Promise<string> {
  const response = await request(`${DRIVE_API}/files/root?fields=id`);
  if (!response.ok) throw new Error("내 드라이브를 확인하지 못했습니다.");
  const id = ((await response.json()) as { id?: unknown }).id;
  if (typeof id !== "string" || !DRIVE_ID_RE.test(id)) throw new Error("내 드라이브를 확인하지 못했습니다.");
  return id;
}

/**
 * 부모 전체를 확인한다 — 빈 하위 폴더를 다른 지점 루트 안에 등록하는 것을 막으려면 맨 위까지의 경로가 필요하다.
 *
 * 🔴 `chainComplete`: 다른 계정이 **공유해 준 폴더**는 그 위 폴더가 이 계정에 보이지 않아 경로가 중간에서 끊긴다. 그러면 그 폴더가
 *    다른 지점 저장 폴더의 안쪽이어도 겹침을 알 수 없다(남의 지점 훑기가 이 지점 파일을 읽게 된다). 그래서 경로의 끝이
 *    **이 계정의 내 드라이브 맨 위**이거나 공유 드라이브의 맨 위일 때만 온전한 경로로 본다.
 * `request`는 **그 폴더를 가진 계정의 자격**이어야 한다 — 다른 계정의 폴더를 이 함수로 읽지 않는다.
 */
export async function verifyVideoFolder(request: DriveRequest, rootId: string, writable = false): Promise<VerifiedFolder> {
  const ancestorIds: string[] = [];
  let current: string | undefined = rootId;
  let folderName = "";
  let top: DriveFile | null = null;
  while (current) {
    if (ancestorIds.includes(current) || ancestorIds.length >= 64) throw new VideoFolderValidationError("폴더 경로를 확인할 수 없습니다.");
    const file = await getDriveFile(request, current, true);
    if (!file || file.trashed || file.mimeType !== FOLDER_MIME) throw new VideoFolderValidationError("사용할 수 있는 Drive 폴더를 지정해 주세요.");
    if (current === rootId) {
      if (writable && file.capabilities?.canAddChildren !== true) throw new VideoFolderValidationError("연결한 계정이 파일을 추가할 수 있는 폴더를 지정해 주세요.");
      folderName = file.name ?? rootId;
    }
    ancestorIds.push(current);
    if ((file.parents?.length ?? 0) > 1) throw new VideoFolderValidationError("폴더 경로를 확인할 수 없습니다.");
    top = file;
    current = file.parents?.[0];
  }
  // 공유 드라이브의 맨 위 폴더는 번호가 드라이브 번호와 같다. 그 밖에는 내 드라이브 맨 위여야 한다.
  const chainComplete = !!top && (top.driveId ? top.id === top.driveId : top.id === (await myDriveRootId(request)));
  return { folderName, ancestorIds, chainComplete };
}

/** 새로 정하는 저장 폴더는 온전한 경로여야 한다 — 공유받은 폴더(위가 안 보이는 폴더)는 거절한다. */
export function requireCompleteChain(folder: VerifiedFolder): void {
  if (!folder.chainComplete)
    throw new VideoFolderValidationError("연결한 Google 계정의 내 드라이브 안에 있는 폴더를 지정해 주세요. 다른 계정이 공유해 준 폴더는 저장 폴더로 쓸 수 없습니다.");
}

export async function requireEmptyVideoFolder(request: DriveRequest, rootId: string): Promise<void> {
  if (!DRIVE_ID_RE.test(rootId)) throw new Error("폴더 번호가 올바르지 않습니다.");
  const params = new URLSearchParams({ q: `'${rootId}' in parents and trashed=false`, pageSize: "1", fields: "files(id),nextPageToken", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const response = await request(`${DRIVE_API}/files?${params}`);
  if (!response.ok) throw new Error("폴더 내용을 확인하지 못했습니다. 연결 권한을 확인해 주세요.");
  const result = await response.json() as { files?: { id: string }[]; nextPageToken?: string };
  if (result.files?.length || result.nextPageToken) throw new VideoFolderValidationError("새로 연결할 폴더는 비어 있어야 합니다. 지점 전용 빈 폴더를 지정해 주세요.");
}
