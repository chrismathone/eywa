# CODEX 코드 리뷰 3c — B1·B2 좁은 재검토

범위는 리뷰 3b 이후의 건수 없는 병합 응답 처리, 미확인 문구, 처리 중 화면 분기와 관련 테스트다. 이전에 닫힌 항목과 PLAN §4·P2는 다시 평가하지 않았다. DB·네트워크·실브라우저에는 접속하지 않았으며 실제 배포 환경의 실행 결과는 **미확인**이다.

## B1·B2 판정

| 항목 | 판정 | 근거(file:line) |
| --- | --- | --- |
| B1 — 건수 없는 응답을 재조회 차이로 확정 | 닫힘 | count가 숫자가 아니면 코드 없는 오류로 즉시 `stop`에 들어간다. 남은 건수를 다시 조회하거나 차이를 계산하는 분기는 제거됐다(`src/features/admin/server/actions.ts:140`, `:144`). `uncertain=true`이면 확인된 이전 이동이 0건이어도 감사로그와 `/owner`·`/students` 무효화를 수행하고 적용 여부 미확인으로 안내한다(`actions.ts:95`, `:100`, `:108`, `:111`, `:116`). 따라서 PATCH 뒤 다른 창이 새 기록을 넣어도 ‘옮겨진 기록 없음’으로 빠지지 않는다. PATCH 전에 기록이 늘어난 경우에도 count 부재면 같은 분기로 끝나며, count가 있으면 그 실제 변경 건수를 합산하고 부족할 때만 멈춘다(`actions.ts:145`, `:147`). 상태 모의의 적용 후 추가+no-count 및 적용 전 추가+실제 count 테스트가 이 경로를 검증한다(`src/features/admin/server/actions.test.ts:406`, `:426`). |
| B2 — 진행 중 안내 대상이 새 props로 바뀜 | 닫힘 | 병합은 pending 분기가 확인 문장보다 먼저 서며 대상 없는 ‘병합 처리 중’만 표시한다(`src/app/(shell)/admin/duplicates/_client.tsx:208`, `:213`). 남은 수강 종료와 일괄 삭제·퇴원도 pending/busy 때 확인 폼 대신 대상 없는 상태 안내를 표시한다(`src/app/(shell)/admin/cleanup/_client.tsx:149`, `:154`, `:288`, `:294`). 병합은 form 자체가 남아도 pending 제출을 막고, 다른 세 작업은 처리 중 해당 form과 확정 버튼이 없다(`duplicates/_client.tsx:147`, `:220`; `cleanup/_client.tsx:155`, `:295`, `:313`). React 액션 큐와 초기화 구현을 확인했으며 자식 form 제거만으로 액션을 취소하거나 결과를 버리는 경로는 찾지 못했다. 아래 근거와 테스트 범위 참조. |

## 새 발견 사항

없음. 차단 0건·중요 0건·경미 0건.

## 반증 경로 및 구현 확인

- **PATCH 적용 → count 없음 → 다른 창의 기록 추가:** 이제 `stop` 전에 재조회하지 않는다. 미확인 단계의 이동량을 추측하여 합산하지 않으며 학생 퇴원 단계로도 넘어가지 않는다(`src/features/admin/server/actions.ts:144`, `:145`, `:150`). 감사의 `mergedRows`는 응답으로 확인된 앞 단계의 합이고 `moved`의 해당 단계 0은 아직 확인한 이동량이 없는 상태다. `partial`, `uncertain`, `failedStep`을 함께 남겨 이를 실제 무변경으로 확정하지 않는다(`actions.ts:107`, `:108`, `:131`). 화면도 숫자로 완료를 보고하지 않고 미확인 안내를 반환한다(`actions.ts:116`).
- **PATCH 전 기록 추가:** 실제 count가 사전 기준보다 크면 해당 count를 그대로 쓰고 계속한다. `count !== expected`로 정상 이동을 거절하는 조건은 없다(`actions.ts:145`, `:146`, `:147`). 이 조합에서 count까지 없으면 이전 항목과 동일하게 미확인으로 중단하므로 재조회 차이에 의존하지 않는다. 기존 단계 사이의 동시 쓰기 한계는 이번 수리로 확장하지 않았다.
- **두 미확인 문구:** 병합과 수강 종료 모두 ‘적용됐는지 확인하지 못했습니다(응답을 온전히 받지 못했습니다)’로 변경됐다. 성공 여부를 확정하지 않으며 DB 원문·표 이름·내부 플랫폼 역할 이름을 추가하지 않는다(`actions.ts:116`, `:257`). PLAN의 수리 기록도 이 동작을 설명한다(`docs/_handoff/settings-cleanup-2026-10-05/PLAN.md:161`).

## React 19 form action 확인

설치된 `react-dom@19.2.4`와 Next가 포함한 일반·experimental 구현을 읽었다.

- **결과 큐는 form의 DOM 생존 여부에 묶이지 않는다.** `mountActionState`는 훅을 호출한 컴포넌트 fiber에 dispatch와 상태 큐를 묶는다(`node_modules/.pnpm/react-dom@19.2.4_react@19.2.4/node_modules/react-dom/cjs/react-dom-client.development.js:8528`, `:8548`, `:8549`). Promise 결과는 그 action queue의 상태를 갱신하고 listener에 알린다(같은 파일 `:8420`, `:8434`). 이번 변경은 `CloseOrphansForm`/`OrphanStudentManager`의 훅을 유지한 채 자식 form만 상태 안내로 교체한다(`src/app/(shell)/admin/cleanup/_client.tsx:142`, `:149`, `:213`, `:288`). 이 제거 분기에 큐 취소나 액션 중단은 없다.
- **자동 초기화는 액션을 호출할 때 예약된다.** `startHostTransition`이 transition 안에서 `requestFormReset`을 호출한 뒤 action을 실행하고, 초기화는 form fiber의 상태 업데이트를 예약한다(`node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:9207`, `:9222`, `:9262`). 응답 뒤 사라진 DOM을 찾아 `requestFormReset`을 다시 호출하는 구조가 아니다. 따라서 이번 분기가 transition 밖 호출 경고를 새로 만들지 않는다.
- **실제 reset은 완료한 렌더 트리의 남은 form만 순회한다.** 제거한 form은 이 순회에 포함되지 않아 null DOM의 reset을 호출하는 경로가 없다(`node_modules/.pnpm/react-dom@19.2.4_react@19.2.4/node_modules/react-dom/cjs/react-dom-client.development.js:14900`, `:15147`; Next 일반 구현 `node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:16214`). experimental 구현도 같은 호출·순회 구조다(`node_modules/next/dist/compiled/react-dom-experimental/cjs/react-dom-client.development.js:9445`, `:9500`, `:16590`).
- **제출 데이터와 이중 제출:** React는 정상 submit에서 FormData를 먼저 만들고 action에 넘긴다(`node_modules/.pnpm/react-dom@19.2.4_react@19.2.4/node_modules/react-dom/cjs/react-dom-client.development.js:19092`, `:19100`). 제출 핸들러가 변경하는 것은 확인 상태이며 ID 입력값이 아니다(`src/app/(shell)/admin/cleanup/_client.tsx:160`, `:228`; `duplicates/_client.tsx:148`). 처리 중에는 확정 버튼이 없으므로 제거된 `disabled={pending}`이 사용자의 추가 클릭 경로를 열지 않는다. 남아 있는 병합 form은 pending 또는 미확인 제출을 취소하고, 퇴원·삭제도 busy/확인 대상 검사와 확인 소모를 유지한다(`duplicates/_client.tsx:147`; `cleanup/_client.tsx:226`). `preventDefault` 분기에서는 React가 action을 실행하지 않는다(같은 React 구현 `:19062`, `:19080`).

위 결론은 이번에 바뀐 **자식 form 제거**에 대한 것이다. 화면 전체 이동으로 부모 컴포넌트까지 사라지는 상황의 결과 표시를 새로 보장한다는 뜻은 아니다.

## 테스트 평가

- **B1 반례를 실제 상태로 재현:** 모의 UPDATE가 대상 행을 먼저 바꾸고 count만 누락한다(`src/features/admin/server/actions.test.ts:118`, `:119`, `:125`). `:406`의 테스트는 그 직후 microtask로 진 쪽에 새 행을 넣는다(`:413`). 이미 옮겨진 행을 확인하면서 무변경 문구를 금지하고 감사 `uncertain`·양쪽 경로 무효화를 단언한다(`:417`, `:419`, `:420`, `:422`). 고정 응답만 검사하는 테스트가 아니다.
- **사전 기준보다 많이 이동한 정상 응답:** 조회 직후 추가하는 hook은 사전 count의 행 집합을 구한 뒤 호출된다(`actions.test.ts:106`, `:107`). 마지막 사전 조회에서 새 행을 넣어 실제 UPDATE가 두 행을 옮기게 하고 결과와 감사 건수를 2로 확인한다(`:426`, `:434`, `:438`, `:439`). 추가 전 사전 count로 성공 건수를 잘못 기록하거나 증가를 부족으로 판정하면 실패하는 단언이다.
- **확인된 앞 단계만 합산:** 출결 no-count 사례는 실제로 출결이 이동해도 응답에 숫자로 완료를 싣지 않고 진 쪽을 퇴원시키지 않으며, 감사의 확인된 앞 단계 합을 2로 유지한다(`actions.test.ts:393`, `:398`, `:400`, `:401`, `:402`).
- **B2의 props 변경:** 실제 `useActionState`와 form을 사용하면서 병합 Promise를 미결로 유지한다. 제출 값 B를 확인한 뒤 `[A,C]`로 rerender하고, 처리 중 안내·alert 부재·확정 버튼 부재 및 액션 1회 호출을 확인한다(`src/app/(shell)/admin/cleanup-clients.test.tsx:331`, `:338`, `:340`, `:342`, `:345`).
- **자식 form 제거 뒤 상태:** 퇴원 Promise를 미결로 유지해 실제 busy 분기와 체크박스 잠금·확정 버튼 제거를 확인한 뒤 resolve한다(`cleanup-clients.test.tsx:197`, `:205`, `:208`, `:210`). 남은 수강 종료의 성공 경고와 실패 state 표시도 실제 form 제출 후 확인한다(`:212`, `:215`, `:218`, `:234`). React 훅 자체를 모의하지 않으며, 이번 좁은 실행에서는 경고·예외 출력 없이 통과했다. 삭제·수강 종료를 각각 장시간 pending으로 유지한 상태에서 props를 바꾸고 결과 문구까지 확인하는 전용 테스트는 없다. 같은 렌더/액션 큐 구조를 코드로 확인했으며, 이를 근거 없는 신규 결함으로 올리지 않았다.

독립 검증: `npx --no-install vitest run --no-cache 'src/features/admin/server/actions.test.ts' 'src/app/(shell)/admin/cleanup-clients.test.tsx'` — **2개 파일·64개 테스트 통과**. 이 보고서 외에는 파일을 만들거나 수정하지 않았다.

판정: 커밋 가능
