-- 0390a 영상 숙제 설명 AI 참고 메모(원장 2026-10-20) — 학생 설명 영상을 소리(전사)·화면으로 판정해 담당 선생님 참고 메모를 남긴다.
-- 결정 본문 = docs/decisions/reports-ai.md '영상 설명 AI 참고 메모'.
--
-- 흐름(영상 1개 = 행 1개, stage가 단계):
--   extract      발송 PC 워커가 드라이브에서 받아 소리(mp3)·화면(jpg)을 뽑아 비공개 버킷에 올린다 → transcribe
--   transcribe   서버가 AssemblyAI(universal-2, ko)에 맡긴다 → transcribing(transcript_id) → 웹훅·cron이 받아 judge
--   judge        밤 배치(Anthropic Message Batches, 50%)로 판정(Haiku) → judging(judge_batch) → 실수가 있으면 verify, 없으면 done
--   verify       실수 주장마다 반박(Sonnet) 배치 → verifying(verify_batch) → done
--   failed       횟수 초과·영구 오류(error에 한글 사유) · skipped = 말소리 없음 등 판정할 수 없는 영상
-- '다시 분석' 버튼은 transcript·assets가 있는 행을 즉시(일반 호출) 다시 판정한다 — 전사는 다시 하지 않는다.
--
-- 🔴 RLS = 앱 사용자(authenticated) 정책 0개(의도적 — 연동 앱 워커 역할 정책만 있다) — 화면은 서버가 admin 클라이언트로 읽되 tenant_id를 항상 거르고, 영상 제출 현황과 같은
--    게이트(현황을 볼 수 있는 사람 · 강사는 내가 낸 숙제 칸)를 지난 영상 id만 묻는다(#104: 정책 없는 표를 사용자 클라이언트로 읽으면 0행).
--    전사·판정 원문(학생 목소리를 옮긴 글)은 화면에 내보내지 않는다 — 화면에 나가는 것은 result(분석 결과)뿐이다.

create table if not exists public.homework_video_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  video_id uuid not null unique references public.student_homework_videos(id) on delete cascade,
  stage text not null default 'extract'
    check (stage in ('extract','transcribe','transcribing','judge','judging','verify','verifying','done','failed','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lock_token uuid,
  locked_at timestamptz,
  -- {audioPath, frames:[{path,label}], durationSec, extractedAt} — 버킷 homework-video-review 안의 경로
  assets jsonb,
  transcript_id text,
  -- {text, words:[[ms,word]...], model} — AssemblyAI 원본(보정 전). 다시 분석해도 재사용
  transcript jsonb,
  -- 판정·확인 원문(모델 JSON 그대로) — 데이터 보존용, 화면에 내보내지 않는다
  judge jsonb,
  verify jsonb,
  -- 화면에 나가는 분석 결과(코드가 정리한 것): overall·scores·mistakes·needsCheck·note·fixes
  result jsonb,
  judge_batch text,
  verify_batch text,
  models jsonb not null default '{}'::jsonb,
  error text,
  requested_by uuid references public.users(id) on delete set null,
  requested_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists homework_video_reviews_queue
  on public.homework_video_reviews (stage, available_at) where stage not in ('done','failed','skipped');
create index if not exists homework_video_reviews_tenant on public.homework_video_reviews (tenant_id, stage);
create index if not exists homework_video_reviews_transcript on public.homework_video_reviews (transcript_id) where transcript_id is not null;

alter table public.homework_video_reviews enable row level security;
revoke all on public.homework_video_reviews from anon, authenticated;
grant all on public.homework_video_reviews to service_role;

-- 연동 앱(발송 PC, Electron) 워커 = 중개 역할 eywa_sync_agent로 붙는다 — 자기 지점 줄만(0401a과 같은 모양).
-- 새 DB는 적용기가 이름순이라 이 파일이 0401a(역할·함수를 만든다)보다 먼저 돌 수 있다 — 그때는 건너뛴다(그 뒤 다시 실행하면 붙는다).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'eywa_sync_agent')
     and to_regprocedure('public.sync_agent_foreign_keys(regclass,jsonb)') is not null then
    execute 'grant select,insert,update,delete on public.homework_video_reviews to eywa_sync_agent';
    execute 'drop policy if exists sync_agent_allow on public.homework_video_reviews';
    execute $p$create policy sync_agent_allow on public.homework_video_reviews for all to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)
      with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)$p$;
    execute 'drop policy if exists sync_agent_tenant_boundary on public.homework_video_reviews';
    execute $p$create policy sync_agent_tenant_boundary on public.homework_video_reviews as restrictive for all to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)
      with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid
        and public.sync_agent_foreign_keys('public.homework_video_reviews'::regclass,to_jsonb(homework_video_reviews)))$p$;
  else
    raise notice '0390a: eywa_sync_agent 역할 또는 sync_agent_foreign_keys가 아직 없어 워커 권한을 건너뜀';
  end if;
end $$;

drop trigger if exists homework_video_reviews_touch on public.homework_video_reviews;
create or replace function public.homework_video_reviews_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger homework_video_reviews_touch before update on public.homework_video_reviews
  for each row execute function public.homework_video_reviews_touch();

-- 소리·화면 보관 버킷(비공개 · signed URL로만). scripts/setup-storage.ts BUCKETS와 같은 값.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homework-video-review', 'homework-video-review', false, 52428800, array['audio/mpeg','image/jpeg'])
on conflict (id) do nothing;
