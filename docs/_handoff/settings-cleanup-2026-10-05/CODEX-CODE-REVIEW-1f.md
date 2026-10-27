# 학원 설정 정리 — 적대적 코드 리뷰 1f

2026-10-06. 리뷰 1e 이후 `data.operations.rev`로 옮긴 수리와 그 writer·소비처·DB 가드·테스트를 대조했다. **E1은 닫혔고, 이번 변경에서 새 차단·중요 결함은 발견하지 못했다.** 기존 E2는 데모 지점 한정 경미 후속으로 남는다.

지정 테스트 **12개 파일·191개 통과**: settings-stamp, operations-save, scheduled-groups, subject-actions-contract, tenant-settings-writers, resolve, preset, operations-slice, settings-diff, use-section-draft, section-form-guards, operations-faces-save. `npx --no-install vitest run --no-cache`에 이 파일만 지정했다. 소스·PLAN·기존 보고서는 수정하지 않았다. 실 DB의 배포 함수/트리거와 실제 일반 역할·개인 예외 계정으로의 DB 실행은 **미확인**이며, 권한 판정은 아래 SQL 코드와 앱 경로를 대조한 결론이다. 스크립트는 읽기만 했다.

## E1 판정

| 항목 | 판정 | 근거 file:line |
| --- | --- | --- |
| 최상위 rev가 개별 설정 위임자의 정상 저장을 거절함 | **닫힘** | 중앙 저장은 운영 요청일 때만 원본 운영 섹션의 순번을 올려 `storedSection`에 넣고, 최상위에는 기존 base·version=1·저장 섹션만 쓴다(`src/features/owner/server/actions.ts:238`, `:239`, `:240`). 따라서 0335a의 `(new.data - v_keys - 'version')`에서 operations와 그 안의 rev가 함께 빠져 잔여 문서는 그대로다(`supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:51`, `:84`). operations 변화에 필요한 권한은 operations_settings이고, OLD permissions의 개인 예외→역할 위임 순으로 판정한다(`:33`, `:35`, `:74`, `:78`). 일반 역할의 operations_settings full/scoped 위임과 개인 예외 full/scoped 부여 모두 추가 owner 권한 없이 통과할 수 있다. 두 면·subject-fields·subject-remove가 동일한 중앙 분기에 도달한다(`src/features/owner/server/actions.ts:129`, `:207`, `:238`; 상위 과목 액션의 같은 메뉴 게이트/중앙 저장 연결 `src/features/owner/server/subject-actions.ts:57`, `:147`). 저장 세션을 admin client로 바꾸거나 권한을 넓히지 않았다(`src/features/owner/server/actions.ts:141`, `:253`). 모의 가드 하의 운영 면·시간표 칸·과목 삭제 저장 통과를 검사한다(`src/features/owner/server/operations-save.test.ts:473`); 과목 면도 같은 분기이며 별도 실제 액션 계약 테스트가 통과했다. |

## 새 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
| --- | --- | --- | --- | --- |
| — | — | — | **없음** | — |

## 실제 DB 가드의 전체 조건 대조

| 조건 | 수리 후 결과와 근거 |
| --- | --- |
| 인증·원장·행 최초 생성/삭제 | auth.uid 없음·master의 기존 조기 반환은 SQL 그대로다(`supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:53`, `:55`). 일반 역할의 DELETE/최초 INSERT 거절도 유지된다(`:56`, `:57`). 순번을 섹션 안으로 옮겼다고 직원에게 없는 설정 행의 최초 생성 권한이 생기지는 않는다. 앱의 INSERT는 여전히 사용자 세션이며 DB 가드를 받는다(`src/features/owner/server/actions.ts:254`). |
| permissions 변경 금지 | 운영 저장은 base.permissions를 그대로 보존한다(`src/features/owner/server/actions.ts:240`). 직접 permissions 저장의 비원장 거절은 앱에 남고(`:101`), DB도 NEW/OLD permissions 차이를 독립적으로 거절한다(`supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:61`). nested rev는 이 검사를 우회하지 않는다. |
| 문서 version 제한 | nextData.version은 계속 1이며(`src/features/owner/server/actions.ts:240`), DB의 ‘변경하더라도 1 이외의 값은 금지’ 조건을 만족한다(`supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:64`). 순번은 이 문서 version과 별개다. |
| preset/modules 보호 | 원본을 펼치고 generic 표식은 원래 generic인 경우만 재확정한다(`src/features/owner/server/actions.ts:240`, `:242`; 판정 `src/features/owner/preset.ts:22`). 운영 요청은 preset/modules를 바꾸지 않으므로 이 가드를 통과한다(`supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:68`). |
| 섹션별 실제 변경 권한 | operations.rev 증가도 operations 변경의 일부라 operations_settings를 요구한다(`supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:72`, `:74`, `:78`). OLD 권한의 개인 거절은 역할 부여보다 우선한다(`:33`, `:35`). 앱도 중앙 저장 및 과목 액션에서 같은 메뉴의 쓰기 권한을 확인한다(`src/features/owner/server/actions.ts:105`; `src/features/owner/server/subject-actions.ts:57`). 무권한 요청은 쓰기 전에 거절된다(시험 `src/features/owner/server/operations-save.test.ts:193`). |
| 잔여 문서 비교 | 운영 섹션과 version만 달라져 잔여 문서가 동일하다(`src/features/owner/server/actions.ts:238`, `:240`; `supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:84`). 다른 최상위 키를 몰래 바꾸는 일반 계정의 제한은 그대로다. 기존 최상위 rev가 있는 가상의 행도 base에 보존할 뿐 새로 변경하지 않으므로 이 비교를 깨뜨리지 않는다. |
| 프로필·수납·알림·상담·메뉴·보고서 등 다른 섹션 | operationsRequest가 없으면 operationsRev=undefined, storedSection=sectionData이며 operations를 그대로 둔다(`src/features/owner/server/actions.ts:238`, `:239`, `:240`). 응답에 운영 version도 추가하지 않는다(`:292`). 기존 섹션 검증·prepare 분기와 개별 메뉴 게이트가 유지된다(`:105`, `:136`, `:226`). 역할 설정 저장도 permissions만 교체해 operations.rev를 보존한다(`src/features/owner/server/setting-role-actions.ts:38`). |
| 다른 tenant_settings 트리거 | 0038a의 master 전용 트리거는 0080a에서 제거되고 같은 쓰기 함수의 연결로 교체된다(`supabase/migrations/s1_season1.sql#0080a_tenant_settings_delegated_write.sql:65`, `:67`). 0281a가 교체한 함수는 이후 0335a의 같은 이름 함수로 갱신되며, 별도의 operations 객체 키 제한은 없다(`supabase/migrations/s1_season1.sql#0281a_tenant_settings_preset_modules_guard.sql:15`, `:73`; `supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:44`). 0327a 추가 가드는 dashboard가 달라질 때만 발화한다(`supabase/migrations/s1_season1.sql#0327a_dashboard_settings_guard.sql:27`). 0344b 추가 가드는 makeups 값/활성 모듈을 검사하고 operations.rev를 검사하지 않는다(`supabase/migrations/s1_season1.sql#0344b_makeup_settings_periods.sql:37`, `:41`). 따라서 저장소에 정의된 이 트리거들은 이번 nested rev 자체를 거절하지 않는다. 실제 배포 상태는 **미확인**이다. |

## 순번과 raw 소비처 대조

- **값·token에 섞이지 않음:** deepMerge는 기본값의 키만 재귀적으로 순회하고 resolveSettings는 그 결과의 operations를 사용한다(`src/features/owner/resolve.ts:21`, `:26`, `:115`, `:122`). operationsSchema도 rev를 선언하지 않은 일반 z.object이며, strictObject/catchall로 바꾸지 않았다(`src/features/owner/settings-types.ts:240`, `:283`). canonical은 스키마 정규화 후 면별 키만 선택하므로, 정상값의 rev가 token에 들어가지 않는다(`src/features/owner/operations-slice.ts:18`, `:157`, `:160`). 스키마 실패 시 fallback에도 면별 키 목록에 rev가 없어 이 키가 추가되지 않는다. 현재 실제 액션 테스트도 raw 저장에는 rev가 있으면서 resolve 결과에는 없음을 검사한다(`src/features/owner/server/operations-save.test.ts:535`, `:539`).
- **prepare 뒤 순번 재부착:** prepare는 parsed 값에서 프리셋 필드를 정리한다(`src/features/owner/preset.ts:130`). 이 과정에서 메타데이터가 떨어져도 중앙 저장은 **resolve된 값이 아닌 원본 base.operations**에서 순번을 얻어 prepare 뒤 storedSection에 붙인다(`src/features/owner/server/actions.ts:220`, `:238`, `:239`). 들어온 JSON으로 순번을 정하지 않는다. 요청 종류와 무관하게 실제 운영 쓰기만 증가한다. 이미 없는 과목 삭제의 무쓰기 응답은 현재 운영 순번을 그대로 반환한다(`:217`).
- **감사로그:** 비교의 이전 값은 withoutSettingsRev, 이후 값은 순번 없는 sectionData다(`src/features/owner/server/actions.ts:262`). helper는 새 객체에서 rev만 제거하고 원본을 바꾸지 않는다(`src/features/owner/settings-stamp.ts:32`; 검증 `src/features/owner/settings-stamp.test.ts:33`). 연속 실제 저장 테스트가 학년 변경만 기록되고 ‘외 N건’이 추가되지 않음을 확인한다(`src/features/owner/server/operations-save.test.ts:535`, `:541`).
- **운영 순번을 쓰는 앱 경로:** 중앙의 두 면·subject-fields·subject-remove는 운영 요청으로 모이고(`src/features/owner/server/actions.ts:129`; `src/features/owner/server/subject-actions.ts:147`), 예약 그룹 반영은 원본 storedOperations를 펼쳐 rev+1과 subjects를 함께 쓴다(`src/features/owner/server/scheduled-groups.ts:109`, `:113`). 중앙 UPDATE/INSERT와 cron CAS는 여전히 updated_at 조건/표식을 사용한다(`src/features/owner/server/actions.ts:249`, `:253`, `:254`; `src/features/owner/server/scheduled-groups.ts:120`, `:122`). 최초 운영 저장은 rev=1이다(시험 `src/features/owner/server/operations-save.test.ts:525`). 기존 행이나 운영 섹션이 없던 읽기는 0이다(`src/features/owner/server/queries.ts:132`; `src/features/owner/settings-stamp.ts:26`).
- **초기 INSERT·다른 섹션 쓰기:** 슈퍼관리자의 신규 행은 운영 섹션 없음, 데모 최초 행은 빈 operations로 시작하므로 이 규칙의 0이다(`src/features/super-admin/server/actions.ts:81`; `src/features/demo-roster/dashboard-apply.ts:68`, `:76`). 두 경로는 기존 운영 섹션을 upsert로 초기화하는 경로가 아니다. configure는 최초 행 충돌 시 do nothing이고, makeups/modules만 jsonb_set하여 운영 순번을 유지한다(`supabase/migrations/s1_season1.sql#0346l_makeup_cmd_configure.sql:29`, `:77`, `:82`). 다른 섹션 저장이 운영 순번을 올리지 않는 것은, 이 순번의 소비처가 두 운영 편집 면이고 그 면의 값이 그 쓰기로 바뀌지 않는 경계와 일치한다.
- **SQL의 raw 운영 읽기:** 0344b는 operations 객체 전체를 가져오지만, 소비 함수는 periodStyle·subjects·weekdayPeriods·weekendPeriods·holidays 경로를 직접 선택한다(`supabase/migrations/s1_season1.sql#0344b_makeup_settings_periods.sql:81`, `:91`, `:95`, `:99`, `:107`, `:168`). 새 rev를 교시 행으로 순회하거나 모르는 키라고 거절하지 않는다. 시간표 시트 SQL도 subjects 배열의 지정 과목만 고쳐 operations.rev를 유지한다(`src/features/timetable/server/master-sheet-store.ts:372`). 다른 raw 설정 읽기의 과목 액션도 바로 resolveSettings를 거친다(`src/features/owner/server/subject-actions.ts:133`, `:139`).
- **워커·스크립트:** cron의 운영 통째 쓰기는 위 scheduled-groups의 증가 경로다. `scripts/owner-settings/set-subject-default-view.mjs`는 원본 operations를 펼친 후 subjects만 교체하므로 rev를 지우지 않는다(`scripts/owner-settings/set-subject-default-view.mjs:84`). permissions 스크립트들은 원본 문서를 펼쳐 permissions만 교체한다(예: `scripts/staff-access/narrow-staff-menu.mjs:144`, `scripts/staff-access/revert-narrow-staff-menu.mjs:50`). 데모 과거 데이터 스크립트의 설정 쓰기는 modules 경로의 jsonb_set이다(`scripts/_oneoff/backfill-demo-history.mjs:758`). 검토한 이 경로에서 순번을 삭제하는 추가 재작성은 발견하지 못했다. 스크립트를 앱/cron 저장과 동시에 실행하지 않는 기존 운영 전제는 여전히 필요하며, 실행/외부 복원 도구의 행위는 **미확인**이다(`src/features/owner/tenant-settings-writers.test.ts:14`).

## 모의 가드의 효력과 한계

새 모의는 SQL과 같은 개별 설정 키 7개와 version을 잔여 문서에서 빼고, 바뀐 섹션이 delegatedSections에 있는지도 검사한다(`src/features/owner/server/operations-save.test.ts:55`, `:57`, `:59`, `:60`). 따라서 E1의 **최상위 새 키 추가→잔여 문서 변화→거절**을 잡는 테스트로는 유효하다. 운영 위임 저장의 positive와 운영 미위임의 negative가 모두 실제 중앙 액션을 통과한다(`:473`, `:485`). 최상위 키 불변·섹션 rev 증가·감사내역 제외도 단순 코드 문자열 검사 외에 실제 상태 검사로 보강했다(`:464`, `:535`; `src/features/owner/server/scheduled-groups.test.ts:99`).

다만 **0335a 전체 가드와 같은 구현은 아니다**. actor는 master인 채 delegatedSections로 별도 모드만 켜며, 앱 권한 판정도 m.allowed boolean이다(`src/features/owner/server/operations-save.test.ts:16`, `:25`, `:30`). SQL의 실제 auth.uid/역할/운영자 판단, 개인 예외 우선순위, INSERT·DELETE, 문서 version이 1 이외로 바뀌는 경우, owner 위임/운영자에게 잔여 문서 변경을 허용하는 분기는 흉내 내지 않는다(SQL `supabase/migrations/s1_season1.sql#0335a_report_settings_menu_permissions.sql:33`, `:53`, `:57`, `:64`, `:84`). nested 객체의 비교도 JSON.stringify여서 키 순서를 무시하는 jsonb 비교와 다르다(모의 `src/features/owner/server/operations-save.test.ts:58`, `:59`). positive 테스트는 **operations 면·subject-fields·subject-remove**를 직접 검사하고, subjects 면을 delegatedSections 모드로 따로 제출하는 사례와 개인 권한 우선순위 사례는 없다(`:473`). 따라서 이 테스트 통과를 ‘실 DB의 모든 권한 분기 검증’이라고 해석하면 안 된다. 위 실제 SQL 대조에서 이번 변경으로 이 빠진 조건을 위반하는 경로는 발견하지 못했으므로, 이 한계를 새 수리 요구로 올리지는 않는다.

## 남은 경미 후속

**기존 E2 유지:** 데모 요일 병합 SQL은 과목 면 소유 칸 weekdayGrouping을 바꾸지만 운영 순번을 올리지 않는다(`src/features/demo-roster/demo-weekday.ts:22`, `:29`). 같은 순번의 새 읽기 뒤 옛 읽기를 받는 한계는 남으며, settings-stamp 주석에도 예외로 명시됐다(`src/features/owner/settings-stamp.ts:15`). 1e에서 판정한 데모 한정 경미 후속이며, 이번 이동 수리로 심각도가 달라진 근거는 없다. 운영 소유 칸을 바꾸는 새 SQL은 순번도 올려야 한다. 이를 근거로 모든 같은 순번 props를 거절하면 저장 직후 서버 다듬기 채택을 막으므로 그 규칙은 유지한다.

판정: 커밋 가능
