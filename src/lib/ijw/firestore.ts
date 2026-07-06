import "server-only";
import { Firestore } from "@google-cloud/firestore";

/**
 * ijw-calander Firestore 클라이언트 (eywa → ijw 시간표 동기화 전용 싱글톤).
 *
 * - ijw는 **비(非)default 데이터베이스** `restore20260319`를 쓰므로 databaseId를 반드시 지정.
 * - 자격증명은 `gcs-client.ts`/`google-sheets.ts`와 동일하게 `FIREBASE_SERVICE_ACCOUNT_KEY`
 *   (JSON 또는 base64)를 파싱 — 이 키는 ijw-calander 프로젝트의 firebase-adminsdk 서비스계정이라
 *   ijw Firestore에 대한 관리자(Admin) 읽기/쓰기 권한을 가진다.
 * - server-only: 브라우저 번들에 절대 포함되지 않는다.
 */
const IJW_DATABASE_ID = "restore20260319";

let fs: Firestore | null = null;

export function getIjwFirestore(): Firestore {
  if (fs) return fs;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "ijw 자격증명(FIREBASE_SERVICE_ACCOUNT_KEY)이 설정되지 않았습니다 — ijw 동기화 불가.",
    );
  }
  let jsonStr = raw.trim();
  if (!jsonStr.startsWith("{")) jsonStr = Buffer.from(jsonStr, "base64").toString("utf-8");
  const creds = JSON.parse(jsonStr) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  fs = new Firestore({
    projectId: creds.project_id,
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    databaseId: IJW_DATABASE_ID,
  });
  return fs;
}
