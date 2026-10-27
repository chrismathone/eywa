# P1-B 적대적 코드 리뷰 2

검토 기준: `ea9ab98e6` 위 미커밋 변경 14개와 새 파일 5개, `PLAN.md:70`의 P1-B 및 `PLAN.md:138`의 구체화, `docs/decisions/settings-wiring.md:56`의 역할·권한 저장 계약. 소스와 마이그레이션을 읽었으며 DB 접속·스크립트 실행·빌드는 하지 않았다. 아래 DB 동작은 저장소의 SQL 계약을 대조한 결과이며, 실제 배포된 함수·실데이터 상태는 **미확인**이다.

## 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로(입력 → 잘못된 결과) | 수정 제안 |
| --- | --- | --- | --- | --- |
| C1 | 중요 | `src/features/owner/permissions-canonical.ts:17`, `src/lib/permissions.ts:448`, `src/features/owner/settings-types.ts:571`, `src/features/owner/settings-types.ts:578`, `src/features/owner/server/actions.ts:174`, `supabase/migrations/s1_season1.sql#0170a_user_permission_overrides.sql:54`, `supabase/migrations/s1_season1.sql#0158a_rls_role_gates_for_invoices_expenses.sql:67` | **앱의 표가 같다는 것이 DB 권한도 같다는 뜻은 아니다.** 역할별 `(menu, role)` 중복은 요청 스키마가 금지하지 않는다(중복 검사는 개인별 예외와 담당자에만 있다). 예외가 없는 상태에서 A가 열어 둔 뒤 B가 동일한 저장 액션으로 `overrides=[{menu:"billing",role:"admin",access:"none"},{menu:"billing",role:"admin",access:"full"}]`을 저장한다. 둘 다 스키마를 통과하고, 원장 쓰기는 DB 가드도 통과한다(`0335a_report_settings_menu_permissions.sql:55`). 앱은 마지막 `full`을 적용하므로 원래 기본값(`permissions.ts:225`)과 **동일한 token**을 반환한다. 반면 SQL은 마지막 행을 고르지 않고 `LIMIT 1`로 고른다(`0170a:61`): 배열 전개 순서대로 첫 일치 행을 반환하는 실행에서는 DB 수납 접근이 `none`으로 바뀐다. 이후 A가 다른 셀만 편집해 저장하면 fresh token도 같아 비교를 통과하고, B 저장 뒤의 `updated_at`에 CAS하므로 CAS도 통과한다(`actions.ts:270`). A의 sparse 목록에는 이 중복 행이 없어(`permissions-section.tsx:55`) B의 DB 권한 변경이 삭제되고 기본 `full`로 돌아간다. **SQL은 행 선택 순서도 명시하지 않아, 앱의 마지막 행 의미와 동치라고 보장할 수 없다.** | SQL 변경 없이 닫을 수 있다: 역할별 중복 셀 요청을 거절하고, 이미 저장된 중복·모호한 셀은 별도 검증으로 편집/저장을 안전하게 거절하여 표 변환 과정에서 조용히 지워지지 않게 한다. canonical의 동치 범위를 앱과 DB에서 모두 같은 의미인 입력으로 제한하되, 유일 셀의 명시적 기본값 행과 무의미한 순서 차이는 계속 허용한다. 중복 셀 요청 및 기존 중복 저장값, B 저장 → A의 옛 기준 저장을 검증하는 회귀 사례를 추가한다. |
| C2 | 경미 | `src/features/owner/resolve.ts:25`, `src/features/owner/permissions-canonical.ts:17`, `src/features/owner/permissions-canonical.ts:20`, `src/lib/permissions.ts:449`, `src/features/owner/server/actions.ts:174` | 깨진 저장 배열은 요소 검증 없이 resolve를 통과한다. 예를 들어 저장값 `permissions.overrides=[null]`이면 `resolveMatrix`의 `o.menu` 접근이, `userOverrides=[null]`이면 canonical의 `row.userId` 접근이 예외를 던진다. 새 baseline 비교는 보호 검사용 `try/catch`(`actions.ts:245`)보다 앞이라 구조화된 오류 응답으로 바뀌지 않는다. 쓰기는 일어나지 않지만, 유효한 수정 요청을 보내도 액션이 throw한다. **이런 저장값의 실데이터 존재는 미확인**이고 정상 스키마 저장으로는 만들어지지 않으므로 후속으로 분류한다. | baseline 발급·비교 전에 저장된 배열 요소의 형태를 확인하거나 해당 구간의 예외를 안전한 읽기 실패/저장 거절로 처리한다. 잘못된 행을 조용히 제거해 정상 token을 발급하면 보호하려던 값을 덮을 수 있으므로 기본값 복구로 통과시키지 않는다. null 요소를 넣은 합성 사례를 추가한다. |

C1은 기존 앱/DB 해석 차이 자체를 이번 작업에서 전부 고치라는 요구가 아니다. 새 충돌 검사가 그 차이를 ‘같은 설정’으로 간주해 다른 저장을 덮는 경로만 닫으면 된다. 잠긴 칸·알 수 없는 메뉴도 앱에서 무시된다는 사실만으로 DB 전체에서 무의미하다고 단정하지 않아야 한다(`permissions-canonical.ts:11`, `permissions.ts:449`, `0170a_user_permission_overrides.sql:59`).

## 확인했고 문제 없음

- **권한 검사와 early return 순서:** 로그인 → 섹션 확인 → 원장/owner 쓰기 권한 → JSON → baseline 필수 → 요청 스키마 → fresh DB 읽기 → token 비교 순서다. 무권한자는 token 일치 여부나 직원 조회 결과를 볼 수 없고, 읽기 실패도 쓰기 전에 거절한다(`src/features/owner/server/actions.ts:98`, `:108`, `:145`, `:150`, `:162`, `:174`).
- **세 칸의 포함:** 정상적으로 검증된 유일 셀 자료에서 역할별 표·개인별 예외·급여명세서/연차 담당자 두 명단이 모두 token에 들어간다. 명단 정렬은 복사본을 사용한다. 개인 예외만 또는 담당자만 바뀐 저장의 거절을 실제 액션으로 확인한다(C1의 모호한 역할 행은 제외: `src/features/owner/permissions-canonical.ts:19`, `src/features/owner/server/permissions-save.test.ts:181`, `:207`).
- **기존 보호와 실제 저장 응답:** fresh token 비교 뒤 일반판 직원/잠긴 메뉴 검사, `prepareSectionForSave`, 운영자 계정 보호 검사를 거쳐 쓴다. 응답 token은 요청 객체가 아닌 `resolveSettings(nextData).permissions`에서 만든다. 침산 담당자 칸 제거·구폼 누락 보존 규칙과 숨은 계정 삭제 거절도 유지된다(`src/features/owner/server/actions.ts:177`, `:243`, `:246`, `:306`, `src/features/owner/preset.ts:64`, `src/features/owner/server/permissions-save.test.ts:260`, `:323`).
- **최종 CAS와 다른 섹션 보존:** 읽은 뒤 다른 writer가 끼어들면 `updated_at` CAS가 거절한다. 문서는 raw base를 펼쳐 현재 섹션만 교체한다. dashboard/navigation baseline, makeups RPC 분기, 나머지 섹션의 prepare·보호·쓰기 경로는 이번 diff에서 바뀌지 않았다(`src/features/owner/server/actions.ts:152`, `:207`, `:217`, `:257`, `:270`, `src/features/owner/server/permissions-save.test.ts:224`, `:310`). C1은 B가 **fresh 읽기 전에** 저장한 경로라 이 CAS로 막히지 않는다.
- **운영 순번 일반화:** 운영 요청은 여전히 필수 파싱을 통과해야 한다. 운영 저장 순번은 동일하게 `base.operations + 1`이며, 쓰지 않는 subject-remove 응답도 이전처럼 현재 운영 순번이다. 다른 섹션은 응답 version이 추가되지 않고 permissions만 새 순번을 받는다(`src/features/owner/server/actions.ts:137`, `:234`, `:255`, `:315`). 운영 액션/두 면/공용 훅·가드 테스트도 함께 통과했다.
- **permissions.rev와 DB 가드:** 순번은 섹션 안에만 있고 다른 섹션 저장은 raw permissions를 그대로 보존한다. 0038a 트리거는 0080a에서 교체됐으며 현재 0335a 가드는 원장 쓰기를 통과시키고, 비원장의 permissions 변경을 거절한다. 추가 dashboard/makeups 트리거는 해당 섹션을 검사하여 permissions.rev를 문제 삼지 않는다(`supabase/migrations/s1_season1.sql#0080a_tenant_settings_delegated_write.sql:65`, `0335a_report_settings_menu_permissions.sql:55`, `:61`, `0327a_dashboard_settings_guard.sql:27`, `0344b_makeup_settings_periods.sql:37`).
- **대화상자 writer:** `saveSettingRoles`는 기존 원장/운영자·열람 모드 게이트 뒤 service role client를 만들고, 기존 permissions를 펼쳐 overrides와 섹션 순번만 바꾼다. 비원장 운영자의 이 경로는 사용자용 permissions 변경 트리거에 막히는 방식으로 바뀌지 않았다. 기존 예외·다른 섹션·새 순번 보존을 확인했다(`src/features/owner/server/setting-role-actions.ts:22`, `:31`, `:40`, `:42`, `src/features/owner/server/setting-role-actions.test.ts:70`, `:83`).
- **순번 소비와 감사 기록:** resolve는 기본값의 키만 합치므로 rev를 PermissionsSettings에 섞지 않는다. raw SQL은 overrides/userOverrides만 읽고, 민감 기능 소비처도 이름 붙은 명단만 읽는다. 감사 diff에는 rev를 제거한 이전 섹션과 순번 없는 새 섹션이 들어간다(`src/features/owner/resolve.ts:21`, `supabase/migrations/s1_season1.sql#0170a_user_permission_overrides.sql:57`, `:66`, `src/features/payroll/server/payslip-gate.ts:30`, `src/features/leave/server/actions.ts:57`, `src/features/owner/server/actions.ts:279`, `src/features/owner/server/permissions-save.test.ts:299`).
- **fresh 편집 화면·실패 처리·PIN:** permissions 폼은 원장에게만 fresh 읽기를 수행해 그 값과 순번으로 열린다. 읽기 오류는 null → 안내만 표시하며 폼은 서지 않는다. operations token은 `editable`뿐 아니라 `canEditOperations`가 참이어야 생성하므로 permissions 읽기 일반화가 PIN 기반 token을 새로 노출하지 않는다(`src/features/owner/server/queries.ts:123`, `:126`, `:133`, `src/app/(shell)/owner/page.tsx:146`, `:151`, `:154`, `:162`, `:205`, `:245`). 비원장·비원장 운영자의 permissions 편집 제한은 기존과 같다(`page.tsx:123`, `:258`).
- **머리글 버튼과 새 문구:** owner 페이지 permissions 탭에서만 버튼을 뺐고 다른 탭의 group 선택은 유지한다. 공유 대화상자의 새 문장은 새 체크가 편집 권한을 준다는 안내이며 내부 역할 이름·원시 코드·우회 설명을 새로 노출하지 않는다(`src/app/(shell)/owner/page.tsx:193`, `src/features/owner/components/setting-roles-button.tsx:27`). 기존 문구는 P2-C 범위로 제외했다.
- **단일 draft·숨은 행·일반판 편집기:** 세 칸은 하나의 draft/확정 상태/baseline으로 움직인다. 표시용 필터는 payload를 잘라내지 않으며 개인 예외 수정·제거와 담당자 추가·해제는 해당 부분만 불변 갱신한다. 일반 직원 편집으로 숨은 행이 자동 삭제되는 경로는 없다(`src/app/(shell)/owner/_components/permissions-section.tsx:109`, `:128`, `:140`, `:148`, `:184`, `:320`, `:349`).
- **교사 복원 기억과 변경 표시:** 끄기 직전 값은 state의 순수 갱신으로 기억하고, 자기 저장은 adoptions를 올리지 않아 기억을 유지한다. 서버 draft 채택 때만 기억을 다시 만든다. 일반 사용자 클릭은 렌더 사이의 현재 값으로 처리되며 updater를 이중 호출해도 ref 부작용이 없다. 저장 전 변경은 항상 JSON으로 만든 확정 스냅샷의 matrix와 비교한다(`src/app/(shell)/owner/_components/permissions-section.tsx:119`, `:165`, `:171`, `:176`, `src/app/(shell)/owner/_components/use-section-draft.ts:66`, `:81`). 연속 off/on·자기 저장 뒤 복원·서버 채택 뒤 리셋을 컴포넌트 테스트로 확인했다(`permissions-face-save.test.tsx:223`, `:237`). StrictMode 전용 실행은 **미확인**이다.
- **저장/props 순서와 기존 훅 소비처:** initialDraft는 initial 객체에 따라 파생하며, 훅은 안정 직렬화·token·순번을 함께 비교한다. 제출 중 props는 미루고 성공/실패 뒤 판단하며 낮은 순번의 읽기는 버린다. confirmed를 반환한 것 외 훅 내부 로직은 기존과 같아 운영/과목의 처리 계약을 바꾸지 않는다(`src/app/(shell)/owner/_components/permissions-section.tsx:108`, `:186`, `src/app/(shell)/owner/_components/use-section-draft.ts:49`, `:61`, `:64`, `:81`, `:97`, `permissions-face-save.test.tsx:157`, `:172`, `:189`).

## 테스트 확인과 한계

독립 실행한 좁은 검사: `npx --no-install vitest run --no-cache`에 아래 11개 파일을 명시하여 **11개 파일·171개 테스트 통과**를 확인했다. 새 반례 테스트를 쓰지는 않았다(소스·테스트 수정 금지 범위).

- `src/features/owner/permissions-canonical.test.ts`
- `src/features/owner/server/permissions-save.test.ts`
- `src/app/(shell)/owner/_components/permissions-face-save.test.tsx`
- `src/features/owner/server/setting-role-actions.test.ts`
- `src/features/owner/server/operations-save.test.ts`
- `src/app/(shell)/owner/_components/operations-faces-save.test.tsx`
- `src/app/(shell)/owner/_components/use-section-draft.test.tsx`
- `src/app/(shell)/owner/_components/section-form-guards.test.tsx`
- `src/features/owner/seat-pin-view.test.ts`
- `src/features/owner/tenant-settings-writers.test.ts`
- `src/features/owner/server/navigation-save.test.ts`

PLAN P1-B의 필수 사례는 개인 예외만 변경/담당자만 변경 거절(`permissions-save.test.ts:181`, `:207`), 대화상자 결과에 해당하는 새 props를 깨끗한 표가 채택(`permissions-face-save.test.tsx:114`), 자기 저장 후 재저장(`permissions-save.test.ts:247`, `permissions-face-save.test.tsx:87`), 숨은 운영 설정 변경 거절(`permissions-save.test.ts:323`, `navigation-save.test.ts:62`)로 확인한다. 대화상자 테스트는 실제 dialog 액션과 폼을 한 실행으로 연결하지 않고, 순수 역할 계산 및 props 주입을 각각 검증한다(`permissions-save.test.ts:195`, `permissions-face-save.test.tsx:118`).

모의 DB의 `otherWriter`는 raw permissions와 문서의 다른 칸을 보존하고 수정 표식을 옮긴다(`permissions-save.test.ts:101`); 일반 API 저장의 최종 쓰기 CAS도 상태를 바꾸며 검증한다(`:72`). 다만 DB의 메뉴 접근 함수/RLS를 실행하지 않아 **C1을 검증하지 않는다**. 기존 canonical 테스트의 기본값/순서 동치 사례에는 중복 역할 셀과 DB의 `LIMIT 1` 의미가 없다(`permissions-canonical.test.ts:23`, `:34`). 여기가 필요한 보강이다.

후속 테스트 유의: admin users 모의는 ID만 필터링하고 `.eq("tenant_id", ...)`를 실제로 적용하지 않는다(`permissions-save.test.ts:47`). ‘다른 지점·퇴직 직원’ 사례도 직원 B를 결과에서 아예 빼는 방식이라 조회의 지점 조건과 반환된 `inactive`/`student` 분기는 각각 검증하지 않는다(`:334`). 실제 코드는 지점 조건과 상태/역할 필터를 유지한다(`actions.ts:188`, `:195`); 이 한계는 코드 결함으로 올리지 않았다. page 배선/PIN 제한 검사는 주로 소스 단언이고 실제 서버 페이지 실행은 **미확인**이다(`permissions-face-save.test.tsx:258`, `seat-pin-view.test.ts:91`).

차단 0건, 중요 1건(C1), 경미 후속 1건(C2). 이번 범위의 커밋 조건은 C1 수리다.

판정: 수리 필요(C1)
