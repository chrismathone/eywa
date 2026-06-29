import "server-only";
import { Storage, type File } from "@google-cloud/storage";

// ijw Firebase(GCS) Storage 클라이언트 — read/write/delete 공유 싱글톤.
// (legacy-audio.ts에서 추출 — 서비스계정 키 파싱은 google-sheets.ts와 동일 포맷: JSON 또는 base64.)

const DEFAULT_FIREBASE_BUCKET = "ijw-calander.firebasestorage.app";

let gcs: Storage | null = null;

export function getGcsClient(): Storage {
  if (gcs) return gcs;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "미디어 스토리지(Firebase) 자격증명(FIREBASE_SERVICE_ACCOUNT_KEY)이 설정되지 않았습니다. 관리자에게 문의하세요.",
    );
  }
  let jsonStr = raw.trim();
  if (!jsonStr.startsWith("{")) jsonStr = Buffer.from(jsonStr, "base64").toString("utf-8");
  const creds = JSON.parse(jsonStr) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  gcs = new Storage({
    projectId: creds.project_id,
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
  });
  return gcs;
}

export function getGcsBucketName(): string {
  return process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_BUCKET;
}

/** 버킷 내 객체 핸들(read/write/delete/metadata 공용). */
export function gcsFile(path: string): File {
  return getGcsClient().bucket(getGcsBucketName()).file(path);
}
