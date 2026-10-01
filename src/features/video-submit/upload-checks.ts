/**
 * 업로드 시작·완료의 **판정만**(순수) — 서버 라우트가 부르고 테스트가 잠근다.
 */
import { HOMEWORK_VIDEO_MAX_BYTES } from "@/features/students/homework-video-limits";

/** 시간당·하루 업로드 시작 상한(링크 하나) — 학부모가 몇 번 다시 해도 넉넉하고, 링크가 새도 Drive를 채우지 못하게. */
export const UPLOAD_STARTS_PER_HOUR = 10;
export const UPLOAD_STARTS_PER_DAY = 30;

/**
 * 업로드 세션을 열 출처 — Google이 이 출처의 브라우저 PUT만 CORS로 받아 준다. 요청이 온 그 사이트여야 한다
 * (남의 사이트가 우리 라우트를 불러 자기 출처로 세션을 받아 가지 못하게). https만, 개발 중 localhost는 http도.
 */
export function uploadOrigin(origin: string | null | undefined, host: string | null | undefined): string | null {
  if (!origin || !host) return null;
  try {
    const url = new URL(origin);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.host.toLowerCase() !== host.toLowerCase()) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export type StartedUpload = {
  id: string; drive_file_id: string; drive_folder_id: string; bytes: number; created_at: string;
};
export type UploadedDriveFile = {
  id?: string; size?: string; md5Checksum?: string; parents?: string[]; trashed?: boolean; appProperties?: Record<string, string>;
};

/**
 * 다 올라간 Drive 파일이 **서버가 연 그 세션의 결과**인가 — 번호·폴더·크기(세션에 못박은 값)·표식·해시.
 * 하나라도 다르면 영상 줄을 만들지 않는다(브라우저가 "끝났다"고 해도 Drive가 증거다). 틀리면 한글 사유, 맞으면 null.
 */
export function verifyUploadedFile(file: UploadedDriveFile, upload: StartedUpload): string | null {
  if (file.id !== upload.drive_file_id) return "다른 파일입니다.";
  if (file.trashed) return "휴지통에 있는 파일입니다.";
  if (!file.parents?.includes(upload.drive_folder_id)) return "담임 폴더에 없는 파일입니다.";
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size !== Number(upload.bytes)) return "올린 크기가 처음 알린 크기와 다릅니다.";
  if (size <= 0 || size > HOMEWORK_VIDEO_MAX_BYTES) return "허용 크기를 넘는 파일입니다.";
  if (file.appProperties?.aywaSource !== "link" || file.appProperties?.aywaUpload !== upload.id) return "제출 링크로 연 업로드가 아닙니다.";
  if (typeof file.md5Checksum !== "string" || !/^[0-9a-f]{32}$/.test(file.md5Checksum)) return UPLOAD_NOT_READY;
  return null;
}

/** 해시가 아직 안 채워졌다 — 실패가 아니라 '조금 뒤 다시'(Drive가 늦게 채우는 경우). */
export const UPLOAD_NOT_READY = "파일 확인값이 아직 없습니다.";

/**
 * 이 업로드를 마무리해도 되나 — 7일째 밤에 시작해 자정을 넘겨 끝난 업로드는 받는다(만료 전 시작).
 * 🔴 끊긴 링크는 **언제 시작했든** 받지 않는다 — '링크 끊기'는 "더 이상 올릴 수 없습니다"라고 약속한다(그 전에 열어 둔 세션도 막는다).
 */
export function startedWhileLinkOpen(upload: { created_at: string }, link: { expires_at: string; revoked_at: string | null }): boolean {
  const started = Date.parse(upload.created_at);
  if (link.revoked_at || !Number.isFinite(started)) return false;
  return started < Date.parse(link.expires_at);
}
