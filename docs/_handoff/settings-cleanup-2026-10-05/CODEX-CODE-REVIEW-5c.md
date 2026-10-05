# 학원 설정 정리 적대적 코드 리뷰 5c

검토일: 2026-10-06. 범위: 리뷰 5b의 B1·B2·B3 수리만. 소스 수정 없음. 차단·중요 0건, 경미한 후속 1건(N1).

## B1·B2·B3 판정

| 항목 | 판정 | 근거(file:line) |
| --- | --- | --- |
| B1 — 상속된 속성을 오류 이름으로 사용 | 부분 | 기존 constructor/toString 등의 이름 표 반례와 객체의 상속 label 반례는 닫혔다. ownLabel은 제 속성의 문자열만, settingFieldLabel은 제 섹션·제 칸만 읽는다. locate의 객체 탐색과 quoteName 후보도 step을 거친다. 다만 배열 숫자 인덱스에는 own 검사 없이 접근하는 예외가 남았다(N1, 경미). `src/features/owner/settings-error.ts:98`, `:104`, `:125`, `:128`, `:136`, `src/features/owner/settings-diff.ts:108`, `src/features/owner/settings-error.test.ts:202`. |
| B2 — 상담 양식 중복의 내부 키 노출 | 닫힘 | 사유는 키를 보간하지 않는 고정 한글 문장으로 바뀌었다. 거절 조건·custom code·templates[i].key 경로는 그대로다. i번째 행의 name을 읽어 해당 양식 줄을 가리키며 실제 스키마 테스트가 general/firstvisit/initial_visit 세 키에서 정확한 문구와 키 비노출을 검사한다. `src/features/owner/settings-types.ts:462`, `:467`, `:469`, `src/features/owner/settings-error.ts:125`, `:128`, `src/features/owner/settings-error.test.ts:103`. |
| B3 — 첫 확정 DB 거절에도 부분 이동 안내 | 닫힘 | 첫 실패에는 wrote=false이고 비어 있지 않은 문자열 code가 있으면 ‘옮겨진 기록은 없습니다’로 답한다. 정상 응답을 받은 UPDATE 뒤에는 wrote=true, code 없는 첫 실패에는 적용 미확인 안내다. 23505 전용 분기는 그대로 먼저 처리한다. `src/features/owner/server/subject-actions.ts:261`, `:267`, `:285`, `:291`, `:301`, `src/features/owner/server/subject-actions-contract.test.ts:335`. |

## 새 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
| --- | --- | --- | --- | --- |
| N1 | 경미 | `src/features/owner/settings-error.ts:105`, `src/features/owner/settings-error.ts:128`, `src/features/owner/settings-error.test.ts:236` | 순수 헬퍼에 길이 1의 빈 배열을 넘기되 그 배열의 로컬 prototype에 `0: { label: "상속된 행" }`을 둔다. path=`["subjects", 0, "color"]`이면 step의 배열 분기는 parent[0]을 직접 읽어 상속된 행을 가져오고, 그 객체가 직접 가진 label을 문구에 붙인다. ‘과목 · 1번째’ 대신 ‘과목 \'상속된 행\'’을 표시하므로 보낸 값 모두를 제 속성으로만 읽는다는 설명에는 예외가 남는다. **현재 저장 경로의 JSON 배열에는 이런 로컬 prototype/빈 슬롯 입력이 전달되지 않으므로 프로덕션 회귀·PIN 노출로 판단하지 않는다.** 새 테스트는 객체가 상속한 label만 검사한다. | 후속으로 배열 숫자 조회도 Object.hasOwn(parent, token)을 만족할 때만 허용하고, 상속 숫자 인덱스/빈 슬롯 배열 사례를 추가한다. 정상 JSON 배열 동작은 유지된다. |

N1은 코드의 정적 실행 경로로 확인했으며 이 추가 반례를 별도 테스트 파일로 실행하지는 않았다(지정 보고서 외 파일 쓰기 금지). 경미한 후속으로 처리 가능하다.

## 확인한 실행 경로

- **이름 표·보낸 값 접근**: VALIDATION_ONLY_LABELS의 섹션도 own 검사 후 선택하고 NESTED_LABELS 값은 ownLabel로만 읽는다. quoteName의 label/name/title 후보는 모두 step을 거친다. 직접 읽는 자리로 남은 것은 own 검사 이후의 table[key]/parent[token]과 N1의 배열 분기다. `src/features/owner/settings-error.ts:99`, `:100`, `:105`, `:106`, `:128`, `:136`.
- **감사 diff 영향 없음**: settingFieldLabel의 실제 생산 호출은 오류 헬퍼뿐이다. 감사 diff는 기존 FIELD_LABELS를 직접 읽는 계산을 유지하므로 정상 감사 변경 목록의 동작은 이번 수리로 바뀌지 않았다. `src/features/owner/settings-error.ts:136`, `src/features/owner/settings-diff.ts:108`, `:330`.
- **양식의 행 이름**: path의 숫자 i에서 input.templates[i]로 내려가 그 행의 name을 후보로 읽는다. 첫 양식 이름을 잘못 붙이거나 내부 key를 이름 후보로 읽지 않는다. 이름이 빈 문자열이면 quoteName이 null을 반환해 ‘N번째’로 가리킨다. 실제 스키마에서는 빈 name의 min 오류가 먼저 발생해 ‘N번째 · 이름’과 이름 입력 안내를 보여 주므로, 중복 키 사유가 빈 행 이름을 대신 노출하지 않는다. 빈 이름 사례 자체를 추가 실행한 검증은 미확인이다. `src/features/owner/settings-error.ts:111`, `:128`, `:130`, `src/features/owner/settings-types.ts:448`, `:469`.
- **첫 거절의 사실성**: wrote가 false인 첫 UPDATE 이전에는 actor/settings 확인과 두 과목의 반 이름 SELECT만 있다. 이 요청의 선행 DB 이동은 없으며 첫 문장의 확정 DB 거절이면 ‘없음’ 안내가 맞다. 응답이 없으면 첫 쓰기라도 ‘없음’으로 단정하지 않는다. `src/features/owner/server/subject-actions.ts:230`, `:238`, `:261`, `:270`, `src/features/owner/server/subject-actions-contract.test.ts:335`, `:355`.
- **0행 응답 뒤의 실패**: wrote는 이동 건수가 아니라 쓰기 문장의 정상 종료를 기록한다. 0행 성공 뒤에도 다음 실패는 보수적인 ‘옮겨졌을 수 있습니다’ 안내를 낸다. 실제 이동이 있었다고 확정하거나 완료 건수를 부풀리지 않는다. 이번 수리의 ‘첫 실패에서는 선행 쓰기가 없다고 확정’하는 조건과 구분된 계약이며 새 모의의 뒤 거절 사례도 0행 성공 응답을 사용한다. 그 경우의 더 정확한 안내는 이미 닫은 B3를 다시 확대해 수리 대상으로 올리지 않았다. `src/features/owner/server/subject-actions.ts:291`, `:292`, `src/features/owner/server/subject-actions-contract.test.ts:53`, `:345`.
- **RPC·세션·유니크 분기**: RPC에 오기 전에 스칼라 UPDATE가 모두 끝나므로 wrote는 true다. RPC 실패는 부분 적용 가능성을 안내하고, 그 뒤 세션 이동 실패의 기존 고정 안내도 같은 보수적 정책이다. 23505는 writeFailure보다 먼저 기존 전용 문구·로그를 사용하므로 wrote에 영향받지 않는다. `src/features/owner/server/subject-actions.ts:285`, `:300`, `:318`, `src/features/owner/server/subject-actions-contract.test.ts:365`, `:375`.
- **로그·기존 액션 흐름**: writeFailure는 같은 explainDbError scope와 스칼라 table context를 넘긴다. 첫/뒤 거절 모두 로그는 남고 문자열 안내만 달라진다. 스칼라 count 집계·RPC counts·설정 제거 순서는 유지되고, 미사용 삭제 경로는 이번 wrote 변경을 사용하지 않는다. `src/features/owner/server/subject-actions.ts:268`, `:289`, `:292`, `:301`, `:303`.

## 테스트 검토·실행

지정한 두 파일만 실행해 **46개 테스트가 통과**했다. `--no-cache` 없이 실행했다. 조정자가 보고한 변이 37종은 이번 검토에서 다시 적용하지 않았다.

```text
npx --no-install vitest run src/features/owner/settings-error.test.ts src/features/owner/server/subject-actions-contract.test.ts
```

- B1의 네 검사는 실제 record 스키마의 상속 이름 5종, 순수 헬퍼의 경로/섹션 이름 6종, 상속 label 객체, settingFieldLabel 직접 결과를 검사한다. 단순 소스 검사만은 아니며 이전의 직접 이름 조회·객체 label 조회로 돌아가면 해당 결과 단언과 맞지 않는다. 배열 인덱스 예외는 N1이다. `src/features/owner/settings-error.test.ts:207`, `:218`, `:236`, `:248`.
- B2는 consultationsSchema를 실제로 돌리고 문구 전체 및 내부 키 비노출을 검사하므로 예전 `${k}` 사유로 되돌리면 실패한다. `src/features/owner/settings-error.test.ts:105`, `:109`, `:112`.
- B3의 dataTable Proxy는 from 단계에서 update만 가로챈다. select 등 읽기는 base 빈 thenable로 넘어가고 writeFault는 읽기를 실패시키지 않는다. update 실패 뒤의 eq 체인은 failed Proxy로 유지돼 기다릴 때 오류가 나온다. tenant_settings는 별도의 상태 가진 모의여서 기존 interleave·설정 보존 검사를 계속 실행한다. `src/features/owner/server/subject-actions-contract.test.ts:58`, `:63`, `:68`, `:85`.
- 새 다섯 실패 사례는 실제 absorbSubject를 호출하고 시도 순서·안내·원문 비노출·과목 행 보존을 검사한다. 첫 거절/뒤 거절/code 없는 첫 실패/RPC 실패/23505를 각각 구분하므로 wrote 갱신이나 분기 문구를 되돌리면 결과 단언에 걸린다. 다만 모의 스칼라 표는 0행이며 실제 기록 이동 건수·실제 DB 로그 수신을 검증하는 테스트는 아니다. 이번 좁은 문구 수리의 테스트로는 적절하다. `src/features/owner/server/subject-actions-contract.test.ts:324`, `:335`, `:345`, `:355`, `:365`, `:375`.

판정: 커밋 가능
