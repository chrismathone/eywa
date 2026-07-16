/**
 * Idempotent setup of Supabase Storage buckets for eywa.
 *
 * Run: pnpm tsx scripts/setup-storage.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
];

const AUDIO_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB — Supabase free-tier per-file cap

// 지출결의서 증빙(영수증/세금계산서 등) — 이미지·PDF. 사적·재무 문서이므로 비공개 버킷 + signed URL로만 열람.
const RECEIPT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];
const RECEIPT_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB — 영수증 1장에 충분

// 수업 보고서 첨부 — 사진 + 문서/오디오(pdf·word·excel·ppt·hwp·mp3·m4a). ClassNote 첨부파일 슬롯 + 앱
// isReportAttachmentCT(src/lib/storage/media-storage.ts)와 **일치 필수**. 학생 PII라 비공개 + admin signed URL.
const REPORT_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/haansofthwp",
  "application/x-hwp",
  "application/octet-stream", // 한글/한셀/한쇼 등 브라우저가 타입 못 정하는 파일 폴백
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
];
const REPORT_ATTACHMENT_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB — 스캔 PDF 등

const BUCKETS = [
  {
    id: "meeting-recordings",
    public: false,
    file_size_limit: AUDIO_SIZE_LIMIT,
    allowed_mime_types: AUDIO_MIME_TYPES,
  },
  {
    id: "consultation-recordings",
    public: false,
    file_size_limit: AUDIO_SIZE_LIMIT,
    allowed_mime_types: AUDIO_MIME_TYPES,
  },
  {
    id: "expense-receipts",
    public: false,
    file_size_limit: RECEIPT_SIZE_LIMIT,
    allowed_mime_types: RECEIPT_MIME_TYPES,
  },
  {
    id: "report-attachments",
    public: false,
    file_size_limit: REPORT_ATTACHMENT_SIZE_LIMIT,
    allowed_mime_types: REPORT_ATTACHMENT_MIME_TYPES,
  },
];

async function main() {
  for (const cfg of BUCKETS) {
    const { data: existing } = await admin.storage.getBucket(cfg.id);
    if (existing) {
      console.log(`[skip] bucket already exists: ${cfg.id}`);
      const { error } = await admin.storage.updateBucket(cfg.id, {
        public: cfg.public,
        fileSizeLimit: cfg.file_size_limit,
        allowedMimeTypes: cfg.allowed_mime_types,
      });
      if (error) console.error(`  update failed: ${error.message}`);
      else console.log(`  updated config`);
      continue;
    }
    const { error } = await admin.storage.createBucket(cfg.id, {
      public: cfg.public,
      fileSizeLimit: cfg.file_size_limit,
      allowedMimeTypes: cfg.allowed_mime_types,
    });
    if (error) {
      console.error(`[fail] ${cfg.id}: ${error.message}`);
      process.exit(1);
    }
    console.log(`[ok] created bucket: ${cfg.id}`);
  }
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
