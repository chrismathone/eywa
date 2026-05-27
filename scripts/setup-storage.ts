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
