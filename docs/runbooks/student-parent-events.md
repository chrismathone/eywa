# 학부모 설명회 최초 연결 실행 안내

원장이 2026-10-26에 **설명회 1회당 운영 기여 5점 반영**을 승인했다. 기존 1점 제안은 폐기했다. 이 승인 범위에서 0456a 적용, 검증을 통과한 최초 명단 연결, 5점 활성화와 기존 집계를 수행한다. 실제 실행에는 최신 원문과 DB를 대조한 지문을 사용하며 충돌한 명단을 임의로 확정하지 않는다.

실행 완료(2026-10-26): 0456a 적용 → 27개 시트 새 MCP 조회·해시 대조 → 14개 행사·33명·41건 저장 → 화면에서 5점 활성화 → 일반 집계 완료. 최초 import는 `39bed525-93df-4d8b-8d39-c213d115bbb1`이며 지문은 `7fcbed5b6eaaaba19cd50a6901ef50404ed261e00a94b1dc60bf4c05e206c577`이다. 이후에는 이 최초 가져오기를 새 후보로 반복하지 않는다. 기존 마감 11,941건 보존과 학생별 41건·205점 일치를 확인했다.

## 준비 자료

- 검토한 `EventSourcePack`: 파일·시트 전체 원문, 행사 식별/날짜·지점·열 해석·회차 매핑을 포함한다. 공개 저장소에 넣지 않고 gitignored `work/` 아래에 둔다.
- 자료 범위: 기존 36개 파일의 73개 시트와 추가 3개 파일의 11개 시트 내용을 조사했다. 연간계획 파일 한 개는 목차를 별도로 확인했다. 추가 자료는 행사 준비·직원/연사·집계 수치·초청 후보로 개인 신청 증거가 아니어서 자동 인정하지 않았다. 계정에서 접근 가능한 검색 결과를 대상으로 하며 다른 계정이나 접근 불가 자료까지 전수 확인했다는 뜻은 아니다.
- 최초 반영 pack은 지점 근거가 있는 9개 파일·27개 시트다. 같은 시트에 섞인 타 지점·초청 자료는 제외하고, 일자/신원/취소/회차 충돌은 보류한다. 날짜 7월 27일/28일과 5월 7일/3월 6일이 충돌하는 명단은 자동 승인하지 않는다.
- 전화번호 재점검에서 전체 셀이 같은 2022 명단의 사본을 대조하고, 시상식 명단의 중복 사본을 제외했다. 행별 행사 날짜, 두 날짜가 나뉜 구간, 2021 신청 원본의 범위와 취소 메모, 2024 명단 중간에 바뀐 연락처 열을 교정했다. 원본은 보존한다. 직원이 적은 복합 학생명과 날짜가 충돌하는 명단은 보류한다.
- 전화번호 집계는 해석한 신청 행 기준이다. 원문 전체의 전화번호 셀 수나 중복을 제거한 참석자 수가 아니다. 학생 DB 번호와 일치해도 이름·보호자·학교·행사일·취소 대조를 통과해야 인정한다.
- `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 기존 서버 환경을 사용한다. 비밀값은 명령 인자·보고서에 적지 않는다. HMAC 키는 원문 식별자 보호에만 쓰며 저장하지 않는다.

## 읽기 전용 준비

워크트리 루트에서 실행한다. 환경 파일 경로는 실제 설치에 맞추고 출력은 새로운 파일명으로 지정한다.

```powershell
node --env-file=<서버 환경 파일> node_modules/tsx/dist/cli.mjs scripts/student-contribution/parent-events/cli.ts prepare --sources work/<검토한-pack>.json --out work/<후보>.json
node --env-file=<서버 환경 파일> node_modules/tsx/dist/cli.mjs scripts/student-contribution/parent-events/report.ts work/<후보>.json work/<원장-보고서>.md
```

준비는 새 Drive 조회와 repeatable-read/read-only DB 트랜잭션이다. MCP로 읽으면 같은 날의 전체 파일·시트·셀 재조회 결과를 `FreshSourceSnapshot` 형식으로 저장하고 `prepare`에 `--verified-source-snapshot work/<당일-재조회>.json`을 전달한다. 옛 pack을 복사하거나 읽은 시각만 바꾼 파일을 대신하지 않는다. 시트의 뒤쪽 빈 칸·체크박스까지 전체 범위를 조회하며 결과 해시를 대조한다. 보고서에는 `driveVerifiedAt`가 남는다.

원장 보고서는 행사·학생·가족 건수, 직접/가족/형제 표본, 원본 위치, 현재 상태, 등록 전·퇴원 후 비교, 마감 보존, 최근 12개월·현재 달 정정 영향과 미확정 행별 확인 목록을 보여준다. 미확정 목록은 다른 지점·행사 범위 문제와 해당 학원 범위를 구별한다. 원문 연락처는 보고서에서 제외한다. 원문을 포함한 JSON은 반드시 `work/`에 보관한다.

**운영 5점/회, 취소되지 않은 신청 간주, 검증된 직접 형제 인정, 두 연간일정의 지점은 원장 확정 사항**이며 재승인을 요청하지 않는다. 기존 1점 후보는 실행하지 않고 최신 5점 후보의 학생별 범위와 지문을 검토한다. service-role 키가 교체되면 식별 지문도 바뀌므로 imports의 `identityKeyFingerprint`를 확인하고 별도 대조 없이 재가져오지 않는다.

## 승인 후 적용 순서

1. 최신 main의 마이그레이션 번호와 운영 적용 이력을 읽기 전용으로 확인한다. `0456a_student_parent_events.sql`만 대상으로 검토·적용한다. 다른 작업의 미적용 마이그레이션을 묶어 실행하지 않는다. 이 SQL은 명단을 넣거나 지표를 켜지 않는다.
2. 비활성 앱을 배포한다. 옛 앱과 새 스키마는 새 원수치 키가 없는 행을 계속 읽을 수 있다. 새 앱도 마이그레이션 전 상태를 자료 확인 전으로 표시한다.
3. 적용 직전에 Drive 원문 전체와 DB를 다시 대조한다. CLI의 `verifyDriveSources`는 읽기 전용 단기 Google 토큰(`GOOGLE_DRIVE_ACCESS_TOKEN`, 프로세스 환경만)을 이용한다. MCP를 사용하는 운영자는 같은 전체 재조회·해시 대조를 실행한 어댑터로 `applyInitialEvents`를 호출할 수 있다. **오래된 로컬 파일을 읽는 함수나 빈 함수를 검증 콜백으로 대신하지 않는다.** 검색 이후 별도 취소 명단/파일이 추가됐는지도 확인한다.
4. 같은 날 검증한 지문으로 최초 가져오기를 실행한다. 아래의 배점 승인 플래그는 원장이 확정한 5점/회를 기록한다.

```powershell
node --env-file=<서버 환경 파일> node_modules/tsx/dist/cli.mjs scripts/student-contribution/parent-events/cli.ts apply --sources work/<검토한-pack>.json --report work/<후보>.json --approve-fingerprint <승인 지문> --owner <승인 원장 ID> --approve-scoring
```

이 과정은 실제 원장 계정과 학원, 진행 중인 집계, 새 DB 지문, 기존 import 이력을 확인한다. 하나의 serializable 트랜잭션에서 저장하고 RPC 결과를 후보와 다시 대조한다. 감사 기록에는 실행 도구와 승인자를 구분한다. 오류면 전체를 롤백한다. **명단 저장만으로 배점은 켜지지 않는다.**

5. 배점 설정에서 승인한 배점을 켜고 기존 `지금 집계`를 한 번 실행한다. 별도 설명회 집계나 Drive 야간 조회는 없다. 비활성 상태에서도 다음 야간 집계가 원수치를 계산할 수 있으므로, 그래프의 반영 달은 배점 활성화일이 아니라 원수치를 처음 반영한 집계의 열린 달이다.
6. 승인 보고서와 DB의 행사·학생별 인정·행사별 가족 합계, 샘플 학생의 과거 행사 근거와 이번 달 정정, 일반 열람자의 원문 접근 차단을 확인한다. 준비·적용 결과가 다르면 배점을 활성화하지 않는다.

## 되돌리기

먼저 화면에서 설명회 지표를 끈다. 되돌리기 대상 import ID와 지문을 확인한 뒤 실행한다.

```powershell
node --env-file=<서버 환경 파일> node_modules/tsx/dist/cli.mjs scripts/student-contribution/parent-events/cli.ts revoke --import <실행 ID> --approve-fingerprint <그 실행 지문> --owner <승인 원장 ID> --reason <되돌린 사유>
```

원본 버전과 마감된 달은 삭제하지 않는다. 이후 기존 집계가 인정 집합의 변화를 정정한다. 같은 취소 재실행은 중복 처리하지 않는다. 최초 도구는 과거 실행을 덮어쓰거나 되살리지 않는다. 재가져오기·개별 수정은 별도 대조 도구를 검토한 뒤 진행한다.

## 로컬 검증

```powershell
node node_modules/vitest/vitest.mjs run src/features/student-contribution src/features/students/ontology
node scripts/student-contribution/verify-parent-events.mjs
node node_modules/tsx/dist/cli.mjs scripts/student-contribution/verify-parent-event-import.ts
```

SQL 검사는 `work/sql-check/node_modules/@electric-sql/pglite`가 필요하며 메모리 DB만 사용한다. 두 SQL 검사 도구는 `DATABASE_URL`을 읽거나 운영에 연결하지 않는다. 프로젝트 전체 검사는 이 변경의 기본 검증 범위가 아니다.
