-- s2_0017 — 시간표 배치의 강의실 = 등록된 강의실만 (원장 2026-11-02)
--
-- 원장: "영어 강의실이 자꾸 301 302 이렇게 되는데, 그런 강의실 없잖아 우린 다 본원이 붙는데"
--       · "전부 연결시켜" · "애초에 저런 강의실 입력할 수 있는곳을 찾아서 다 막아"
--
-- 배치(class_schedules)는 강의실을 두 벌로 든다 — 연결(classroom_id)과 라벨(slot_room_label)([[#115]]).
-- 설정 화면은 연결을, 시간표 머리·시트 가져오기는 라벨을 먼저 읽는다. 쓰는 길이 여럿이라(반 수정 · 영어 시트 반영
-- DB 함수 apply_english_structure · 시간표 연습본 적용 · 드래그 이동 · 인수인계 · 엑셀 가져오기 · 옛 스크립트) 앱 한 곳을
-- 고쳐서는 막히지 않는다. 실측 2026-11-02: 연습본 적용 한 번이 라벨 '605'만 있고 연결이 빈 줄 93개를 만들었다.
-- → 표에 문을 하나 단다(모든 길이 지난다).
--
--  ① 연결이 있으면 라벨은 그 강의실 이름으로 맞춘다(라벨이 비어 있으면 그대로 — 화면은 연결 이름으로 보인다).
--  ② 연결 없이 라벨만 오면 등록 강의실(보관 제외)에서 같은 이름, 없으면 '건물+호수' 하나(605 → 본원605)로 맞을 때 잇는다.
--     규칙은 앱 canonicalRoomName(src/features/attendance/live/seating-floors.ts)과 같다 — 후보가 둘이면 고르지 않는다(#122).
--  ③ 못 맞추면(맞는 강의실이 없거나 여럿) **지금·앞으로 유효한 줄은 거절**한다. 이미 끝난 줄(되돌리기·이력 복원)은 통과.
--     자리 이름(LAB·JJ와 그 별칭)은 강의실이 아니다 — 라벨을 비우고 통과(시트 강의실 칸에 LAB이 와도 반영 전체가 실패하지
--     않게). 별칭 목록 = 앱 specialSlotLabel의 SPECIAL_BY_ALIAS(teacher-label.ts)와 같아야 한다(가드 room-canonical-sql.test.ts).
--     이름 비교는 대소문자를 가리지 않는다(sky = 본원SKY). '건물+호수' 규칙은 세 자리 숫자·SKY 모양일 때만(앱 roomToken과 같은
--     모양 — 짧은 조각 'b'가 본원LAB에 붙지 않게).
--  ④ 강의실 이름을 바꾸면 그 강의실에 연결된 **지금·앞으로 유효한** 배치의 라벨도 새 이름으로(라벨이 이름의 복사본이
--     됐으니 — 안 하면 시간표가 다음 저장 전까지 옛 이름·옛 건물로 보인다). 끝난 줄(이력)은 그때 이름 그대로 둔다.
--
-- ⚠️ 반 수정 저장은 현재 줄을 지우고 다시 넣는다(한 거래 아님). 지금 유효한 줄 중 '연결 없음 + 맞는 강의실 없는 라벨'이
--    있으면 다시 넣기·복구가 둘 다 거절돼 그 반의 현재 교시가 사라진다 — 적용 전 전 지점 0줄 확인(2026-11-02)했고,
--    이 문이 그런 줄이 새로 생기는 것을 막는다.
--
-- 다른 칸만 고치는 update(끝나는 날 마감 등)는 문을 지나지 않는다(update of 두 칸만). 기존 줄은 이 파일이 바꾸지 않는다
-- (2026-11-02 명령줄로 침산 영어 555줄을 이미 연결 — D:\tmp\room-link-2026-11-02\backup.json).
-- 되돌리기 = 트리거 둘과 함수 둘을 지운다(drop trigger class_schedules_room_canonical on public.class_schedules;
--   drop trigger classrooms_name_sync_schedule_labels on public.classrooms; drop function public.tg_class_schedules_room_canonical();
--   drop function public.tg_classrooms_name_sync_schedule_labels();).

create or replace function public.tg_class_schedules_room_canonical()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := nullif(btrim(new.slot_room_label), '');
  v_key text;
  v_id uuid;
  v_name text;
  v_n integer;
begin
  -- ① 연결이 이긴다 — 라벨은 그 강의실 이름으로(두 벌이 갈라지지 않게).
  if new.classroom_id is not null then
    if v_label is not null then
      select r.name into v_name from public.classrooms r
       where r.id = new.classroom_id and r.tenant_id = new.tenant_id;
      if v_name is not null then
        new.slot_room_label := v_name;
      end if;
    end if;
    return new;
  end if;

  -- 빈 라벨 · 자리 이름(LAB·JJ — 강의실이 아니다)은 라벨을 비우고 통과.
  if v_label is null or lower(v_label) in ('lab', 'lab실', '이주희', '랩실', 'jj', '집중자율수업실', '자율실') then
    new.slot_room_label := null;
    return new;
  end if;
  v_key := lower(v_label);

  -- ② 같은 이름 → 없으면 '건물+호수' 하나(대소문자 무시).
  select count(*) into v_n from public.classrooms r
   where r.tenant_id = new.tenant_id and r.archived_at is null and lower(r.name) = v_key;
  if v_n = 1 then
    select r.id, r.name into v_id, v_name from public.classrooms r
     where r.tenant_id = new.tenant_id and r.archived_at is null and lower(r.name) = v_key;
  elsif v_n = 0 and v_label ~* '^([0-9]{3}|sky)$' then
    select count(*) into v_n from public.classrooms r
     where r.tenant_id = new.tenant_id and r.archived_at is null
       and length(r.name) > length(v_key)
       and right(lower(r.name), length(v_key)) = v_key
       and left(r.name, length(r.name) - length(v_key)) !~ '[0-9]$';
    if v_n = 1 then
      select r.id, r.name into v_id, v_name from public.classrooms r
       where r.tenant_id = new.tenant_id and r.archived_at is null
         and length(r.name) > length(v_key)
         and right(lower(r.name), length(v_key)) = v_key
         and left(r.name, length(r.name) - length(v_key)) !~ '[0-9]$';
    end if;
  end if;

  if v_id is not null then
    new.classroom_id := v_id;
    new.slot_room_label := v_name;
    return new;
  end if;

  -- ③ 끝난 줄(이력 복원)은 그대로, 지금·앞으로 유효한 줄은 거절.
  if new.valid_to is not null and new.valid_to < (now() at time zone 'Asia/Seoul')::date then
    return new;
  end if;
  raise exception '등록되지 않은 강의실입니다: %. 학원 설정의 강의실 목록에 있는 강의실로 골라 주세요.', v_label;
end
$$;

drop trigger if exists class_schedules_room_canonical on public.class_schedules;
create trigger class_schedules_room_canonical
  before insert or update of slot_room_label, classroom_id on public.class_schedules
  for each row execute function public.tg_class_schedules_room_canonical();

-- ④ 강의실 이름을 바꾸면 연결된 지금·앞으로 유효한 배치의 라벨도 새 이름으로(라벨이 비어 있는 줄·끝난 줄은 그대로).
create or replace function public.tg_classrooms_name_sync_schedule_labels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.class_schedules s
       set slot_room_label = new.name
     where s.tenant_id = new.tenant_id and s.classroom_id = new.id
       and s.slot_room_label is not null and s.slot_room_label is distinct from new.name
       and (s.valid_to is null or s.valid_to >= (now() at time zone 'Asia/Seoul')::date);
  end if;
  return null;
end
$$;

drop trigger if exists classrooms_name_sync_schedule_labels on public.classrooms;
create trigger classrooms_name_sync_schedule_labels
  after update of name on public.classrooms
  for each row execute function public.tg_classrooms_name_sync_schedule_labels();
