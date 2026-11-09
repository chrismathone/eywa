import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUploadedSize } from "./upload-verify";
import {
  classifyAudioPath,
  isTenantAudioPath,
  isTenantBrandingPath,
  isTenantDocumentPath,
  isTenantReceiptPath,
  isTenantReportAttachmentPath,
  isTenantTextbookCoverPath,
  SUPABASE_BUCKET_BY_KIND,
  type AudioKind,
} from "./legacy-audio-path";
import type { MediaKind, UploadTicket } from "./types";
import { isReportVideoCT, REPORT_VIDEO_MAX_BYTES } from "@/features/onescreen/report-video";

// 단일 미디어 스토리지 — **Supabase Storage 전용**(2026-07-29). 옛 GCS(ijw Firebase) 분기는 제거했다:
// 그 프로젝트를 삭제해 `MEDIA_STORAGE_BACKEND=gcs`로 되돌리면 업로드·읽기가 전부 실패하는데, 코드만 보면
// 되돌릴 수 있는 안전장치처럼 보였다(= ClassNote Cloud Run 폴백과 같은 지뢰). 경로가 하나면 그 오해가 없다.
// ⚠️ 호출부(server action)는 throw를 try/catch로 `{error}` 변환.

const AUDIO_MAX = 100 * 1024 * 1024; // 100MB (원장 2026-09-10) — 🔴 클라 MAX_AUDIO_SIZE와 **같은 값**이어야 한다
const RECEIPT_MAX = 10 * 1024 * 1024; // 10MB
const BRANDING_MAX = 5 * 1024 * 1024; // 5MB
const TEXTBOOK_COVER_MAX = 5 * 1024 * 1024; // 5MB — 표지 사진 한 장(브랜딩과 같은 급)
const DOCUMENT_MAX = 20 * 1024 * 1024; // 20MB — 스캔 PDF 등 큰 서식 고려
// 보고서 첨부 = 영상 상한(100MB, 2026-11-06 영상 첨부). 영상 아닌 첨부의 20MB는 attachment-actions가 따로 거절한다
// (report-video.ts `REPORT_FILE_MAX_BYTES`) — 여기 값은 업로드 확인(verifyUploadedObject)의 바깥 상한이다.
const REPORT_ATTACHMENT_MAX = REPORT_VIDEO_MAX_BYTES;
const READ_TTL_MS = 2 * 60 * 60 * 1000; // 2h — AssemblyAI 큐+다운로드 여유
// 업로드 URL 수명은 Supabase createSignedUploadUrl 기본값을 따른다(옛 GCS signed PUT 15분 상수는 제거).

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
  /^audio\/(mpeg|mp4|m4a|x-m4a)$/.test(ct) ||
  isReportVideoCT(ct); // 영상(2026-11-06) — 한 장에 하나·100MB는 attachment-actions가 본다

type KindMeta = {
  /** 이 kind가 저장되는 Supabase Storage 버킷. */
  supabaseBucket: string;
  maxBytes: number;
  allowCT: (ct: string) => boolean;
  /** tenant 경로 형식 검증(순수). */
  validate: (path: string, tenantId: string) => boolean;
};

/** kind별 메타 — 오디오/영수증/브랜딩을 한 곳에서 분리(버킷·검증·크기·형식). */
export const MEDIA_KIND: Record<MediaKind, KindMeta> = {
  meeting: { supabaseBucket: SUPABASE_BUCKET_BY_KIND.meeting, maxBytes: AUDIO_MAX, allowCT: isAudioCT, validate: isTenantAudioPath},
  consultation: { supabaseBucket: SUPABASE_BUCKET_BY_KIND.consultation, maxBytes: AUDIO_MAX, allowCT: isAudioCT, validate: isTenantAudioPath},
  registration: { supabaseBucket: SUPABASE_BUCKET_BY_KIND.registration, maxBytes: AUDIO_MAX, allowCT: isAudioCT, validate: isTenantAudioPath},
  receipt: { supabaseBucket: "expense-receipts", maxBytes: RECEIPT_MAX, allowCT: isReceiptCT, validate: isTenantReceiptPath},
  branding: { supabaseBucket: "branding", maxBytes: BRANDING_MAX, allowCT: isImageCT, validate: isTenantBrandingPath},
  document: { supabaseBucket: "academy-documents", maxBytes: DOCUMENT_MAX, allowCT: isDocumentCT, validate: isTenantDocumentPath},
  report_attachment: { supabaseBucket: "report-attachments", maxBytes: REPORT_ATTACHMENT_MAX, allowCT: isReportAttachmentCT, validate: isTenantReportAttachmentPath},
  // 교재 표지(0266a) — 사진만(jpeg/png/webp). svg/heic/gif 제외(보고서 첨부와 같은 기준).
  textbook_cover: { supabaseBucket: "textbook-covers", maxBytes: TEXTBOOK_COVER_MAX, allowCT: isReportImageCT, validate: isTenantTextbookCoverPath},
};

// ── 업로드 티켓 ──────────────────────────────────────────────

/**
 * 업로드 티켓 발급. ⚠️ path/권한/size는 **호출 server action이 이미 검증**한 뒤 부른다.
 * Supabase `createSignedUploadUrl` — 클라는 `bucket`+`token`으로 `uploadToSignedUrl`.
 */
export async function createUploadTicket(args: {
  kind: MediaKind;
  path: string;
  contentType: string;
  /** 같은 경로 덮어쓰기 허용 — **결정적 경로**(같은 원본을 다시 만들어 올리는 경우)에만. 없으면 "이미 존재" 오류. */
  upsert?: boolean;
}): Promise<UploadTicket> {
  const bucket = MEDIA_KIND[args.kind].supabaseBucket;
  const { data, error } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUploadUrl(args.path, args.upsert ? { upsert: true } : undefined);
  if (error || !data?.signedUrl) {
    throw new Error(`업로드 URL 생성 실패: ${error?.message ?? "unknown"}`);
  }
  return { uploadUrl: data.signedUrl, path: args.path, bucket, token: data.token };
}

/**
 * 업로드 직후 객체 진실성 검증(P1) — 클라가 올린 **실제 객체**를 서버가 다시 확인한다.
 * 부재/크기 위반이면 throw(호출부가 removeObject로 cleanup). 반환 size는 메타 실값(DB 저장용 신뢰값).
 *
 * 🔴 **부재는 반드시 차단한다**(2026-07-29 적대 검증 P1): 업로드 티켓은 register 호출과 무관하게 유효하므로,
 * "업로드하지 않고 register만" 부르면 검증을 통째로 우회해 DB 행부터 만들 수 있다. 옛 GCS 분기의 `exists()`
 * 강제가 그 구멍을 막고 있었고, 여기서 그대로 이어받는다. Supabase list는 강한 일관성이라 지연 걱정도 없다.
 *
 * ⚠️ **MIME은 강제하지 않는다**(같은 검증 P1): Supabase에 기록되는 mimetype은 서버가 승인한 contentType이
 * 아니라 **클라 File.type**이다(storage-js uploadToSignedUrl은 File 본문에서 fileOptions.contentType을 쓰지
 * 않는다). MediaRecorder가 오디오 전용 녹음도 `video/webm`으로 뱉는 등 실제 타입이 흔들려, 여기서 allowCT를
 * 강제하면 **정상 업로드를 거부하고 호출부가 그 파일을 지운다**(녹음 소실). 형식 관문은 버킷의
 * `allowed_mime_types`(setup-storage.ts)가 담당하고, 여기서는 관측값으로만 돌려준다.
 */
export async function verifyUploadedObject(
  kind: MediaKind,
  path: string,
): Promise<{ size: number; contentType: string }> {
  const meta = MEDIA_KIND[kind];
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const { data, error } = await createAdminClient()
    .storage.from(meta.supabaseBucket)
    .list(dir, { search: name, limit: 100 });
  if (error) throw new Error(`업로드 확인 실패: ${error.message}`);
  const found = data?.find((o) => o.name === name);
  if (!found) throw new Error("업로드된 파일을 찾을 수 없습니다");
  const md = found.metadata as { size?: number; mimetype?: string } | null;
  const size = Number(md?.size ?? 0);
  const contentType = String(md?.mimetype ?? "");
  if (!assertUploadedSize(size, meta.maxBytes)) {
    throw new Error("업로드 파일 크기가 허용 범위를 벗어났습니다");
  }
  return { size, contentType };
}

// ── 읽기(signed GET URL) ─────────────────────────────────────
// downloadName을 주면 attachment disposition으로 서명 → 브라우저가 미리보기 대신 파일로 저장한다.
// 🔴 **파일명을 이 인자에 의존하지 말 것**(2026-08-17 실측): Content-Disposition은 Supabase storage-api가
// 만들고, 그 구현은 `filename=<encodeURIComponent(이름)>; filename*=UTF-8''<같은 값>`이라 ① 폴백이
// percent-encoded 원문이고 ② RFC 5987 비-attr-char(`*'()`)가 인코딩되지 않는다 → `filename*`을 못 읽는
// 브라우저가 `%EA%B9%80…pdf`를 그대로 저장한다(원장 제보). 저장 이름이 중요한 표면은 클라에서
// [`saveFileAs`](src/lib/http/download-file.ts)로 blob+`a.download` 저장 — 여기서는 "미리보기 대신 저장"만 담당.
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
 * 오디오 fetch용 signed GET URL — tenant/legacy 모두 **현 백엔드**를 따른다.
 * (legacy-audio.ts resolveAudioUrl 본체 이전·일반화. AssemblyAI가 이 URL을 fetch.)
 * legacy(옛 ijw 경로)는 2026-07-28 ijw 소등 이전 때 Supabase kind 버킷에 **원경로 그대로**(한글
 * 파일명만 b64_ 인코딩·DB 재작성) 복사됨 — supabase 백엔드에선 같은 경로를 kind 버킷에서 서명한다.
 */
export async function resolveAudioReadUrl(
  path: string,
  kind: AudioKind,
  tenantId: string,
  ttlMs: number = READ_TTL_MS,
): Promise<string> {
  const cls = classifyAudioPath(path, kind, tenantId);
  if (cls === "invalid") throw new Error("잘못된 오디오 경로입니다");
  // tenant=`{tenantId}/{uuid.ext}` · legacy=`{kind}-recordings/{파일명}` — 키 모양만 다르고
  // supabase에선 둘 다 kind 버킷 안 원경로 키라 같은 분기로 서명한다.
  return supabaseSignedRead(SUPABASE_BUCKET_BY_KIND[kind], path, ttlMs);
}

/** 이미지·문서(영수증/브랜딩/서식/보고서첨부) signed GET URL — legacy 없음, tenant 전용. downloadName=attachment 저장. */
export async function resolveTenantReadUrl(
  path: string,
  kind: "receipt" | "branding" | "document" | "report_attachment" | "textbook_cover",
  tenantId: string,
  ttlMs: number = READ_TTL_MS,
  downloadName?: string,
): Promise<string> {
  if (!MEDIA_KIND[kind].validate(path, tenantId)) throw new Error("잘못된 파일 경로입니다");
  return supabaseSignedRead(MEDIA_KIND[kind].supabaseBucket, path, ttlMs, downloadName);
}

/**
 * 로고/직인 표시용 src — 빈 값=null, http(s)=그대로(외부 URL 하위호환), 그 외=branding 경로로 보고 signed URL.
 * 인쇄 서버컴포넌트가 `<img src>`에 쓴다(비공개 버킷 path를 직접 못 쓰므로 resolve).
 */
export async function resolveBrandingSrc(
  value: string | null | undefined,
  tenantId: string,
  ttlMs: number = READ_TTL_MS,
): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  // 사이트 내부 정적 파일(`/manuals/...` 등 public/) — 도메인이 바뀌어도 따라오게 경로 그대로 쓴다.
  // (Storage 경로로 오해해 서명 시도 → 실패 → null이 되면 이미지가 조용히 사라진다.)
  if (value.startsWith("/")) return value;
  try {
    return await resolveTenantReadUrl(value, "branding", tenantId, ttlMs);
  } catch {
    return null;
  }
}

/** 복수 영수증·첨부 등 — path→signed URL 맵(실패 path는 생략). */
export async function resolveTenantReadUrls(
  paths: string[],
  kind: "receipt" | "branding" | "document" | "report_attachment" | "textbook_cover",
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
/** 객체 삭제(best-effort) — bucket 없으면 no-op(호출부가 kind 버킷을 넘긴다). */
export async function removeObject(path: string, opts: { bucket?: string } = {}): Promise<void> {
  if (!opts.bucket) return;
  await createAdminClient().storage.from(opts.bucket).remove([path]);
}
