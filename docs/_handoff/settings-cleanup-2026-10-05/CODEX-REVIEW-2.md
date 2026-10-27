# 학원 설정 정리 계획 v2 — Codex 합의 확인

검토일: 2026-10-05. 대상은 같은 폴더의 `PLAN.md` v2와 `CODEX-REVIEW-1.md`다. 결론은 **조건부 합의**다. 검토 1의 핵심 방향은 반영됐으나, 삭제 응답의 스냅샷 불일치, cron 충돌 후 처리, 누락된 설정 writer를 보완해야 한다.

루트 `CLAUDE.md`·`AGENTS.md`의 규칙을 유지하여 코드와 저장소 SQL을 정적으로 대조했다. 이 파일 외의 쓰기, git 쓰기, 앱·빌드·테스트·스크립트 실행, DB 접속·네트워크 호출은 하지 않았다. 아래 실행 경로는 코드와 계획에서 도출한 반례이며 실행 재현은 **미확인**이다. 프로덕션 데이터·실제 DB 트리거·화면 동작도 **미확인**이다. 새 훅·face·token 계약은 계획이므로 구현 완료를 뜻하지 않는다.

아래 `PLAN.md:n`·`CODEX-REVIEW-1.md:n`은 이 문서와 같은 폴더의 파일을 가리킨다. 반영 여부는 문서의 계약을 비교한 판정이며, 소스 근거와 남은 반례는 §2에 적었다.

## 1. 반영 대조표

| 조건 | 반영 여부(반영 / 부분 / 미반영) | 근거 |
| --- | --- | --- |
| §1 F2: 새 체크만 full, 기존 readonly/scoped 보존·문구 정정 | 반영 | 검토 1 `CODEX-REVIEW-1.md:13` → `PLAN.md:18`, `PLAN.md:70`. 전체 권한 payload 조건도 P1-B에 포함했다. |
| §1 F3: 행 수 실측과 스키마 참조 수의 확인 범위 구분 | 반영 | 검토 1 `CODEX-REVIEW-1.md:14` → `PLAN.md:19`. 1,068행은 CLAUDE의 과거 기록으로 한정하고 실제 DB 참조 수는 미확인으로 남겼다. |
| §1 F5: 현재 면 정의·과거 11면의 근거 구분 | 반영 | 검토 1 `CODEX-REVIEW-1.md:16` → `PLAN.md:21`, `PLAN.md:23`. 과거 문서의 11면 기록은 `docs/_handoff/menu-compact-2026-09-07/HANDOFF.md:85`에서 확인했다. 당시 실행 화면 자체는 미확인이다. |
| §1 P1-A: 면별 병합에 canonical·PIN·draft 수명·caller/CAS 포함 | 부분 | 검토 1 `CODEX-REVIEW-1.md:17` → `PLAN.md:35`, `PLAN.md:43`, `PLAN.md:45`, `PLAN.md:49`, `PLAN.md:51`, `PLAN.md:55`, `PLAN.md:56`. 대부분 반영했으나 자체 삭제의 token 조정은 §2 N1, writer 범위와 cron 처리에는 N2·N3가 남는다. |
| §1 P1-A 반대: face 없는 전체교체·현행 내부 caller 방치 금지 | 반영 | 검토 1 `CODEX-REVIEW-1.md:18` → `PLAN.md:35`, `PLAN.md:37`, `PLAN.md:38`, `PLAN.md:55`. 구폼 거절과 내부 호출자 의도별 이전을 명시했다. |
| §1 P1-B: overrides/userOverrides/specialAccess 전체 기준·전체 clean 판정·보호 | 반영 | 검토 1 `CODEX-REVIEW-1.md:19` → `PLAN.md:67`, `PLAN.md:68`, `PLAN.md:69`, `PLAN.md:71`. 기준값 필수화도 적절하다. |
| §1 P1-C: admin 유지, 최소 오류/부분완료, 두 학생 존재, 감사, ordered paging, 조회 유지 | 반영 | 검토 1 `CODEX-REVIEW-1.md:20` → `PLAN.md:74`, `PLAN.md:75`, `PLAN.md:76`, `PLAN.md:77`. 데이터 면의 바깥 fieldset도 제외한다. |
| §1 P2-A: 공용 정의의 metadata·generic modules·원래 순서 보존 | 반영 | 검토 1 `CODEX-REVIEW-1.md:22` → `PLAN.md:80`. navigation → modules → dashboard와 사용자 지정 이름·배치를 명시했다. |
| §1 P2-B: 인증→최종 권한/특수 조건 후보→도착 가드, 자체 쓰기 게이트 | 반영 | 검토 1 `CODEX-REVIEW-1.md:23` → `PLAN.md:81`. 후보 없음·자기 이동·embed·꺼진 모듈 404·import 진입 조건을 포함한다. |
| §1 P2-C: 안전한 path 라벨 + Zod message + 한글 트리거 매핑 | 반영 | 검토 1 `CODEX-REVIEW-1.md:24` → `PLAN.md:82`. `.message` 반환, PIN 감사 비노출, 실제 인쇄 소비처도 포함한다. |
| §1 P2-D: 모듈 꺼짐/권한 없음 구분·전체 참조 재검색·키오스크 자체 키·MP 값 보존 | 반영 | 검토 1 `CODEX-REVIEW-1.md:25` → `PLAN.md:83`. 네 조건을 모두 적었다. |
| §1 3단계: dirty 이동 정책·실제 시각 검증·빈 범주/iframe/키보드/URL | 반영 | 검토 1 `CODEX-REVIEW-1.md:27` → `PLAN.md:87`, `PLAN.md:88`. 검증 수단이 없으면 브랜치에 남긴다. |
| Q1-1: draft/확정 스냅샷/token 동시 갱신, 제출분만 확정 | 반영 | 검토 1 `CODEX-REVIEW-1.md:35` → `PLAN.md:50`, `PLAN.md:51`, `PLAN.md:52`, `PLAN.md:58`. 단 삭제 성공의 별도 경로는 N1처럼 이 규칙을 깨므로 Q1-7은 부분이다. |
| Q1-2: 스키마 기본값·읽기 승격·객체 순서 정규화 | 반영 | 검토 1 `CODEX-REVIEW-1.md:37` → `PLAN.md:45`, `PLAN.md:59`. 화면과 액션의 서버 함수도 통일한다. |
| Q1-3: 같은 면의 서로 다른 필드도 충돌이라는 제품 선택 | 반영 | 검토 1 `CODEX-REVIEW-1.md:39` → `PLAN.md:48`, `PLAN.md:100`. 세밀한 patch는 후속이다. |
| Q1-4: 읽기 전용에는 PIN 파생 baseline도 금지, redacted 원 요청 거절·빈 PIN 유지 | 반영 | 검토 1 `CODEX-REVIEW-1.md:41` → `PLAN.md:46`, `PLAN.md:47`, `PLAN.md:49`, `PLAN.md:61`, `PLAN.md:63`. 해시만으로 해결했다고 하지 않고 저장 권한도 요구한다. |
| Q1-5: prepare의 침산 제거·일반판 보존, terms/record 유지 | 반영 | 검토 1 `CODEX-REVIEW-1.md:43` → `PLAN.md:27`, `PLAN.md:41`, `PLAN.md:46`, `PLAN.md:62`. merged를 rawInput으로 주는 수정은 구폼 전체 거절 + 새 키 두 개를 어떤 면도 소유하지 않고 fresh에서만 받는 새 계약으로 수용 가능하다. 원 요청의 누락 때문에 침산 스키마 기본값이 일반판 값을 덮는 경로를 없앤다. 새 계약의 회귀 검증은 §4 참조. |
| Q1-6: 시간표 6개 키의 부재 보존, 새 과목의 외부 소유 키 배제 | 반영 | 검토 1 `CODEX-REVIEW-1.md:45` → `PLAN.md:42`, `PLAN.md:43`, `PLAN.md:60`. 값만 spread하지 않고 incoming에서 먼저 지우도록 했다. |
| Q1-7: 자체 흡수 후 안전한 조정, 다른 dirty 값까지 확정하지 않음·부활 방지 | 부분 | 검토 1 `CODEX-REVIEW-1.md:47` → `PLAN.md:54`. 선저장 정책은 반영했지만, 로컬 clean은 서버 최신임을 뜻하지 않는다. 행만 제거하고 새 token을 붙이는 조정은 N1 반례를 허용한다. |
| Q1-8: face/baseline 서버 검증, 권한 검사 유지·baseline은 인증 아님 | 반영 | 검토 1 `CODEX-REVIEW-1.md:49` → `PLAN.md:35`, `PLAN.md:36`, `PLAN.md:39`, `PLAN.md:62`. 두 UI face + 두 의도별 서버 요청으로 넓힌 것은 적절하다. |
| Q1-9: 최종 CAS 유지, 범위 안 writer도 같은 수정 표식 갱신 | 부분 | 검토 1 `CODEX-REVIEW-1.md:51` → `PLAN.md:46`, `PLAN.md:56`. 명시된 cron/시트는 포함했지만 src의 데모 writer까지 포함하는 계약인지는 빠졌다(N3). |
| Q2: 버튼 숨김 외 전체 권한 보호·복원 ref·기존 보호·사실에 맞는 안내 | 반영 | 검토 1 `CODEX-REVIEW-1.md:57`, `CODEX-REVIEW-1.md:59` → `PLAN.md:66`, `PLAN.md:67`, `PLAN.md:68`, `PLAN.md:69`, `PLAN.md:70`. |
| Q3: 파괴적 admin 게이트 유지, 변이만 UI 제한, scoped 정책 별도 | 반영 | 검토 1 `CODEX-REVIEW-1.md:63`, `CODEX-REVIEW-1.md:65` → `PLAN.md:74`, `PLAN.md:76`, `PLAN.md:100`. |
| Q4: 5범주/기존 순서·최종 권한·특수 면·기존 가드/404/import/embed | 반영 | 검토 1 `CODEX-REVIEW-1.md:69`, `CODEX-REVIEW-1.md:71`, `CODEX-REVIEW-1.md:73` → `PLAN.md:80`, `PLAN.md:81`. |
| Q5: D→A→B→C→P2→시각 검증, 큰 범위 분리 | 반영 | 검토 1 `CODEX-REVIEW-1.md:77` → `PLAN.md:25`, `PLAN.md:93`, `PLAN.md:98`, `PLAN.md:100`. |
| R1: cron CAS·시트 수정 표식·캐시 책임·구폼 무기준 전체 저장 폐지 | 부분 | 검토 1 `CODEX-REVIEW-1.md:83`, `CODEX-REVIEW-1.md:85` → `PLAN.md:35`, `PLAN.md:56`. 열거된 수리 자체는 반영했으나 “다음 실행이 다시 판단”은 현재 호출부와 반대다(N2). 다른 writer의 보장 범위도 N3처럼 정해야 한다. |
| R2: 순수 함수만이 아닌 실제 액션/훅 경계·canonical/PIN/prepare/권한 회귀 | 반영 | 검토 1 `CODEX-REVIEW-1.md:89`의 경계와 `CODEX-REVIEW-1.md:91`~`CODEX-REVIEW-1.md:96`의 사례를 `PLAN.md:57`, `PLAN.md:58`, `PLAN.md:59`, `PLAN.md:60`, `PLAN.md:61`, `PLAN.md:62`, `PLAN.md:63`, `PLAN.md:71`에 담았다. 구폼 누락 보존은 새 정책상 구폼 거절 + fresh 보존으로 바뀐다. 구체적인 통합 테스트 주의는 §4, 새 반례의 추가 사례는 N1~N3 참조. |
| R3: 미이전 표/RPC 분리, 뒤 update 오류·두 학생·부분완료 감사/refresh·확인 대상 구분 | 반영 | 검토 1 `CODEX-REVIEW-1.md:100`, `CODEX-REVIEW-1.md:102` → `PLAN.md:19`, `PLAN.md:75`, `PLAN.md:76`, `PLAN.md:98`. |
| R4: ordered paging, 날짜 의미는 정의 또는 안내 정정, DataFace 오류 수용·invoice 조회 범위 | 반영 | 검토 1 `CODEX-REVIEW-1.md:106` → `PLAN.md:77`, `PLAN.md:99`. 날짜 판정과 invoice 페이징은 후속으로 명시하는 범위 조정에 동의한다. |
| R5: 기존 문구 전수·인쇄 소비처·Zod/DB message·helper 반환·PIN 감사 보호 | 반영 | 검토 1 `CODEX-REVIEW-1.md:110`, `CODEX-REVIEW-1.md:112` → `PLAN.md:82`. |
| R6: 순서·경계별 커밋/검증·3단계와 표 확장/RPC 분리 | 반영 | 검토 1 `CODEX-REVIEW-1.md:116` → `PLAN.md:25`, `PLAN.md:79`, `PLAN.md:86`, `PLAN.md:93`, `PLAN.md:98`. |

## 2. v2 새 설계에 대한 반증 결과

| 설계 | 반증 결과 | 코드 및 계획 근거 |
| --- | --- | --- |
| 운영 요청 4종·face 필수·UI 두 면 baseline 필수 | **없음** — 전체교체 호환 경로를 닫고, 제한된 patch/remove 의도를 fresh에 적용하는 방향에 동의한다. 값 검증·대상 과목 존재 확인은 서버에서 완료해야 한다. | `PLAN.md:35`, `PLAN.md:37`, `PLAN.md:38`, `PLAN.md:46`. 현행 전체 전달 경로는 `src/features/owner/server/subject-actions.ts:148`, `src/features/owner/server/subject-actions.ts:390`, `src/features/owner/server/subject-actions.ts:497`; 현행 권한/스키마 검사는 `src/features/owner/server/actions.ts:84`, `src/features/owner/server/actions.ts:106`. |
| 서버 sha256 token·쓰기 권한자에게만 제공 | **없음** — 읽기 전용에 PIN 해시까지 내리지 않는 조건이 명확하다. token은 저장 결과와 일치하는 canonical에서 만들어야 한다. | `PLAN.md:47`, `PLAN.md:49`; PIN 공개 기준은 `src/features/owner/seat-pin-view.ts:8`, `src/features/owner/seat-pin-view.ts:37`, 표식 방어는 `src/features/owner/seat-pin-view.ts:20`, `src/features/owner/server/seat-pin-save.test.ts:120`. |
| 편집 면의 캐시 없는 새 읽기·조회 실패 시 폼 폐쇄 | **없음** — stale token 때문에 새로고침으로도 회복되지 않던 경로를 차단한다. | `PLAN.md:49`; 현 캐시 TTL은 `src/features/owner/server/queries.ts:45`, 실패가 기본값으로 반환되는 경로는 `src/features/owner/server/queries.ts:62`, 엄격한 uncached 읽기의 기존 선택지는 `src/features/owner/server/queries.ts:94`, `src/features/owner/server/queries.ts:102`. |
| useSectionDraft의 draft/확정 스냅샷/token 한 쌍·제출분 확정 | **없음** — 일반 저장/refresh 규칙 자체에는 추가 이견이 없다. 단 삭제 응답의 별도 전진 규칙이 이 불변식을 깨는 N1은 수정해야 한다. | `PLAN.md:51`, `PLAN.md:52`; 현재 제출/완료 경계는 `src/app/(shell)/owner/_components/section-form.tsx:62`, `src/app/(shell)/owner/_components/section-form.tsx:79`. |
| 다른 미저장 변경은 선저장 후 과목 삭제, 행만 제거하고 새 token 수신 | **구멍 있음: N1.** 다른 창의 저장 또는 삭제 중 저장을 로컬 clean 판정으로 감지하지 못한다. | `PLAN.md:38`, `PLAN.md:54`; fresh 삭제는 `src/features/owner/server/subject-actions.ts:143`, `src/features/owner/server/subject-actions.ts:267`, 로컬 행 제거는 `src/app/(shell)/owner/_components/subjects-section.tsx:396`. |
| scheduled-groups CAS·master-sheet-store 수정 표식 갱신 | **cron에 구멍 있음: N2.** CAS 자체와 시트의 동일 SQL 수정 표식은 적절하나 cron의 자동 재판단 주장은 틀리다. 시트 경로 자체의 새 구멍은 **없음**. | `PLAN.md:56`; cron 완료 표식 기록/제외는 `src/app/api/cron/apply-due-class-updates/route.ts:236`, `src/app/api/cron/apply-due-class-updates/route.ts:87`; 시트는 `src/features/timetable/server/master-sheet-store.ts:370`. |
| “모든 operations 쓰기 경로” 및 최종 CAS 보장 범위 | **구멍 있음: N3.** 데모 writer와 수동 스크립트가 누락돼 있다. | `PLAN.md:33`, `PLAN.md:56`; `src/features/demo-roster/demo-weekday.ts:21`, `scripts/staff-access/grant-class-review.mjs:113`, `scripts/owner-settings/set-subject-default-view.mjs:85`. |
| permissions 전체 canonical·baseline 필수·복원 ref/기존 보호 유지 | **없음** — 개인 예외만 바뀌어도 stale 전체 권한 저장이 거절되는 계약이다. 대화상자 writer는 이미 fresh 위에 overrides만 적용하고 CAS한다. | `PLAN.md:67`, `PLAN.md:68`, `PLAN.md:69`; `src/features/owner/server/setting-role-actions.ts:31`, `src/features/owner/server/setting-role-actions.ts:36`, `src/features/owner/server/setting-role-actions.ts:38`; prepare/계정 보호는 `src/features/owner/preset.ts:64`, `src/features/owner/server/platform-settings.ts:34`. |

### N1. 자체 삭제가 최신 token을 옛 목록에 붙인다 — 저장값 유실 가능

`PLAN.md:54`는 삭제 성공 후 **로컬 draft·확정 스냅샷에서 행 하나만 빼고 최신 subjects token을 붙인다**. 그러나 `subject-remove`는 UI가 가지고 있던 과목 baseline을 받지 않는다(`PLAN.md:38`). 현 흡수는 처음 읽기 뒤 여러 DB 작업을 거쳐 마지막에 다시 읽고 삭제한다(`src/features/owner/server/subject-actions.ts:181`, `src/features/owner/server/subject-actions.ts:213`, `src/features/owner/server/subject-actions.ts:267`). 현재 클라이언트도 나머지 목록을 서버 결과로 교체하지 않고 행 하나만 뺀다(`src/app/(shell)/owner/_components/subjects-section.tsx:397`).

구체적 경로:

1. A 창이 과목 `[X, Y]`와 token `T0`를 읽고 아무것도 수정하지 않는다. A는 로컬 기준으로 clean이다.
2. B 창이 Y의 라벨을 바꾸고 Z를 추가해 저장한다. 또는 A의 흡수 실행 도중 B가 이를 저장한다. A에는 아직 새 initial이 도착하지 않았다.
3. A가 X를 삭제한다. v2 서버는 fresh의 `[X, Y수정, Z]`에서 X만 제거해 `[Y수정, Z]`를 정상 확정하고 token `T2`를 반환한다.
4. 계획대로 A는 로컬의 X만 빼서 draft/확정 스냅샷을 `[Y옛값]`으로 만들고 token을 `T2`로 바꾼다. **스냅샷과 token이 서로 다른 서버 상태를 가리킨다.**
5. A가 이어 과목 설정을 저장하면 `T2` 검사를 통과한다. subjects 전체 배열은 incoming을 적용하므로 B의 Y 변경과 Z가 사라진다(`PLAN.md:43`, `PLAN.md:46`).

선저장은 A 자신의 미저장 변경만 없앤다. 최신 서버 상태임을 증명하지 못한다. 다른 창이 지운 과목이 A의 나머지 목록에 있었다면 같은 방식으로 그 과목도 부활할 수 있다. `revalidatePath`가 호출되는 것은 확인했다(`src/features/owner/server/actions.ts:228`). 그러나 v2는 삭제 응답 처리 전에 새 props가 반드시 적용된다는 계약이 없으며, 이를 안전성 근거로 삼을 수 없다(실제 응답/렌더 순서는 미확인).

**필요한 수정:** 삭제 성공 응답에 **삭제로 확정된 subjects 면 전체 스냅샷과 그 스냅샷의 token을 함께** 반환하고, clean 클라이언트가 둘을 함께 채택한다. 과목 목록만이 아니라 면 소유 키인 weekdayGroupings·hiddenBuiltinWeekdayGroupings도 포함한다(`PLAN.md:41`). 행만 로컬에서 빼는 응답 처리는 폐지한다. 응답 전에 추가 로컬 변경이 가능하다면 잠금 또는 명시적 재조정을 적용하고 그 변경까지 clean으로 만들지 않는다. 테스트는 “clean A → B가 다른 과목 변경/추가/삭제 → A 자체 삭제 → A 재저장”과 “흡수 진행 중 B 저장”을 넣어 B 변경 보존을 확인한다. 이것은 이름/파일 위치 문제가 아니라 저장 안전성 계약이다.

### N2. cron CAS 충돌은 다음 실행에 재시도되지 않는다 — 예약 반영 누락 가능

`PLAN.md:56`의 “충돌 시 status:error, 다음 실행이 다시 판단 — 기존 계약”은 호출부 코드와 맞지 않는다. 호출부는 그룹 결과가 error여도 반 이름/담임의 완료 표식을 남긴다(`src/app/api/cron/apply-due-class-updates/route.ts:223`, `src/app/api/cron/apply-due-class-updates/route.ts:236`, `src/app/api/cron/apply-due-class-updates/route.ts:242`). 다음 실행은 그 종류의 표식이 하나라도 있으면 스냅샷 전체를 제외하고, 그룹 결과를 읽지도 않는다(`src/app/api/cron/apply-due-class-updates/route.ts:78`, `src/app/api/cron/apply-due-class-updates/route.ts:87`, `src/app/api/cron/apply-due-class-updates/route.ts:92`).

구체적 경로: cron이 설정/updated_at을 읽음 → owner가 공휴일 같은 다른 설정을 저장해 updated_at 변경 → 새 cron CAS는 0행이어서 error 반환 → 호출부는 groups:error를 담은 완료 표식 기록 → 다음 날 스냅샷 제외 → **사람이 그룹 배치를 건드리지 않았어도 예약된 그룹 반영은 자동으로 다시 시도되지 않는다**. CAS로 기존 값을 덮는 사고는 막지만, 계획이 약속한 재판단은 사라진다.

**필요한 수정:** 충돌 처리 정책을 실제 호출부와 함께 정한다. 최소 대안은 같은 실행에서 fresh 재조회·`shouldApplyGroups` 재판정·CAS를 한정 횟수 재시도하고, 최종 실패는 자동 재시도가 없다는 기존 완료 표식 계약에 맞게 명시/기록하는 것이다(`src/features/owner/server/scheduled-groups.ts:63`, `src/features/owner/server/scheduled-groups.ts:64`). 다음 실행 재시도를 유지하려면 **완료된 반 이름/담임을 재생하지 않고 그룹만 재시도**하는 표식/선별 계약이 필요하다. 스냅샷 전체의 완료 표식을 없애는 단순 수정은 하지 않는다. 테스트는 CAS 0행뿐 아니라 **완료 표식 작성 후 다음 실행의 선별**까지 검증해야 한다.

### N3. 수정 표식을 갱신하지 않는 다른 writer가 남아 있다

앱 내부에도 `PLAN.md:56`의 cron·시트 이외 writer가 있다. `switchDemoRoster` → `replaceDemoRoster` → `insertDashboardSatellite` → `writeDemoWeekdayGrouping`가 설정 과목의 weekdayGrouping을 SQL로 바꾸며 updated_at을 갱신하지 않는다(`src/features/demo-roster/server/actions.ts:17`, `src/features/demo-roster/apply.ts:160`, `src/features/demo-roster/dashboard-apply.ts:113`, `src/features/demo-roster/demo-weekday.ts:21`). 같은 트랜잭션의 모듈 변경도 updated_at을 갱신하지 않는다(`src/features/demo-roster/dashboard-apply.ts:81`). 이 경로는 slug=demo만 허용하므로 **injaewon에 실행된다고 주장하지 않는다**(`src/features/demo-roster/apply.ts:36`, `src/features/demo-roster/apply.ts:45`). 그러나 계획은 일반판도 다룬다.

구체적 경로: demo의 owner 저장이 data/updated_at을 읽고 면 baseline 검사까지 통과 → 별도 데모 구성 액션이 과목 요일 병합/모듈을 바꾸고 커밋 → owner 저장은 이전 updated_at 조건에 여전히 일치 → 읽어 둔 전체 문서를 써 데모 변경을 되돌림(`src/features/owner/server/actions.ts:118`, `src/features/owner/server/actions.ts:190`, `src/features/owner/server/actions.ts:202`). 데모 액션의 `tenants` 행 잠금은 owner 액션이 사용하는 `tenant_settings` CAS를 대신하지 않는다(`src/features/demo-roster/apply.ts:40`). 캐시 무효화도 이미 읽은 저장 후보를 보호하지 않는다(`src/features/demo-roster/server/actions.ts:26`).

수동 스크립트도 fresh 편집 읽기만으로 보호되지 않는다. 권한 스크립트는 읽어 둔 data 전체를 PATCH하며 CAS/updated_at 갱신이 없다(`scripts/staff-access/grant-class-review.mjs:113`, `scripts/staff-access/grant-class-review.mjs:117`; `scripts/staff-access/grant-seat-attendance.mjs:48`). 과목 기본뷰 스크립트도 같은 방식이다(`scripts/owner-settings/set-subject-default-view.mjs:84`, `scripts/owner-settings/set-subject-default-view.mjs:88`). 액션의 기존 조회 이후 스크립트가 쓰면 새 face/permissions baseline은 이미 검사됐고 최종 CAS는 그 변경을 못 본다. 반대로 스크립트가 먼저 읽고 owner가 쓴 뒤 스크립트가 PATCH하면 owner 변경을 덮는다. **읽기만 했고 어떤 스크립트도 실행하지 않았다.**

최초 DDL과 앱 스키마에는 timestamp 기본값만 있다(`supabase/migrations/s1_season1.sql#0033a_tenant_settings.sql:12`, `src/lib/db/schema.ts:2289`). 실제 DB의 별도 자동 갱신 트리거는 미확인이므로 발생한 사고라고 단정하지 않는다. 계획은 미확인 트리거에 의존하지 않고 코드상 보장을 정해야 한다.

**필요한 수정:** 데모의 기존 SQL writer도 같은 트랜잭션에서 수정 표식을 갱신하는 대상으로 포함한다(시트와 같은 좁은 변경이면 된다). 수동 스크립트는 전부 고치도록 범위를 자동 확장할 필요는 없다. 다만 **이번 보호 범위에서 제외하고 owner/cron/시트 저장과 동시 실행하지 않는 전제를 명시**하거나, 보호 대상이면 조회 시점 CAS·updated_at 갱신까지 함께 적용해야 한다. 그러고 나서 `PLAN.md:33`의 “모든 경로”가 가리키는 범위를 정확히 적는다. 모의 DB로 데모 writer가 중앙 액션 조회 뒤 커밋하는 경우 중앙 저장 거절/보존을 확인한다.

## 3. 남은 이견

1. **삭제 응답 계약:** 최신 token을 로컬 행 제거 결과에 붙이지 않고, 확정된 subjects 면 스냅샷과 token을 함께 채택한다(N1).
2. **cron 충돌 후 정책:** 현재 완료 표식 때문에 다음 실행 자동 재판단이 없음을 바로잡고, 한정 재시도/최종 실패 또는 그룹만 다음 실행 재시도 중 실제 계약을 정한다(N2).
3. **writer 보호 범위:** 데모 SQL writer의 수정 표식 갱신을 포함하고, 수동 스크립트는 동시 실행 제외 전제를 명시하거나 같은 CAS 계약으로 보호한다(N3).

이 세 계약이 반영되면 그 외 계획 방향에 추가 이견은 없다. 새 마이그레이션·표 확장·세밀한 필드 병합을 합의 조건으로 요구하지 않는다.

## 4. 구현 시 유의 — 별도 설계 이견 아님

- **확정 성공 token의 출처:** prepare와 실제 저장 후보의 resolve/canonical 이후 token을 만든다. permissions의 침산 specialAccess 제거와 일반판 누락 보존이 존재하므로 파싱 직후 token을 반환하면 자기 재저장 기준이 어긋날 수 있다(`src/features/owner/preset.ts:64`, `src/features/owner/preset.ts:71`, `src/features/owner/preset.ts:130`). 두 면 token을 받더라도 현재 제출한 면의 스냅샷에 대응하는 token만 전진시킨다(`PLAN.md:46`, `PLAN.md:52`).
- **중앙 patch도 서버 액션 입력이다:** 허용 키 외 속성을 거절하고 값을 검증하며, 없는 subject를 임의 생성하지 않는다. `null` 삭제와 생략(no-op)을 구분한다. 기존 보관함 서버 도장·위생 처리와 `presets` 생략 보존을 유지한다(`src/features/owner/settings-types.ts:96`, `src/features/owner/server/subject-actions.ts:462`, `src/features/owner/server/subject-actions.ts:474`, `src/features/owner/server/subject-actions.ts:489`). 전체 fresh payload를 다시 만들어 patch에 담는 식으로 이전하지 않는다.
- **hook만 clean이어서는 부족:** 현재 SectionForm의 성공 처리는 `markSaved()`를 호출하고, 그 함수는 완료 시점의 DOM 전체를 확정한다(`src/app/(shell)/owner/_components/section-form.tsx:84`, `src/components/workspace/use-unsaved-guard.ts:108`). 새 제출분 확정 규칙을 창 닫기/이탈 dirty 안내까지 연결한다. refresh와 성공 응답의 도착 순서, 중복 제출의 응답 대응도 통합 테스트에서 다룬다.
- **canonical 실패 fallback:** `operationsSchema` 파싱 실패 시 원본을 사용하는 경로도 화면/액션에서 동일해야 한다(`PLAN.md:45`). 레거시 기본값 사례에는 color·testMax·weekdayGrouping을 포함하고, malformed 값은 정상 저장을 허용하려고 검사/보호를 우회하지 않는다(`src/features/owner/settings-types.ts:135`, `src/features/owner/settings-types.ts:138`, `src/features/owner/settings-types.ts:143`). 실제 invalid 운영 데이터의 존재는 미확인이다.
- **prepare/기존 문서 보존 회귀:** 일반판의 새 키 두 개는 incoming의 값/누락과 무관하게 fresh 저장 의미를 보존하고, 침산에는 두 키를 남기지 않는다. terms·부서 record·꺼진 modules 설정 보존도 검토 1의 회귀 명세에 남긴다(`src/features/owner/preset.ts:132`, `src/features/owner/generic-defaults.ts:38`, `src/features/owner/settings-types.ts:268`, `src/features/owner/server/actions.ts:190`).
- **CAS와 테스트 범위:** cron update가 error=null이면서 0행인 경우도 충돌로 받아야 한다. 중앙 액션과 같은 행 반환 검사가 필요하다(`src/features/owner/server/scheduled-groups.ts:92`, `src/features/owner/server/actions.ts:206`). “다른 면 동시 저장 둘 다 보존”은 최종 CAS 충돌을 무조건 둘 다 성공으로 숨긴다는 뜻으로 구현하지 않는다. 실제 caller의 patch·삭제 의미와 cron/시트/데모의 조회 후 충돌도 모의 DB 경계에서 확인한다.

합의: 조건부(삭제 성공 시 확정 subjects 면 스냅샷과 token 동시 채택, cron CAS 충돌 뒤 완료 표식과 맞는 재시도/실패 정책 확정, 데모 writer 수정 표식 갱신 및 수동 스크립트 동시 실행 보호 범위 명시)
