# CODEX 코드 리뷰 3 — P1-C 데이터 정리 면

검토 기준: `0c962d231` 위의 미커밋 변경, `PLAN.md:78`의 P1-C 계약과 `PLAN.md:150`의 구체화 사항. §4의 표 확장·트랜잭션화·날짜 판정·청구 조회 페이징·scoped 정책 및 P2는 제외했다. 소스와 새 테스트 네 파일을 읽고 관련 테스트를 좁게 실행했다. DB·네트워크에는 접속하지 않았으므로 배포된 정책과 실제 장애 발생 여부는 **미확인**이다. 아래 경로는 코드와 저장소의 마이그레이션을 기준으로 한다.

## 발견 사항

차단 0건, 중요 3건, 경미 1건.

| 번호 | 심각도 | file:line | 구체적 실행 경로(입력 → 잘못된 결과) | 수정 제안 |
| --- | --- | --- | --- | --- |
| C1 | 중요 | `src/app/(shell)/admin/cleanup/_client.tsx:203`, `:210`, `:258`, `:278`; `src/app/(shell)/admin/duplicates/_client.tsx:84`, `:91`, `:190` | **확인이 실행 대상을 붙잡지 않는다.** ① 김하나만 선택 → ‘퇴원 처리’로 확인 열기 → 김하나를 해제하고 이두리를 선택 → `confirming`은 여전히 `withdraw`, hidden `ids`는 이두리로 바뀐다 → 이두리는 첫 확인 버튼 없이 바로 ‘퇴원 확정’으로 처리된다. 삭제도 같은 구조다. ② 실제 후보 묶음 `[A,B,C]`에서 `B→A` 확인을 연 채 다른 창의 처리/새 읽기로 B가 빠져 `[A,C]`가 내려오면, A가 첫 학생이므로 카드 key가 유지되고(`duplicate-candidates.ts:219`, 클라이언트 `:71`), `effectiveMergeeId`만 C로 바뀐다 → `C→A`의 ‘병합 확정’이 바로 남는다. select의 직접 변경은 확인을 내리지만 props에 따른 변경은 그렇지 않다. | 확인 상태에 작업 종류와 **선택 ID 집합/병합 쌍의 스냅샷**을 보관하고, 현재 대상이 그 스냅샷과 다르면 확정 UI를 내린다. `onSubmit`에서도 일치 여부와 pending을 검사한다. 선택 변경과 목록 갱신 **모두** 재확인을 요구하고 저장 중 선택 컨트롤을 잠근다. 두 경로를 제출 값까지 검증하는 테스트로 추가한다. |
| C2 | 중요 | `src/features/admin/server/actions.ts:100`, `:111`, `:118`, `:134`, `:212`, `:217`; `supabase/migrations/0219a_students_enrollments_write_role_gate.sql:42`, `:52` | **오류 없는 0행 UPDATE를 성공으로 친다.** 구체적으로 `admin=full`을 위임받은 강사는 앱 게이트를 통과할 수 있지만(`permissions.ts:426`, `:444`, `:474`; `perm-matrix.ts:131`), 0219a의 students/enrollments UPDATE `USING` 명단에는 없고 SELECT는 열려 있다. 두 학생 존재 확인은 통과 → 수강은 0행, 학생 메모 등의 테넌트 정책은 갱신 허용(`0015a_rls_for_student_grades_memos.sql:12`) → 퇴원 UPDATE도 0행/오류 없음 → 학생은 여전히 재원이고 일부 기록만 옮겨졌는데 정상 완료 로그와 `mergedRows`를 반환한다. 마지막 표식 해제도 0행을 경고로 알리지 않는다. 별도로 미래 수강 목록을 읽은 뒤 다른 창의 `deleteEnrollment`가 한 행을 지우면(`src/features/enrollments/server/actions.ts:800`), 그 행의 UPDATE가 0행이어도 `closedCount += 1`이 실행되어 새 감사로그에 실제 종료보다 큰 건수가 남는다. | 필수인 mergee 퇴원은 `.select("id")` 등으로 **실제 1행 갱신**을 확인하고, 0행이면 부분 실패로 처리한다. keeper 표식 해제 0행도 남은 일로 알린다. 미래 수강 종료는 실제 반환 행/건수만 합산한다. 필요하면 기존 쓰기 가능 여부를 작업 시작 전에 확인하되, `admin` 게이트와 scoped 정책 자체를 바꾸거나 RLS를 우회할 필요는 없다. 모의 DB에 ‘SELECT 가능·UPDATE 0행’과 ‘미래 조회 후 삭제’를 넣는다. |
| C3 | 중요 | `src/features/admin/server/actions.ts:67`, `:70`, `:84`, `:94`, `:111`, `:168`, `:201`; `node_modules/.pnpm/@supabase+postgrest-js@2.106.2/node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:329`, `:372`, `:424`, `:483` | **0건과 결과를 모르는 쓰기를 구별하지 않는다.** 실제 클라이언트는 PATCH의 통신 실패를 재시도하지 않고 `error`·`count:null`·`status:0`으로 돌려준다. 이는 DB 롤백 확인이 아니다. 첫 수강 이동이 DB에서 적용된 뒤 응답 연결이 끊기면, 이번 액션은 `mergedRows=0`으로 `stop()`에 들어가 ‘옮겨진 기록은 없습니다’라고 단정하고 감사로그·목록 갱신을 모두 건너뛴다. 더 명확하게 자식 기록 0건인 두 학생의 **퇴원 UPDATE**가 적용된 뒤 응답만 끊겨도 같은 결과다. 진 쪽은 후보에서 이미 빠질 수 있다(`queries.ts:59`). 또한 성공 응답이라도 Content-Range가 없으면 count는 null로 남는데, `count ?? 0`으로 확정된 0건과 같게 처리한다. 수강 종료의 새 로그도 같은 합산/기록 조건을 쓴다. 실제 장애 발생은 미확인이지만 이 오류 응답 처리 경로와 잘못된 단정은 코드로 확인된다. | 확정된 건수와 **쓰기 결과 미확인**을 분리한다. 통신 오류·건수 누락에는 ‘적용 여부를 확인하지 못했습니다’로 안내하고, 시도한 단계/확정된 범위/미확인 범위를 기록하며 쓰기 시도 이후에는 목록을 갱신한다. 가능하면 재조회로 상태를 확인한다. 모든 error를 롤백으로 간주하지 말고, 상태를 가진 모의 DB에서 ‘적용 후 응답 실패’와 `error:null,count:null`을 검증한다. RPC나 마이그레이션 없이도 단정·무기록 문제를 줄일 수 있다. |
| C4 | 경미 | `src/features/admin/server/actions.ts:173`, `:214`; `src/features/audit/describe.ts:945` | **미래 시작 수강의 감사 상세가 실제 종료일과 다르다.** 오늘이 2026-10-06이고 미래 수강만 한 건(시작 2099-01-01) 있으면 실제 `end_date`는 2099-01-01로 저장되지만, 새 metadata는 `endDate=2026-10-06`, 감사 상세는 ‘종료일 2026-10-06’이라고 표시한다. 혼합 처리에서도 일부 행의 실제 종료일을 대표하지 못한다. 새 테스트도 미래 종료일과 로그의 오늘 날짜를 각각 단언하여 이 차이를 허용한다(`actions.test.ts:278`). | 오늘 날짜는 `processedOn`/‘처리 기준일’로 표시하거나 ‘시작 전 수강은 시작일로 종료’ 규칙을 상세에 함께 표시한다. 실제 종료일로 표시하려면 날짜별 건수를 남긴다. 후속 처리 가능. |

### 테스트의 실효성과 남은 구멍

- `cleanup-clients.test.tsx:115`, `:168`은 실제 React form action으로 캡처한 FormData를 검사한다. `onSubmit`에서 확인을 내리는 것 때문에 정상 제출의 값이 빠지는 회귀는 잡는다. `:129`, `:196`은 **자기 제출이 끝난 뒤** 확인이 재사용되지 않는 것도 검증한다. 다만 확인 도중 체크박스/props가 바뀌는 C1은 없다. 병합 select의 직접 변경(`:180`)은 props 변경을 대신하지 못한다.
- `actions.test.ts:43`의 thenable은 await 시 실행된다는 점에서 실제 빌더와 맞는다. 그러나 `:81`의 world는 표별 고정 응답만 돌려주고 기록 이동·학생 상태 변경을 저장하지 않는다. `:94`는 학생 UPDATE를 무조건 성공으로 응답하여 C2의 실제 갱신 여부를 검증할 수 없다. `:165`는 ‘connection reset’을 실패 이전 무변경으로 가정한다. 실제 빌더의 통신 오류는 롤백을 보장하지 않아 C3에 대한 안전성 증명이 되지 않는다.
- `actions.test.ts:316`의 미래 수강 실패는 첫 미래 UPDATE부터 실패한다. **첫 미래 행 성공 → 둘째 실패**, 첫 행 0행 처리, 실제 반환 건수 합산을 검증하는 사례가 필요하다(C2).
- `find-orphans.test.ts:44`의 모의는 range 후 1,000행 절단과 `.in()`의 큰 ID 목록 실패를 실제로 적용한다. 1,200개 반(`:76`)과 100반 한 묶음의 1,041개 이력(`:87`)은 각각 페이징과 청크 안 페이징을 빼면 결과가 달라지는 유효한 단언이다. 150개 ID 한도는 모의용 값이며 실서버 URL 한도를 입증하지는 않는다. 현재 코드는 공용 100개 청크를 쓰므로 해당 모의와 계약은 맞는다.
- 두 Face의 실패 처리 테스트(`cleanup-clients.test.tsx:258`)는 소스 문자열 검사다. DB 오류를 실제로 주입하여 다른 두 구획이 남는 렌더 테스트는 아니다. 현재 호출 경로는 아래처럼 직접 확인했다.

## 확인했고 문제 없음

- **액션 게이트와 화면 판정:** 네 액션 모두 로그인 뒤 `canWriteTenant(user.systemRole,"admin")`을 검사하고, 페이지도 같은 함수·같은 키를 넘긴다(`actions.ts:31`, `:149`, `:252`, `:318`; `page.tsx:160`). C2는 이 게이트를 바꾸자는 정책 지적이 아니라 그 뒤 실제 쓰기의 성공 판정 문제다.
- **열람자의 변이 컨트롤:** `canManage=false`에서 일괄 선택/퇴원/삭제/종료/병합 폼은 서지 않고 학생·반 링크와 후보는 남는다(`cleanup/_client.tsx:124`, `:213`; `duplicates/_client.tsx:138`; 렌더 테스트 `cleanup-clients.test.tsx:65`).
- **owner fieldset 분리:** 데이터 면만 fieldset 밖으로 옮겼고, 설정 읽기 전용 안내도 data에서만 제외했다. 다른 면 조건은 diff에서 유지된다(`page.tsx:210`, `:346`). 데이터 면 입구는 여전히 `requireAccess("owner")`라 관리자 도구만 있고 owner 열람이 없는 계정의 입구는 종전과 같다(`page.tsx:114`; `settings-role-catalog.ts:46`). 입구 확장은 P2 범위다.
- **두 학생 선확인:** 세션/RLS 조회의 오류와 둘 중 하나의 부재를 첫 UPDATE보다 앞에서 거절한다. 다른 지점 학생은 같은 부재 경로로 끝난다(`actions.ts:49`, `:55`, `:62`; `actions.test.ts:142`).
- **단계 오류 및 재실행:** 일곱 표와 학생 퇴원 단계에서 반환된 error를 모두 확인하며 오류 뒤의 단계는 실행하지 않는다(`actions.ts:88`, `:111`). **롤백이 확인된 DB 오류**에 대해서는 완료한 표가 재시도 때 `student_id=mergeeId` 필터에서 빠지고, 퇴원 전까지 후보의 학생 속성은 유지되어 같은 쌍으로 이어갈 수 있다(`actions.ts:92`; `queries.ts:59`; `duplicate-candidates.ts:165`). 통신 실패와 0행 쓰기는 C2·C3의 예외다. 충돌을 자동 해소한다는 보장은 하지 않는다.
- **마지막 표식 해제 오류의 완료+경고:** 실제 mergee 퇴원이 성공한 경우라면 마지막 keeper 표식만 실패해도 병합 완료로 답하고 학생 상세에서 처리하도록 안내하는 판단은 맞다(`actions.ts:118`, `:136`). 기존 메모 앞에 병합 표식을 붙이고 keeper 의심 표식을 내리는 소스 가드도 통과했다(`duplicate-candidates.test.ts:230`; `merged.ts:62`).
- **병합 범위:** 서버·안내·확인문이 같은 일곱 표 목록을 사용하며, enrollment_consultations도 오류와 건수 확인에 포함됐다(`merge-scope.ts:7`; `actions.ts:88`; `duplicates-face.tsx:52`; `duplicates/_client.tsx:193`). 제외 예시인 수업 보고서·진도·레벨테스트·교재 요청에는 실제 student_id가 있고 목록 밖이다(`schema.ts:728`, `:865`, `:1640`, `:1309`).
- **감사 배선:** 부분 병합의 `moved/partial/failedStep`, 남은 수강 종료의 `count/partial`가 메타데이터에 실린다. 새 액션 라벨과 student 유형, 상세 표시, owner 배선 검사도 등록되어 관련 테스트가 통과했다(`actions.ts:76`, `:173`; `log.ts:213`; `describe.ts:945`, `:1001`; `owner-audit-wiring.test.ts:50`). 건수 신뢰성은 C2·C3, 날짜 문구는 C4로 분리했다. 공용 logAction은 기존처럼 best effort이며 실제 DB 기록 성공 여부는 미확인(`log.ts:539`).
- **종료 처리의 정상 오류 경로:** closedCount는 루프 이전에 선언되고, 일반 묶음/미래 조회/미래 UPDATE 오류는 같은 finish를 거쳐 앞의 확정된 건수를 기록하고 `/owner`를 무효화한다(`actions.ts:164`, `:167`, `:200`, `:210`, `:216`). 미래 시작일로 클램프하는 기존 규칙도 유지된다(`:214`).
- **조회 한도·정렬·병렬:** 학생·수강·반은 unique PK id로 정렬하여 전건 페이징하고, 스케줄은 100개 ID 청크 안에서 다시 페이징한다. Promise.all의 네 조회는 서로 독립이다(`queries.ts:219`, `:277`; `batch.ts:16`, `:47`, `:72`; PK `schema.ts:307`, `:350`, `:412`, `:494`). 날짜 유효기간을 추가하지 않아 종전의 ‘기록 한 줄도 없음’ 판정은 유지된다(`queries.ts:280`).
- **조회 실패와 Next 신호:** findOrphans/findDuplicateStudents의 프로덕션 호출부는 각각 DataFace/DuplicatesFace이고, 둘 다 DB 조회 오류를 해당 구획의 한글 실패 안내로 받는다(`data-face.tsx:15`, `:32`; `duplicates-face.tsx:19`, `:58`). 현재 두 조회는 redirect/notFound를 호출하지 않고, owner는 force-dynamic이며 인증 단계에서 이미 요청 캐시된 createClient/cookies를 사용한다(`page.tsx:44`, `:115`; `queries.ts:39`, `:210`; `supabase/server.ts:9`). 현재 경로에서 새로 삼키는 프레임워크 신호는 확인하지 못했으므로 결함으로 올리지 않는다. 해당 호출 구조를 바꾸면 로컬 Next 문서의 unstable_rethrow 규칙을 재검토해야 한다.
- **새 안내 문구:** 권한 안내는 화면 이름 ‘관리자 도구’를 사용하고, 오류는 explainDbError로 영문 원문/표 이름을 화면에서 치환한다(`cleanup/_client.tsx:35`; `duplicates/_client.tsx:214`; `actions.ts:68`, `:179`; `db-error.ts:80`). 이번에 추가한 문장에 금지된 플랫폼 역할 이름이나 원시 권한 코드는 없다. 기존 ID·상태 표시는 이번 문구 검토 대상에서 제외했다.

## 직접 실행한 검증

`npx --no-install vitest run --no-cache`로 다음 일곱 파일을 지정 실행했고 **7개 파일·264개 테스트 통과**를 확인했다: `src/features/admin/server/actions.test.ts`, `src/features/admin/server/find-orphans.test.ts`, `src/app/(shell)/admin/cleanup-clients.test.tsx`, `src/features/admin/duplicate-candidates.test.ts`, `src/features/students/merged.test.ts`, `src/features/audit/describe.test.ts`, `src/features/audit/owner-audit-wiring.test.ts`. typecheck·eslint·실DB 검증은 실행하지 않았고 조정자의 결과를 독립 검증했다고 주장하지 않는다. 새 테스트나 소스는 작성하지 않았다.

판정: 수리 필요(C1, C2, C3)
