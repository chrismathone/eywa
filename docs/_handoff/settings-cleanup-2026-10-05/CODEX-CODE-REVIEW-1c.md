# 학원 설정 정리 — 적대적 코드 리뷰 1c

2026-10-05. 리뷰 1b 이후의 훅·공통 폼·두 소비처·보강 테스트만 재검토했다. **B1·B2의 기존 반례는 닫혔다. 중요 N1 1건 때문에 수리가 필요하며, 경미 N2는 후속이다.** 보류는 처리 순서를 바꾸지만, 보류된 읽기가 저장 커밋보다 최신임을 보장하지 않는다.

코드의 상태 전이와 현재 배선을 대조했다. 아래 테스트 3개 파일·32개는 통과했다. 새 반례를 실행할 테스트 파일은 소유 범위 밖이라 작성하지 않았으며, 실 브라우저·실 DB에서 응답 타이밍을 재현한 것은 **미확인**이다. 소스·기존 보고서·PLAN은 수정하지 않았다.

## B1·B2 판정

| 항목 | 판정 | 근거 file:line |
| --- | --- | --- |
| B1 훅이 버린 응답과 폼 가드 기준의 불일치 | **닫힘 — 기존 반례 기준** | noteSubmitted가 inFlight를 켜고, 그동안 seen도 갱신하지 않는다. 성공은 제출분을 반드시 확정하고 inFlight를 끈다(`src/app/(shell)/owner/_components/use-section-draft.ts:49`, `:63`, `:67`). 공통 폼은 성공 콜백 뒤 두 가드에 같은 제출 스냅샷을 전달한다(`src/app/(shell)/owner/_components/section-form.tsx:115`, `:117`, `:118`). 다음 렌더에서 서버 값을 채택하면 adoptions를 올리고, rebaseline 효과가 두 가드를 그 폼으로 맞춘다(`use-section-draft.ts:54`, `section-form.tsx:145`). 실제 훅·폼·가드 테스트가 props 선행, 옛 값으로 재편집, 같은 커밋 도착, 서버 다듬기까지 검사한다(`src/app/(shell)/owner/_components/section-form-guards.test.tsx:140`, `:161`, `:180`, `:201`, `:220`). **응답 무시로 생기던 가드 불일치는 없어졌지만, 양쪽 모두 옛 서버 값에 맞춰지는 새 문제 N1은 별도다.** |
| B2 제출 중 되돌림 후 정상 성공 응답을 버림 | **닫힘 — 기존 반례 기준** | 세대 비교/return을 없앴고 confirmSaved가 제출분을 항상 확정한다(`src/app/(shell)/owner/_components/use-section-draft.ts:67`). D1 제출→D0로 되돌림→저장 전 시점의 props→성공에서는 confirmed=D1, draft=D0라 dirty로 남고 응답 token을 유지한다. 이 정확한 반례를 테스트한다(`src/app/(shell)/owner/_components/use-section-draft.test.tsx:145`). 다음 제출과 성공 후 props 채택도 검사한다(`:178`). **사용자가 되돌리지 않은 정상 제출에 저장 전 props가 오는 사례는 이 테스트로 덮이지 않는다(N1).** |

## 새 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
| --- | --- | --- | --- | --- |
| N1 | **중요** | `src/app/(shell)/owner/_components/use-section-draft.ts:49`, `:51`, `:54`, `:58`, `:67`; `src/app/(shell)/owner/_components/section-form.tsx:115`, `:145` | **사용자가 되돌리지 않은 정상 저장도 보류된 옛 읽기로 되돌아간다.** ① 초기 owned 값 D0/token T0에서 과목명을 D1로 고쳐 제출한다. ② 저장 커밋 전에 읽힌 props P=(owned D0 + 변경된 시간표 칸 R1, token T0)가 inFlight 중 도착한다. R1 때문에 incoming은 기존 seen과 다르지만, 시간표 칸은 subjects token에서 제외되므로 T0는 그대로다(`src/features/owner/operations-slice.ts:35`, `:157`). ③ 실제 저장은 D1+R1을 성공시키고 T1을 돌려준다. confirmSaved는 confirmed=D1, baseline=T1, inFlight=false로 만든다. ④ 바로 다음 렌더에서 draft D1=confirmed이므로 **보류된 P를 채택해 draft/confirmed를 D0+R1, baseline을 T0로 되돌린다**. 폼은 adoptions에 따라 두 가드도 D0+R1로 확정하고 '저장됨'을 표시한다(`section-form.tsx:145`, `:179`). 정상 저장한 과목명이 화면에서 사라지고, 곧바로 다른 항목을 고쳐 저장하면 서버의 T1과 옛 T0가 달라 정상 변경이 거절된다(`src/features/owner/server/operations-save.ts:108`). 뒤늦은 최신 props도 그때 이미 dirty면 받지 않는다. **DB의 D1이 이 경로로 덮어써지는 것은 아니다.** props는 캐시 없는 SELECT 시점의 값일 뿐, 제출 커밋과 읽기 순서를 나타내는 정보가 없다(`src/app/(shell)/owner/page.tsx:143`, `src/features/owner/server/queries.ts:97`, `:113`). 읽기를 겹칠 수 있는 현재 진입점은 과목 세션의 연도 Link다(`src/app/(shell)/owner/_components/subject-session-editor.tsx:152`): pending fieldset은 링크 탐색을 막지 않고, Next는 navigation을 진행 중 action보다 우선하며 action 결과 Promise는 별도로 resolve한다(`section-form.tsx:171`, `node_modules/next/dist/client/components/app-router-instance.js:143`, `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:237`). 이 탐색과 DB 커밋의 실제 타이밍 재현은 **미확인**이나, 위 props 입력에 대한 훅의 잘못된 결과는 코드상 확정적이다. | 성공 후 **커밋 전에 읽혔을 수 있는 보류 props를 무조건 확정 상태로 채택하지 않는다**. 응답과 같은 면 token을 가진 후보는 같은 owned 저장값으로 확인할 수 있지만, 다른 sha256 token의 신구 관계는 알 수 없다(`operations-save.ts:34`). 그런 후보는 보류/소비 처리하고 **응답 후 시작한 fresh 읽기**로 다시 확인하거나, 읽기·저장 양쪽에 비교 가능한 확정 버전을 붙인다. 제출분/token 쌍과 미저장 보호는 유지한다. 실제 훅·폼·두 가드 테스트에 「D1 정상 제출→owned D0+시간표 R1/T0 props→D1/T1 성공→D1/T1 유지→다음 편집·저장」을 추가한다. B의 실제 최신 변경을 받는 경우도 별도로 유지한다. **단순히 !inFlight 조건을 뺀 mutation 실패는 이 신구 구분을 검증하지 않는다.** |
| N2 | **경미·후속** | `src/app/(shell)/owner/_components/use-section-draft.ts:65`, `:67`, `:74`; `src/app/(shell)/owner/_components/subjects-section.tsx:437` | 훅 API에서 noteSubmitted(D0)→adopt(삭제 확정 D2/T2)→늦은 confirmSaved(T1)를 허용하면, adopt는 inFlight를 끄지 않고 제출분도 무효화하지 않는다. 늦은 성공은 삭제 확정 confirmed/token을 D0/T1로 바꾼다. draft는 삭제된 D2라 불필요하게 dirty가 되고, 다음 저장 기준도 잘못된다. **현재 사용자 조작으로 이 겹침이 가능한지는 미확인**: 폼 저장 중 자식 fieldset은 disabled이고, 삭제는 showModal로 배경을 막으며 실행 버튼은 type=button이다(`section-form.tsx:171`, `subjects-section.tsx:471`, `:558`, `:562`, `:567`). 따라서 커밋 차단 항목으로 올리지 않았다. | 과목 삭제와 일반 저장을 훅/소비처 계약상 동시에 허용하지 않는지 명시하고, submit→adopt→success 및 submit→adopt→failure 테스트를 추가한다. 겹침을 지원한다면 adopt 이후 옛 제출 응답이 확정 스냅샷/token을 되돌리지 않게 처리하고 공통 폼 가드도 같은 결정을 따르게 한다. 훅 단위에서 이미 바뀐 서버 값을 임의로 덮는 수리는 피한다. |

### N1이 새 테스트에 잡히지 않는 이유

`use-section-draft.test.tsx:132`의 정상 dirty 제출 사례는 보류 props도 이미 제출값 D1이다. 옛 props 사례(`:145`)에는 제출 중 되돌림을 넣어, 성공 후 dirty 조건이 채택을 막는다. 따라서 **dirty 제출 후 추가 편집이 없고, 보류 props가 저장 전 owned 값인 교차 사례**가 빠졌다.

통합 테스트의 다른 창 값 사례는 깨끗한 제출이고(`section-form-guards.test.tsx:161`), dirty 제출의 다듬기 사례는 성공한 뒤 다듬은 값을 보낸다(`:220`). token 문자열은 모의로 지정되어 읽기 시점/owned 내용과의 대응을 검사하지 않는다(`:156`, `:172`). 현재 테스트 통과는 B1·B2의 기존 반례를 닫는 증거이며 N1의 반증은 아니다.

## 요구된 실패·효과 순서·다른 소비처 대조

| 확인 대상 | 결과와 근거 |
| --- | --- |
| readOnly·pending 때문에 제출을 무시 | return이 onSubmit보다 먼저다. 무시한 제출이 noteSubmitted를 호출해 새 inFlight를 남기는 경로는 없다(`src/app/(shell)/owner/_components/section-form.tsx:92`, `:93`). 기존 진행 중 제출의 응답과 snapshot도 재제출로 바뀌지 않는다. |
| 일반 오류 응답 후 보류 props | 실제 두 면이 onSaveFailed를 연결했고, 공통 폼이 error state 변경 때 최신 콜백을 호출한다(`operations-section.tsx:67`, `subjects-section.tsx:105`, `section-form.tsx:82`, `:87`). noteSaveFailed는 confirmed/token을 바꾸지 않고 보류를 푼다(`use-section-draft.ts:73`). clean이면 props 채택, dirty면 draft/옛 기준 유지가 훅 테스트에 있다(`use-section-draft.test.tsx:161`). 실제 폼의 dirty 실패도 입력/이탈 보호가 남는지 검사한다(`section-form-guards.test.tsx:234`). 실패를 성공으로 확정하는 새 경로는 찾지 못했다. |
| 같은 오류 객체 재사용 | effect가 [state]에만 의존하므로 **같은 객체를 재반환하면 두 번째 실패 콜백은 생략될 수 있다**(`section-form.tsx:89`; `node_modules/react-dom/cjs/react-dom-client.development.js:7601`, `:7619`). 다만 현재 운영 섹션의 서버 오류 반환은 모두 매 호출 새 객체 리터럴이며 _prev를 돌려주는 경로가 없다(`src/features/owner/server/actions.ts:86`, `:126`, `:145`, `:208`, `:241`, `:242` 및 함수 전체 대조). 이 재사용을 실제 액션의 버그로 올리지 않았다. 구현 시 유의: 캐시된 오류 객체를 반환하도록 바꾸면 제출 시도 식별자로 완료를 추적해야 한다. 재사용 객체 테스트는 현재 없음. |
| action throw·네트워크 reject | 현재 공통 폼은 예외를 error 반환값으로 바꾸지 않으므로 noteSaveFailed는 불리지 않는다(`section-form.tsx:59`, `:106`). 그러나 설치된 React는 action reject를 렌더에서 다시 던지고, Next 오류 경계는 자식 대신 오류 UI를 렌더한다(`node_modules/react-dom/cjs/react-dom-client.development.js:8424`, `:8448`, `:8577`, `:5958`; `node_modules/next/dist/client/components/error-boundary.js:99`). /owner의 가장 가까운 셸 오류 화면은 reset/reload를 제공한다(`src/app/(shell)/error.tsx:35`, `:43`). **현재 살아 있는 폼에 inFlight가 영구 고착된다고 볼 근거는 없다**. 오류 경계로 인한 기존 편집 소실은 이번 변경으로 새로 생긴 것이 아니다. 실제 단절·throw 통합 재현은 미확인이다. 끝나지 않는 Promise는 공통 폼 pending도 끝나지 않으며 이번 변경만의 새 완료 신호 누락으로 분류하지 않았다. |
| 언마운트 | inFlight는 컴포넌트의 useState이며 외부 저장소에 남기지 않는다(`use-section-draft.ts:45`). 두 가드는 언마운트 때 리스너/dirty 알림을 정리한다(`src/components/workspace/use-unsaved-guard.ts:98`, `src/components/workspace/use-concurrent-edit-guard.ts:42`). 새 폼 마운트에 이전 inFlight가 이어지는 경로는 찾지 못했다. |
| 성공 응답·props의 같은 커밋/다른 커밋 순서 | pending 동안 props를 미루므로 성공 effect가 제출분 기준을 먼저 잡고, 훅의 다음 렌더에서 채택되면 rebaselineNonce effect가 채택값 기준을 잡는다(`section-form.tsx:111`, `:145`, `use-section-draft.ts:49`). 콜백 ref 갱신 effect는 성공/실패 처리 effect보다 먼저 선언되어 있다(`section-form.tsx:82`). 두 도착 순서·재편집 경고·다듬기는 실제 두 가드 테스트로 확인했고 모두 통과했다. 이 순서 자체에서 B1의 불일치는 찾지 못했으며 **채택값의 신구 판단은 N1**이다. |
| 과목 삭제 adopt와의 순서 | 삭제 응답은 adopt와 savedNonce를 함께 반영한다(`subjects-section.tsx:437`, `:438`); adoptions와 savedNonce 효과가 둘 다 현재 폼을 기준으로 하므로 일반 단독 삭제의 가드 기준은 같다(`section-form.tsx:135`, `:145`). 일반 저장과 겹치는 API 상태 전이는 N2에 적었다. 현재 삭제 테스트는 단독 adopt만 검사한다(`use-section-draft.test.tsx:197`). |
| 아직 훅을 안 쓰는 다른 SectionForm 소비처 | 프로필·수납·알림·상담·권한·메뉴·대시보드는 onSaveFailed를 전달하지 않아 새 실패 콜백은 optional no-op이다(`profile-section.tsx:16`, `billing-section.tsx:49`, `notifications-section.tsx:16`, `consultations-section.tsx:12`, `permissions-section.tsx:150`, `navigation-section.tsx:54`, `dashboard/dashboard-editor.tsx:128`; 모두 `src/app/(shell)/owner/_components/` 아래). 기존 요청 만들기·대시보드 revision·메뉴 발행·두 가드 성공 처리에는 이번 1c 수리의 추가 변경이 없다(`section-form.tsx:95`, `:100`, `:114`, `:119`). 실제 프로필 Harness의 성공·추가 편집·동시 편집 경고·실패 테스트 4개도 통과했다(`section-form-guards.test.tsx:39`, `:74`). 각 전체 화면의 브라우저 검증은 미확인이며, 이 변경으로 확인된 새 회귀는 없다. |

## 실행한 검증

```text
npx --no-install vitest run --no-cache 'src/app/(shell)/owner/_components/use-section-draft.test.tsx' 'src/app/(shell)/owner/_components/section-form-guards.test.tsx' 'src/app/(shell)/owner/_components/operations-faces-save.test.tsx'
# 3 files / 32 tests passed
```

전체 테스트·typecheck·eslint·의도적 mutation은 재실행하지 않았다. 조정자가 알려준 279파일·2,906개 통과 및 mutation 실패를 독립 검증 결과로 적지 않았다. N2는 후속으로 둘 수 있고, 커밋 전에는 N1의 정상 제출 + 저장 전 props 사례를 수리하고 검증해야 한다.

판정: 수리 필요(N1)
