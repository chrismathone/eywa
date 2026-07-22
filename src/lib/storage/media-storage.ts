import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { getMediaBackend } from "./backend";
import { gcsFile } from "./gcs-client";
import {
  classifyAudioPath,
  isTenantAudioPath,
  isTenantBrandingPath,
  isTenantDocumentPath,
  isTenantReceiptPath,
  isTenantReportAttachmentPath,
  SUPABASE_BUCKET_BY_KIND,
  type AudioKind,
} from "./legacy-audio-path";
import type { MediaKind, StorageBackend, UploadTicket } from "./types";

// 단일 미디어 스토리지 추상화 — 신규 업로드를 GCS(ijw Firebase) 또는 Supabase로 라우팅.
// 백엔드는 env MEDIA_STORAGE_BACKEND(기본 gcs). 추상화 덕에 추후 Supabase 스왑은 flag 한 줄.
// ⚠️ 호출부(server action)는 throw를 try/catch로 `{error}` 변환.

const AUDIO_MAX = 50 * 1024 * 1024; // 50MB (클라 validateAudioFile과 동일 — 필요 시 함께 상향)
const RECEIPT_MAX = 10 * 1024 * 1024; // 10MB
const BRANDING_MAX = 5 * 1024 * 1024; // 5MB
const DOCUMENT_MAX = 20 * 1024 * 1024; // 20MB — 스캔 PDF 등 큰 서식 고려
const REPORT_ATTACHMENT_MAX = 20 * 1024 * 1024; // 20MB — 학생 풀이 사진 + 문서/오디오 첨부(pdf·hwp·office·mp3)
const READ_TTL_MS = 2 * 60 * 60 * 1000; // 2h — AssemblyAI 큐+다운로드 여유
const UPLOAD_TTL_MS = 15 * 60 * 1000; // 15m — signed PUT 유효

const isAudioCT = (ct: string) => /^audio\//.test(ct);
const isImageCT = (ct: string) => /^image\//.test(ct);
const isReceiptCT = (ct: string) => /^image\//.test(ct) || ct === "application/pdf";
// 보고서 첨부 이미지 — 사진만(jpeg/png/webp). svg/heic/gif 제외(보안·ClassNote 스샷 품질).
const isReportImageCT = (ct: string) => ct === "image/jpeg" || ct === "image/png" || ct === "image/webp";
// 서식 문서 — 이미지·PDF(향후 OCR 대상) + 오피스 문서 + HWP(흔히 CT가 애매해 octet-stream 폴백 허용).
const DOCUMENT_CT_ALLOW = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/haansofthwp",
  "application/x-hwp",
  "application/octet-stream",
]);
const isDocumentCT = (ct: string) => /^image\//.test(ct) || DOCUMENT_CT_ALLOW.has(ct);
// 보고서 첨부 = 사진(jpeg/png/webp) + 문서(pdf·word·excel·ppt·hwp·octet-stream) + 오디오(mp3·m4a). ClassNote 첨부파일 슬롯과 정렬.
// ⚠️ Supabase 백엔드는 버킷 allowed_mime_types도 이 집합과 일치해야 함(scripts/setup-storage.ts REPORT_ATTACHMENT_MIME_TYPES).
const isReportAttachmentCT = (ct: string) =>
  isReportImageCT(ct) ||
  DOCUMENT_CT_ALLOW.has(ct) ||
  ct === "application/vnd.ms-powerpoint" ||
  ct === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
  /^audio\/(mpeg|mp4|m4a|x-m4a)$/.test(ct);

type KindMeta = {
  /** Supabase 백엔드 버킷(GCS 백엔드는 단일 버킷이라 미사용). */
  supabaseBucket: string;
  maxBytes: number;
  allowCT: (ct: string) => boolean;
  /** tenant 경로 형식 검증(순수). */
  validate: (path: string, tenantId: string) => boolean;
  /** 레거시 Firebase prefix를 갖는가(오디오만 true — 옛 ijw 녹음). */
  hasLegacy: boolean;
};

/** kind별 메타 — 오디오/영수증/브랜딩을 한 곳에서 분리(버킷·검증·크기·형식). */
export const MEDIA_KIND: Record<MediaKind, KindMeta> = {
  meeting: { supabaseBucket: SUPABASE_BUCKET_BY_KIND.meeting, maxBytes: AUDIO_MAX, allowCT: isAudioCT, validate: isTenantAudioPath, hasLegacy: true },
  consultation: { supabaseBucket: SUPABASE_BUCKET_BY_KIND.consultation, maxBytes: AUDIO_MAX, allowCT: isAudioCT, validate: isTenantAudioPath, hasLegacy: true },
  registration: { supabaseBucket: SUPABASE_BUCKET_BY_KIND.registration, maxBytes: AUDIO_MAX, allowCT: isAudioCT, validate: isTenantAudioPath, hasLegacy: true },
  receipt: { supabaseBucket: "expense-receipts", maxBytes: RECEIPT_MAX, allowCT: isReceiptCT, validate: isTenantReceiptPath, hasLegacy: false },
  branding: { supabaseBucket: "branding", maxBytes: BRANDING_MAX, allowCT: isImageCT, validate: isTenantBrandingPath, hasLegacy: false },
  document: { supabaseBucket: "academy-documents", maxBytes: DOCUMENT_MAX, allowCT: isDocumentCT, validate: isTenantDocumentPath, hasLegacy: false },
  report_attachment: { supabaseBucket: "report-attachments", maxBytes: REPORT_ATTACHMENT_MAX, allowCT: isReportAttachmentCT, validate: isTenantReportAttachmentPath, hasLegacy: false },
};

export { getMediaBackend }; // backend.ts(순수)에서 — 호출부는 media-storage에서 계속 import 가능.

// ── 업로드 티켓 ──────────────────────────────────────────────
/**
 * 업로드 티켓 발급. ⚠️ path/권한/size는 **호출 server action이 이미 검증**한 뒤 부른다.
 * GCS=v4 signed PUT(+contentType 서명, 클라가 동일 헤더로 PUT). Supabase=createSignedUploadUrl.
 */
export async function createUploadTicket(args: {
  kind: MediaKind;
  path: string;
  contentType: string;
  /**
   * 같은 경로 덮어쓰기 허용 — **결정적 경로**(같은 원본을 다시 만들어 올리는 경우)에만.
   * GCS signed PUT은 원래 덮어쓰지만 Supabase는 이 옵션 없이는 "이미 존재" 오류가 난다(백엔드 스왑 대비).
   */
  upsert?: boolean;
}): Promise<UploadTicket> {
  const backend = getMediaBackend();
  if (backend === "gcs") {
    const [uploadUrl] = await gcsFile(args.path).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + UPLOAD_TTL_MS,
      contentType: args.contentType,
    });
    return { backend, uploadUrl, path: args.path, headers: { "Content-Type": args.contentType } };
  }
  const bucket = MEDIA_KIND[args.kind].supabaseBucket;
  const { data, error } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUploadUrl(args.path, args.upsert ? { upsert: true } : undefined);
  if (error || !data?.signedUrl) {
    throw new Error(`업로드 URL 생성 실패: ${error?.message ?? "unknown"}`);
  }
  return { backend, uploadUrl: data.signedUrl, path: args.path, bucket, token: data.token };
}

/**
 * 업로드 직후 객체 진실성 검증(P1) — GCS signed PUT은 size/MIME를 자동검증하지 않으므로
 * exists·size≤max·contentType∈allowCT를 서버가 확인. 위반/부재면 throw(호출부가 removeObject로 cleanup).
 * 반환 size는 메타데이터 실값(DB 저장에 신뢰값으로 사용).
 */
export async function verifyUploadedObject(
  kind: MediaKind,
  path: string,
): Promise<{ size: number; contentType: string }> {
  const meta = MEDIA_KIND[kind];
  if (getMediaBackend() === "gcs") {
    const file = gcsFile(path);
    const [exists] = await file.exists();
    if (!exists) throw new Error("업로드된 파일을 찾을 수 없습니다");
    const [md] = await file.getMetadata();
    const size = Number(md.size ?? 0);
    const contentType = String(md.contentType ?? "");
    if (size <= 0 || size > meta.maxBytes) {
      throw new Error("업로드 파일 크기가 허용 범위를 벗어났습니다");
    }
    if (!meta.allowCT(contentType)) {
      throw new Error(`허용되지 않는 파일 형식입니다: ${contentType || "unknown"}`);
    }
    return { size, contentType };
  }
  // Supabase 백엔드: RLS+클라 contentType로 1차 제약 — best-effort(엄격 검증은 GCS 분기).
  return { size: 0, contentType: "" };
}

// ── 읽기(signed GET URL) ─────────────────────────────────────
// downloadName을 주면 attachment disposition으로 서명 → 브라우저가 미리보기 대신 그 파일명으로 저장.
// (한글 파일명은 attachmentFilename이 RFC 5987로 안전 인코딩 — B1 헤더 규칙.)
async function gcsSignedRead(path: string, ttlMs: number, downloadName?: string): Promise<string> {
  const file = gcsFile(path);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(
      "원본 파일이 없습니다(보존기간 만료 등). 'AI 분석 다시 생성'으로 텍스트 기반 재분석을 사용하세요.",
    );
  }
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + ttlMs,
    ...(downloadName ? { responseDisposition: attachmentFilename(downloadName) } : {}),
  });
  return url;
}

async function supabaseSignedRead(
  bucket: string,
  path: string,
  ttlMs: number,
  downloadName?: string,
): Promise<string> {
  const { data, error } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUrl(path, Math.floor(ttlMs / 1000), downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) {
    throw new Error(`signed URL 생성 실패: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

/**
 * 오디오 fetch용 signed GET URL — tenant=현 백엔드 / legacy(옛 ijw)=항상 GCS.
 * (legacy-audio.ts resolveAudioUrl 본체 이전·일반화. AssemblyAI가 이 URL을 fetch.)
 */
export async function resolveAudioReadUrl(
  path: string,
  kind: AudioKind,
  tenantId: string,
  ttlMs: number = READ_TTL_MS,
): Promise<string> {
  const cls = classifyAudioPath(path, kind, tenantId);
  if (cls === "tenant") {
    return getMediaBackend() === "gcs"
      ? gcsSignedRead(path, ttlMs)
      : supabaseSignedRead(SUPABASE_BUCKET_BY_KIND[kind], path, ttlMs);
  }
  if (cls === "legacy") return gcsSignedRead(path, ttlMs); // 옛 ijw 녹음은 항상 GCS
  throw new Error("잘못된 오디오 경로입니다");
}

/** 이미지·문서(영수증/브랜딩/서식/보고서첨부) signed GET URL — legacy 없음, tenant 전용. downloadName=attachment 저장. */
export async function resolveTenantReadUrl(
  path: string,
  kind: "receipt" | "branding" | "document" | "report_attachment",
  tenantId: string,
  ttlMs: number = READ_TTL_MS,
  downloadName?: string,
): Promise<string> {
  if (!MEDIA_KIND[kind].validate(path, tenantId)) throw new Error("잘못된 파일 경로입니다");
  return getMediaBackend() === "gcs"
    ? gcsSignedRead(path, ttlMs, downloadName)
    : supabaseSignedRead(MEDIA_KIND[kind].supabaseBucket, path, ttlMs, downloadName);
}

/**
 * 로고/직인 표시용 src — 빈 값=null, http(s)=그대로(외부 URL 하위호환), 그 외=branding 경로로 보고 signed URL.
 * 인쇄 서버컴포넌트가 `<img src>`에 쓴다(GCS 비공개 path를 직접 못 쓰므로 resolve).
 */
export async function resolveBrandingSrc(
  value: string | null | undefined,
  tenantId: string,
  ttlMs: number = READ_TTL_MS,
): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  try {
    return await resolveTenantReadUrl(value, "branding", tenantId, ttlMs);
  } catch {
    return null;
  }
}

/** 복수 영수증·첨부 등 — path→signed URL 맵(실패 path는 생략). */
export async function resolveTenantReadUrls(
  paths: string[],
  kind: "receipt" | "branding" | "document" | "report_attachment",
  tenantId: string,
  ttlMs: number = READ_TTL_MS,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    paths.map(async (p): Promise<[string, string] | null> => {
      try {
        return [p, await resolveTenantReadUrl(p, kind, tenantId, ttlMs)];
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));
}

// ── 삭제 ─────────────────────────────────────────────────────
/** 객체 삭제(best-effort). gcs=file.delete(ignoreNotFound) / supabase=bucket.remove. */
export async function removeObject(
  path: string,
  opts: { backend?: StorageBackend; bucket?: string } = {},
): Promise<void> {
  const backend = opts.backend ?? getMediaBackend();
  if (backend === "gcs") {
    await gcsFile(path).delete({ ignoreNotFound: true });
  } else if (opts.bucket) {
    await createAdminClient().storage.from(opts.bucket).remove([path]);
  }
}
