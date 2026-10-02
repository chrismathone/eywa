-- 0330a — 숙제 영상 **올리기 사이트**(`/v`) (원장 2026-10-02)
--   *"클래스노트에 애초에 접근할 수 없는 학생들을 위해 … 그냥 '업로드 전용 사이트'를 만들어야겠어. 거기서 자신의 휴대폰 번호
--     뒷 4자리를 입력하고 반을 고르면 업로드할 수 있게 링크와 같이."*
--
-- 지금까지는 선생님이 학생마다 제출 링크를 복사해 보내야 했다(학생 상세 '제출 링크 복사' · 보고서 글의 영상첨부 줄).
-- 올리기 사이트는 **주소 하나**(`…/v`)다: 휴대폰 뒷 4자리 → 내 이름(가운데 가림)·반 고르기 → 그 학생 × 반의 제출 링크가
-- 그 자리에서 만들어져 기존 제출 화면(`/v/<토큰>`)으로 넘어간다. 올린 뒤는 링크와 똑같다(담임 Drive 폴더 · 숙제 영상 탭 · 제출 현황).
--
--   ① homework_video_links.origin 에 'site' 추가 — 어디서 만든 링크인지(학생 상세 / 보고서 글 / 올리기 사이트)를 기록에 남긴다.
--   ② homework_video_site_attempts — 조회·열기 시도 기록(남용 방지: 시간당 횟수 제한). IP는 해시만 저장한다(원본 미저장).
--
-- 🔴 뒷 4자리는 **약한 확인**이다(1만 가지) — 그래서 ⓐ 시도 횟수를 제한하고 ⓑ 이름은 가운데를 가려 보여 주고 ⓒ 사이트가 만든 링크는
--    짧게(만든 날과 다음 날) 살고 ⓓ 감사로그에 출처 'site'로 남긴다. 올라온 영상은 선생님이 숙제 영상 탭에서 본다.
-- 🔴 앱은 이 SQL 전에도 돈다([[#95]]) — 표가 없으면 올리기 사이트는 "지금은 받을 수 없습니다"만 보이고, 기존 링크 기능은 그대로다.
-- 쓰기·읽기 = 서버(service_role)만. 시도 표는 정책을 두지 않는다(사용자 직접 조회 불가, [[#104]]).

begin;

-- ① 출처에 'site' 추가(기존 check를 갈아 끼운다 — 이름은 0325a의 열 check 기본 이름).
alter table public.homework_video_links drop constraint if exists homework_video_links_origin_check;
alter table public.homework_video_links
  add constraint homework_video_links_origin_check check (origin in ('manual', 'report', 'site'));

-- ② 시도 기록.
create table if not exists public.homework_video_site_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),   -- 서버 비밀값으로 서명한 해시 — HMAC-SHA256(IP + 지점) — 원본 IP는 저장하지 않는다
  kind text not null check (kind in ('lookup', 'open')),       -- 뒷 4자리 조회 / 링크 열기
  created_at timestamptz not null default now()
);
create index if not exists homework_video_site_attempts_ip_idx
  on public.homework_video_site_attempts (tenant_id, ip_hash, created_at desc);
create index if not exists homework_video_site_attempts_recent_idx
  on public.homework_video_site_attempts (tenant_id, created_at desc);

alter table public.homework_video_site_attempts enable row level security;
revoke all on public.homework_video_site_attempts from anon, authenticated;
grant all on public.homework_video_site_attempts to service_role;

comment on table public.homework_video_site_attempts is
  '숙제 영상 올리기 사이트(/v)의 조회·열기 시도(0330a) — 시간당 횟수 제한용. IP는 해시만. 서버 전용(정책 없음).';

commit;

notify pgrst, 'reload schema';
