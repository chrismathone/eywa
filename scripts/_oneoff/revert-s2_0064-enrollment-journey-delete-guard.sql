-- s2_0064 되돌리기 — 앱을 먼저 되돌린 뒤(병합이 새 함수를 부른다).
-- 되돌리면 기록이 걸린 상담도 다시 지워지고(기록·이력 cascade), 병합 중 저장된 기록이 유실될 수 있는 종전 상태가 된다.
begin;
drop trigger enrollment_consultations_journey_guard on public.enrollment_consultations;
drop function public.merge_enrollment_consultations_with_journey(uuid, uuid, uuid, uuid[], jsonb);
drop function public.guard_consultation_journey_delete();
notify pgrst, 'reload schema';
commit;
