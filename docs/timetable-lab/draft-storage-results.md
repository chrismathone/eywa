# 연습본 저장 API (2026-10-02)

이름을 붙인 연습본은 Supabase `timetable_lab_drafts`에 별도 사본으로 저장한다. 기존 저장본을 덮어쓰거나 운영 반·학생·시간표를 변경하는 경로는 없다. 목록과 원본 조회 모두 로그인한 사용자의 현재 지점 및 본인 작성분으로 제한한다.

## API 계약

- `GET /api/timetable/lab/drafts?offset=0&limit=20`: `{ items: DraftSummary[], nextOffset: number | null }`. 최대 50개와 다음 페이지 확인용 1행만 읽고, 목록 조회에는 시간표 JSON을 포함하지 않는다. 정렬은 작성 시각·ID 내림차순이다.
- `POST /api/timetable/lab/drafts`: `{ version: 1, name, snapshot }` → `201 { item: DraftSummary }`. 같은 이름도 별도 ID와 작성 시각으로 저장한다.
- `GET /api/timetable/lab/drafts/[id]`: `{ version: 1, item: DraftSummary, snapshot }`. 다른 사람·다른 지점·없는 ID는 모두 404다.
- `PUT /api/timetable/lab/drafts/[id]`(본문은 POST와 같다) · `DELETE /api/timetable/lab/drafts/[id]`: 덮어쓰기·삭제(2026-11-02 추가). 저장한 사람과 영어 과목 관리자 이상만 가능하고(과목 범위는 퇴원보고서 열람과 같은 기준) 그 밖에는 403이다. DB 권한은 그대로(일반 계정은 읽기·추가만)이고, 라우트가 확인한 뒤 관리 클라이언트로 쓴다. 덮어쓰면 저장자·저장 시각이 마지막 저장으로 바뀌고 이전 값은 감사로그(`timetable_lab_draft_overwrite`·`timetable_lab_draft_delete`)에 남는다.
- `DraftSummary`: `id, name, subject: 'english', createdAt, lessonCount, classCount, studentCount, referenceDate`.
- 비로그인은 401, 시간표 또는 반 전체 관리 권한이 없으면 403, 잘못된 구조는 400, 2MiB를 넘는 요청은 413이다. 오류 응답은 `{ error: string }`이다. 모든 응답은 `private, no-store`다.

저장 및 불러오기 검증은 `src/features/timetable-lab/draft-schema.ts`의 `draftSnapshotSchema`를 공유한다. `boundedJson`으로 깊이·노드 수·위험한 객체 키를 먼저 확인한다. 반 이름·학생 이동 출처·운영 시간대·색상·불완전한 편집 셀도 보존하며, 중복 수업 ID나 같은 표 행을 가리키는 배치는 거절한다. 학생 수는 실제 배치의 학생 ID를 중복 제거해서 계산한다. 로그인한 사용자의 예시 자료 저장은 허용한다.

## 데이터베이스 경계

마이그레이션은 `supabase/migrations/s1_season1.sql#0333a_timetable_lab_drafts.sql`이다. 처음에는 Supabase CLI 2.119.0의 `migration new`가 붙인 이름(`20261002100848_timetable_lab_drafts.sql`)이었고 원격 DB에도 그 이름일 때 적용했다. 이 저장소는 `NNNNa_` 번호 이름만 쓰고(`session-consumption-wiring.test.ts`가 규약 밖 이름을 실패시킨다) CLI의 적용 기록 표도 쓰지 않으므로, 내용은 그대로 두고 파일 이름만 바꿨다. **0333a는 2026-10-02 21시 기준 비어 있던 번호다. main에 합치기 직전에 번호가 겹치지 않는지 다시 확인한다**(0330a는 다른 작업이 쓰고 있다). 테이블 RLS와 SELECT/INSERT 권한만 부여하며 UPDATE/DELETE는 부여하지 않는다. API는 세션 클라이언트를 사용하고 명시적인 `tenant_id`·`created_by` 필터도 적용한다. 서비스 역할로 저장·조회하지 않는다.

`auth_can_use_timetable_lab()`은 SECURITY INVOKER이며 시간표와 반의 전체 관리 권한을 모두 요구한다. 기존 `auth_menu_access` SQL 기본값은 이 두 메뉴가 누락되어 있으므로 재사용하지 않는다. 앱의 역할 기본값·역할 예외·개인 예외·슈퍼관리자 병합 규칙을 이 두 메뉴에 한해 반영하고, 퇴사자와 학생 역할은 거절한다. 슈퍼관리자도 다른 작성자의 저장본에는 접근하지 못한다. 브라우저의 '다른 강사 화면 보기' 읽기 전용 상태는 API의 기존 `canManageTenant`가 계속 제한한다.

계정 상태 판정은 기존 `getCurrentUser()`와 같은 `status <> 'inactive'`다. 현재 앱은 `pending`을 별도로 차단하지 않는다. 이 기능만 다른 로그인 규칙을 만들지 않았다. 읽기 대상인 `users`와 `tenant_settings`는 기존 정책상 자기 지점 자료를 세션으로 읽을 수 있고, 이 두 표의 정책은 연습본 표를 참조하지 않으므로 순환 RLS가 생기지 않는다.

## 감사로그

저장이 성공하면 `timetable_lab_draft_save`("시간표 연습본 저장") 한 줄을 남긴다. 대상 칸에는 연습본 이름, 상세에는 반·수업·학생 수만 적는다("개인 연습본 · 반 5개 · 수업 12개 · 학생 31명"). 시간표 내용은 싣지 않는다. 기록이 실패해도 저장 결과는 바뀌지 않고, 저장이 실패하면 기록도 남기지 않는다. 목록·불러오기는 읽기라 남기지 않는다.

기존 '시간표 계획' 저장(`timetable_plan_*`)이 감사로그를 남기는 것과 같은 결이며, 라벨에 "연습본"을 넣어 운영 시간표가 바뀐 것으로 읽히지 않게 했다. 연습본은 작성자만 읽는 개인 사본이라 슬랙 활동 규칙에서는 고를 수 없게 막았다(`activity-catalog.ts` `FORBID_KEYS`). 등록 3곳: `audit/server/log.ts`(액션 라벨), `audit/describe.ts`(대상 유형 라벨·상세 문구), `slack/activity-catalog.ts`.

## 검증

- API·저장 쿼리·JSON 검증 Vitest **30개(4파일) 통과**. 비로그인, 두 메뉴 권한, 위조 소유자, 다른 지점 원본, 최대 크기, 잘못된 JSON, 비공개 캐시, 목록 페이징, 저장본 재검증, 안전한 실패 응답, 저장 성공 때만 감사로그 한 줄을 확인했다. 감사로그 등록 가드·슬랙 분류 가드·상세 문구 테스트도 통과했다.
- 변경한 TypeScript 파일 ESLint 통과.
- 실제 Next 개발 서버에서 비로그인 목록·저장·단건 조회 모두 401과 `private, no-store` 응답을 확인했다(감사로그 호출을 넣은 최종 라우트로 다시 확인).
- 저장 스키마는 모르는 키를 거절하는 엄격한 검증이라, 브라우저 테스트(API는 합성 응답)로는 실제 운영 자료가 서버 검증을 통과하는지 알 수 없다. 대신 불러오기 API가 내려주는 표시 설정 타입(`LabAppearance`·`PeriodsConfig`·`IntegrationGroupsConfig`)과 스키마의 키를 하나씩 대조했고, 원격 DB에서 지점 4곳의 id가 모두 스키마가 받는 UUID 형식임을 읽기 전용으로 확인했다. 알려진 차이는 하나다: 학원 설정은 교시 시각을 `\d{2}:\d{2}`로만 검사하지만 스키마는 00:00~23:59만 받는다. 교시가 24:00 이후로 설정된 지점이 생기면 저장이 400으로 거절된다.
- `supabase/tests/timetable_lab_drafts.sql`의 pgTAP **33개 통과**. 로컬 PGlite 0.3.14 PostgreSQL에 실제 마이그레이션을 적용하고 `authenticated` 역할로 테넌트·개인 격리, 권한 회수, 개인 예외, 슈퍼관리자, 비활성 계정, 위조 저장, 변경 금지를 실행했다.
- 로컬 Supabase 전체 스택은 Docker/Podman이 없어 실행할 수 없었다. PGlite 검증은 최소한의 `users`·`tenant_settings`·인증 헬퍼를 둔 격리된 DB에서 진행했으므로 전체 운영 DB의 기존 트리거·정책 결합 검증을 대신하지 않는다.

**2026-10-02 원격 DB에도 적용했다.** Supabase 앱 연결은 프로젝트 권한을 거부했지만, 사용자가 환경변수 확인을 지시한 뒤 `.env.local`의 `DATABASE_URL`로 공개 앱 URL과 같은 프로젝트인지 확인하고 이 마이그레이션만 적용했다. 실제 원격 PostgreSQL에서 pgTAP **33개 모두 통과**했다. 인증 역할의 저장·조회, 다른 사용자·지점 차단, 권한 회수, 슈퍼관리자의 개인 소유권 경계를 실제 기존 RLS와 함께 확인했다. 테스트 자료는 트랜잭션에서 전부 롤백했다. 실제 로그인 브라우저의 전체 저장 왕복은 아직 별도로 실행하지 않았다.

같은 날 저녁 스크립트의 마지막 수정(TAP 출력만 추리기, 시험용 지점이 남지 않았는지 확인)과 마이그레이션 개명까지 끝낸 최종본으로 다시 실행했다. `--test`는 원격에서 **33개 통과·시험 자료 잔존 0건**, `--check`는 RLS 켜짐·정책 2개·익명 읽기 불가·인증 역할 수정/삭제 불가·권한 함수가 RLS를 우회하지 않음을 다시 보여 줬다. 이때 표의 연습본은 0건이었다. 즉 실제 계정으로 저장한 적이 아직 한 번도 없다.

재현 명령은 `node --env-file=.env.local scripts/timetable-lab-db.mjs --check`와 `--test`다. `--apply`는 표가 아직 없을 때 이 기능의 마이그레이션 하나만 실행하며, 기존 표가 있으면 중단한다. 접속 URL과 키는 출력하지 않는다. 적용 후 스키마 캐시 갱신을 요청했고 RLS 활성화, 정책 2개, 익명 접근 차단, 인증 역할 UPDATE/DELETE 차단을 재확인했다.

CLI 2.119.0의 `db query --help`로 확인한 SQL 파일 실행 형식은 `npx --yes supabase db query --local --file supabase/tests/timetable_lab_drafts.sql`이다. 연결된 검증 DB에서는 `--local` 대신 `--linked`를 사용한다. 현재 이 워크트리에는 연결된 CLI 프로젝트가 없고, `.env.local`의 공개 Supabase 주소는 `ylqviwxedsdikuslmwxf.supabase.co`다. 원격 연결 문자열이나 인증키를 문서·명령 출력에 남기지 않는다.

현재 PC에서 실행한 격리 검증은 `node C:\Users\user\AppData\Local\Temp\timetable-lab-db-check\check.mjs`다. 이 임시 실행기는 저장소 의존성을 변경하지 않고 위 마이그레이션과 pgTAP 파일을 그대로 읽는다. 운영 DB의 전체 스키마와 인증 세션 검증은 별도 단계다.

검토한 공식 자료: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [새 표의 명시적 API 권한 변경](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [PGlite 시작하기](https://pglite.dev/docs/). RLS와 별개로 명시적인 SELECT/INSERT GRANT가 필요하다는 2026년 변경을 마이그레이션에 반영했다.
