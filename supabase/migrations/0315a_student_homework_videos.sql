-- 영상 원본 접근 주소·작업 임대는 워커 전용. 학생 화면은 권한 검사 후 필요한 열만 읽는다.
create table if not exists public.student_homework_videos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  subject text,
  teacher_id uuid references public.users(id) on delete set null,
  center_id bigint not null,
  video_id bigint not null,
  post_id bigint not null,
  comment_id bigint,
  posted_at timestamptz,
  status text not null default 'queued' check (status in ('queued', 'processing', 'uploaded', 'failed')),
  drive_file_id text,
  drive_folder_id text,
  bytes bigint,
  md5 text,
  payload jsonb not null default '{}'::jsonb,
  route jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  error text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, center_id, video_id)
);
create index if not exists student_homework_videos_student_idx
  on public.student_homework_videos (tenant_id, student_id, posted_at desc, id);
create index if not exists student_homework_videos_pending_idx
  on public.student_homework_videos (tenant_id, available_at) where status in ('queued', 'processing', 'failed');
alter table public.student_homework_videos enable row level security;
revoke all on public.student_homework_videos from anon, authenticated;
grant all on public.student_homework_videos to service_role;
comment on table public.student_homework_videos is
  'ClassNote 학부모 영상 작업·Drive 보관 기록. service_role/워커 전용. 학생 상세 권한 확인 후 허용 열만 반환.';
notify pgrst, 'reload schema';

-- PC 교체·동시 재시도에도 담임 폴더 번호는 DB에서 한 번만 선점한다.
create table if not exists public.classnote_video_folders (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  root_folder_id text not null,
  route_key text not null,
  drive_folder_id text not null,
  primary key (tenant_id, root_folder_id, route_key),
  unique (tenant_id, drive_folder_id)
);
alter table public.classnote_video_folders enable row level security;
revoke all on public.classnote_video_folders from anon, authenticated;
grant all on public.classnote_video_folders to service_role;

create table if not exists public.classnote_video_history (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  center_id bigint not null,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, center_id)
);
alter table public.classnote_video_history enable row level security;
revoke all on public.classnote_video_history from anon, authenticated;
grant all on public.classnote_video_history to service_role;

create table if not exists public.classnote_video_files (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  folder_id text not null,
  md5 text not null,
  bytes bigint not null,
  drive_file_id text not null,
  primary key (tenant_id, folder_id, md5, bytes),
  unique (tenant_id, drive_file_id)
);
alter table public.classnote_video_files enable row level security;
revoke all on public.classnote_video_files from anon, authenticated;
grant all on public.classnote_video_files to service_role;
notify pgrst, 'reload schema';
