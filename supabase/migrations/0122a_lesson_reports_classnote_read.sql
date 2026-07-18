-- 0122a: ClassNote 학부모 읽음 동기화 (2026-07-18, A안 2단계).
--
-- 배경(1단계 조사, docs/classnote-read-sync-plan.md): ClassNote 피드 행에 `read_by_parent.date_read`가
-- 이미 들어 있다(추가 요청 0, 실측 100건 중 58건 채워짐). eywa의 share_link_views는 발송분의 1.5%만
-- 잡아 '미확인' 판정이 불가능했으나, 이 값을 동기화하면 정확한 판정이 가능해진다.
--
-- ⚠️ **매칭 키가 핵심**: 현재 학부모에게 실제로 나가는 보고서는 eywa가 아니라 **edutrix가 발송**한다
-- (ClassNote 본문이 `edutrix.vercel.app/share/{uuid}`). 그 uuid = edutrix `reports.share_token`이고,
-- eywa가 임포트해 둔 `edutrix_report_id`(=edutrix reports.id)와는 **다른 값**이라 그대로는 못 잇는다.
-- 실측 체인(2026-07-18): ClassNote 본문 uuid → edutrix.share_token **77/77(100%)** →
-- edutrix.id → eywa.edutrix_report_id **64/77(83%, 나머지는 당일분 미임포트)**.
-- 그래서 edutrix-sync cron이 `share_token`을 함께 임포트해 여기 저장하고, 워커는 이 컬럼으로 조인한다.
--
-- eywa가 직접 발송한 건(본문에 `/r/{share_token}`)은 기존 `share_token` 컬럼으로 매칭한다 — 워커가 두 형태를 모두 파싱.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table lesson_reports add column if not exists edutrix_share_token text;
alter table lesson_reports add column if not exists classnote_read_at timestamptz;

comment on column lesson_reports.edutrix_share_token is
  'edutrix reports.share_token(uuid) — ClassNote 본문 edutrix.vercel.app/share/{uuid}와 잇는 매칭 키. edutrix-sync가 채움.';
comment on column lesson_reports.classnote_read_at is
  'ClassNote 학부모 읽음 시각(read_by_parent.date_read). null=미읽음/미확인. 연동 PC 워커가 채움(앱은 읽기만).';

-- 워커의 갱신 조회(테넌트 + 토큰)용. 부분 인덱스로 토큰 있는 행만(대부분 과거 행은 null).
create index if not exists lesson_reports_edutrix_share_token_idx
  on lesson_reports (tenant_id, edutrix_share_token)
  where edutrix_share_token is not null;

-- '미확인' 이벤트 후보 조회(발송됐고 아직 안 읽은 건)용.
create index if not exists lesson_reports_unread_idx
  on lesson_reports (tenant_id, report_date desc)
  where classnote_status = 'success' and classnote_read_at is null;
