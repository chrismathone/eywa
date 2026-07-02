-- 0068a_consultation_recordings.sql (손수 alpha)
-- 등록상담 녹음 = 여러 행 — 여러 상담사가 각자 녹음/업로드를 추가하고, 각 녹음이 독립 전사된다.
-- (사용자 결정 2026-07-02: "녹음파일들이 행으로 남아있으면 되겠어")
--
-- 모델:
--  · consultation_recordings 1행 = 녹음 1개(오디오 + 전사 + 화자 + 상태 + 올린이).
--  · enrollment_consultations의 기존 단일 오디오 컬럼(audio_path 등)은 **최신 녹음 미러**로 유지
--    (목록 🎙️ 배지·StatusWatcher·칸반 등 레거시 소비처 무회귀). transcription엔 완료 녹음 합본.
--  · 13섹션 AI 분석은 녹음 하나가 완료될 때마다 "완료된 전체 녹음 전사 합본"으로 재생성(추가 분석).
--
-- ⚠️ 이 파일은 drizzle journal 밖(손수 적용). 신규 DB는 pnpm db:alphas가 사전순으로 함께 적용.

create table if not exists consultation_recordings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  consultation_id uuid not null references enrollment_consultations(id) on delete cascade,

  -- 오디오(media-storage 추상화 경로 — GCS/Supabase)
  audio_path text not null,
  audio_size_bytes integer,
  audio_duration_sec integer,

  -- 전사 파이프라인(enrollment_consultations 단일 컬럼과 동형)
  transcription text,
  speaker_labels jsonb,
  processing_status consultation_processing_status not null default 'uploaded',
  processing_error text,
  assemblyai_transcript_id text,

  -- 누가 녹음/업로드했나(여러 상담사 구분)
  recorded_by uuid references users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cr_consultation_idx
  on consultation_recordings (consultation_id, created_at);
create index if not exists cr_assemblyai_transcript_idx
  on consultation_recordings (assemblyai_transcript_id);
create index if not exists cr_tenant_idx
  on consultation_recordings (tenant_id);

alter table consultation_recordings enable row level security;

drop policy if exists consultation_recordings_tenant_isolation on consultation_recordings;
create policy consultation_recordings_tenant_isolation on consultation_recordings
  for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

-- 백필(멱등): 기존 단일 오디오(enrollment_consultations.audio_path)를 녹음 행으로 이전.
-- 레거시 컬럼은 지우지 않는다(미러·in-flight 웹훅 폴백 보존). recorded_by는 원본에 없어 null.
insert into consultation_recordings (
  tenant_id, consultation_id, audio_path, audio_size_bytes, audio_duration_sec,
  transcription, speaker_labels, processing_status, processing_error,
  assemblyai_transcript_id, created_at, updated_at
)
select
  ec.tenant_id, ec.id, ec.audio_path, ec.audio_size_bytes, ec.audio_duration_sec,
  ec.transcription, ec.speaker_labels, ec.processing_status, ec.processing_error,
  ec.assemblyai_transcript_id, ec.created_at, ec.created_at
from enrollment_consultations ec
where ec.audio_path is not null
  and not exists (
    select 1 from consultation_recordings cr
    where cr.consultation_id = ec.id and cr.audio_path = ec.audio_path
  );
