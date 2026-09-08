-- 0250a — 학생 메모의 '검색 허용' 축.
--
-- 원장 2026-09-08: "학생 검색시에 '메모 내용'도 검색되도록" → "메모를 추가할때 '검색 허용' 토글 만들고
-- 토글 허용된 검색만 검색에 노출되도록".
--
-- 🔴 기본값을 true로 두는 이유: 이 컬럼이 생기는 시점에 이 테넌트의 메모는 **1행**이고(실측 2026-09-08),
--    그 한 줄이 바로 원장이 검색으로 찾고 싶어 하는 '특별반' 메모다. false로 두면 기능을 켜자마자
--    "검색이 안 된다"가 된다. 민감한 메모는 토글을 꺼서 뺀다(그게 이 토글의 용도다).
-- ⚠️ 메모 내용에는 개인 사정이 적힐 수 있다 — 검색은 **학생 목록을 쓰는 사람**(students 접근 권한)만
--    하므로 새 노출 경로가 열리는 것은 아니다. 그래도 끄고 싶은 메모는 토글로 뺀다.

alter table student_memos
  add column if not exists searchable boolean not null default true;

comment on column student_memos.searchable is
  '학생 검색(이름·학교·연락처)에서 이 메모 내용도 매칭 대상으로 쓸지. 작성·수정 폼의 ''검색 허용'' 토글.';

-- 검색은 `content ilike '%…%'`라 인덱스가 안 먹는다(선행 와일드카드). 대신 **허용된 것만** 훑도록
-- 부분 인덱스로 후보를 좁힌다. ⚠️ 이 축으로 upsert 하지 말 것([[#113]] — 부분 유니크가 아니라 부분
-- 인덱스라 upsert와는 무관하지만, 습관적으로 WHERE를 유니크에 붙이는 실수를 막기 위해 적어 둔다).
create index if not exists student_memos_searchable_idx
  on student_memos (tenant_id, student_id)
  where searchable;
