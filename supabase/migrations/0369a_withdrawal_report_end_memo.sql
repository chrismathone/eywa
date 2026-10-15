-- 0369a — 퇴원보고서 처리 때 닫는 수강 줄에도 상세사유 글을 메모로(원장 2026-10-15 *"기타는 모든 곳을 일치하게"*).
--
-- 퇴원보고서는 제출 때 상세사유를 200자 이상 받는다('기타'여도 실제 사유 글이 늘 있다). 그런데 처리 때 그 글을 **학생**의 퇴원
-- 메모(`students.withdrawal_metadata.memo`)에만 옮기고 **수강 줄**(`enrollments.withdrawal_memo`, 0367a)엔 안 옮겼다 —
-- '수강종료'로 처리된 보고서는 퇴원관리 명단에 메모 없는 '기타'로 섰다(다른 길은 모두 '기타'면 메모가 있다).
-- → 두 전이 함수(`transition_withdrawal_report` 묶음용 · `_v1` 한 건용)가 수강 줄을 닫는 그 한 줄에 메모를 더한다.
--    본문은 그대로 두고 그 줄 글자만 바꾼다(0367a와 같은 방식 — 소유자·권한·security invoker 그대로). 바꿀 줄이 정확히 하나가
--    아니면 중단한다(조용히 넘어가지 않게) · 이미 바뀌었으면 건너뛴다(다시 돌려도 같다).
-- 메모 = 그 수강의 담임이 쓴 보고서의 상세사유(사유와 같은 보고서 — 묶음 보고서는 담임마다 한 건).
--
-- ② 수강 보호 트리거(`student_status_private.guard_enrollment`, 20261015160100)의 '날짜 수정' 갈래 — 종료일이 잡힌 수강을 같은
--    사유로 다시 종료하면서 세부·메모가 바뀌면, 원생 상태 변경 권한이 있는 사람(원장 포함)도 '수강 날짜 수정 범위를 벗어난 변경'으로
--    막혔다(리뷰 2026-10-15 — 수강 종료가 이제 세부·메모를 함께 쓰므로 생긴 길). 그 권한(`allowed()`)이 있으면 막지 않는다 —
--    날짜만 고칠 수 있는 사람은 여전히 세부·메모를 못 바꾼다(앱의 수강 종료도 같은 권한을 먼저 본다).
--
-- 앱 배포와 순서 무관(앱은 이 함수들을 부르기만 한다).
-- ⚠️ 빈 DB에 파일 이름 순서로 처음부터 깔면 이 파일이 함수를 만드는 타임스탬프 파일들보다 먼저 돌아 멈춘다(0367a와 같다 —
--    README 참고). 이미 운영 중인 DB에 손으로 적용하는 데는 상관없다.
begin;
set local lock_timeout = '5s';

do $$
declare
  definition text;
  hits integer;
  g_old constant text := $q$withdrawal_reason=(select q.body->>'reason' from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id and q.teacher_id=c.teacher_id and c.subject=any(q.subjects) limit 1)$q$;
  g_new constant text := $q$withdrawal_reason=(select q.body->>'reason' from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id and q.teacher_id=c.teacher_id and c.subject=any(q.subjects) limit 1),
    withdrawal_memo=(select nullif(btrim(q.body->>'detail'),'') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id and q.teacher_id=c.teacher_id and c.subject=any(q.subjects) limit 1)$q$;
  v_old constant text := $q$withdrawal_reason=r.body->>'reason',is_transferred=false$q$;
  v_new constant text := $q$withdrawal_reason=r.body->>'reason',withdrawal_memo=nullif(btrim(r.body->>'detail'),''),is_transferred=false$q$;
  t_old constant text := E'is null) then\n      raise exception ''수강 날짜 수정 범위를 벗어난 변경입니다''; end if;';
  t_new constant text := E'is null) and not student_status_private.allowed() then\n      raise exception ''수강 날짜 수정 범위를 벗어난 변경입니다''; end if;';
begin
  -- 묶음 보고서(지금 쓰는 함수)
  select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  if position('withdrawal_memo' in definition) = 0 then
    hits := (length(definition) - length(replace(definition, g_old, ''))) / length(g_old);
    if hits <> 1 then
      raise exception '0369a: transition_withdrawal_report에서 바꿀 줄이 하나가 아닙니다(%건)', hits;
    end if;
    execute replace(definition, g_old, g_new);
  end if;

  -- 한 건 보고서(옛 함수 — 묶음이 아닌 보고서가 아직 이 길로 간다)
  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  if position('withdrawal_memo' in definition) = 0 then
    hits := (length(definition) - length(replace(definition, v_old, ''))) / length(v_old);
    if hits <> 1 then
      raise exception '0369a: transition_withdrawal_report_v1에서 바꿀 줄이 하나가 아닙니다(%건)', hits;
    end if;
    execute replace(definition, v_old, v_new);
  end if;

  -- 수강 보호 트리거 — 날짜 수정 갈래의 세부·메모 거절에 '원생 상태 변경 권한이 없을 때만'을 붙인다(줄바꿈은 E 문자열의 \n 이스케이프 — 체크아웃 줄바꿈과 무관).
  select pg_get_functiondef('student_status_private.guard_enrollment()'::regprocedure) into definition;
  if position(t_new in definition) = 0 then
    hits := (length(definition) - length(replace(definition, t_old, ''))) / length(t_old);
    if hits <> 1 then
      raise exception '0369a: guard_enrollment에서 바꿀 줄이 하나가 아닙니다(%건)', hits;
    end if;
    execute replace(definition, t_old, t_new);
  end if;
end $$;

commit;
