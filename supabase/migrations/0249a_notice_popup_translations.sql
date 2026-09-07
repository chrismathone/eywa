-- 0249a — 팝업 공지 **번역 캐시**(원어민 강사가 공지를 읽을 수 있게)
--
-- 원장 2026-09-03: *"공지사항도 영어로 보이도록 해줘. 중간에 실시간 번역 필요하면 deepseek api 활용할것."*
-- 화면 크롬('7일간 보지 않기'·'닫기')은 정적 사전이 맡고, **사람이 쓴 본문**(title·body·link_label)만
-- 이 표에 번역을 캐시한다.
--
-- 🔴🔴 **"실시간"을 페이지 로드에 붙이지 않는다.** CLAUDE.md 불변 규칙: *"AI 호출은 캐싱 + 명시적
--    트리거 — 페이지 로드만으로 절대 새 호출 안 함."* 팝업은 **셸 진입마다** 뜨고 eywa는 메뉴가
--    same-origin iframe이라 **창 수만큼 곱해진다**(B6). 그래서:
--      · 만드는 시점 = 공지 저장(사람이 [저장]을 누른 것이 명시 트리거) 또는 /owner의 [영문 만들기]
--      · 읽는 시점 = **이 표만** 조회. 없으면 **한국어 원문 그대로**(빈 팝업 금지 — 못 읽는 것보다 낫다)
--
-- 🔑 **재번역 판정은 `source_hash`**(원문 title+body+link_label의 해시)다. `updated_at`으로 하면
--    이미지·노출기간만 바꿔도 다시 부른다(돈). 해시가 같으면 건너뛴다.
--
-- ⚠️ **앱은 이 표가 없어도 살아야 한다**([[#95]] — SQL은 원장이 손으로 실행하므로 배포와 적용 사이에
--    항상 간격이 있다). 조회는 fail-soft라 표가 없으면 한국어로 떨어지고, 팝업은 **전원이 매일 보는
--    경로**라 특히 조심한다(여기서 throw하면 셸이 통째로 죽는다).
--
-- ⚠️ 번역을 **안 하고 원문을 유지하는 정당한 사유**가 있다(계좌번호·주민번호 같은 민감 패턴이 본문에
--    보이면 외부 AI로 보내지 않는다 — CLAUDE.md '외부 AI 전송 금지 필드'). 그 사실을 화면이 말해야
--    하므로 `skip_reason`에 남긴다(null = 정상).
--
-- 🔴 `lang`은 지금 'en'만 쓰지만 컬럼으로 둔다 — 나중에 다른 언어가 생겨도 표를 새로 파지 않는다.
--    (`ko`는 저장하지 않는다: 원문이 `notice_popups`에 이미 있다. 같은 사실을 두 벌로 들지 않는다.)
--
-- 롤백:
--   drop table if exists public.notice_popup_translations;
set local statement_timeout = '60s';

create table if not exists public.notice_popup_translations (
  notice_id uuid not null references public.notice_popups(id) on delete cascade,
  lang text not null check (lang in ('en')),
  -- 번역 결과. 🔴 **null 허용** — 원문이 비어 있는 칸(body 없는 이미지 공지)은 번역도 없다.
  title text,
  body text,
  link_label text,
  -- 원문 해시(재번역 판정). 이 값이 지금 원문의 해시와 다르면 화면은 **번역을 안 쓴다**(옛 글이
  -- 새 글인 척하는 것보다 한국어 원문이 정직하다).
  source_hash text not null,
  -- 번역을 건너뛴 사유(민감 패턴 등). null = 정상 번역.
  skip_reason text,
  -- 어떤 모델이 만들었나(비용·품질 역추적). UI엔 안 띄운다.
  model text,
  updated_at timestamptz not null default now(),
  primary key (notice_id, lang)
);

comment on table public.notice_popup_translations is
  '팝업 공지 번역 캐시(0249a). 🔴 페이지 로드가 아니라 **저장 시점·명시 버튼**에서만 만든다. '
  '없거나 source_hash가 어긋나면 화면은 한국어 원문을 그대로 쓴다(빈 팝업 금지).';
comment on column public.notice_popup_translations.source_hash is
  '원문(title+body+link_label) 해시. 재번역 판정 축 — updated_at으로 하면 이미지만 바꿔도 다시 부른다.';
comment on column public.notice_popup_translations.skip_reason is
  '번역을 건너뛴 사유(민감 패턴 등). null=정상. 화면이 "왜 한국어인지" 말할 수 있게 남긴다.';

alter table public.notice_popup_translations enable row level security;

do $$
begin
  -- 🔴 부모(notice_popups)의 테넌트를 따라간다 — 이 표엔 tenant_id가 없다(부모가 유일한 진실).
  --    security definer 함수로 감싸지 않아도 되는 이유: 참조가 **한 방향**이라 재귀가 없다([[#109]]).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notice_popup_translations'
      and policyname = 'notice_popup_translations_tenant_read'
  ) then
    create policy notice_popup_translations_tenant_read
      on public.notice_popup_translations for select
      using (
        exists (
          select 1 from public.notice_popups p
          where p.id = notice_id and p.tenant_id = auth_tenant_id()
        )
      );
  end if;
end $$;

-- ⚠️ 쓰기 정책은 만들지 않는다 — 번역은 **서버(admin client)만** 쓴다(사람이 손으로 고치는 값이 아니다).
--    정책 없는 RLS = 전부 거부라 사용자 클라이언트로는 못 쓴다([[#104]]와 같은 성질을 **의도적으로** 쓴다).

notify pgrst, 'reload schema';
