# Claude 인계·마무리 기록 — 2026-10-02

## Claude 마무리 결과 (같은 날 저녁)

Codex가 남긴 미커밋 변경을 그대로 이어받아 검증하고, 검증에서 나온 네 가지를 고친 뒤 기능 브랜치에 커밋·푸시했다. main 병합과 운영 배포는 하지 않았다. 아래 "Codex 인계 원문"은 당시 기록으로 남겨 둔다. 원문의 수치와 파일 이름 가운데 이 절과 다른 것은 이 절이 최신이다.

### 2차 보완 (같은 날 밤, 사용자 지시 "해결 가능한 부분 해결")

1차 마무리에서 남겨 둔 항목 가운데 손댈 수 있는 것을 처리했다. 아래 절들의 수치 가운데 이 절과 다른 것은 이 절이 최신이다.

| 남겨 뒀던 것 | 처리 |
|---|---|
| 브라우저 전체가 한 번에 통과하지 않음 | **해결.** 원인은 준비 전에 입력이 들어가는 두 곳이었다(Univer 이름 상자, 늦게 붙는 `labProbe`). 준비될 때까지 기다리게 고쳤고 전체 39개가 세 번 연속 한 번에 통과했다 |
| 반 편집 창 위에서 Ctrl+S를 누르면 보관함이 겹쳐 뜸 | **해결.** 다른 창이 열려 있으면 보관함을 띄우지 않고 먼저 닫으라고 알린다(브라우저 테스트 1개 추가) |
| 루트 `pnpm build` 재실행 | **통과.** 새 API 라우트 3개(`/api/timetable/lab/drafts`, `/drafts/[id]`, `/source`)가 빌드 결과에 있다 |
| main이 2커밋 앞서 있음 | **병합.** `7dcfb8069`까지 충돌 없이 합쳤다. 합친 뒤 루트 타입 검사 통과, 전체 테스트는 1,329 / 1,335파일·15,638 / 15,646개 통과. 실패 6파일·8개는 아래 표와 같은 목록이고 새로 생긴 실패는 없다 |
| main 쪽 낡은 테스트 3개 | **main 반영(2026-10-03, 승인받음).** `13730314c`. 코드 동작은 바꾸지 않고 테스트만 현재 동작에 맞췄다 |
| main의 규약 밖 마이그레이션 이름 2개 | **main 반영(2026-10-03, 승인받음).** `a64e7de1e`·`e334fae0b`(0334a·0335a로 이름만 변경, 읽는 곳 3군데의 경로 수정). 두 파일이 만드는 함수는 원격 DB에 이미 있다 |
| 지난 강사 가드(`past-teacher-wiring.test.ts`) | **손대지 않음.** 아래 설명 |
| 실제 로그인 저장→불러오기 | **할 수 없었다.** 아래 설명 |

**지난 강사 가드를 고치지 않은 이유.** 이 가드는 2026-09-07 결정("지난 수업의 강사는 시간표와 같은 단일 소스로 되살린다")을 잠근 것이다. `0c20facff`는 되살리는 방식을 새 모듈(`students/server/past-class-teachers.ts`)로 바꿨다. 담임 이력은 여전히 같은 `teacher-as-of` 모듈에서 읽지만, 이력이 없을 때의 추정은 "그 달 보고서 작성자"에서 "수강 기간의 마지막 보고서 → 강사 출결 기록"으로 달라졌다. 못 살리면 `—`로 비우는 것, 화면에 '(추정)'을 붙이지 않는 것, 마우스 오버로 근거를 말하는 것은 그대로다. 가드를 새 코드에 맞추는 것은 그 설계 변경을 승인하는 일이라 결정한 사람이 정해야 한다. 바뀐 방식이 의도한 것이면 가드의 세 줄(호출 형태, 조회 생략 조건, 툴팁 문구)만 새 코드에 맞추면 된다.

**실제 로그인 왕복을 못 한 이유.** 비밀번호는 문서에 없고(보안 감사 뒤 삭제), Claude가 쓸 수 있는 브라우저 프로필에는 로그인 세션이 없었다(실제 Next 서버에 물어 401 확인). 사람이 로그인한 브라우저에서 한 번 저장·불러오기를 해 봐야 한다. 첫 저장이 "연습본 이름 또는 시간표 자료 형식을 확인해 주세요"(400)로 거절되면 서버 저장 검증(`draft-schema.ts`)과 실제 운영 자료 모양의 차이다.

**main에 올린 것(2026-10-03).** 사용자가 "이상 없으면 올려"라고 승인했다. 올리기 전에 수정을 얹은 최신 main 전체로 다시 확인했다: 루트 타입 검사 통과, 전체 테스트 1,327파일 중 1,326 통과·15,596개 중 15,593 통과. 남은 실패는 지난 강사 가드 한 파일(3개)뿐이다. main은 `7dcfb8069..e334fae0b`로 빨리감기됐다. 런타임 코드 변경이 없어 끝 커밋을 스크립트 경로 수정으로 두었고 운영 빌드는 돌지 않았다("Canceled by Ignored Build Step").

검증 중 두 가지를 더 고쳐 함께 올렸다. 첫째, 창 식별 테스트에 넣었던 "창은 정확히 owner·lesson_reports 둘"이라는 고정 기대값을 목록에 묶이지 않는 확인으로 바꿨다(설정 면이 하나 늘면 깨질 가드였다). 둘째, 처음 검색에서 `tests/` 폴더를 빠뜨려 놓친 참조 `tests/integration/scheduled-enrollment.test.ts`의 경로를 새 이름으로 고쳤다. 이 통합 테스트(`pnpm test:rls`)는 실제 DB에 마이그레이션을 실행했다가 롤백하는 종류라 돌리지 않았다.

그 뒤 이 브랜치에도 main `e334fae0b`를 합쳤다. 마이그레이션은 0333a(이 브랜치)·0334a·0335a 순으로 놓인다.

### 고친 것

1. **회의 시간 편집이 끌기와 어긋나 있었다.** 마지막 변경으로 비수업 일정의 이동은 운영시간 제한에서 빠졌는데, 시간 폼과 `resizeLesson`은 여전히 운영시간을 걸어 운영시간 밖 회의를 열면 경고와 함께 버튼이 잠겼다. `isAllowedTime` 한 규칙으로 맞췄다. 수업은 그대로 운영시간 안에서만 바뀌고, 회의가 수업 운영시간을 넓히지 않는 것도 그대로다(단위 1개·브라우저 1개 추가).
2. **저장 경로에 감사로그가 없었다.** 프로젝트 규칙(쓰기 경로에는 `logAction`)에 따라 `timetable_lab_draft_save`를 등록하고 저장 성공 뒤 한 줄 남긴다. 개인 사본이라 슬랙 활동으로는 나가지 않게 막았다. 상세는 [저장 API 결과](draft-storage-results.md).
3. **마이그레이션 이름이 저장소 규약 밖이었다.** `20261002100848_…` → `0333a_timetable_lab_drafts.sql`. 내용과 원격 DB는 그대로다. 루트 전체 테스트를 끝까지 돌려서야 드러났다.
4. 응답 지연 안내 문구: 읽기 요청에도 "저장됐는지 확인"이라고 나오던 것을 저장 요청에만 나오게 했다.

### 검증 결과 (모든 수정 뒤 다시 실행)

| 항목 | 결과 |
|---|---|
| 실험 단위 테스트 | 42개 / 6파일 통과 |
| 실험 브라우저, 새 기능 4파일 | 21개 통과 (세 번 실행 모두) |
| 실험 브라우저, 전체 38개 | 1차 36개, 2차 37개 통과. 실패는 매번 다른 이전 단계(P0) 테스트이고 단독 3회는 통과. **한 번에 38개가 통과한 실행은 없다** |
| 실험 TypeScript·프로덕션 빌드 | 통과 (기존 Univer 번들 크기 경고는 그대로) |
| 루트 TypeScript (8GB) | 통과, 메모리 부족 없음 |
| 변경 파일 ESLint (51개) | 통과 |
| 저장 API 관련 테스트 | 30개 / 4파일 통과 |
| 감사로그·슬랙 분류 가드 포함 관련 묶음 | 248개 / 14파일 통과 |
| 시간표 기능 폴더 전체 | 1,237개 / 103파일 통과 |
| 로컬 격리 DB(PGlite) pgTAP | 33개 통과 |
| 원격 DB pgTAP (최종 스크립트) | 33개 통과, 시험 자료 잔존 0건 |
| 원격 DB 권한 상태 | RLS 켜짐, 정책 2개, 익명 읽기·수정·삭제 불가 |
| 실제 Next 개발 서버 | 비로그인 목록·저장·단건 조회 모두 401, `private, no-store` |
| 루트 전체 테스트, main 병합 전 | **1,316 / 1,322파일, 15,496 / 15,504개 통과. 6파일·8개 실패** |
| 루트 TypeScript, main(`245eb7b0e`) 병합 후 | 통과 |
| 루트 전체 테스트, main 병합 후 | **1,328 / 1,333파일, 15,612 / 15,619개 통과. 5파일·7개 실패**(아래 표의 고정 실패 그대로, 흔들리는 한 파일은 이번에는 통과) |

### 루트 전체 테스트의 실패 6파일

전체 테스트는 두 번 끝까지 돌렸다. 한 번은 main을 합치기 전, 한 번은 그날 main의 새 커밋 12개를 합친 뒤다. 합친 뒤에도 이 브랜치 때문에 새로 생긴 실패는 없었다. **전체가 모두 통과한 실행은 없다.**

이 브랜치는 main과 갈라진 뒤 billing·workspace·onescreen·classes 쪽 파일을 건드리지 않았다. 아래 가운데 네 파일은 main에 이미 들어온 커밋에서 생긴 고정 실패이고 한 파일은 흔들리는 테스트라, 이 브랜치에서 고치지 않았다. 고치는 쪽은 그 작업을 한 세션이다. 마지막 줄의 이름 가드만 이 브랜치 몫이 섞여 있었다.

| 테스트 파일 | 실패 | 원인 |
|---|---|---|
| `billing/session-terms/server/pricing.test.ts` | 1 | `71418e490`이 `salary-access.ts`에 `canAccessTenant`를 넣었는데 테스트의 권한 mock에 그 이름이 없다 |
| `components/workspace/window-identity.test.tsx` | 1 | `71418e490`이 넣은 메뉴 목적지 11개(`/owner?tab=…`, `/lesson-reports?tab=…`)의 창 id가 메뉴 키와 다르다 |
| `onescreen/makeup-merge-plan.test.ts` | 1 | `0c20facff`가 `onescreen-client.tsx`에서 가드가 찾는 `status: BasicAttendance \| "early_leave"` 표기를 없앴다 |
| `classes/past-teacher-wiring.test.ts` | 3 | `0c20facff`가 가드가 찾는 `resolveTeacherAsOf(…)` 호출과 툴팁 문구를 없앴다 |
| `billing/_components/receipt-allocation-dialog.test.tsx` | 1 | 고정 실패가 아니라 흔들리는 테스트다. '배분 저장' 버튼을 제때 찾지 못할 때만 실패한다. 단독으로 3회 돌리면 1회 실패·2회 통과였다 |
| `billing/session-terms/session-consumption-wiring.test.ts` | 1 | 규약 밖 마이그레이션 이름. main의 `20261002050926_…`(`0c26cb321`), `20261002075120_…`(`71418e490`) 두 개가 남아 있다. 이 브랜치의 세 번째는 0333a로 바꿔 해결했다 |

전체 실행 중 HappyDOM이 `localhost:3000/students?embed=1` iframe을 정리하며 내는 네트워크 오류 줄은 계속 나오지만 그 때문에 실패한 테스트는 없었다.

### 확인하지 못한 것

- **실제 로그인 계정으로 저장→불러오기를 한 번도 해 보지 않았다.** 원격 표의 연습본은 0건이다. 브라우저 테스트는 API를 합성 응답으로 대신했고, 서버의 엄격한 저장 검증이 실제 운영 자료를 받는지는 타입 대조와 DB 읽기 확인으로만 살폈다. 저장은 지울 수 없는 행(삭제 API 없음)을 운영 DB에 남기므로 사용자 확인 없이 실행하지 않았다.
- 불러오기 API(`/api/timetable/lab/source`)의 실제 계정 조회도 여전히 미검증이다.
- 성능 수치는 합성 자료의 순수 알고리즘 측정이다. 브라우저 렌더 시간이나 운영 자료 실측이 아니다.
- (루트 `pnpm build`와 Ctrl+S 창 겹침은 2차 보완에서 처리했다.)

### main에 합칠 때 할 일

1. 마이그레이션 번호가 겹치지 않는지 다시 확인한다(지금 0333a). 원격 DB에는 이미 적용돼 있어 다시 실행하지 않는다.
2. `docs/changelog.md`에 한 줄, `docs/decisions/timetable.md`에 "시간표 첫 과목 = 담당 과목, 링크에는 과목을 항상 싣는다"를 추가한다. main의 문서와 충돌하지 않게 이 브랜치에서는 넣지 않았다.
3. 루트 `pnpm build`와 전체 테스트를 다시 돌린다. 위 main 쪽 실패가 그때도 남아 있는지 본다.
4. 운영 화면의 '시간표 편집기' 진입 버튼, 운영 반영 경로는 아직 없다. 운영 반영을 만들 때는 반드시 감사로그를 함께 넣는다.

### 프로세스

Codex가 남긴 Vite(4317)·Next(4320) 개발 서버는 Claude가 처음 확인한 20시 무렵에는 살아 있었고, 21시 무렵 다시 봤을 때는 둘 다 내려가 있었다. Claude가 종료한 적은 없으며 원인은 확인하지 못했다(Codex 세션이 끝나며 함께 내려갔거나, 타입 검사·전체 테스트가 겹친 때의 메모리 부족으로 추정). 브라우저 테스트는 Playwright가 Vite를 직접 띄워 돌았다. 라우트 확인용으로 Next를 잠깐 띄웠다가 그 프로세스만 종료했다. 남긴 서버는 없다.

이 브랜치를 origin에 올릴 때는 맨 끝 커밋을 문서만 바꾸는 커밋으로 둔다. `vercel.json`의 `ignoreCommand`가 끝 커밋 하나만 보고, 그 커밋이 `docs/`·`scripts/`·`*.md`만 바꿨으면 빌드를 건너뛴다. 끝이 코드 커밋이나 병합 커밋이면 프리뷰 빌드가 돈다(프리뷰 배포는 비용 때문에 쓰지 않기로 돼 있다).

---

## Codex 인계 원문

사용자 최신 지시: “한도 초과 될거같으니까 멈추고 claude로 그대로 작업 넘겨”. Codex는 기능 작업을 중단하고 이 문서 작성 및 Claude 시작만 수행했다. Claude가 이후 작업 소유권을 인수한다. 재기획하거나 처음부터 다시 만들지 말고 현재 미커밋 변경을 이어서 검증·마무리한다.

## 작업 위치와 상태

- 실제 작업 폴더: `C:\Users\user\orca\workspaces\eywa_refactoring\timetable-lab`
- 브랜치: `chrismathone/timetable-lab`
- HEAD 및 마지막 푸시: `888484e186413b6f018c9acce38fe5862b54b3e3`
- 이번 기능 변경은 모두 미커밋 상태로 보존되어 있다. `git status --short`로 확인할 것. 삭제/reset/stash 금지.
- 공유 원본 `D:\eywa_refactoring`은 수정하지 않는다.
- 마지막 fetch 기준 main `71418e490`은 이미 이 브랜치에 반영되어 있었다. 마무리 때 다시 fetch하고 필요하면 충돌 해결 후 기능 브랜치에 push. force push 금지, 명시적 파일 staging만 사용.
- main 병합/운영 배포는 이번 단계에서 실행하지 않는다. 사용자 요청은 별도 워크트리에서 섬세하게 개발하는 것.
- Codex 하위 작업자 2명은 완료 상태이며 더 이상 수정하지 않는다.

## 사용자 의도와 확정 사항

- 영어부터 만들고 이후 수학에도 확장. Excel 화면 자체가 아니라 기존 시간표 모양에 Excel/Sheets의 편리함을 제공한다.
- 기존 강사뷰를 기준으로 배치하고 통합뷰에 투영하여 학생을 배정한다. 기존 시간표 불러오기, 운영 색상, 공간 최대 활용을 유지한다.
- 충돌이 있어도 자유롭게 배치하고 이유를 표시한다. 충돌 없는 대안을 추천하는 스마트 도우미가 필요하다.
- 복사/잘라내기/붙여넣기/Undo 등 단축키 지원. 전체 Sheets 단축키가 완성되었다고 주장하면 안 된다. 이전 계획과 남은 범위는 같은 폴더 문서에 있다.
- 반 이름 변경, 학생 드래그 반 이동, 반 병합/분리, 여러 연습본 저장·불러오기·비교.
- 드래그 반 이동은 사용자가 명시적으로 **옮겨가는 반의 전체 수업에 배정**을 선택했다.
- 수업 길이 40→60분 등 변경 가능하되 실제 운영시간 범위 안에서만. 비수업 회의가 수업 운영시간을 늘려서는 안 된다.
- 용어는 쉬운 한국어. 사용자가 “도착 수업”을 이해 못 했으므로 해당 용어를 쓰지 않는다.
- 연습본은 브라우저 localStorage가 아니라 Supabase DB 저장/조회.
- 반 이동한 학생은 기존 시간표처럼 민트색 및 출발 반 설명 표시.
- 시간표 초기 과목은 담당 직원의 과목을 따른다. 영어 담당에게 수학을 기본으로 열지 않는다.
- 운영 시간표 오른쪽 “시간표 편집기” 진입 버튼은 사용자가 “나중에”라고 했으며 후속 단계로 남겼다.
- 병목 개선도 요청받아 구현했다.
- Claude/Grok 협의 및 초기 계획은 이전 단계에 이미 수행되어 문서가 있다. JEV는 활용 가능하면 활용하라는 요청이었다.

## 구현된 변경

상세는 `class-editing-results.md`, `draft-storage-results.md`, `README.md`를 먼저 읽는다.

- `experiments/timetable-lab-p0/src/class-commands.ts`: 반 이름, 전체 수업 학생 이동, 병합, 분리. 안정된 ID, 원자적 변경 및 한 번의 Undo.
- 병합은 선택한 기존 반의 시간표/색상을 유지하고 명단을 합친다. 분리는 새 ID로 시간표를 복제하며 초기 중복 경고를 보여 준다.
- `student-marks.ts`: 이동 이력, 원래 반으로 돌아오면 표시 해제. 통합뷰 민트색 `#bbf7d0` / `#14512b`.
- `roster-drag.tsx`: 마우스/터치 드래그, 6px 문턱, Escape/blur/cancel, 경계 자동 스크롤, 낡은 revision 차단. 드래그 중 전체 React 보드 렌더 대신 DOM ghost/outline 업데이트.
- `class-tools.tsx`, `lesson-time-form.tsx`, `inspector.tsx`: 이름/병합/분리/학생 이동/요일·강사·시작·종료 설정. 40/50/60/80/90분 버튼과 운영시간 안내.
- `operating-times.ts`: 영어 평일/주말 시간대 + 실제 불러온 수업의 예외를 합치되 운영시간 사이의 틈을 보존. block 회의 제외.
- `block-clipboard.ts`: classRevision/originId로 이전 명단·이름·다른 연습본의 복사 내용 차단.
- `store.ts`: 변경 가지 공유 및 불변 스냅샷으로 Undo/Redo. 삭제된 키가 undefined 키로 바뀌는 반례도 수정/검증.
- `constraints.ts`: 요일·강사·교실·학생 색인, 영향받는 배치만 추천 검사. 원래 경고 순서/ID fallback/좌석 예외 보존.
- `draft-api.ts`, `draft-library.tsx`, `draft-comparison.ts`, `comparison-view.tsx`: 이름 있는 새 버전 저장, 페이지당 20개 목록, 불러오기, 두 연습본 읽기 전용 비교. 실패/취소/변경 revision 보호, Ctrl+S, 저장 상태/beforeunload.
- 저장된 연습본은 불변 버전이며 덮어쓰기/삭제 API 없음. 비교는 통합/강사뷰 및 변경 항목 표를 제공한다.
- `vite.config.ts`: Zod 사전 최적화로 첫 불러오기 시 Vite 자동 리로드/작업 유실 방지.
- `src/features/timetable-lab/draft-schema.ts`: 공유 엄격 Zod 검증, 2MiB 제한, UUID/참조/위험 키 검사.
- `server/draft-http.ts`, `server/drafts.ts`, `/api/timetable/lab/drafts` 및 `/[id]`: 인증, 지점/작성자 범위, 메뉴 권한, summary-only 목록, JSON 스트림 제한, cross-site POST 차단.
- `src/features/timetable/lib/subject-default.ts`, `server/view-prefs-queries.ts`, timetable page: 명시 URL 과목 > 담당 과목 > 사용 가능한 첫 과목. 다중 담당은 학원 과목 순서. 다른 강사 보기 권한 경로에서도 대상 강사의 과목 사용.

## 실제 Supabase 적용 완료 — 접근 차단 아님

- 프로젝트 ref: `ylqviwxedsdikuslmwxf`.
- MCP 연결은 접근 거부였으나 사용자가 “env에 없어?”라고 하여 `.env.local`의 `DATABASE_URL`로 직접 접속했다. 값/비밀키를 출력하거나 커밋하지 않는다.
- 실제 원격 DB에 `supabase/migrations/20261002100848_timetable_lab_drafts.sql` **적용 완료**. 다시 적용할 필요 없다.
- `timetable_lab_drafts` + SECURITY INVOKER 메뉴 권한 helper, 소유자/지점 RLS, SELECT/INSERT만 허용. 개인·지점 분리 및 적절한 인덱스.
- 실제 권한 점검: RLS=true, 정책2개, anonymous 읽기=false, authenticated update/delete=false, helper RLS 우회=false.
- 실제 원격 DB에서 `supabase/tests/timetable_lab_drafts.sql` pgTAP **33개 통과**. 시험용 지점/사용자는 트랜잭션 rollback되어 운영 레코드를 바꾸지 않았다.
- `scripts/timetable-lab-db.mjs` 재현 도구: `node --env-file=.env.local scripts/timetable-lab-db.mjs --check` / `--test`. `--apply`는 테이블 없을 때만 동작.
- 프로젝트 연결 일치 검증과 에러 URL 마스킹 포함. 마지막에 TAP 출력 필터와 fixture 잔존 0 검사를 추가했는데 이 마지막 스크립트 변경 이후 재실행은 아직 안 했다.
- 실제 로그인한 사용자의 브라우저 저장 왕복은 아직 검증하지 않았다. 브라우저 API mock + 실제 SQL/RLS 검증 결과를 구별해서 보고한다.

## 검증 결과와 정확한 중단 위치

- 실험 단위 테스트: 마지막 **41개 / 6파일 통과**.
- 실험 Playwright 브라우저: 마지막 **20개 통과** (44.4초), API는 mock. 드래그 전체 수업, 이동 표시, 병합/분리, 변경 Undo, 저장/불러오기/비교 및 오류 보호 포함.
- 실험 TS/Vite build 통과. 무거운 기존 lazy Univer 번들 경고는 남아 있다.
- 실험 변경 파일 ESLint 통과.
- 루트 full TypeScript `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit --pretty false`: **통과**.
- 루트 `pnpm build`: **통과**, Next16.2.6 및 신규 API 경로 포함. repo 설정상 build 자체 TS skip이므로 위 별도 TS 결과와 함께 본다.
- 루트 `pnpm lint`: **exit0**, 기존 13 warnings/0 errors.
- 새 API 관련 테스트22개, 과목 기본값 관련67개는 작업자 검증에서 통과.
- 전체 루트 `pnpm test`는 여러 기존 테스트 실패를 출력했고 사용자 중단 요청으로 **완주 전에 종료했다**. 전체 통과로 보고하지 않는다.
- 확인한 실패 4곳:
  1. `src/features/billing/session-terms/server/pricing.test.ts`: standalone 재현됨. perm-matrix mock에 `canAccessTenant` 누락, `salary-access.ts:26` → settlement-queries → pricing.test.ts:366. 33 pass/1 fail. 관련 구현을 이번에 수정하지 않았다.
  2. `src/app/(shell)/billing/_components/receipt-allocation-dialog.test.tsx`: “이동 수납을 선택 합산하고 입력한 배분금액·종료일 표시를 유지한다” (20개 중1실패). 최종 상세는 아직 확인 못 함.
  3. `src/components/workspace/window-identity.test.tsx`: “메뉴 판(=검색 팰릿) 목적지 전부 — 창 링크·알림·딥링크와 같은 id” (12개 중1실패).
  4. `src/features/onescreen/makeup-merge-plan.test.ts`: 합침·추가 보강 `mergeStatusOf(attendanceRaw)` 관련 (24개 중1실패).
- 전체 테스트 중 HappyDOM iframe teardown localhost:3000/students?embed=1 네트워크 에러가 대량 발생했다. 무관한 기능 로직 변경으로 우회하지 말고 최소 원인 확인.
- 마지막 테스트 뒤 작은 변경 2개: draft-api 20초 timeout/저장 여부 재확인 안내, block-commands에서 비수업 block 이동은 수업 운영시간 제한 제외. 따라서 마지막 상태의 실험 테스트/build 재검증 필요.
- 스크린샷: 실험 `.artifacts/class-editing-panel.png`, `student-move-mark.png`, `draft-comparison.png`. 비교 화면 nested section CSS 문제 수정 후 시각 확인 완료.
- 합성 1,200배치·4,800학생 순수 알고리즘: 충돌78→53ms, 추천4137→84ms, 20편집945→56ms, 명단 객체40→1. 브라우저 전체 속도라고 주장하면 안 된다.

## 다음 작업

1. 저장된 변경을 검토하고 위 마지막 작은 변경 검증. 로컬 규칙을 읽고 필요한 범위의 기존 전체 테스트 실패 원인을 확인한다.
2. 문서에 최종 검증 상태 반영. 아직 실패가 남으면 정확히 구분해 보고하고 전체 green을 주장하지 않는다.
3. 관련 파일만 명시적으로 stage, 의미 있는 범위로 commit, fetch 후 최신 main 포함 확인, 기능 브랜치 push 및 remote HEAD 확인. 운영 배포는 후속.
4. 완성 범위/실제 DB 적용/검증 제한/다음 통합 단계를 한국어로 설명한다.

## 로컬 환경과 주의

- PowerShell/Node22.17.1/pnpm12.8.1. Next16.2.6. 사용자 AGENTS 지시에 따라 코드 전 관련 `node_modules/next/dist/docs/` 가이드 읽기.
- `CLAUDE.md` 및 `docs/setup-and-ops.md` 규칙 준수. 새 파일 길이/props 규칙, 명시 staging, 검증, adversarial review.
- 중단 시 Vite4317 PID15352, Next4320 PID32332 및 child35624/37868 존재. 기존 dev server는 인계용으로 남겼다. 연결 상태는 필요할 때 확인.
- 멈춘 전체 Vitest PID27908 및 당시 worker35116/28796만 종료했다. 다른 작업 프로세스는 건드리지 않았다.
- `.env.local`, 비밀키, `.artifacts`, `.next`, node_modules 등은 커밋하지 않는다.
- 회의/비수업 block은 수업 운영시간을 확장해서는 안 된다. 시간 편집 폼은 여전히 block에도 보이므로 제한 일관성은 검토 여지가 있다(학생 수업 범위가 우선).
- 전역 Ctrl+S는 클래스 편집 dialog가 열린 경우 중첩 dialog 가능성이 있다. 선택적 소규모 UI 검토 항목이며 현재 핵심 기능 완료를 불필요하게 늘리지 않는다.

이 인계는 Claude가 계속 실행하는 전체 인계다. Codex 결과를 기다리거나 Codex에게 재위임하지 않는다.
