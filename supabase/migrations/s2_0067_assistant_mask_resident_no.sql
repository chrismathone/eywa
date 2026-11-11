-- s2_0067_assistant_mask_resident_no.sql — 학원 비서 보기에서 주민번호 뒷자리 6개를 가린다 · 2026-11-11
--
-- 원장 2026-11-11 *"주민번호 앞자리 6개 및 뒷자리 1개만 보내. 나머진 됐고"* — 멘트 시험에서 '적음' 단계가 이력서 서식(form_data)을
-- 통째로 조회해 주민번호 13자리가 AI 입력에 들어갔다(E2-low · 화면에는 앞 6자리). 11-06 결정(그 지점 표 전부 — 급여·계좌·연락처 포함)은
-- 그대로 두고 주민번호만 '891003-1******'(생년월일 6자리 + 뒷자리 첫 자리)로 보인다. 설계 = docs/features/academy-assistant.md §2.
-- 가림 = s2_0031 §4 masked_columns(자리 PIN과 같은 방식) — 보기 안의 식이라 비서 역할은 원문을 볼 길이 없다(원래 표 권한 없음).
-- 🔴 식에는 pg_catalog 함수만 — 실행 계획 검사(server/executor.ts planProblem)가 다른 스키마 함수를 거절한다(함수를 만들어 부르지 말 것).
--
-- 가리는 곳(운영 2026-11-11 전수 확인: 주민번호 꼴 = academy_documents 47줄뿐 · 다른 표의 13자리 일치는 해시·id):
--   academy_documents.form_data — 이력서 personal.residentId(줄표 없이 적어도) + 서식 어디든 '######-#######'(ASCII 줄표) 꼴
--                                  + 직원 등록 QR 서식(form_type staff_intake_token)의 공유키 token(비밀값 — 재리뷰 2026-11-11)
--                                    🔴 `#-`·`-`는 객체가 아닌 값(글자·숫자·null)에서 오류를 내 그 칸 조회 전체가 멈춘다 — 객체일 때만 지운다(재리뷰)
--   payslips.print_payload      — 발행 스냅샷 teacher.residentRegNo(발행 때 이력서에서 옮겨 동결 — 지금 0줄, 앞으로 생긴다) + 같은 꼴
-- 🔴 DB 가림은 이 두 칸·이 꼴만이다 — 다른 칸·다른 꼴(줄표 없이 · 띄어 · 긴 줄표 · 전각)은 앱이 조회 결과를 AI에 넘기기 전에 한 번 더 가린다
--    (src/features/assistant/pii-mask.ts · executor `cell` — 모든 글자 칸).
-- 줄표 꼴 치환은 JSON 글자 안에서만 일어난다(숫자 값에는 줄표가 들어갈 수 없다) — 다시 jsonb로 읽어도 깨지지 않는다.
-- 앱 배포와 순서 상관없음(보기 칸 이름·타입 그대로). 적용하면 다음 질문의 '바뀌었을 때만 다시 만들기'가 아니라 여기서 바로 다시 만든다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0067-assistant-mask-resident-no.sql

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

insert into assistant_private.masked_columns (table_name, column_name, expr, reason) values
  ('academy_documents', 'form_data', $m$case
     when t.form_type = 'staff_intake_token' and jsonb_typeof(t.form_data) = 'object'
     then regexp_replace((t.form_data - 'token')::text, '([0-9]{6}) *- *([1-8])[0-9]{6}', '\1-\2******', 'g')::jsonb
     when jsonb_typeof(t.form_data #> '{personal,residentId}') = 'string'
      and length(regexp_replace(t.form_data #>> '{personal,residentId}', '[^0-9]', '', 'g')) >= 7
     then jsonb_set(regexp_replace(t.form_data::text, '([0-9]{6}) *- *([1-8])[0-9]{6}', '\1-\2******', 'g')::jsonb, '{personal,residentId}',
            to_jsonb(substr(regexp_replace(t.form_data #>> '{personal,residentId}', '[^0-9]', '', 'g'), 1, 6) || '-'
                     || substr(regexp_replace(t.form_data #>> '{personal,residentId}', '[^0-9]', '', 'g'), 7, 1) || '******'))
     else regexp_replace(t.form_data::text, '([0-9]{6}) *- *([1-8])[0-9]{6}', '\1-\2******', 'g')::jsonb
   end$m$,
   '주민번호 뒷자리 6개(원장 2026-11-11 — 앞 6자리 + 뒷자리 첫 자리만) · 직원 등록 QR 공유키(token — 비밀값)'),
  ('payslips', 'print_payload', $m$case
     when jsonb_typeof(t.print_payload #> '{teacher,residentRegNo}') = 'string'
      and length(regexp_replace(t.print_payload #>> '{teacher,residentRegNo}', '[^0-9]', '', 'g')) >= 7
     then jsonb_set(regexp_replace(t.print_payload::text, '([0-9]{6}) *- *([1-8])[0-9]{6}', '\1-\2******', 'g')::jsonb, '{teacher,residentRegNo}',
            to_jsonb(substr(regexp_replace(t.print_payload #>> '{teacher,residentRegNo}', '[^0-9]', '', 'g'), 1, 6) || '-'
                     || substr(regexp_replace(t.print_payload #>> '{teacher,residentRegNo}', '[^0-9]', '', 'g'), 7, 1) || '******'))
     else regexp_replace(t.print_payload::text, '([0-9]{6}) *- *([1-8])[0-9]{6}', '\1-\2******', 'g')::jsonb
   end$m$, '주민번호 뒷자리 6개(원장 2026-11-11 — 앞 6자리 + 뒷자리 첫 자리만)')
on conflict (table_name, column_name) do update set expr = excluded.expr, reason = excluded.reason;

-- 정책 표가 바뀌어 지문이 달라졌다 — 지금 다시 만든다.
select public.assistant_refresh_views_if_stale();

-- 사후 확인 — 보기는 지점 증표 없이는 0행이라, 같은 식을 원래 표에 걸어 가린 뒤에 남은 주민번호 꼴이 없는지 센다.
-- (앞뒤가 숫자·소수점이 아닌 13자리만 — 명세서 지표의 긴 소수 '0.0891…'는 주민번호가 아니다.)
do $$
declare
  v_expr text;
  v_left bigint;
  v_def text;
  c record;
begin
  for c in select * from (values ('academy_documents', 'form_data'), ('payslips', 'print_payload')) as x(tbl, col) loop
    select m.expr into v_expr from assistant_private.masked_columns m where m.table_name = c.tbl and m.column_name = c.col;
    if v_expr is null then raise exception 's2_0067 사후 확인: %.% 가림식이 없습니다', c.tbl, c.col; end if;
    execute format('select count(*) from public.%I t where (%s)::text ~ %L', c.tbl, v_expr,
                   '(^|[^0-9.])[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01]) *-? *[1-8][0-9]{6}([^0-9]|$)')
      into v_left;
    if v_left > 0 then raise exception 's2_0067 사후 확인: %.% 가린 뒤에도 주민번호 꼴이 %줄 남았습니다', c.tbl, c.col, v_left; end if;
    if c.tbl = 'academy_documents' then
      execute format('select count(*) from public.academy_documents t where t.form_type = %L and (%s) ? %L', 'staff_intake_token', v_expr, 'token') into v_left;
      if v_left > 0 then raise exception 's2_0067 사후 확인: 직원 등록 QR 공유키가 %줄 남았습니다', v_left; end if;
    end if;
    select pg_get_viewdef(format('assistant.%I', c.tbl)::regclass) into v_def;
    if v_def not like '%regexp_replace%' then raise exception 's2_0067 사후 확인: 보기 assistant.%가 가림식으로 다시 만들어지지 않았습니다', c.tbl; end if;
  end loop;
end $$;

commit;
