# 보강관리 개선 구현 인수인계 — 2026-10-06

현재 완료된 것은 **객관적 감사와 Codex·실제 Claude의 구현계획 합의**다. 보강관리 개선 앱·SQL은 아직 구현하지 않았다. 사용자의 “구현 계획을 handoff로 남겨서 커밋푸시”, 이어서 “지금 그렇게 해놓는게 낫겠네” 지시에 따라 이 문서·계획·검토 근거를 main에 커밋·푸시한다.

## 먼저 읽기

1. [승인된 최종 계획 v4](../../features/makeups/improvement-2026-10-06/plan-v4.md): 구현 기준 본문.
2. [합의 기록](../../features/makeups/improvement-2026-10-06/consensus.md), [기계 판독 기록](../../features/makeups/improvement-2026-10-06/consensus.json): 확정 결정과 검증 경계.
3. [Claude 최종 APPROVE](../../features/makeups/improvement-2026-10-06/claude-review-v4.md): 필수 지적 해소·구현 때 확인할 권고6개.
4. [저장소에 보관한 실제 앱 감사](evidence/review.md): 완료 집계 오류·등록 동선·관리자 현황의 근거. 같은 폴더의 JSON과 화면도 함께 읽는다.

계획 SHA256은 `83a48a5f62d0146895ac43ea014db4a5a199a77f74c970349830349ba70d6b74`다. 승인된 본문을 편집한 후 같은 합의를 재사용하지 말고 새 해시로 다시 검토한다. 과거 v1/v3는 수정 이력이며 현재 구현 기준이 아니다.

## 기준 커밋과 최신 main

- 감사·합의 소스: `fe45e47ad38a4e3bb5862fcc75c251871b0a189a`.
- 감사 브라우저 빌드: `a534465b8152b7c13df10cc4b11d4753dcb52205`. 감사 소스와의 차이는 문서뿐이었다.
- 문서 커밋 준비 중 원격 main의2개 커밋을 fast-forward로 반영했다. 커밋 직전 부모는 `ea9ab98e6557678b67b976505f65395673a3233a`다.
- 최신 반영은 운영 설정 저장·부서별 직급 읽기이며 `use-unsaved-guard.ts`, `use-concurrent-edit-guard.ts` 같은 공통 코드도 바뀌었다. 합의 소스가 최신 main의 실제 동작까지 검증했다고 주장하지 않는다. 구현을 시작할 때 관련 차이와 편집 보호 계약을 재확인한다.

최종 계획·독립 검토 문서는 승인 당시의 바이트를 보존했다. consensus.json의 미구현·SQL 미적용·미푸시 표시는 **계획 검토 종료 당시**의 상태다. 이후 이번 문서 커밋·푸시와 앱 구현/SQL 적용을 혼동하지 않는다.

## 문제와 확정 방향

| 문제 | 확정 방향 |
| --- | --- |
| 인정·종결된 참여가 대시보드 ‘보강예정/지남’에 남음 | 실시·인정·노쇼·반전·연결된 기존 이행 상태를 공통 SQL로 판정. 완료는 예정에서 제외하고 명단·보고서·영상숙제 이력은 보존 |
| 기존 예약이 새 장부에 자동으로 생기지 않음 | 미연결 앞으로/지난 예약 N과 이행 이력 M을 분리. 실제 연결 권한이 있는 직원만 명시적으로 연결. 자동 이관·승인 없음 |
| 강사가 학생·반·날짜를 반복 입력 | 실제 결석 문맥에서 서버가 확인한 값을 채운 접수 화면 제공. 확인+저장으로 승인 대기. 기존 당일 보강 추가/출결 흐름은 유지 |
| 관리자 업무 목록으로 실제 실시 일정을 한눈에 보기 어려움 | 기존 미처리 업무를 유지하면서 수학 보강 일정 탭 추가. 오늘·이번 주·직접 기간, 실시 강사·강의실·진행 상태 필터 |

## 구현 순서

1. **P0 — 조회·상태 계약.** 참여 조회의 선택 진행 계약과 공통 상태 도우미, 대시보드/학생 예정 수정. 구 DB의 응답도 공용 명단 파서가 허용해야 한다. `with_progress` 추가 계산은 필요한 예정/일정 조회에만 쓴다.
2. **P1 — 기존 예약 발견과 연결.** 후보 상태·날짜 필터/DB 전체 count·기능별 capability. 이미 연결된 legacy를 먼저 대체한 뒤 상태 조건 적용. 동일 날짜의 미연결 legacy와 native를 문자열로 합치지 않는다.
3. **P2 — 간편 접수.** 출석부·강사뷰 과거 결석 문맥의 공용 진입, 서버 최신 결석 검증, 검증된 기본값, 안전한 복귀, 승인 관측과 경고 표시.
4. **P3 — 관리자 일정.** 같은 DB 허용 집합에 filter/count/order/pagination. 한 참여는1행이며 복수 원결석 배분으로 늘리지 않는다. 실제 실시 강사와 업무 담당자를 구분한다.
5. **P4 — 검증과 적대적 리뷰.** 최종 계획의25개 수용 기준을 실제 실행하고 근거를 기록한다. 현재는 미실행이다.

P0 뒤 P1/P2를 진행하고 P3도 P0 상태 계약을 사용한다. 상세 구현·예외 판정표·25개 기준은 최종 계획을 따른다.

## 반드시 유지할 결정

- 수학 시범·on/draining/off 계약, 지점/학생/반/참여 권한, 분량 승인·독립 실시 검토, 시수·급여·청구 산식을 유지한다. 새 영어 운영·자동 권리/인정·자동 학부모 안내·셀프예약은 범위 밖이다.
- **0349b 출결 관측 함수·트리거는 변경하지 않는다.** v3의 출결 트리거 사건 잠금 제안은 철회됐다. 여러 줄 출결의 잠금 역전과 실패 격리 훼손을 만들지 않는다.
- intake의 기존 사건 키는 최신 결석 검증보다 앞선 별도 SQL 문장에서 잡는다. 출결 행을 잠그거나 고치지 않는다. 닿는 case를 최초 잠금부터 id순으로 잡는다.
- 승인 시 원수업 칸을 기존 관측 함수로 다시 본다. source_conflict가 열리면 승인과 확인 항목·warnings를 함께 커밋하고 화면에 남긴다. 관측 직후 예외로 거절하면 새 확인 항목도 롤백되므로 그 방식을 쓰지 않는다. 열린 항목은 기존대로 종결을 막는다. 폼이 사라진 뒤 경고와 동일 command_id replay도 검증한다.
- 강사 대시보드는 effectiveTeacherId의 **이번 주 담당 반 참여 ∪ 직접 실시하는 참여**를 표시한다. 지점 전체 조회 계정의 강사뷰에 전체 참여를 보여주지 않는다. 담당 반0개 강사의 본인 실시 참여는 보여야 한다.
- actual attendance 근거의 결석 접수만 메모를 선택으로 한다. 수동 결석·예정 결석·휴강·추가 지도는 메모 필수이며 서버에서도 강제한다.
- 기본 반은 검색어 없는 전체 후보 total=1일 때만 채운다. 원반은 원수업일, 출결 반은 실제 실시일 기준이다. 관리자 자신을 실시 강사로 자동 선택하지 않는다.
- raw return URL은 받지 않는다. 출처 enum과 검증된 id·날짜로 서버가 복귀 목적지를 만든다. autoClose·embed·mutation signal·미저장 보호를 유지한다.
- 일반 지점 화면 문구에 내부 플랫폼 역할·권한 우회 설명을 노출하지 않는다. Next 수정 전 설치된 `node_modules/next/dist/docs/`의 관련 문서를 읽는다.

## 주요 코드 위치

| 분야 | 먼저 볼 파일 |
| --- | --- |
| 완료 집계 | `src/features/dashboard/server/makeup-upcoming.ts`, `src/features/attendance/server/makeup-reservation-queries.ts` |
| 참여 계약 | `src/features/makeups/types.ts`, `command-parse.ts`, `server/adapters/participants.ts`, `supabase/migrations/0348c_makeup_read_lists.sql` |
| 후보·연결 | `components/candidate-action.tsx`, `supabase/migrations/0348e_makeup_read_candidates.sql`, `0346i_makeup_cmd_legacy_config.sql` |
| 접수·승인 | `components/intake-form.tsx`, `session-fields.tsx`, `option-picker.tsx`, `command-form.tsx`, `schemas.ts`, `server/actions.ts`, `0346a_makeup_cmd_intake.sql`, `0346b_makeup_cmd_decide.sql` |
| 진입 문맥 | `src/features/attendance/components/makeup-add-flow.tsx`, `makeup-confirm-dialog.tsx`, `src/features/onescreen/server/makeup-register-actions.ts`, `src/components/workspace/open-window-button.tsx` |
| 관리자 목록 | `src/features/makeups/components/case-list.tsx`, `list-navigation.ts`, `src/app/(shell)/makeups/` |
| 잠금·관측·반전 | `0345a_makeup_core_fns.sql`, `0345f` 계열, `0349b_makeup_attendance_observer.sql`, `0346g_makeup_cmd_adjust.sql`, `0347a_makeup_command.sql` |

표에서 짧게 쓴 components·SQL 파일명은 각각 `src/features/makeups/`와 `supabase/migrations/` 기준이다. 실제 수정할 때 `rg --files`로 현존 파일과 후속 재정의 migration을 확인한다. 옛 migration을 직접 고치는 대신 새 번호 migration으로 현재 최종 정의를 변경한다.

## 검증·적용의 경계

- 합성 DB 감사에서 실시 인정·종결 후 예정 잔존을 실제 앱으로 재현했다. 운영 데이터나 실제 직원 과제 수행 시간을 측정하지 않았다. 기존 S13 담당 반0개/타 반 배정 증거를 이번에 재실행한 것으로 세지 않는다.
- 구현 후 구 앱+새 DB / 새 앱+구 DB, 역할·다른 지점·겸직·다른 강사 뷰, 중복 접수, 출결 정정/삭제의 병행, 0분 인정·인정 반전, 연결된 완료 이력, 모든 모드, 페이지/필터/요약·창 갱신을 검증한다.
- 관측은 칸의 가장 나중 행을 보고, 후보 검증은 하루 중 유효 시수 행 존재를 본다. 이 기존 차이와 긴 출결 트랜잭션이 접수·승인 커밋 양쪽을 가로지르는 한계를 기록한다. 승인 warnings 화면·미니셸 진입·SQL 성능·변경 pgTAP는 아직 확인하지 않았다.
- 권한·잠금·tenant·EXECUTE/search_path와 실제 migration 체인·재적용, 관련 통합 회귀·타입·변경 lint·production build·390/1440px 화면을 확인한다. 의미 있는 실제 경로 시험을 사용한다.
- SQL은 사용자가 지시한 Supabase CLI/npx 파일 단위 실행·단일 트랜잭션으로 적용한다. 현재 최종 함수 정의 백업·정확한 undo와 다음 빈 migration 번호를 준비한다. 운영 이력표가 없는 환경에 전체 db push를 하지 않는다.
- Vercel 배포는 사용자 담당이다. 이번 문서 게시에서 앱/SQL 구현 완료·배포 검증을 주장하지 않는다.

## 자료·자원·커밋 범위

실제 Claude orchestration run `run_9475995b6dbc`의 세 검토가 모두 종료됐고, 최종 결과는 동일 해시 APPROVE다. 해당 Claude 터미널은 해제하고 transcript를 보관했으며 새 worktree는 만들지 않았다. 관련 검토 ID·보고서는 합의 문서에 있다.

감사 원본은 `F:/eywa-review/makeup-objective-audit-20261006`, 계획 원본은 `F:/eywa-review/makeup-improvement-plan-20261006`에 있다. 다른 컴퓨터에서는 저장소의 이 handoff와 `evidence/`, 최종 계획 폴더를 사용한다. 승인 문서 안의 외부 절대 경로는 당시 원본 위치다.

커밋 대상은 `docs/_handoff/makeup-improvement-2026-10-06/`와 `docs/features/makeups/improvement-2026-10-06/`뿐이다. 기존 미추적 `supabase/.temp/`는 이 작업에 포함하지 않는다. 커밋은 문서만 포함하는지 확인하고 정상 main push를 사용한다.
