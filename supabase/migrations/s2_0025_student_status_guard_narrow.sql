-- s2_0025 — 원생 메뉴 권한 저장 가드를 '상태 변경 권한이 넓어지는 변경'만 막도록 좁힌다 (2026-11-05)
--
-- 왜: 원장 *"원생목록 '읽기'에 굳이 그럴 필요가있어?"* — 아르바이트 칸에 원생목록 '읽기'를 주려는데 저장이
--     "원생 메뉴 권한을 바꾸기 전에 원생 상태 변경 담당자를 지정해 주세요"로 막혔다. 옛 방식(담당자 미지정 학원)에서는
--     원생 상태 변경(퇴원·휴원·재개·복구)을 **사무실 역할 ∧ 원생 메뉴 '전체'**인 사람이 한다(src/features/students/status-access.ts).
--     그런데 가드는 원생 메뉴 줄이 **조금만 바뀌어도** 막았다 — '읽기'·'담당'·'없음', 강사·열람·아르바이트 칸, 좁히는 변경까지.
-- 무엇: student_status_private.guard_settings()(시즌1 0428a 정의)의 세 번째 갈래만 바꾼다 — 나머지 글자·소유자·권한 그대로.
--   · 그대로: 운영 서버(service role 등 authenticated가 아닌 쓰기)는 통과 · 담당자 지정을 지우는 저장은 거절 · 지정 전환 중이거나 지정된 학원은 통과.
--   · 바뀜: 옛 방식에서 거절하는 것은 **넓히는 변경**뿐이다(앱 studentStatusRefreshRequired와 같은 판정 — 가드 시험이 두 쪽을 맞춘다).
--       상태 변경 자격 = 사무실 역할 ∧ (원생 'students' 전체 ∨ 관리자 도구 'admin' 전체)(student_status_private.allowed).
--       앞뒤 **실효값**(개인 예외 마지막 줄 → 역할 칸 마지막 줄 → 코드 기본값 — student_status_private.menu와 같은 순서)을 비교한다:
--       ① 역할 칸 — 사무실 역할(admin·manager·counselor·accountant)이 두 메뉴 어느 쪽으로도 '전체'가 아니었는데 '전체'가 된다
--          (줄을 지워 코드 기본값 '전체'로 돌아가는 것 포함 · 기본값 = permissions.ts MENU_ACCESS 미러).
--       ② 개인 예외 — 누군가의 실효값이 '전체'가 되거나, '전체'가 아닌 제한이 사라진다(역할 칸으로 돌아가 '전체'일 수 있다).
--       같은 줄을 그대로 두면 절대 거절하지 않는다(겹친 줄이 저장된 학원도 다른 섹션 저장이 막히지 않는다 — 재리뷰 2026-11-05).
--     원장은 언제나 상태를 바꾸므로 원장 칸은 보지 않는다.
-- 적용 순서: 앱보다 먼저든 나중이든 안전하다 — 앱도 같은 판정을 먼저 하고, 옛 앱은 더 넓게 막을 뿐이다.
-- 적용 확인(읽기만):
--   select pg_get_functiondef('student_status_private.guard_settings()'::regprocedure) like '%LEGACY-STATUS-WIDEN%';  -- 기대: true
--
-- 되돌리기: 시즌1 s1_season1.sql의 0428a 구역 guard_settings 정의를 다시 실행한다(본문에 붙이지 않는다).

begin;
set local lock_timeout = '3s';

create or replace function student_status_private.guard_settings() returns trigger
language plpgsql security invoker set search_path=public as $$
declare before_special jsonb:=old.data->'permissions'->'specialAccess';
  after_special jsonb:=new.data->'permissions'->'specialAccess';
  -- 코드 기본값(MENU_ACCESS) — 옛 방식에서 상태를 바꾸는 사무실 역할 × 자격을 주는 두 메뉴만. LEGACY-STATUS-WIDEN
  defaults constant jsonb:='{"students":{"admin":"full","manager":"full","counselor":"full","accountant":"readonly"},"admin":{"admin":"none","manager":"none","counselor":"none","accountant":"none"}}';
  o_old jsonb; o_new jsonb; u_old jsonb; u_new jsonb;
  r text; m text; u text; a text; b text; a_full boolean; b_full boolean;
begin
  if current_user<>'authenticated' then return new; end if;
  if coalesce(before_special ? 'studentStatusManagerIds',false) and
    not coalesce(after_special ? 'studentStatusManagerIds',false) then
    raise exception '원생 상태 변경 권한은 새 설정 화면에서 저장해 주세요';
  end if;
  if coalesce(before_special ? 'studentStatusManagerIds',false) or
    coalesce(after_special ? 'studentStatusManagerIds',false) then
    return new;
  end if;

  -- 배열이 아니면 빈 것으로 본다(student_status_private.menu와 같다).
  o_old:=case when jsonb_typeof(old.data->'permissions'->'overrides')='array' then old.data->'permissions'->'overrides' else '[]'::jsonb end;
  o_new:=case when jsonb_typeof(new.data->'permissions'->'overrides')='array' then new.data->'permissions'->'overrides' else '[]'::jsonb end;
  u_old:=case when jsonb_typeof(old.data->'permissions'->'userOverrides')='array' then old.data->'permissions'->'userOverrides' else '[]'::jsonb end;
  u_new:=case when jsonb_typeof(new.data->'permissions'->'userOverrides')='array' then new.data->'permissions'->'userOverrides' else '[]'::jsonb end;

  -- ① 역할 칸: 마지막 줄(없으면 기본값) 기준으로 이전엔 두 메뉴 다 '전체'가 아니었는데 이후 하나라도 '전체'면 거절.
  foreach r in array array['admin','manager','counselor','accountant'] loop
    b_full:=false; a_full:=false;
    foreach m in array array['students','admin'] loop
      select x.value->>'access' into b from jsonb_array_elements(o_old) with ordinality x(value,n)
        where x.value->>'menu'=m and x.value->>'role'=r order by x.n desc limit 1;
      select x.value->>'access' into a from jsonb_array_elements(o_new) with ordinality x(value,n)
        where x.value->>'menu'=m and x.value->>'role'=r order by x.n desc limit 1;
      if coalesce(b, defaults->m->>r)='full' then b_full:=true; end if;
      if coalesce(a, defaults->m->>r)='full' then a_full:=true; end if;
    end loop;
    if a_full and not b_full then
      raise exception '이 변경은 원생 상태 변경(퇴원·휴원) 권한을 넓힙니다 — 먼저 원생 상태 변경 담당자를 지정해 주세요';
    end if;
  end loop;

  -- ② 개인 예외: 마지막 줄 기준으로 '전체'가 되거나, '전체'가 아닌 제한이 사라지면 거절.
  for u in select distinct x.value->>'userId' from jsonb_array_elements(u_old || u_new) x(value)
      where x.value->>'menu' in ('students','admin') and jsonb_typeof(x.value->'userId')='string' loop
    foreach m in array array['students','admin'] loop
      select x.value->>'access' into b from jsonb_array_elements(u_old) with ordinality x(value,n)
        where x.value->>'menu'=m and x.value->>'userId'=u order by x.n desc limit 1;
      select x.value->>'access' into a from jsonb_array_elements(u_new) with ordinality x(value,n)
        where x.value->>'menu'=m and x.value->>'userId'=u order by x.n desc limit 1;
      if (a='full' and b is distinct from 'full') or (a is null and b is not null and b<>'full') then
        raise exception '이 변경은 원생 상태 변경(퇴원·휴원) 권한을 넓힙니다 — 먼저 원생 상태 변경 담당자를 지정해 주세요';
      end if;
    end loop;
  end loop;
  return new;
end $$;

commit;
