import "server-only";
import { Storage } from "@google-cloud/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyAudioPath,
  SUPABASE_BUCKET_BY_KIND,
  type AudioKind,
} from "./legacy-audio-path";

// 오디오 재처리용 fetch 가능한 signed URL 생성(IO). 순수 판별은 legacy-audio-path.ts.
// - tenant 경로(신규 Supabase 업로드) → Supabase signed URL.
// - 레거시 Firebase 경로(옛 ijw 녹음, Storage 미이전) → Firebase(GCS) v4 signed URL.

// 큰 파일 + AssemblyAI 큐 지연을 고려해 2시간(전사 제출 후 fetch까지 여유).
const SIGNED_URL_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_FIREBASE_BUCKET = "ijw-calander.firebasestorage.app";

let gcs: Storage | null = null;

/** ijw Firebase(GCS) Storage 클라이언트 — 캐시 싱글톤(solapi 패턴). 키 포맷은 google-sheets.ts와 동일. */
function getGcsClient(): Storage {
  if (gcs) return gcs;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "레거시 녹음 접근용 Firebase 자격증명(FIREBASE_SERVICE_ACCOUNT_KEY)이 설정되지 않았습니다. 관리자에게 문의하세요.",
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

/**
 * 오디오 경로 → fetch 가능한 signed URL. tenant=Supabase / legacy=Firebase v4 / 그 외=throw.
 * ⚠️ **호출부(server action)는 반드시 try/catch로 감싸 `{ error }` 반환**할 것
 * (resolveAudioUrl이 throw하면 useActionState 에러표시가 안 됨).
 */
export async function resolveAudioUrl(
  path: string,
  kind: AudioKind,
  tenantId: string,
): Promise<string> {
  const cls = classifyAudioPath(path, kind, tenantId);

  if (cls === "tenant") {
    const bucket = SUPABASE_BUCKET_BY_KIND[kind];
    const { data, error } = await createAdminClient()
      .storage.from(bucket)
      .createSignedUrl(path, Math.floor(SIGNED_URL_TTL_MS / 1000));
    if (error || !data?.signedUrl) {
      throw new Error(`signed URL 생성 실패: ${error?.message ?? "unknown"}`);
    }
    return data.signedUrl;
  }

  if (cls === "legacy") {
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_BUCKET;
    const file = getGcsClient().bucket(bucketName).file(path);
    // ⚠️ exists() 선확인 — getSignedUrl은 객체가 없어도 URL을 만든다(나중에 AssemblyAI fetch에서 늦게 실패).
    // 보존기간 만료 등으로 삭제됐으면 즉시 명확히 알린다.
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(
        "원본 녹음 파일이 없습니다(보존기간 만료 등). 'AI 분석 다시 생성'으로 텍스트 기반 재분석을 사용하세요.",
      );
    }
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  }

  throw new Error("잘못된 오디오 경로입니다");
}
