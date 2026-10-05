# 학원 설정 정리 — 적대적 코드 리뷰 1b

2026-10-05, 리뷰 1의 C1~C4 수리 및 보강 테스트를 미커밋 코드에서 재검토했다. **수리 필요: 중요 B1 1건. 경미 B2는 후속.** 기존 도장 위조와 단독 저장 중 추가 편집의 가드 불일치는 닫혔지만, 새 props를 먼저 채택한 뒤 늦은 성공 응답을 받는 경로에서 두 가드가 다시 옛 제출분을 기준으로 삼는다.

소스·PLAN·기존 보고서는 수정하지 않았다. 실행 경로는 코드로 대조했고 지정 테스트만 실행했다. 실 DB·실 브라우저의 응답 타이밍 재현은 미확인이다.

## C1~C4 판정

| 항목 | 판정 | 근거 file:line |
| --- | --- | --- |
| C1 공개 subject-fields의 도장·위생 우회 | **닫힘** | 중앙 저장은 freshSubject와 서버 actor/시각으로 normalize를 호출한다(`src/features/owner/server/operations-save.ts:111`, `src/features/owner/server/operations-save.ts:114`, `src/features/owner/server/actions.ts:204`). cleanPreset이 클라이언트 도장을 복사하지 않고, 같은 id의 본문이 같을 때만 fresh의 기존 도장을 유지한다(`src/features/owner/subject-fields.ts:34`, `src/features/owner/subject-fields.ts:49`, `src/features/owner/subject-fields.ts:62`). 직접 공개 액션의 도장 위조·중복 배정·공백 처리 테스트가 실제 저장값과 응답을 검사한다(`src/features/owner/server/operations-save.test.ts:246`, `src/features/owner/server/operations-save.test.ts:275`). |
| C2 clean 제출의 props→성공 응답 순서 | **부분** | adoptions 세대가 달라졌으면 confirmSaved를 버려 훅의 draft·confirmed·token 퇴행은 막는다(`src/app/(shell)/owner/_components/use-section-draft.ts:59`, `src/app/(shell)/owner/_components/use-section-draft.ts:63`). clean 역순 응답·다음 제출도 검사한다(`src/app/(shell)/owner/_components/use-section-draft.test.tsx:113`, `src/app/(shell)/owner/_components/use-section-draft.test.tsx:136`). 그러나 SectionForm은 그 응답이 버려졌는지 알지 못하고 두 가드의 기준을 옛 제출분으로 바꾼다(`src/app/(shell)/owner/_components/section-form.tsx:106`, `src/app/(shell)/owner/_components/section-form.tsx:108`): **B1**. 정상 응답을 버리는 추가 훅 상태 전이는 후속 B2에 적었다. |
| C3 헛도는 단언·모의 DB 차이·필수 사례 누락 | **부분** | 실제 두 가드 + 저장 중 외부 payload 변경 + beforeunload/다른 창 경고 검사가 추가됐다(`src/app/(shell)/owner/_components/section-form-guards.test.tsx:91`, `src/app/(shell)/owner/_components/section-form-guards.test.tsx:107`). 모의 DB는 전달된 updated_at을 저장하고 시계는 명시 제어한다(`src/features/owner/server/operations-save.test.ts:51`, `src/features/owner/server/operations-save.test.ts:82`). 최초 요청은 유효하되 fresh 병합이 무효인 사례, 실제 흡수 중 B의 변경/추가/삭제, 실패 표식→두 번째 cron 실행 skip도 생겼다(`src/features/owner/server/operations-save.test.ts:186`, `src/features/owner/server/subject-actions-contract.test.ts:142`, `src/app/api/cron/apply-due-class-updates/route.groups-mark.test.ts:85`). 다만 새 가드 Harness에는 useSectionDraft·props 갱신·rebaselineNonce가 없고, 역순 응답은 훅 단위에만 있어 **B1을 놓친다**(`section-form-guards.test.tsx:38`, `use-section-draft.test.tsx:113`, 두 파일의 전체 내용 대조). |
| C4 notifySaved도 제출분을 기준으로 확정 | **닫힘** | notifySaved(snapshot)과 markSaved(snapshot)에 같은 제출 스냅샷을 전달하고, 문자열이 아닌 인자는 종전 현재 폼 동작을 유지한다(`src/app/(shell)/owner/_components/section-form.tsx:108`, `src/components/workspace/use-concurrent-edit-guard.ts:57`). 실제 가드 테스트가 저장 중 추가 편집 뒤 다른 창 경고를 검사한다(`src/app/(shell)/owner/_components/section-form-guards.test.tsx:107`). **서버 상태를 먼저 채택한 경우의 예외 처리는 B1과 별개로 아직 필요**하다. |

## 새 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
| --- | --- | --- | --- | --- |
| B1 | **중요** | `src/app/(shell)/owner/_components/use-section-draft.ts:63`; `src/app/(shell)/owner/_components/section-form.tsx:106`, `:108`, `:109`, `:137`; `src/components/workspace/use-unsaved-guard.ts:115`; `src/components/workspace/use-concurrent-edit-guard.ts:60` | **서로 다른 렌더로 props 채택이 먼저 완료되는 순서.** ① clean D0를 제출해 submittedSnapshot=D0가 된다. ② 서버의 D1/token이 먼저 내려오면 훅이 D1을 채택하고 adoptions가 증가한다. SectionForm의 rebaseline 효과까지 완료되어 두 가드도 D1을 기준으로 clean이다. ③ 뒤늦은 성공 응답에서 훅의 confirmSaved는 세대가 달라 return하지만, SectionForm은 무조건 notifySaved(D0)·markSaved(D0)를 호출한다. 훅은 D1을 clean으로 보는데 두 가드는 D1≠D0라 거짓 dirty가 된다. **반대 방향의 보호 누락도 생긴다:** A의 무변경 저장 뒤 B가 과목명을 D0→D1로 바꾸고 새 props가 먼저 반영된 경우, ③ 후 A가 이름을 D0로 되돌리면 훅은 미저장으로 보지만 두 가드는 현재 폼=D0=옛 기준이라 clean으로 본다. 창 닫기/이탈 및 다른 창 저장 경고가 생략되어 그 미저장 편집을 잃을 수 있다(`use-unsaved-guard.ts:90`, `use-concurrent-edit-guard.ts:45`). 과목 면은 전체 payload를 hidden data에 싣고 adoptions를 rebaselineNonce로 전달하므로 실제 배선에서도 같은 비교 경로다(`subjects-section.tsx:96`, `:105`, `section-form.tsx:161`). | 저장 응답의 **확정 여부/세대 처리를 훅과 공통 폼·두 가드에 함께 전달**한다. 이미 서버 상태를 채택해 버린 성공 응답은 저장 신호를 알릴 수 있어도 가드 기준을 옛 제출분으로 되돌리면 안 된다. 현재 폼을 무조건 markSaved하는 수리는 저장 중 추가 편집 보호를 다시 깨므로 피한다. 실제 useSectionDraft + SectionForm + 두 가드의 통합 테스트로 「props 채택/가드 rebaseline 완료 → 늦은 성공 → clean 유지 → 채택 전 값으로 편집 → beforeunload/창 닫기 dirty 및 다른 창 경고」를 검사한다. 동일 커밋에 두 효과가 함께 도는 경우와 별도 커밋으로 도는 경우를 모두 검사한다. |
| B2 | 경미·후속 | `src/app/(shell)/owner/_components/use-section-draft.ts:46`, `:51`, `:59`, `:63`; `src/app/(shell)/owner/_components/section-form.tsx:162` | 훅의 **API 상태 전이**: confirmed=D0 → draft=D1 제출 → 기다리는 동안 setDraft(D0)로 되돌림 → 아직 해당 제출의 커밋 전인 서버 props D0+시간표 변경을 수신·채택(adoptions 증가) → 실제 D1 저장의 성공 token 수신. 채택 횟수만 비교하므로 이 **정상 성공 응답도 버려**, draft D0를 clean으로 두고 옛 token을 유지한다. 「제출 뒤 받은 서버 값」이 「그 제출의 커밋보다 최신」임을 뜻하지 않는다. 현재 두 운영 면은 pending fieldset으로 사용자 직접 편집을 막으므로 이 되돌림의 현행 UI 진입은 **미확인**이며, 따라서 후속으로 분류한다. 훅 자체는 setDraft를 노출하고 저장 중 추가 편집도 지원한다(`use-section-draft.ts:22`, `use-section-draft.test.tsx:69`). | 제출 중 되돌림과 서버 채택을 별도 테스트로 고정한다. 채택 세대만으로 응답의 신구 관계를 추정하지 말고 제출 중 채택을 보류해 성공/실패와 함께 조정하거나, 실제 확정 상태의 순서를 식별할 정보를 사용한다. adopt() 전후의 응답과 다음 제출도 같이 검사한다. 이 경로의 UI 소비처가 추가되기 전에 해결한다. |

## 수리의 세부 계약 대조

- **도장 유지 조건:** 같은 preset id를 찾고, name·groups의 id/title/classIds 순서·showOthers의 기본 true·othersTitle의 기본 빈 문자열을 배열로 비교한다. 객체 키 순서는 영향을 주지 않고 배열 순서는 보존된다. 본문이 바뀌거나 새 id면 서버 actor/시각을 쓰며 incoming savedBy/savedAt을 재사용하지 않는다(`src/features/owner/subject-fields.ts:49`, `:58`, `:63`, `:65`). 기존 도장 유지·키 순서·새 항목·작성자 이름 부재는 테스트되어 있다(`src/features/owner/subject-fields.test.ts:60`, `:65`, `:70`, `:76`). 이 조건에서 새로운 위조 경로는 찾지 못했다.
- **null/생략/빈 배열:** normalize는 보낸 키만 복사하고 null·생략을 그대로 두며, 빈 강사 순서와 공백 기타 제목은 null로 정리한다. presets의 빈 배열은 그대로 빈 배열이다. applySubjectFields는 undefined를 건너뛰고 null이면 키를 지운다(`src/features/owner/subject-fields.ts:78`, `:79`, `:84`, `:85`, `src/features/owner/operations-slice.ts:111`). presets 생략 보존/빈 배열 비우기는 액션에서도 검사한다(`src/features/owner/server/operations-save.test.ts:298`).
- **검증과 다듬기 순서:** 공개 subject-fields는 요청 스키마 검증 **후** 중앙 normalize, 병합 결과 재검증 순서다(`src/features/owner/server/operations-save.ts:75`, `:114`, `:122`). 따라서 직접 요청의 `title:""`, `name:""`, `teacherViewOrder:[""]` 등은 저장 스키마의 min(1)에 걸려 normalize까지 도달하지 않는다(`src/features/owner/settings-types.ts:80`, `:91`, `:162`, `src/features/owner/operations-slice.ts:55`). 공백 문자열은 길이 제한 내에서 통과한 뒤 다듬어진다. 고수준 액션은 요청 전에 같은 helper로 빈 항목을 제거하므로 정상 폼의 빈 입력 처리도 유지한다(`src/features/owner/server/subject-actions.ts:393`, `:419`, `:420`). 순수 helper의 빈 문자열 테스트를 공개 액션의 허용 입력 테스트로 읽으면 안 된다. 잘못된 입력 검증을 우회한 수리는 아니며, 이 차이를 추가 중요 결함으로 올리지 않았다.
- **presets 응답:** 중앙 subject-fields 응답은 실제 저장 후보를 resolve한 대상 과목의 보관함을 반환한다. 고수준 saveIntegrationGroups는 presets를 전달했을 때 그 응답을 그대로 돌려주고, 생략했을 때는 undefined를 돌려준다. `[]`는 truthy라 명시 비우기도 저장·응답 모두 `[]`다(`src/features/owner/server/actions.ts:273`, `src/features/owner/server/operations-save.ts:57`, `src/features/owner/server/subject-actions.ts:434`, `:439`, `:454`). 기존 보관함 보존과 즉시 도장 표시는 실제 고수준 액션 테스트로 확인했다(`src/features/owner/server/subject-actions-contract.test.ts:226`, `:244`).
- **연속 제출·adopt 순서:** noteSubmitted가 매번 당시 adoptions를 저장하므로 버림 상태가 다음 정상 제출에 붙지는 않는다(`src/app/(shell)/owner/_components/use-section-draft.ts:59`, `use-section-draft.test.tsx:136`). adopt는 값·확정 스냅샷·token을 함께 바꾸고 세대를 올리므로 뒤늦은 훅 성공은 그 스냅샷을 되돌리지 않는다(`use-section-draft.ts:68`). 반면 실제 폼의 가드까지 그 결정을 따르지는 않는다(B1). 현재 테스트에는 submit→adopt→late confirm의 조합이나 제출 중 되돌림(B2)이 없다(`use-section-draft.test.tsx:150` 이하 포함 전체 대조).
- **notifySaved의 다른 호출부:** 원생·직원·반·학생상담·등록상담은 모두 무인자 호출을 유지하며, 새 구현에서 현재 폼 기준·저장 발행 동작은 같다(`src/app/(shell)/students/_components/student-form.tsx:144`, `src/app/(shell)/staff/_components/staff-form.tsx:167`, `src/app/(shell)/classes/_components/class-form.tsx:260`, `src/app/(shell)/consultations/_components/consultation-form.tsx:282`, `src/app/(shell)/enrollment/_components/consultation-full-form.tsx:285`, `src/components/workspace/use-concurrent-edit-guard.ts:57`). 폼 없는 경우·scope 없는 경우도 기존 반환을 유지한다. 이 호출부들에서 새 회귀 경로는 찾지 못했다.

## 보강 테스트가 실제로 바뀐 점

| 리뷰 1 지적 | 이번 확인 |
| --- | --- |
| 두 가드 모의·저장 중 편집 없는 단언 | 가드 모의를 제거한 새 Harness가 저장 Promise를 보류하고 외부 setter로 실제 payload를 바꾼다. beforeunload와 subscribe 메시지의 경고를 검사한다(`src/app/(shell)/owner/_components/section-form-guards.test.tsx:17`, `:36`, `:53`, `:91`, `:107`). 이 지적 자체는 해소됐고, props/훅과의 결합은 B1 보강이 남는다. |
| 모의 DB가 timestamp에 순번을 더함 | 실제 전달된 updated_at만 저장하고 fake Date를 호출별로 명시 이동한다(`src/features/owner/server/operations-save.test.ts:52`, `:61`, `:82`). 임의의 `#순번` 전제는 없어졌다. 실제 DB timestamp 충돌·배포된 트리거 상태는 여전히 미확인이다. |
| 최초 요청에서 떨어지는 병합 검증 테스트 | 유효한 운영 면 요청과 다른 과목의 중복 라벨 fresh를 따로 만들고, 병합 후 오류·쓰기 0회를 검사한다(`src/features/owner/server/operations-save.test.ts:186`). 검증 순서가 달라져야 실패하는 실질적인 사례다. |
| N1 B의 다른 과목 삭제·흡수 진행 중 저장 없음 | 실제 absorbSubject를 호출하고 데이터 이동 RPC 대기 중 다른 창의 실제 saveOwnerSection을 끼워 넣는다. B의 변경/추가/삭제 보존과 삭제 응답 채택 후 재저장을 검사한다(`src/features/owner/server/subject-actions-contract.test.ts:52`, `:109`, `:142`, `:155`). 미사용 삭제도 사용량 재집계 중 다른 창 저장을 검사한다(`:34`, `:178`). 설정 외 표를 빈 결과로 모의하므로 실제 과목 데이터 이동/FK/트랜잭션 자체를 검증한다고 해석하지 않았다. |
| N2 완료 표식 뒤 다음 실행 skip의 구조 가드뿐 | 실제 GET을 두 번 호출하고, 상태 가진 로그 모의에서 완료 kind를 다음 읽기에 반환한다. error·예외·success 모두 재반영되지 않는 것을 검사한다(`src/app/api/cron/apply-due-class-updates/route.groups-mark.test.ts:29`, `:50`, `:85`, `:94`, `:104`). 날짜 필터·cron 인증 전체를 검증하는 테스트로 확대해 해석하지 않았다. |

## 리뷰 1의 기존 정상 항목 재대조

중앙 요청 검증·권한 검사·PIN 원 요청 검증·fresh 읽기·면별 token·소유권 병합·prepare·경계 검사·CAS·캐시 순서는 유지됐다. 이번 중앙 변경은 subject-fields의 fresh 정규화와 서버 도장, 요청별 성공 응답에 국한된다(`src/features/owner/server/actions.ts:95`, `:125`, `:130`, `:137`, `:203`, `:212`, `:221`, `:238`, `:273`; `src/features/owner/server/operations-save.ts:106`, `:114`, `:122`).

삭제 응답은 여전히 subjects 면 전체와 같은 saved에서 계산한 token을 함께 반환한다. presets 응답 추가로 PIN 원문이나 운영 면 snapshot이 응답에 추가되지 않는다(`src/features/owner/server/operations-save.ts:53`). 기존 PIN 거절·보존 테스트도 통과했다. cron·시트·데모 writer·P1-D resolve는 이번 수리에서 달라지지 않았다(git diff 및 현재 파일 대조). 다른 섹션의 기존 분기 역시 유지된다(`src/features/owner/server/actions.ts:133`, `:154`, `:183`, `:194`, `:213`, `:218`). 새 회귀로 확인된 부분은 **C2의 응답 무시와 공통 폼 가드의 연결(B1)**이다.

## 실행한 검증

아래 **10개 파일·96개 테스트 통과**. 전체 테스트·typecheck·eslint는 재실행하지 않았고, 조정자의 279파일·2,899개 결과를 독립 검증 결과로 적지 않았다. 소스 수정·추가 테스트 파일 작성·스크립트·DB·네트워크·빌드·dev 서버 실행은 하지 않았다. B1/B2 재현 테스트는 아직 없으므로 실행 통과 목록을 두 발견 사항의 반증으로 삼지 않는다.

```text
npx --no-install vitest run --no-cache src/features/owner/subject-fields.test.ts src/features/owner/server/operations-save.test.ts src/features/owner/server/subject-actions-contract.test.ts 'src/app/(shell)/owner/_components/section-form-guards.test.tsx' 'src/app/(shell)/owner/_components/use-section-draft.test.tsx' src/app/api/cron/apply-due-class-updates/route.groups-mark.test.ts 'src/app/(shell)/owner/_components/operations-faces-save.test.tsx'
# 7 files / 74 tests passed

npx --no-install vitest run --no-cache src/features/owner/server/seat-pin-save.test.ts src/features/owner/seat-pin-view.test.ts src/features/makeups/components/command-form-dirty.test.tsx
# 3 files / 22 tests passed
```

판정: 수리 필요(B1)
