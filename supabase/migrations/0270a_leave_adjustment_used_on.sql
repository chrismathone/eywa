-- 0270a — 연차 조정 행에 **실제 휴가 사용일** 한 칸
--
-- 원장 지시 2026-09-18: *"연차관리 조정할때 가감일수에 추가로 그사람이 언제 연차썼는지까지 기록남기기
-- 위해 여기서 날짜도 기입해주고 가감된거 내정보에서도 언제 쓴지까지 연계시켜줘"*
--
-- 🔑 **왜 칸이 필요한가**: 전자결재로 낸 휴가는 `leave_forms.start_date`에 날짜가 남지만, 사무실이 손으로
--    차감하는 몫(결재 밖에서 쓴 연차·중도 정산)은 `leave_adjustments`에 일수와 사유만 남아 "언제 쓴
--    건지"가 사유 문장 안에만 있었다. 그 날짜를 칸으로 빼면 내 정보 화면이 휴가 문서와 **한 목록에
--    날짜순으로** 세울 수 있다.
--
-- 🔴 **잔여 산식은 한 글자도 바뀌지 않는다.** 이 값은 기록·표시용이고 차감은 종전처럼 `days`(음수)가
--    부여 쪽에서 한다 — 사용일을 '사용'으로 또 세면 같은 연차가 **두 번** 깎인다(balance.ts 규약).
--
-- 🔑 nullable인 이유: 이월·특별휴가 **부여**(+) 행에는 사용일이 없다. 비어 있는 것이 정상이고, 모르는
--    것을 지어내지 않는다(0252a `created_by` set null과 같은 결).
--
-- ⚠️ 구간 밖 날짜는 **앱이** 거절한다(features/leave/server/actions.ts) — DB check로 굳히면 나중에
--    "지난 구간 사용분을 이번 구간에서 정산" 같은 예외가 생길 때 손댈 수 없다(0223a와 같은 결: DB는
--    형식만 잠그고 규칙은 앱 단일 소스).
-- ⚠️ 앱이 먼저 배포돼도 죽지 않는다([[#95]] expand/contract): 조회는 이 컬럼이 없으면 **빼고 다시 읽고**
--    (leave/server/admin.ts · leave/server/my-history.ts), 쓰기는 사용일을 **적었을 때만** 한글로
--    "0270a 적용 필요"를 알린다(비워 두면 지금 스키마에서도 그대로 저장된다).
--
-- 롤백: alter table public.leave_adjustments drop column if exists used_on;
set local statement_timeout = '60s';

alter table public.leave_adjustments
  add column if not exists used_on date;

comment on column public.leave_adjustments.used_on is
  '실제 휴가 사용일(차감 행에만 적는다 — 이월·특별휴가 부여 행은 null). 기록·표시용이고 잔여 산식에는 들어가지 않는다(차감은 days가 한다). 0270a';

-- 인덱스는 두지 않는다 — 읽는 자리가 "한 사람·한 구간의 조정 몇 줄"이라 기존
-- `leave_adjustments_user_period_idx`(tenant, user, period_start)로 좁힌 뒤 날짜 정렬만 하면 된다.

notify pgrst, 'reload schema';
