# P1-B 적대적 코드 리뷰 2b

리뷰 2의 C1·C2 수리와 그 수리로 바뀐 부분만 검토했다. 코드·테스트·문서 대조와 좁은 Vitest 실행을 수행했으며 DB 접속·네트워크·빌드·스크립트 실행은 하지 않았다. 실제 배포 DB와 손으로 넣은 중복/깨진 실데이터의 존재는 **미확인**이다.

## C1·C2 판정

| 리뷰 2 항목 | 판정 | 근거(file:line) |
| --- | --- | --- |
| C1 — 앱의 표가 같아 다른 창의 DB 권한 변경을 덮음 | **닫힘** | `permissions-canonical.ts:23`은 역할 행을 통째로 직렬화한다. `:38`에서 칸 순으로 정렬하고 같은 칸은 원래 index 순을 유지하므로 중복 행 추가·같은 칸의 순서 변경·명시적 기본값 행 추가가 token에 남는다. 실제 액션은 요청 스키마 다음·DB 읽기 전에 중복 셀 요청을 거절한다(`src/features/owner/server/actions.ts:151`, `:158`, `:162`). 다른 writer가 raw 중복을 만들었어도 fresh token 비교가 A의 옛 기준을 거절한다(`actions.ts:182`). 리뷰 2의 `[billing/admin/none, billing/admin/full]` 반례를 그대로 넣은 테스트가 표의 동일성·저장 거절·원래 행 보존을 함께 단언한다(`src/features/owner/server/permissions-save.test.ts:235`). |
| C2 — null 등 깨진 행에서 token 계산이 throw | **닫힘** | 행에서 필드를 읽기 전에 record 여부를 확인하고, 최종 출력에는 원래 행을 실어 null·숫자·문자열·배열을 삭제하지 않는다(`src/features/owner/permissions-canonical.ts:30`, `:38`, `:40`). 두 종류 행 배열 모두 합성 junk가 있으면 throw하지 않고 없는 경우와 다른 canonical을 만든다(`permissions-canonical.test.ts:117`). 실제 액션의 null 개인 예외 사례도 기준 계산을 통과한 뒤 기존 보호 검사에서 구조화된 오류로 끝나며 쓰지 않는다(`src/features/owner/server/permissions-save.test.ts:295`, `src/features/owner/server/actions.ts:253`). 이는 **기준 계산 수리**의 닫힘 판정이며, 기존 깨진 배열을 모든 화면에서 편집 가능하게 만들었다는 뜻은 아니다. |

표에서 짧게 적은 canonical 파일 경로는 모두 `src/features/owner/` 아래다.

## 새 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
| --- | --- | --- | --- | --- |
| N1 | 경미 | `src/app/(shell)/owner/_components/permissions-section.tsx:121`, `:241`, `src/app/(shell)/owner/_components/use-section-draft.ts:64`, `:85` | 새 중복 경고는 확정 상태가 아닌 **initial props**에서 별도로 계산된다. 예를 들어 중복 `billing/admin=[none, readonly]`, 버전 0으로 열어 저장이 성공해 버전 1·단일 readonly 행이 확정되고, 정리된 props가 내려와 경고가 사라진다. 그 뒤 버전 0의 옛 중복 props가 늦게 도착하면 훅은 옛 draft/token을 거절하지만 경고는 initial에서 다시 만들어져 ‘같은 칸이 여러 번 저장되어 있습니다’라고 표시한다. 성공 응답만 오고 props가 아직 옛것인 동안에도 정리 완료 뒤 경고가 남는다. 저장값·다음 baseline은 정상이며 잘못된 안내만 남는 경로다. 소스에서 확인한 실행 순서이고 별도 신규 재현 테스트는 작성하지 않았다. | 경고의 원본도 채택된 서버 버전 및 저장 성공과 맞춰 관리한다. 낮은 버전의 props는 경고를 되살리지 않게 하고, 해당 제출이 정상 저장됐으면 중복 정리가 확정됐음을 반영한다. ‘중복 → 저장 성공 → 새 props → 옛 props’ 및 ‘성공 응답만 도착’ 사례를 추가한다. 기존 새 안내 테스트는 초기 표시와 정상 초기값의 미표시만 확인한다(`permissions-face-save.test.tsx:217`, `:230`). |

차단 0건·중요 0건·경미 1건(N1). N1은 후속으로 둘 수 있다.

## (c) 기존 중복 저장값의 편집·저장을 허용하는 판단

**동의한다.** 알려진 메뉴·직급의 유효한 중복 역할 행은 기존 스키마가 읽을 수 있고, 원장 권한 검사와 숨은 계정 보호도 유지된다. 면은 값이 갈린 칸을 한글 메뉴/직급 라벨로 알리고, 원장이 마지막 행으로 표시된 표 값을 확인하거나 바꾼 뒤 유일한 셀 요청으로 정리할 수 있다(`src/features/owner/permissions-canonical.ts:52`, `src/app/(shell)/owner/_components/permissions-section.tsx:242`, `src/features/owner/server/actions.ts:109`, `src/features/owner/server/platform-settings.ts:35`). 마지막 줄이 기본값이면 sparse 저장에서 행이 없어질 수 있으므로 ‘한 줄’은 물리적인 행 수보다 표의 한 값으로 해석해야 한다(`permissions-section.tsx:56`).

이 방식은 리뷰 2에서 제안한 편집 차단보다 범위가 좁고, 사용자에게 복구 경로를 남긴다. `docs/gotchas.md:425`의 원장 복구 경로 유지 원칙과도 부합한다. 이 원칙을 무권한자의 저장 허용으로 확대하지 않았고, 실제 액션 테스트는 이미 저장된 중복을 정상 요청으로 정리하고 실제 저장 token을 반환함을 확인한다(`src/features/owner/server/permissions-save.test.ts:281`). N1은 그 판단을 바꿀 이유가 될 정도의 저장 결함은 아니다.

값이 같은 중복은 실제 값 충돌이 없어 경고 대상에서 빠지지만 요청에서는 똑같이 거절된다(`permissions-canonical.ts:58`, `permissions-canonical.test.ts:138`, `permissions-save.test.ts:268`). 모르는 메뉴·직급은 표시 가능한 라벨 목록에 없어서 경고에 원시 코드로 싣지 않고, canonical의 행에서는 보존한다(`permissions-canonical.ts:40`, `:60`, `permissions-canonical.test.ts:151`). 모르는 메뉴가 있는 저장값을 모두 UI에서 복구할 수 있다는 보장은 없다. 기존 보호 검사는 이전 값도 스키마로 읽으므로 해당 경우의 거절은 기존 동작이다(`src/features/owner/settings-types.ts:553`, `src/features/owner/server/platform-settings.ts:36`).

## 추가 반증 결과

- **raw 행 비교와 정렬 충돌:** 역할/개인별 행은 정렬 키만 문자열로 만들고 **결과에는 행 전체**를 남긴다. 예를 들어 raw 칸 키 `menu="a|b", role="c"`와 `menu="a", role="b|c"`는 정렬 키가 같아도 서로 다른 객체가 출력되므로 같은 canonical로 합쳐지지 않는다. 그 충돌은 원래 index 순을 더 보존하는 방향이다(`src/features/owner/permissions-canonical.ts:38`, `:40`). 정상 요청의 메뉴·직급은 enum, 개인 ID는 UUID라 `|`가 들어가는 칸도 만들지 못한다(`src/features/owner/settings-types.ts:553`, `:554`, `:561`).
- **text()의 실제 동치 한계:** 임의의 깨진 담당자 목록까지 완전히 구분하는 함수는 아니다. raw `payslipViewerIds=[7]`과 `["7"]`은 둘 다 `payslip:["7"]`이 된다(`src/features/owner/permissions-canonical.ts:32`, `:44`). 이 구체적 충돌은 있다. 그러나 두 이전 값 모두 UUID 스키마 밖이며, 유효한 수정 요청의 token이 같더라도 기존 값 검사에서 parse가 실패해 구조화된 거절로 끝난다(`src/features/owner/settings-types.ts:566`, `src/features/owner/server/platform-settings.ts:36`, `src/features/owner/server/actions.ts:256`). **현재 허용된 저장의 변경 유실 경로는 찾지 못했으므로 커밋 차단 사항으로 올리지 않았다.** 이 두 깨진 목록의 실데이터 존재·별도 실행은 미확인이다.
- **sortKeysDeep의 동치:** 저장 JSON의 객체 키 차례는 의미가 없고, 배열 순서·값·행 수는 유지된다. undefined/Symbol/비유한 수 등 JSON 저장값이 아닌 JS 입력의 직렬화 동치는 DB에서 읽힌 정상 행의 반례로 삼지 않았다(`src/lib/stable-json.ts:6`, `src/features/owner/permissions-canonical.ts:40`). 기본값 행·잠긴 칸·다른 접근 값의 중복은 보존되는 테스트를 확인했다(`permissions-canonical.test.ts:55`, `:65`, `:74`, `:80`, `:86`).
- **자기 저장·누락 보존·지속적인 오탐:** page의 token은 fresh 조회가 resolve한 permissions에서 나오며, 액션 비교도 fresh DB 값을 같은 resolve/같은 token 함수로 해석한다. payload를 sparse로 바꾸는 것은 비교 **뒤**이고, 응답은 실제 nextData를 다시 resolve해 만든다(`src/features/owner/server/queries.ts:132`, `src/app/(shell)/owner/page.tsx:252`, `src/features/owner/server/actions.ts:182`, `:251`, `:314`, `:316`). 따라서 명시적 기본값 행 때문에 한 번 거절되더라도 새로 열면 그 행을 포함한 기준으로 저장할 수 있다. 다른 writer가 계속 바꾸지 않는 한 새로고침해도 계속 충돌하는 경로는 찾지 못했다.
- **침산 제거·일반판 구폼:** 침산 담당자 칸 제거 후 응답은 제출 token과 달라도 저장된 값의 token과 같아 다음 저장이 성공한다(`src/features/owner/server/permissions-save.test.ts:326`). 일반판 누락 보존은 이전 userOverrides/specialAccess를 그대로 얹고, 응답과 화면 둘 다 같은 결과를 resolve한다(`src/features/owner/preset.ts:66`, `:74`, `src/features/owner/preset.test.ts:160`, `src/features/owner/server/actions.ts:314`). 새 canonical 도입으로 이 순서가 바뀌지 않았다. 누락 보존과 서버 응답 token을 한 액션에서 묶은 새 사례는 없고, 이 부분은 기존 prepare 테스트와 코드 대조로 확인했다.
- **중복 요청 거절의 위치·소비처:** 원장/owner 권한 뒤, JSON·스키마 검사 뒤, DB client 생성/읽기 앞에서 거절한다. 새 문구는 ‘같은 메뉴·직급의 권한을 두 번 지정할 수 없습니다’이며 내부 역할/원시 키를 담지 않는다(`src/features/owner/server/actions.ts:109`, `:151`, `:158`, `:162`). 면의 sparse 변환은 메뉴×직급을 한 번씩 순회하여 새 중복을 만들지 않는다(`src/app/(shell)/owner/_components/permissions-section.tsx:56`). 별도 대화상자 `applySettingRoles`도 해당 그룹의 기존 행을 제거한 뒤 유일한 메뉴×직급 조합을 쓰며, 그룹 밖 기존 중복은 보존할 수 있다. 대화상자는 중앙 저장 액션을 거치지 않아 새 거절에 걸리지 않는다(`src/features/owner/setting-roles.ts:19`, `:20`, `src/lib/settings-role-catalog.ts:31`, `src/features/owner/server/setting-role-actions.ts:37`).
- **새 안내의 문구:** 알려진 메뉴/직급의 한글 라벨만 보여 주고, 내부 플랫폼 역할이나 원시 코드를 새로 노출하지 않는다(`src/app/(shell)/owner/_components/permissions-section.tsx:244`, `src/features/owner/permissions-canonical.ts:60`). 실제 안내 테스트가 raw `billing/admin` 미노출과 제출 행의 readonly 한 줄을 확인한다(`permissions-face-save.test.tsx:217`). 정리된 fresh props가 내려오면 initial의 중복이 없어 안내가 사라지는 코드는 맞지만, 실패/옛 props까지 포함한 흐름은 N1과 같이 보강이 필요하다.

## 테스트 확인

아래 6개 파일을 `npx --no-install vitest run --no-cache`에 명시해 **6개 파일·105개 테스트 통과**를 독립 확인했다.

- `src/features/owner/permissions-canonical.test.ts`
- `src/features/owner/server/permissions-save.test.ts`
- `src/app/(shell)/owner/_components/permissions-face-save.test.tsx`
- `src/features/owner/server/setting-role-actions.test.ts`
- `src/features/owner/preset.test.ts`
- `src/app/(shell)/owner/_components/section-form-guards.test.tsx`

새 테스트는 C1의 표가 같은 raw 중복 삽입을 기존 액션에 넣고, 거절만이 아니라 쓰기 0건과 B의 저장값 보존까지 단언한다(`permissions-save.test.ts:240`, `:243`, `:245`). 같은 값/다른 값의 중복 요청을 각각 거절하며, 이미 저장된 중복은 유일한 요청으로 정리되는 반대 경로도 확인한다(`:268`, `:281`). C2 사례도 token 비동치·액션 오류·쓰기 0건을 확인하여 헛도는 no-throw 단언만 있지는 않다(`:302`, `:303`, `:307`, `:308`). DB 권한 함수 자체는 실행하지 않았고 상태를 가진 모의 DB의 한계는 리뷰 2와 같다. 조정자가 수행했다는 변이 17종은 재실행하지 않았다.

판정: 커밋 가능
