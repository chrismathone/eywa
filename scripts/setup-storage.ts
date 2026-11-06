/**
 * Idempotent setup of Supabase Storage buckets for aywa.
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

// audio/* 와일드카드: 레거시 ijw 녹음의 `audio/webm;codecs=opus` 등 파라미터 변형 흡수.
// video/webm: MediaRecorder가 오디오 전용 녹음도 video/webm 컨테이너로 뱉는 경우(레거시 5건 실측).
const AUDIO_MIME_TYPES = ["audio/*", "video/webm"];

// 2026-07-28 유료 티어 전환 + ijw 레거시 녹음 이전(최대 119.7MB)으로 200MB로 상향.
// ⚠️ 프로젝트 전역 업로드 한도(Project Settings → Storage)가 이 값 이상이어야 updateBucket이 통과한다.
const AUDIO_SIZE_LIMIT = 200 * 1024 * 1024;

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
  // 영상(2026-11-06) — 보고서 한 장에 하나 · ClassNote 글의 영상 칸으로(src/features/onescreen/report-video.ts).
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
];
// 100 MB = 영상 상한(REPORT_VIDEO_MAX_BYTES) — 영상 아닌 첨부의 20MB는 앱(attachment-actions)이 따로 거절한다.
const REPORT_ATTACHMENT_SIZE_LIMIT = 100 * 1024 * 1024;

// 교재 표지 사진(0266a) — 사진만. 앱 isReportImageCT(media-storage.ts MEDIA_KIND.textbook_cover)와 **일치 필수**.
// 학생 PII는 아니지만 학원 자산이라 다른 버킷과 같이 비공개 + signed URL.
const TEXTBOOK_COVER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const TEXTBOOK_COVER_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB — 표지 한 장

// 영상 설명 AI 참고 메모(0390a) — 발송 PC가 뽑은 소리(mp3)·화면(jpg). 학생 목소리·얼굴이라 비공개 + signed URL.
// 경로·이름 규칙 = src/features/video-review/storage-paths.ts · 0390a 마이그레이션의 버킷 값과 같게.
const VIDEO_REVIEW_MIME_TYPES = ["audio/mpeg", "image/jpeg"];
const VIDEO_REVIEW_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB — 긴 영상의 소리 한 개

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
  {
    id: "textbook-covers",
    public: false,
    file_size_limit: TEXTBOOK_COVER_SIZE_LIMIT,
    allowed_mime_types: TEXTBOOK_COVER_MIME_TYPES,
  },  {
    id: "homework-video-review",
    public: false,
    file_size_limit: VIDEO_REVIEW_SIZE_LIMIT,
    allowed_mime_types: VIDEO_REVIEW_MIME_TYPES,
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
