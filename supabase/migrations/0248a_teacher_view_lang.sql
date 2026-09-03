-- 0248a — 강사뷰 **화면 언어 기본값**(관리자 지정)
--
-- 원장 2026-09-03: *"샘 킴 (sam)도 원어민에 등록"*. 2026-09-03에 붙인 강사뷰 한/영 전환은 미지정
-- 기본값을 **표시 이름**에서 도출한다(`isKoreanTeacherName`: 이름에 한글이 있으면 한국어). 그런데
-- 샘 킴 = **김태건**이라 이름이 한글이고, 휴리스틱이 그를 못 잡는다. 그래서 **사람이 지정하는 축**을
-- 하나 만든다.
--
-- 🔴🔴 **이 컬럼은 담임 판정과 아무 상관이 없다. 절대 합치지 말 것.**
--    CLAUDE.md 확정 결정: *"영어 반 담임 = 한국인 강사 중 그 반에 가장 많이 들어가는 사람 ·
--    원어민은 담임을 맡지 않는다"* 이고, 그 판정의 단일 소스는 `isKoreanTeacherName(display_name)`이다.
--    🔴 김태건은 **활성 담임 반이 4개**(PJ2·LT6·LS4b·RTT5, 전부 english)다. 이 값을 "원어민 여부"라는
--    하나의 플래그로 만들어 `isKoreanTeacherName` 쪽이 읽게 하면, 시간표 가져오기의 담임 자동채움
--    (`buildClassUpdates`)에서 **그의 담임 반 4개가 빠지거나 다른 강사로 뒤집힌다**.
--    원장이 원한 것은 **그 사람이 보는 화면의 글자**이지 담임 자격이 아니다.
--    → 그래서 컬럼 이름도 `is_native_speaker`가 아니라 **`teacher_view_lang`**이다. 이름이 곧 울타리다.
--
-- 값: null = **지정 없음**(지금처럼 이름에서 도출) · 'ko' · 'en'.
-- 🔴 null을 'ko'로 채우지 말 것 — "아직 안 정함"과 "한국어로 정함"은 다른 사실이다. 전자는 나중에
--    휴리스틱이 좋아지면 따라오고, 후자는 사람이 정한 값이라 그대로 있어야 한다.
--
-- 해석 순서(앱): 본인이 고른 값(`ui_prefs.teacherView.lang`) → **이 컬럼** → 이름에서 도출.
-- 🔴 본인 선택이 **여전히 맨 위**다 — 관리자가 en으로 지정해도 본인이 한국어를 고르면 한국어다
--    (스위치를 전원에게 연 것과 같은 논리: 표시 판정을 능력 판정으로 만들지 않는다).
--
-- ⚠️ **앱은 이 컬럼이 없어도 살아야 한다**([[#95]] — eywa는 SQL을 원장이 손으로 실행하므로 배포와
--    적용 사이에 항상 간격이 있다). 그래서 조회는 기존 select에 끼워 넣지 않고 **별도 질의**로 떼어
--    두었다(`getTeacherViewLangValue`·`readTeacherLangOverride`) — 컬럼이 없으면 지정만 조용히 비고
--    언어는 종전대로 이름에서 도출된다. 기존 select에 넣었으면 컬럼 부재 → PostgREST 400 →
--    **직원 상세·강사 셸이 통째로 죽는다**(0224a·0227a와 같은 규약).
--
-- ⚠️ 인덱스를 만들지 않는다 — 활성 32계정이고 언제나 **id 한 건**으로만 읽는다(기본키 조회).
--
-- ⚠️ 특정 직원(김태건)을 여기서 **하드코딩하지 않는다** — 데이터는 화면(직원관리 → 근무 설정 →
--    '강사 화면 기본 언어')에서 켠다. 마이그레이션이 사람을 지정하면 그 사실이 감사로그에 안 남는다.
--
-- 롤백:
--   alter table public.users drop column if exists teacher_view_lang;
set local statement_timeout = '60s';

alter table public.users
  add column if not exists teacher_view_lang text;

do $$
begin
  -- 세 값만 — 화면이 모르는 값을 받으면 조용히 이름 도출로 떨어지지만, 애초에 들어오지 못하게 막는다.
  if not exists (
    select 1 from pg_constraint where conname = 'users_teacher_view_lang_valid'
  ) then
    alter table public.users
      add constraint users_teacher_view_lang_valid
        check (teacher_view_lang is null or teacher_view_lang in ('ko', 'en'));
  end if;
end $$;

comment on column public.users.teacher_view_lang is
  '강사뷰 화면 언어 기본값(0248a). null=지정 없음(표시 이름에서 도출) · ko · en. '
  '🔴 담임 판정과 무관 — 원어민 여부 플래그가 아니다(isKoreanTeacherName은 이 컬럼을 읽지 않는다). '
  '본인이 내 메뉴에서 고른 값(ui_prefs.teacherView.lang)이 이 값보다 우선한다.';

notify pgrst, 'reload schema';
