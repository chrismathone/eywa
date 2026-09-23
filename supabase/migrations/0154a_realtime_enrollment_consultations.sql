-- 0154a_realtime_enrollment_consultations.sql (손수 alpha)
-- 등록상담 목록/상세 실시간 갱신 — `enrollment_consultations`를 Supabase Realtime 발행에 추가한다.
--
-- 배경: 앱은 이미 이 테이블의 postgres_changes를 구독하고 있었다(상담 상세 StatusWatcher, 사전 브리프
-- 진행바). 그런데 **테이블이 supabase_realtime 발행에 들어있지 않아 이벤트가 한 번도 오지 않았고**,
-- 실제 갱신은 전부 옆에 붙여둔 5초 폴링이 하고 있었다(구독은 조용히 무동작). 그래서 QR 접수가 들어와도
-- 열어둔 등록상담 목록은 사람이 새로고침할 때까지 그대로였다.
--
-- ⚠️ 실시간도 RLS를 그대로 탄다 — authenticated 구독자는 `tenant_id = auth_tenant_id()` 정책을 통과한
--    행 변경만 받는다(테넌트 격리 유지). 새 노출면이 아니라 기존 조회 권한과 동일 범위다.
-- ⚠️ REPLICA IDENTITY는 기본(primary key)으로 둔다 — old 레코드 전체가 필요 없고(INSERT 감지가 목적),
--    FULL로 올리면 UPDATE마다 이전 행 전체가 WAL에 실려 비용만 커진다.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'enrollment_consultations'
  ) then
    alter publication supabase_realtime add table public.enrollment_consultations;
  end if;
end $$;
