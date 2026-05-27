CREATE TYPE "public"."meeting_processing_status" AS ENUM('idle', 'uploaded', 'transcribing', 'analyzing', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "meeting_minutes" ALTER COLUMN "content" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "audio_path" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "audio_duration_sec" integer;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "audio_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "transcription" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "speaker_labels" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "processing_status" "meeting_processing_status" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "assemblyai_transcript_id" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "ai_report" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "ai_speaker_roles" jsonb;--> statement-breakpoint
CREATE INDEX "mm_assemblyai_transcript_idx" ON "meeting_minutes" USING btree ("assemblyai_transcript_id");