-- 교재목록 학년·학기 — 수학 교재가 어느 학년·학기 교재인지(원장 2026-10-22 *"초, 중은 교재부터 적혀있어서 되는데
-- 고등은 안되자나 … 교재 등록 시 수학은 학년도 넣는게 나을듯"*).
--
-- 🔑 진도 카드(로드맵)는 교재를 `시리즈|학년-학기|권` 열쇠로 줄 세운다(src/features/textbooks/math-book-match.ts).
--    초·중은 제목에서 읽혔지만 고등 제목(`가우스 공통수학1 01. 다항식~…`)엔 학년이 없어 순서에 못 섰다.
--    이 칸이 있으면 **제목 대신 이 값**으로 줄을 세운다. 고등 과목 ↔ 학년은 22개정 표준(원장 2026-10-22 선택):
--    공통수학1=고1-1 · 공통수학2=고1-2 · 대수=고2-1 · 미적분I=고2-2 · 확률과통계=고3-1 · 기하=고3-2.
-- 🔑 값 모양 = `초3-1`·`중2-2`·`고1-1`(학교급 + 학년 + 학기). null = 미지정(제목에서 읽던 대로).
-- ⚠️ 이름(`title`)은 그대로 둔다 — makeedu 단가표 이름과 글자까지 맞춰 매핑한다(원장 2026-10-22).
--
-- 롤백:
--   alter table public.textbooks drop column if exists grade_term;
set local statement_timeout = '60s';

alter table public.textbooks add column if not exists grade_term text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'textbooks_grade_term_fmt') then
    alter table public.textbooks add constraint textbooks_grade_term_fmt
      check (grade_term is null or grade_term ~ '^[초중고][1-6]-[12]$');
  end if;
end $$;

comment on column public.textbooks.grade_term is
  '학년·학기(초3-1·중2-2·고1-1) — 진도 카드가 교재를 줄 세우는 열쇠. null이면 제목에서 읽는다.';

notify pgrst, 'reload schema';
