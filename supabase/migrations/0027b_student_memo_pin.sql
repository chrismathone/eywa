-- 0027b: student_memos 고정(pin) + 수정시각(updated_at) 컬럼 추가 (손수 alpha)
-- drizzle 스냅샷이 kiosk(0027a) 드리프트로 어긋나 있어 db:generate가 무관한 변경을 끌어옴 →
-- memo 컬럼만 alpha SQL로 추가(0027a 패턴과 동일). schema.ts가 소스 오브 트루스.
alter table public.student_memos
  add column if not exists pinned boolean not null default false;

alter table public.student_memos
  add column if not exists updated_at timestamptz not null default now();
