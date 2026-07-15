import "server-only";
import { Storage, type File } from "@google-cloud/storage";

// ijw Firebase(GCS) Storage 클라이언트 — read/write/delete 공유 싱글톤.
// (legacy-audio.ts에서 추출 — 서비스계정 키 파싱은 google-sheets.ts와 동일 포맷: JSON 또는 base64.)

// injaewon(단일 테넌트) 프로덕션 Firebase(GCS) 버킷. 현재 유일 테넌트엔 이 값이 정답이라 기본값으로 유지
// (app-url.ts와 달리 안전한 기본값 존재). ⚠️ 멀티테넌트 확장 시 이 폴백이 타 학원 미디어를 injaewon 버킷에
// 오적재할 수 있으므로, 그 시점엔 FIREBASE_STORAGE_BUCKET을 테넌트별 필수화(폴백 제거)할 것.
const INJAEWON_PROD_FIREBASE_BUCKET = "ijw-calander.firebasestorage.app";

let gcs: Storage | null = null;
let warnedBucketFallback = false;

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
  const explicit = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;
  if (!warnedBucketFallback) {
    warnedBucketFallback = true;
    console.warn(
      `[gcs] FIREBASE_STORAGE_BUCKET 미설정 — injaewon 기본 버킷(${INJAEWON_PROD_FIREBASE_BUCKET})으로 폴백. ` +
        `멀티테넌트 배포라면 env로 버킷을 반드시 지정(교차 테넌트 오적재 위험).`,
    );
  }
  return INJAEWON_PROD_FIREBASE_BUCKET;
}

/** 버킷 내 객체 핸들(read/write/delete/metadata 공용). */
export function gcsFile(path: string): File {
  return getGcsClient().bucket(getGcsBucketName()).file(path);
}
