# CODEX 코드 리뷰 3b — P1-C 수리 재검토

검토 대상은 리뷰 3의 C1~C4 수리와 그로 인해 달라진 경로다. `PLAN.md` §4의 표 확장·트랜잭션화·날짜 판정·청구 조회 페이징·scoped 정책 및 P2는 제외했다. 소스, 상태를 가진 새 모의 DB, 설치된 PostgREST/React 구현을 대조했다. DB·네트워크에는 접속하지 않았으며 실제 배포 환경의 장애 발생 여부는 **미확인**이다.

## C1~C4 판정

| 항목 | 판정 | 근거(file:line) |
| --- | --- | --- |
| C1 — 확인과 실행 대상의 불일치 | 닫힘 | 병합은 확인한 두 ID와 현재 effective ID를 비교하고, select와 실제 전송 값도 effective ID로 맞춘다. 제출 때 확인을 소모하며 미확인·pending 제출은 취소한다(`src/app/(shell)/admin/duplicates/_client.tsx:85`, `:91`, `:96`, `:145`, `:159`, `:180`). 일괄 퇴원·삭제는 작업 종류와 정렬한 live ID 묶음을 비교한다(`src/app/(shell)/admin/cleanup/_client.tsx:207`, `:212`, `:217`, `:221`). 남은 수강 종료는 합의한 학생 수 기준을 비교한다(`cleanup/_client.tsx:144`, `:153`). 선택·props 변경 및 실패 후 재확인 테스트가 있다(`src/app/(shell)/admin/cleanup-clients.test.tsx:144`, `:175`, `:187`, `:215`, `:302`, `:317`, `:328`). 진행 중 안내 대상 표시의 경미한 문제는 B2로 별도 기록한다. |
| C2 — 오류 없는 0행 쓰기를 완료로 보고 | 닫힘 | 병합은 사전 head count 실패 때 쓰기 전에 멈추고, 알려진 실제 변경 건수가 부족하면 진 쪽 퇴원 전에 멈춘다(`src/features/admin/server/actions.ts:80`, `:83`, `:137`, `:153`). 진 쪽 퇴원은 반환 ID 1행을 요구하고 남긴 쪽 표식 해제의 0행은 경고다(`actions.ts:170`, `:172`, `:179`, `:181`). 수강 종료도 실제 count와 반환 ID를 세며 0건 실패를 완료로 답하지 않는다(`actions.ts:271`, `:314`, `:328`). 상태를 가진 모의에서 RLS 0행, 미래 행 삭제, 첫 미래 행 성공 뒤 둘째 실패를 검증한다(`src/features/admin/server/actions.test.ts:328`, `:541`, `:551`, `:572`). **변경 건수를 받지 못한 응답의 추론 문제는 C3/B1에 남는다.** |
| C3 — 응답 실패·건수 부재를 무변경으로 확정 | 부분 | 코드 없는 오류는 `uncertain`으로 답하고, 확인된 건수가 0이어도 감사로그와 무효화를 수행한다(`src/features/admin/server/actions.ts:95`, `:100`, `:108`, `:116`, `:241`, `:253`, `:263`). 수강 종료의 건수 부재와 병합 재조회 실패도 같은 경로다(`actions.ts:147`, `:313`). 실제 쓰기 후 응답만 잃는 상태 모의 테스트가 있다(`src/features/admin/server/actions.test.ts:116`, `:118`, `:365`, `:379`, `:584`). 그러나 **병합 재조회가 성공하면 두 시점의 건수 차를 자기 쓰기의 변경 건수로 확정**한다(`actions.ts:149`). B1의 반례로 원래의 ‘실제로 바뀌었는데 무변경 안내·무기록’이 다시 생긴다. |
| C4 — 미래 수강 종료일의 감사 표시 | 닫힘 | 감사 metadata를 `processedOn`과 실제 미래 종료 건수 `futureCount`로 나누며, 성공한 미래 UPDATE만 합산한다(`src/features/admin/server/actions.ts:250`, `:251`, `:328`, `:330`). 상세도 처리일과 시작일 종료를 구분한다(`src/features/audit/describe.ts:949`, `:952`, `:953`). 날짜·부분·미확인 상세 테스트가 각각 있다(`src/features/audit/describe.test.ts:510`, `:515`, `:522`, `:525`). |

## 새 발견 사항

차단 0건, 중요 1건, 경미 1건.

| 번호 | 심각도 | file:line | 구체적 실행 경로(입력 → 잘못된 결과) | 수정 제안 |
| --- | --- | --- | --- | --- |
| B1 | 중요 | `src/features/admin/server/actions.ts:80`, `:142`, `:149`, `:152`, `:153`, `:100`, `:125`; `src/features/admin/server/actions.test.ts:389` | **재조회 건수 차는 이 요청이 옮긴 건수가 아니다.** 진 쪽 M에 수강 E 한 건만 있고 다른 병합 표는 비어 있다 → 사전 `expected=1` → 첫 PATCH가 E를 남긴 쪽 K로 실제 이동하지만 성공 응답에 count가 없다 → 재조회 전에 다른 창이 M에 다른 반의 새 수강 E2 한 건을 추가한다 → `left.count=1`, `done=max(0,1-1)=0` → `short`로 멈추며 `mergedRows=0`, `uncertain=false`라 감사로그·`/owner`/`/students` 무효화를 모두 생략하고 **“옮겨진 기록은 없습니다”**라고 답한다. E는 이미 K에 있다. 반대로 PATCH 전에 한 건이 추가되어 두 건을 이동하고 left=0이면 실제 2건을 1건으로 감사 기록한다. 현재 no-count 테스트는 다른 창의 쓰기가 없는 경우만 확인한다. 이는 단계 사이에 창이 있다는 근본 한계와 별개로, 확인하지 못한 건수를 확정하는 이번 분기의 문제다. | count가 없으면 수강 종료와 동일하게 **적용 여부/건수 미확인으로 멈추고 로그·목록 무효화**를 수행한다. 재조회는 남은 대상 안내에 쓸 수 있지만 자기 변경 건수의 증거로 삼지 않는다. 또는 해당 PATCH가 실제 변경한 ID/건수를 응답에서 직접 확인한다. ‘PATCH 적용 뒤 새 행 추가 → no-count → 재조회 성공’과 ‘PATCH 전 새 행 추가’를 상태 모의 테스트에 추가한다. 트랜잭션·RPC·마이그레이션은 필요하지 않다. |
| B2 | 경미 | `src/app/(shell)/admin/duplicates/_client.tsx:91`, `:94`, `:206`, `:209` | **진행 중 안내가 이미 제출한 대상 대신 새 props의 대상을 표시한다.** `[A,B,C]`에서 B→A를 확정해 제출 → pending 중 다른 창의 읽기가 `[A,C]`로 바뀜 → effective mergee는 C가 되고, `confirming=false`여도 `pending` 조건으로 확인 안내가 남아 **C→A를 처리하는 문장**이 뜬다. 실제로 제출된 FormData는 B→A이며 pending 잠금 때문에 C를 추가 실행하는 경로는 아니다. | 후속: 진행 중에는 제출 때의 대상 이름/ID를 표시하거나 대상 문장 대신 ‘병합 처리 중’ 안내를 표시한다. pending 중 props 변경의 안내 문장 테스트를 추가한다. 커밋 차단 사유는 아니다. |

B1은 코드 분기를 따라 구성한 반례이며 새 DB 접속이나 추가 스크립트로 실행하지 않았다. 해당 동시 실행이 실제 운영에서 발생했는지는 **미확인**이다.

## 오류 모양·결과 분류 확인

설치된 `@supabase/postgrest-js@2.106.2`의 실제 경로를 확인했다.

| 입력/응답 | 설치된 구현의 결과 | 이번 분류 |
| --- | --- | --- |
| PostgreSQL 또는 PostgREST의 코드가 있는 JSON 오류 | HTTP 실패 본문을 JSON으로 읽어 `error`에 그대로 넣는다(`node_modules/.pnpm/@supabase+postgrest-js@2.106.2/node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:513`). | 해당 서버가 문장을 거절한 오류는 `isRejectedByDb`의 코드 검사와 맞는다(`src/features/admin/server/actions.ts:25`). |
| 게이트웨이 등의 비 JSON 오류 본문 | JSON 파싱 실패 시 `{ message: body }`이며 code를 만들지 않는다(같은 `PostgrestBuilder.ts:522`, `:528`). | 미확인 분기로 간다. 본문을 사용자에게 직접 전달하지 않고 고정 안내로 답한다(`actions.ts:114`, `:261`). |
| fetch 실패·응답 읽기 실패 | 네트워크 오류용 code는 빈 문자열이고 data/count는 null이다(같은 `PostgrestBuilder.ts:372`, `:378`, `:424`, `:430`). | 실제 쓰기가 끝났을 수도 있으므로 미확인 분기가 맞다. `lost-response` 모의도 적용 뒤 이 형태로 돌려준다(`actions.test.ts:81`, `:116`, `:118`). |
| 수강 대상 조회가 throw | 현재 묶음의 쓰기보다 앞에서만 `code: "READ"`로 감싼다(`src/features/admin/server/actions.ts:289`, `:295`, `:300`). | 이 묶음의 쓰기가 적용되지 않았다고 분류해도 맞다. 앞 묶음에서 확인된 `closedCount`는 별도로 기록·표시한다(`actions.ts:242`, `:268`). |
| 성공 응답인데 Content-Range 없음 | count 기본값은 null이고, 요청의 count 헤더와 응답 Content-Range가 함께 있을 때만 계산한다(같은 `PostgrestBuilder.ts:462`, `:483`, `:485`). | 이 응답 형태 자체는 모의에만 있는 가정이 아니다. 수강 종료는 안전하게 미확인 처리하지만 병합의 추론은 B1이다. |

JSON 오류의 code는 라이브러리가 출처를 검증하지 않고 전달한다. DB가 적용한 뒤 임의의 code를 담은 JSON 오류를 만드는 중간 장비가 실제 배포 경로에 있는지는 **미확인**이다. 비 JSON 게이트웨이 오류와 fetch 실패에 대해서는 이번 수리의 분류가 맞으며, 확인하지 못한 별도 장비를 근거로 추가 수리 항목을 올리지는 않았다.

## 확인했고 문제 없음 및 테스트 평가

- **확인 후 선택/목록 변경:** 현재 대상과 확인 스냅샷이 다르면 확정 제출을 막는다. 병합 수동 선택 변경은 확인도 즉시 내린다(`duplicates/_client.tsx:96`, `:147`, `:163`, `:184`). 일괄 퇴원·삭제의 hidden IDs는 확인 키와 같은 live 집합에서 만들어진다(`cleanup/_client.tsx:212`, `:213`, `:217`). ID 집합이 같은 경우 순서만 바뀌는 것은 대상 변경이 아니다.
- **제출 순간 확인 해제와 React form action:** 제출 핸들러는 확인 상태만 바꾸며 effective select 값·hidden IDs는 바꾸지 않는다(`duplicates/_client.tsx:148`, `cleanup/_client.tsx:223`). 설치된 React는 `defaultPrevented`이면 action을 호출하지 않고, 정상 제출이면 FormData를 만들어 action에 전달한다(`node_modules/.pnpm/react-dom@19.2.4_react@19.2.4/node_modules/react-dom/cjs/react-dom-client.development.js:19062`, `:19080`, `:19092`, `:19103`). 실제 컴포넌트 테스트도 확인한 쌍과 fallback keeper가 전송됨을 검증한다(`cleanup-clients.test.tsx:261`, `:328`).
- **처리 중 잠금:** 병합 두 select와 확정·취소가 pending에 잠기고, 퇴원·삭제는 두 액션의 busy로 모든 체크박스와 처리 버튼을 잠근다(`duplicates/_client.tsx:160`, `:181`, `:213`, `:219`; `cleanup/_client.tsx:216`, `:258`, `:270`, `:289`, `:308`, `:323`, `:327`). props가 바뀌어도 pending 제출은 막는다. 진행 중 대상 안내만 B2다.
- **중단 후 이어가기:** 확인된 DB 거절·알려진 부족 건수 경로에서는 진 쪽을 퇴원시키기 전에 멈춘다. 이미 이동한 행은 다음 실행의 `student_id=mergeeId`에서 빠진다(`actions.ts:138`, `:153`, `:156`). 상태를 실제로 유지하는 재시도 테스트가 이를 검증한다(`actions.test.ts:294`). 응답 미확인인 경우에는 학생 상태·중복 목록을 먼저 확인하라고 안내하며 무조건 재시도 가능하다고 단정하지 않는다(`actions.ts:116`). 마지막 keeper 표식 실패는 퇴원이 이미 확인된 뒤라 완료+경고 판단을 유지한다(`actions.ts:172`, `:177`, `:198`).
- **수강 종료의 실제 건수:** 일괄 쓰기의 필터가 읽기와 같은 학생 묶음/열린 수강/오늘까지 시작 조건을 사용하며, 미래 수강은 반환 ID가 있는 행만 센다(`actions.ts:291`, `:297`, `:308`, `:310`, `:324`, `:328`). 미래 첫 행 삭제와 첫 성공·둘째 거절 테스트는 실제 DB 상태와 감사 건수를 함께 확인하므로 이전의 고정 응답 단언보다 유효하다(`actions.test.ts:551`, `:565`, `:572`, `:577`).
- **새 오류·확인 문구:** 확인문은 작업과 대상을 설명하고 내부 플랫폼 역할 이름을 추가하지 않았다. 쓰기 응답 미확인은 고정 안내이며, DB 오류는 기존 설명 함수로 정리해 표시한다(`duplicates/_client.tsx:209`, `cleanup/_client.tsx:159`, `actions.ts:97`, `:116`, `:263`, `:266`). 원시 표 이름은 `moved` metadata의 키로만 쓰고 사용자 단계명은 목록의 label을 사용한다(`actions.ts:129`, `:134`, `:151`).
- **상태 모의의 개선:** UPDATE 대상은 필터로 계산하고 실제 행을 바꾼다. 거절 fault는 변경 전, lost-response는 변경 후, no-count는 변경 후 건수만 빠진다(`actions.test.ts:112`, `:113`, `:115`, `:116`, `:118`, `:122`). 세 경우의 분기 검증은 실제 라이브러리 계약과 맞는다. 표 단위 deny 모의라 행별 RLS의 모든 조합을 입증하지는 않지만, 현재 구현은 알려진 부분 건수도 합산한 뒤 부족 여부를 검사한다(`actions.ts:152`, `:153`).
- **남은 테스트 보강:** head 모의는 `head`만 있어도 count를 돌려준다(`actions.test.ts:105`). 실제 라이브러리는 `count` 옵션을 넣어야 count Prefer 헤더를 만든다(`node_modules/.pnpm/@supabase+postgrest-js@2.106.2/node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts:903`, `:924`). 현재 실제 코드의 옵션은 정확하다(`actions.ts:81`). 후속으로 모의도 count 옵션을 확인하면 이를 누락하는 회귀를 잡을 수 있다. no-count 재조회 성공 테스트(`actions.test.ts:389`)에는 B1의 다른 창 쓰기가 빠져 있다.

독립 검증: `npx --no-install vitest run --no-cache`로 `actions.test.ts`, `cleanup-clients.test.tsx`, `describe.test.ts`, `duplicate-candidates.test.ts` **4개 파일·258개 테스트 통과**. 추가 소스·테스트 파일은 만들거나 수정하지 않았다.

## 알려진 한계 — 이번 수리 요구에서 제외

- 사전 건수 조회·각 표 UPDATE·학생 퇴원은 한 트랜잭션이 아니다. 다른 창이 그사이 기록을 추가/제거하면 알려진 count가 사전 기준보다 작아 정상 이동도 중단될 수 있고, 사전 0건으로 건너뛴 표에 뒤늦게 기록이 생길 수도 있다(`actions.ts:82`, `:133`, `:153`, `:161`). 합의한 범위에서는 중단 후 확인·재시도로 다룬다. **B1의 무변경 확정·무기록은 count 부재를 미확인 처리하는 것으로 별도로 닫을 수 있다.**
- 세션 RLS로 보이지 않는 기록은 head count에도 나오지 않는다. 이를 관리자 클라이언트로 우회하지 않는 전제는 유지한다(`actions.ts:38`, `:55`, `:81`). 배포된 정책의 실제 가시 범위는 미확인이다.
- 화면 확인은 병합 ID 쌍, 퇴원·삭제 ID 집합, 남은 수강 종료의 학생 수에 묶인다. 같은 ID의 DB 내용 변경이나 같은 학생 수의 구성 변경까지 고정하지는 않는다(`duplicates/_client.tsx:96`, `cleanup/_client.tsx:145`, `:217`). 수강 종료 액션은 실행 시점의 퇴원 학생을 다시 읽는 전역 작업이다(`actions.ts:225`). 이 확인 계약을 데이터 버전 CAS로 확장하는 일은 이번 수리 요구에 포함하지 않는다.

판정: 수리 필요(B1)
