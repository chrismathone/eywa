CREATE TYPE "public"."consultation_processing_status" AS ENUM('idle', 'uploaded', 'transcribing', 'analyzing', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "audio_path" text;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "audio_duration_sec" integer;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "audio_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "transcription" text;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "speaker_labels" jsonb;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "processing_status" "consultation_processing_status" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD COLUMN "assemblyai_transcript_id" text;--> statement-breakpoint
CREATE INDEX "ec_assemblyai_transcript_idx" ON "enrollment_consultations" USING btree ("assemblyai_transcript_id");