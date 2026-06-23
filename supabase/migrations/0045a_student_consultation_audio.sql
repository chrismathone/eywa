-- 0045a: student_consultations 음성→전사→AI 파이프라인 컬럼 (재원생 학생상담 녹음)
-- enrollment_consultations / meeting_minutes 오디오 파이프라인을 재원생 학생상담에 이식.
-- 상태 enum(consultation_processing_status)·버킷(consultation-recordings)·웹훅은 기존 것 재사용.
-- RLS는 student_consultations 기존 tenant_isolation 정책 상속(신규 정책 불요). 멱등.

alter table public.student_consultations
  add column if not exists audio_path text,
  add column if not exists audio_duration_sec integer,
  add column if not exists audio_size_bytes integer,
  add column if not exists transcription text,
  add column if not exists speaker_labels jsonb,
  add column if not exists processing_status public.consultation_processing_status not null default 'idle',
  add column if not exists processing_error text,
  add column if not exists assemblyai_transcript_id text,
  add column if not exists ai_report jsonb,
  add column if not exists ai_summary text,
  add column if not exists ai_model_version text,
  add column if not exists ai_generated_at timestamptz;

create index if not exists sc_assemblyai_transcript_idx
  on public.student_consultations (assemblyai_transcript_id);
