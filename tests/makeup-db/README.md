# 보강 원장 SQL — 계약과 검증

마이그레이션 `supabase/migrations/0343a ~ 0350f`(49개, 각 200줄 이하)의 외부 계약과 로컬 검증 방법이다.
운영 DB에는 적용하지 않았다. 여기 데이터는 전부 합성이다.

## 1. 구조

| 파일 | 내용 |
|---|---|
| 0343a–f | 표 15개(정책 버전·케이스·근거·회차·참여·배정·실시·인정·조정·이벤트·명령·기존 예약 연결·반영 작업·대사·대사 실행 기록), RLS, 권한 회수, 행 보호 트리거 |
| 0344a–c | 행위자·메뉴 권한·범위 helper, 설정 가드(운영 모드·기능 목록), 교시표 해석, 대사·작업의 1:N 연결과 읽기 범위 |
| 0345a–f | 잠금·개정 번호·수량 재계산·이벤트·대사 helper, 자원/학생 검사, 실시 증거 검사, 출결 효과 검증·반영, 케이스 잠금 공유·노쇼 되돌리기 |
| 0346a–l | 명령 본체(접수·승인·예약·참여·검토·조정·종결·기존 예약 연결·대사 해결·설정) + 수납 확인 대사 |
| 0347a | 진입점 `public.makeup_command` |
| 0348a–i | 읽기 RPC 9개(가져오기 미리 보기 포함) + 반영 실패 기록 RPC + 읽기 출력 정리(범위·수납 가림) |
| 0349a–f | 기존 예약·보고서 보호, 출결·시간표·직원·인계·보고서 관측 트리거, 대사 실행 |
| 0350a–f | 사용성 보완(2026-10-05): 상세의 파생 값 helper(다시 인정할 수 있는 분량·출결 연결·참여별 할 수 있는 일) · 상세·선택지·대사 출력에 칸 추가 · 일정 변경(다 비운 옛 회차를 먼저 닫음) · 출결 반 복구 뒤 관측. 앞 파일의 같은 함수를 바꿔 끼운다 — **0346d·0346k·0348b·0348d·0348h를 다시 실행했으면 0350도 다시 실행한다** |

- 새 표는 직접 쓰지도 읽지도 못한다. `anon`·`authenticated`는 표 권한 0, `service_role`은 SELECT만.
- 쓰기는 `makeup_command` 하나(+ 실패 표시를 남기는 `makeup_note_effect_gap`). 핵심 표는 명령 밖 쓰기를 트리거가 거절한다.
- 이 SQL은 `attendance_records`·`lesson_reports`·청구 표를 **쓰지 않는다**(실행기가 정적으로 확인한다).

## 2. 명령

`makeup_command(p_command_id uuid, p_action text, p_payload jsonb, p_expected_revision integer default null) → jsonb`

- **사용자 세션 클라이언트로만** 부른다. 행위자는 `auth.uid()` → 지금의 `public.users` 행이다(인자로 넘기는 길이 없다).
- 성공: `{id, revision, replayed, effect_key, action, case_id, case_ids[], session_id, participant_id, fulfillment_id, quantities|null, warnings[], …}`
- 실패: 예외(전체 롤백). `message`는 화면용 한글, `details`는 `{"code": …}` JSON.
  `forbidden`(42501) · `mode_off` · `mode_draining` · `invalid` · `not_found` · `conflict` · `live_commitments` ·
  `stale_revision` · `command_conflict` · `evidence_required`.
- 같은 `command_id`를 같은 사람이 같은 내용으로 다시 보내면 저장된 결과(`replayed: true`)를 돌려준다.
- `p_expected_revision` 필수: approve · deny · assign · hold · resume · close · waive · adjust(케이스), cancel · reschedule(참여/회차),
  verify · reverse(실시), resolve_reconciliation(대사 또는 반영 작업).

| action | 권한 | payload |
|---|---|---|
| intake | 쓰기(강사는 지금 담당 반) | student_id, reason, original_class_id, original_date, subject_key, source_kind, source_id, note, owner_id, due_date |
| approve / deny | 원장·관리자 | case_id, target_minutes, policy_version_id, owner_id, due_date, note / case_id, reason |
| assign | 지점 전체 운영 | case_id, owner_id, due_date(승인된 건은 원장·관리자), reason |
| reserve | 쓰기(강사는 본인 수업·담당 건) | student_id, allocations[{case_id, minutes}], anchor_class_id + 새 회차{session_date, period_ids[], teacher_id, classroom_id, capacity} 또는 session_id |
| reschedule / cancel | 쓰기 | session_id, participant_id, 새 회차 필드, reason / session_id 또는 participant_id, reason, cause |
| participation | 지점 전체 운영 또는 그 회차 강사 | participant_id, status, **actual_minutes(필수)**, 증거(report_id · learning_summary · attendance_record_id), teacher_id(가져온 회차), effect_key, reason |
| submit | 지점 전체 운영 또는 그 회차 강사 | participant_id, report_id 또는 learning_summary, homework |
| verify / reverse | 원장·관리자(실제 강사 본인은 불가) | fulfillment_id, recognitions[{case_id, minutes}] 또는 status:'returned' + reason / fulfillment_id, reason |
| waive / adjust | 원장·관리자 | case_id, minutes, reason / case_id, minutes(±), due_date, reason |
| hold / resume / close | 지점 전체 운영 / 원장·관리자 | case_id, reason, hold_review_at / case_id / case_id, closure_reason, reason |
| link_legacy | 지점 전체 운영 | source_id(= makeup_reservations.id), expected_source_hash(선택 — 미리 보기의 값. 다르면 쓰기 전에 거절), batch_id(선택). 예약의 학생·반이 이 지점의 것이 아니거나 연결된 출결 행이 그 학생·반·보강일의 것이 아니면 거절 |
| resolve_reconciliation | 지점 전체 운영(시수·근거·수납·원수업 충돌·수량은 원장·관리자) | reconciliation_id, status, reason, accept_manual_units, anchor_class_id **또는** projection_id, status(생략·done = 다시 확인 · failed), reason |
| reconcile | 지점 전체 운영 | reason(필수) → `{run{status, checked, opened, resolved, error}}` |
| configure | 원장 | mode(off·on·draining), policy{label, effective_from, allowed_reasons, note} — 범위를 넓히는 값은 거절 |

### 고정된 규칙

- 수량: O = 목표 + 조정 − 인정 − 면제, C = Σ(배정 − 인정 − 해제), R = O − C. 음수는 거절한다.
- **참여**: 실제 분은 반드시 명시한다(예정 분으로 채우지 않는다). 왔다·일부는 실시 증거가 있어야 한다 —
  `report`(반 없는 보강 보고서 · 실제 강사 작성 · 출결 반 일치 · 발송/회수 처리 중 아님) · `manual`(지도 근거 글) ·
  `attendance`(**정규 수업이 없는 날**의 출결 반 출결 행). 정규 수업일의 출석은 증거가 아니다 → `evidence_required`.
  결과에 `evidence_kind`, `projection_state`(pending·done·failed), `verification{ok, code, …}`,
  `evidence{attendance_record_id, session_units, taught_by, report_id, actual_teacher_id}`가 온다.
- **출결 효과**(작업 `att:<참여 id>`)는 서버 검증만이 done으로 만든다: 그 칸의 최신 유효 행 · 상태 · 귀속 강사(`taught_by` 또는 그날 담당) ·
  교시 · 같은 날 정규 강사 · 실제 시수 = 서버 예상 시수. 명령 성공·사람의 사유·요청의 `status: done`은 완료를 정하지 못한다.
- **예상 시수**는 서버가 계산한다(요청의 `manual_units`·`expected_*`는 주장값으로만 남는다). 기존 자동 시수와 같은 식:
  정규 = ceil(그날 그 반 수업 분 ÷ 60) ÷ 2(자리 교시 제외 · 같은 시작 시각 한 번), 보강 = ceil(회차 분 ÷ 60) ÷ 2, 상한 20.
  자동 시수를 쓰지 않는 지점(`preset = generic`)·수학이 아닌 과목은 시수를 대조하지 않는다.
- **시수·출결 대사**(units_mismatch · units_review · attendance_observed)는 종결과 검토(verify)를 막는다. 닫히는 길은 둘뿐:
  출결을 정정해 사실이 맞게 되거나(관측이 닫는다), 원장·관리자가 `accept_manual_units: true` + 사유로 승인한다(감사로그).
  승인은 그 순간의 증거 스냅샷(출결 행·상태·시수·귀속 강사·출결 반·참여 상태)과 함께 남고, 그 뒤 검증은 증거가 **정확히 같을 때만**
  `ok: true · code: accepted_manual_units`를 돌려준다(작업 done과 검증 ok가 어긋나지 않는다). 증거가 바뀌면 다시 열린다.
  원장은 어느 경로에서도 시수를 고치지 않는다.
- **노쇼 되돌리기**는 정원·강의실·학생 시간·남은 분량을 다시 검사한다(그 사이 찬 자리·잡힌 분량을 되살리지 않는다).
  그 배정이 걸린 건이 이미 종결됐으면 거절한다(`reason: case_closed`) — 새 건·새 일정으로 잡는다.
- 추가 지도는 접수·승인까지만 된다(예약 확정은 첫 운영 범위 밖). 자기 검토는 항상 거절.
- 첫 운영 범위는 서버가 고정한다: 대상 과목 = `["math"]`, 추가 지도 꺼짐. `configure`가 범위를 넓히는 값을 거절하고,
  유효 설정(`makeup_private.settings`)은 저장값과 무관하게 이 범위다.

## 3. 읽기 RPC · 실패 표시 RPC

꺼짐이면 예외(`mode_off`) — 빈 목록으로 답하지 않는다. 범위: full(또는 강사가 아닌 readonly)은 지점 전체, 그 밖은
담당자 · 지금 담당 반 · 내가 맡은 회차. 대사·작업은 **닿는 케이스·참여**(1:N) 기준으로 보이고 막는다(0344c) —
참여가 적힌 항목은 그 참여의 건에만, 회차 단위 항목은 그 회차의 건 전부에 닿는다.
🔴 밖으로 나가는 번호(case_id · case_ids · participant_id · participant_ids · detail/payload 안의 같은 키 · legacy_maps)는 **행위자 범위
안의 것만** 남는다(0348h). 수납 확인 대사의 내용과 `quantity_basis`는 수납 읽기 권한(0158a)이 있어야 나가고, 없으면
`restricted: true`(항목이 있다는 사실만)다.

| RPC | 반환 |
|---|---|
| `makeup_list_cases(p_filter)` | `{mode, total, page, page_size, rows[], counts{}, last_success_at}` |
| `makeup_case_detail(p_case_id)` | `{mode, today, case, policy, quantities, sources[], sessions[], participants[], allocations[], fulfillments[], recognitions[], adjustments[], events[](최근 50), events_total, reconciliation[], projection_jobs[], legacy_maps[], permissions{}}` — 0350: `participants[].actions{record,submit,cancel,reschedule}` · `blocked{…: 까닭 코드\|null}` · `anchor_class_name` · `attendance_link`(linked·pending·failed·none), `allocations[].recognizable_minutes`(검토가 받아 주는 최대 분 — 검토와 같은 식), `fulfillments[].evidence_kind`, 추가 지도 건은 `permissions.reserve = false` |
| `makeup_case_events(p_case_id, p_filter{page, page_size≤100})` | `{rows[{id, event_type, actor_name, reason, occurred_at, …}], total, page, page_size}` |
| `makeup_list_participants(p_filter)` | `{mode, participants[], legacy_maps[], truncated, total, page, page_size, next_after}` |
| `makeup_list_reconciliation(p_filter)` | `{mode, total, page, page_size, rows[], projection_jobs[], projection_total, projection_page, projection_page_size, projection_pending, projection_failed, last_success_at, last_run, permissions{resolve_reconciliation, reconcile, accept_manual_units}}` |
| `makeup_options(p_filter)` | `{rows[{id, name, …}], total, page, page_size}` — staff는 강사 범위에서 본인만 · policies는 원장·관리자만. 0350: students 줄에 `school · grade · class_names[]`, classes 줄에 `active`. `purpose`(classes 전용 · `student_id`+`session_date` 필수): `anchor` = 출결 반 후보(`resolve_anchor`와 같은 조건) · `original` = 원수업 반 후보(접수와 같은 조건 — 지금 종료된 반 포함) |
| `makeup_candidates(p_filter)` | `{rows[], total, page, page_size, date_from, date_to}` — 기간을 주지 않으면 전 기간 |
| `makeup_legacy_dry_run(p_filter)` | `{rows[…, source_hash, occurrence_key, evidence_grade(A~E), duplicate_count, review_note], total, page, page_size(≤200), counts{A,B,C,D,E}, writes: 0}` — 연결 안 된 기존 예약의 가져오기 미리 보기(읽기 전용). B = 이행 + 그 칸의 최신 유효 출결 + 유효한 보강 보고서 **둘 다**(하나뿐이면 C). 예약·학생·반이 같은 지점일 때만 나온다 |
| `makeup_projection_evidence(p_effect_key)` | `{effect_key, participant_id, state, verification, evidence}` — 읽기 전용 |
| `makeup_note_effect_gap(p_gap)` | `{queued:true, id, effect_key, kind, state, projection_state, case_ids[]}` |

- **참여 명단 넘겨 읽기**: 정렬은 항상 `session_date, start_time(HH:MI), id`. `after{session_date, start_time, id}`(그 키 다음부터) 또는
  `page` + `page_size`/`limit`(최대 500). 둘 다 오면 `after`. `truncated` = 뒤에 줄이 더 있다, `next_after` = 마지막 줄의 키.
  커서 모양이 틀리면 거절한다.
- **반영 실패 표시**(`makeup_note_effect_gap`): `{effect_key, kind, participant_id, reservation_id, error}`. 사용자 세션만(관리자
  클라이언트는 실행 권한 없음). (effect_key, kind)에 멱등. 닿는 케이스의 종결을 막고, 서버 검증이 맞게 끝나면 스스로 닫힌다.
- 출결 반 확인(anchor_missing) 줄에는 `anchor_context{student_id, subject_key, session_date}`가 온다(그 참여가 범위 안일 때만 — 0350f).
  `resolve_reconciliation`에 `anchor_class_id`를 주면 결과에 `anchor_class_id` · `anchor_verification{state, ok, code}`가 온다(관측만 — 0350e).
- 대사 `kind`: source_conflict · units_review · units_mismatch · attendance_observed · evidence_removed · quantity_drift(이상 종결 차단) ·
  timetable_conflict · owner_inactive · teacher_inactive · handover_review · anchor_missing · legacy_done_review ·
  legacy_multi_same_day · legacy_checksum_conflict · billing_review. 행마다 `summary`(화면용 한 줄)와 `case_ids`가 온다.

## 4. 설정 · 기존 표 보호 · 관측

- 정본은 `tenant_settings.data.makeups = {mode, allowAdditional, pilotSubjects}`. `configure`로만 바뀐다(직접 PATCH 거절).
- off 전환은 열린 케이스·열린 대사·미처리 작업이 0건일 때만. on·draining으로 저장하면 `modules.disabled`에서 `makeups`를 뺀다.
  켜짐·정리 중에 `modules.disabled`에 `makeups`를 새로 넣는 직접 쓰기는 거절된다(열린 업무가 메뉴째 숨지 않게).
- 연결된 `makeup_reservations`·`lesson_reports` 행의 직접 삭제·핵심 칸 변경은 모드와 무관하게 거절된다(꺼진 뒤에도).
- 출결 저장(INSERT·UPDATE·DELETE), 정규 시간표·수강·학생 상태·담임 저장, 직원 비활성은 **막지 않는다**. 관측 트리거가
  대사·반영 작업으로 남기고, 안에서 실패하면 그 학생·그날의 참여·케이스를 적은 failed 작업을 남긴다.
- 종강·수강 종료/휴원·퇴원·담임 변경 뒤에도 열린 보강은 그대로 두고 인계 항목(handover_review)을 연다.
- 대사 실행: 명령 `reconcile`(사람) · `public.makeup_reconcile_tenants()`(service_role 전용 — 주기 실행에서 부른다). 탐지만 한다.
- 관측·대사 실행은 쓰기 전에 닿는 케이스 행을 잠가 종결과 줄을 선다(0345f). 닫힌 건이어도 증거(출결 행·연결한 보고서·원결석)가
  나중에 바뀌면 항목이 열려 목록에 보인다(`counts.closed_recon_open`). 증거가 그대로인 done 반영은 다시 뒤집지 않는다.
- 연결한 보고서가 회수되거나 보강 표시·보강 반이 바뀌면 `evidence_removed`(detail.source = report)가 열린다(0349f).
- 원장의 연결 칸(직원·강의실·출결·보고서)은 그 바깥 행이 **실제로 지워질 때의 참조 무결성 동작**으로만 빈다 — 직접 UPDATE는 거절.

## 5. 실행

```sh
# 격리된 로컬 Postgres(127.0.0.1) 전용. DB 이름은 makeup_ 으로 시작해야 한다.
MAKEUP_DB_NAME=makeup_claude node tests/makeup-db/run.mjs --reset        # fixture로 스키마 재생성 + 전부 실행
MAKEUP_DB_NAME=makeup_claude node tests/makeup-db/run.mjs --only 14_     # 시나리오 일부만
MAKEUP_DB_NAME=makeup_claude node tests/makeup-db/run.mjs --real-chain   # 실제 마이그레이션 전부로 만든 스키마 위에서 전부 실행
```

- 정적 대조: 출결·보고서·청구 표를 쓰는 문장 없음 · 파일 200줄 이하 · 기본 교시표 미러(`periods.ts`) · 자리 교시 이름
  미러(`teacher-label.ts`) · **fixture ⊆ 실제 마이그레이션 체인**(표·칸·enum 값·함수 — `real-chain.mjs`).
- `--reset`: `fixture.sql`(Supabase 역할·`auth.uid()`·기존 표의 필요한 칸과 실제 제약·트리거) + 실제 `0264a` + 원장 43개(두 번) + `seed.sql`.
- `--real-chain`(`real-apply.mjs`): 합성 Supabase 플랫폼(auth·storage·역할) 위에 저장소의 실제 마이그레이션을 파일마다 따로
  적용하고(플랫폼 탓에 적용되지 않는 파일은 목록으로 출력), 원장 43개를 적용 + 재실행(실패 0 필수)한 뒤 같은 시나리오를 돌린다.
  끝난 뒤 fixture로 돌아가려면 `--reset`.

| 파일 | 다루는 기준 |
|---|---|
| 01_grants_auth | MU-023·036·038·039·041·077 |
| 02_intake_cases | MU-002·003·006·007·008·009·010·011·012·049·065·071·076·081, X04·X06 |
| 03_reserve_resources | MU-015·016·017·018·019·038·070, X01·X02·X03·X18 |
| 04_quantities | MU-013·014·020·021·028·031·051·068·078·080, X07·X08·X09·X10 |
| 05_participation_review | MU-010·025·026·033·064·069·076·079, X12·X16·X17·X19 |
| 06_legacy | MU-055·056·072·073·074·075, X05·X14 |
| 07_regular_writers | MU-007·008·024, X13 |
| 08_read_rpcs | MU-048·049·050·059·077 |
| 09_mode_settings | MU-058, X14 |
| 10_core_flow | MU-001·003·005·025·029·030·034·067 |
| 11_billing_review | MU-035, X11 |
| 12_options_candidates | MU-049 + 화면용 선택지·미연결 근거 |
| 13_evidence | MU-025·026·029·069·076, X02·X12 |
| 14_units_resolve | MU-033·034·052, X03·X16·X17·X19 |
| 15_no_show_restore | MU-015·016·020·068, X07 |
| 16_pilot_guards | MU-006·058·073·076, X06·X14 |
| 17_paging | MU-036·049·050 |
| 18_observers_reconcile | MU-007·008·024·034·053, X16·X17 |
| 19_effect_gap | MU-026·034·036·052, X16 |
| 20_read_scope | MU-036·038·077(읽기 출력 범위·수납 가림) |
| 21_accept_restore_basis | MU-020·031·034·035, X11·X19(승인된 시수 · 닫힌 건 되돌리기 · 수납 기준 표) |
| 22_closed_evidence_guards | MU-010·031·034·053·075, X16·X17(닫힌 건의 증거 변경 · 보고서 회수/삭제 · 연결 칸) |
| 23_legacy_dry_run | MU-054·055·056·074(가져오기 미리 보기 · 등급 · 1,001건 넘겨 읽기 · 바뀐 예약 연결 거절) |
| 24_dry_run_evidence_tenant | MU-023·054·056(B = 출결 + 유효 보고서 둘 다 · 다른 지점을 가리키는 예약의 비노출·연결 거절) |
| 26_reschedule_vacate | 사용성 감사 A02(강의실만 바꾸기 · 남은 학생이 있을 때의 진짜 충돌 · 실패 시 전부 되돌림) |
| 27_recognizable | 사용성 감사 A01(반전 뒤 다시 인정할 수 있는 분량 = 검토의 식 · 새 예약이 잡은 분량 침범 없음 · 재시도 한 번만) |
| 28_detail_actions | 사용성 감사 A11·A10·R01(참여별 할 수 있는 일과 명령의 판정 일치 · 추가 지도 예약 힌트 · 출결 연결 표시 · 옛 칸 보존) |
| 29_anchor_resolve | 사용성 감사 A03(출결 반 후보 · 잘못된 반 거절 · 맞는 반 저장 + 관측 · anchor_context 범위) |
| 30_options_disambiguation | 사용성 감사 A04·R04(동명이인 단서 · 원수업 반 후보 — 종료된 반 포함 · 옛 호출 그대로) |
| concurrency/01_races · 02_restore_race · 03_close_locks | MU-001·015·020·053·066·067, X13·X16·X17(두 연결) |

시나리오 날짜는 전부 "오늘(KST) + n일"이다. `mt.backdate`·`mt.as_command`는 검증 전용 경로다(운영에는 없다).
