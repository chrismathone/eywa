-- 0301a — 반 이름 공백 정리 트리거 (2026-09-29, 원장 지시 "재발 방지도 적용").
--
-- 왜: 반 이름은 ClassNote 반 보드 이름과 **글자까지 같아야** 동기화된다. 그런데 `중등M 개별  BS3R`(공백 두 칸)이
--     저장돼 있었고, 웹 화면은 연속 공백을 한 칸으로 그려 아무도 못 봤다(보드도 두 칸으로 복사됐다 — 둘 다 고침).
--     앱의 저장 경로(반 폼·레벨 변경·예약 개명 cron)는 `normalizeClassName`(src/features/classes/class-name.ts)을
--     지나지만, 시트 가져오기·스크립트·SQL 직접 수정처럼 그 함수를 안 부르는 경로가 있다 → DB가 마지막으로 막는다.
-- 규칙: 앞뒤 공백 제거 + 연속 공백(탭·줄바꿈·NBSP 포함) 한 칸. ⚠️ class-name.ts와 같은 규칙이어야 한다.
-- 기존 데이터: 적용 시점 0행(2026-09-29 실측 — 유일한 1건은 이미 고침). 아래 UPDATE는 멱등 확인용.
-- 앱은 이 SQL 전후 어느 쪽에서도 같은 값을 저장한다([[#95]] — 트리거가 없어도 앱이 이미 정리한다).
--
-- 롤백:
--   drop trigger if exists classes_normalize_name on public.classes;
--   drop function if exists public.classes_normalize_name();

create or replace function public.classes_normalize_name()
returns trigger
language plpgsql
as $$
begin
  if new.class_name is not null then
    -- [[:space:]]는 NBSP(U+00A0)를 안 잡으므로 함께 넣는다.
    new.class_name := btrim(regexp_replace(new.class_name, '[[:space:]' || chr(160) || ']+', ' ', 'g'));
  end if;
  return new;
end;
$$;

drop trigger if exists classes_normalize_name on public.classes;
create trigger classes_normalize_name
  before insert or update of class_name on public.classes
  for each row execute function public.classes_normalize_name();

-- 남아 있는 값 정리(지금은 0행). 트리거가 붙은 뒤라 같은 규칙으로 정리된다.
update public.classes
set class_name = class_name
where class_name ~ ('[[:space:]' || chr(160) || ']{2,}') or class_name <> btrim(class_name)
   or strpos(class_name, chr(160)) > 0 or class_name ~ '[\t\n\r]';
