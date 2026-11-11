# SQL 시즌2 — 작업이 부딪힐 때 읽는 안내 (2026-10-27)

> 원장 *"이전 001~458번대까지 sql을 전부 하나로 정리해서 뭉쳐놔. 번호가 너무 많이 올랐어. 다시 1번부터 시작할 수 있게"* ·
> *"시즌2 sql 느낌으로 시작해 새로"* · *"작업 부딪힐 수 있는것 안내문서 남겨놓을것 읽을 수 있게"*.
>
> 이 문서는 **SQL 시즌2 커밋 전에 갈라진 브랜치·작업 공간**에서 일하던 세션이 main을 합칠 때 읽는다.
> 규칙의 짧은 판은 [CLAUDE.md #139](../CLAUDE.md) · [gotchas #139](gotchas.md) · [마이그레이션 README](../supabase/migrations/README.md).

## 1. 무엇이 바뀌었나

| 전 | 후 |
|---|---|
| `supabase/migrations/`에 낱개 568개(`0000_…` drizzle · `0001a_…`~`0458a_…` alpha) + `meta/` | **`s1_season1.sql` 하나**(시즌1 합본) + **`s2_NNNN_설명.sql`**(시즌2) + `README.md` |
| 새 파일 = `NNNNa_설명.sql`(최대 번호 + 1) | 새 파일 = **`s2_0001_설명.sql`부터**(시즌2 최대 번호 + 1 · 빈틈·겹침 금지) |
| 테스트·스크립트가 `supabase/migrations/0349a_x.sql`을 경로로 읽음 | `readMigration("0349a_x.sql")` · 폴더 훑기는 `migrationFiles()`([`src/lib/db/migrations-corpus.mjs`](../src/lib/db/migrations-corpus.mjs)) |
| 문서 링크 `supabase/migrations/0349a_x.sql` | `supabase/migrations/s1_season1.sql#0349a_x.sql`(합본 # 구역 이름) |
| 새 DB = `pnpm db:migrate` → `pnpm db:alphas` | 새(빈) DB = **`pnpm db:alphas` 하나**(빈 DB가 아니면 멈춘다) · `pnpm db:migrate`는 안내만 하고 멈춘다 |

- 합본은 구역마다 머리줄 `--@@s1 <원래 파일 이름>` — 원래 내용 그대로(568개 전수 대조: 540개 바이트 같음 · 28개 끝 줄바꿈만 더함).
- 🔴 **합본은 고치지 않는다** — 운영에 이미 적용된 기록이다. 지문(sha256)이 가드에 고정돼 있어 한 글자만 바뀌어도 테스트가 실패한다.
- 운영 DB는 **바뀐 것이 없다**(저장소 정리만). 운영에 SQL을 적용하는 방법도 그대로 — 새 파일 **하나만** 원장 승인 뒤.
- 옛 낱개 파일은 git 기록에 있다: `git log --diff-filter=D --oneline -- supabase/migrations/0458a_makeup_reservation_checked.sql`로 합본 커밋을 찾고, 그 **부모 커밋**에서 `git show <부모>:supabase/migrations/<이름>`.

## 2. 지금 부딪힐 작업 (조사 2026-10-27 — 원격 브랜치 전수 · 로컬 작업 공간의 커밋 안 된 파일)

| 어디 | 무엇 | 합칠 때 생기는 일 | 할 일 |
|---|---|---|---|
| `origin/codex/management-agent-mvp` (main에 없는 커밋 4개) | 새 파일 `0377a`~`0377e_management_agent_*.sql` 5개(합본에도 다른 `0377a_staff_tasks`가 있다) | 합쳐지는 순간 SQL을 읽는 테스트가 전부 실패(`규칙 밖 SQL 파일이 있습니다`) · 폴더 가드 실패 | §3-A — `s2_NNNN_management_agent_*.sql` 5개로 이름 바꾸기(순서 유지) |
| `origin/codex/student-care-mvp` (main에 없는 커밋 7개) | 같은 이름 `0377a`~`0377e` 5개 — 🔴 이 브랜치는 `management-agent-mvp`를 **통째로 포함**하고, `0377b`·`0377d`·`0377e`는 **내용이 다르다**(a·c만 같다) | 위와 같다 | 하나만 합칠 거면 **student-care 판**으로 5개를 바꾼다. management 판을 먼저 `s2_`로 합쳐 운영에 적용했다면, student-care의 b·d·e 변경은 이미 적용된 `s2_` 파일에 얹지 말고(git이 이름 바뀜을 따라가 조용히 얹는다 — 운영과 어긋난다) **새 `s2_` 파일**(멱등 재정의)로 넣는다 |
| 작업 공간 `student_point`(브랜치 `chrismathone/student_point` · **커밋 안 함**) | `0447a_student_contribution_tenure.sql` · `0448a_student_parent_events.sql` | 합본에 같은 번호의 **다른** 파일이 있다(`0447a_unassigned_video_…` · `0448a_inventory_vendors`) — 커밋하면 폴더 가드 실패 | 먼저 main의 `0456a_student_parent_events.sql`·`0457a_student_participation_units.sql`(합본 구역)과 같은 작업의 옛 사본인지 확인 → 아직 필요한 변경만 `s2_NNNN_…`로 |
| 작업 공간 `/Volumes/새 볼륨/eywa/auto_work`(브랜치 `BIGSHOL/auto_work` · 업무 완성도 · 2026-11-11 확인) | `s2_0043_duty_ledger` ~ `s2_0064_duty_class_time_and_reown` 22개(2026-11-11 05시 기준)(일부는 이미 운영 DB에 적용됨 — 그 브랜치 커밋 메시지) | main에 같은 번호의 **다른** 파일이 있다 — `s2_0043_query_correctness_rpcs`(main) · `s2_0044_consultation_ratings`(main, 2026-11-11 원생상담 평점 — 운영 적용됨). 합치는 순간 폴더 가드 실패(번호 겹침) | §3-A — 합칠 때 auto_work 쪽 파일을 **main 마지막 번호 다음부터** 원래 순서대로 이름만 바꾼다(🔴 2026-11-11 낮 기준 **`s2_0066`부터** — 운영 로그 정리가 `s2_0045`·`s2_0046`을, aywa-next 이식 ①단계가 `s2_0047`~`s2_0060`을 썼다(규칙 밖이던 마케팅 SQL은 `s2_0047_marketing_archive_sources`로 이름을 맞췄다) · 같은 이식의 ②단계(신규생·콜&상담 여정 · 직원 삭제 차단 검사 보강)가 `s2_0061`~`s2_0065`를 썼다. push 직전에 main의 마지막 번호를 다시 볼 것). 🔴 auto_work가 운영에 적용한 `s2_0043`~`s2_0064`는 main의 같은 번호 파일과 **내용이 다른 파일**이다 — 운영 적용 기록은 번호가 아니라 파일 전체 이름으로 적는다. 이미 운영에 적용한 파일은 다시 돌리지 않고 `supabase/migrations/README.md`에 '옛 이름 s2_00NN으로 적용됨'을 적는다 |

> 위 표는 조사 시점의 것이다. 그 뒤에 갈라진 작업이 있으면 같은 방법으로 찾는다:
> - 브랜치: `git fetch --all && for b in $(git for-each-ref --format='%(refname:short)' refs/remotes); do git diff --name-status $(git merge-base origin/main $b) $b -- supabase/migrations; done`
> - **커밋 안 한 파일**(작업 공간): `git worktree list` → 경로마다 `git -C <경로> status --short -- supabase/migrations`

## 3. 고치는 법

### A. 옛 이름으로 **새 파일**을 만들었다(`0459a_x.sql` · `0377a_x.sql` · CLI 타임스탬프 `20261027…_x.sql`)

1. main을 받는다: `git fetch origin && git merge origin/main`.
2. 시즌2 다음 번호를 본다: `git ls-tree --name-only origin/main supabase/migrations/ | grep '^supabase/migrations/s2_'` — 마지막 번호 + 1부터.
3. 이름만 바꾼다(내용 그대로): `git mv supabase/migrations/0377a_x.sql supabase/migrations/s2_0001_x.sql` — 여러 개면 원래 순서대로 번호를 이어 붙인다.
4. 그 이름을 쓰는 곳을 고친다: `git grep -n "0377a_"` → 코드의 `readMigration("0377a_x.sql")` · 문서 · 주석.
5. 이미 운영에 **옛 이름으로 적용**했으면 이름만 바꾸고 `supabase/migrations/README.md`에 "옛 이름 0377a로 적용됨"을 적는다(다시 돌리지 않는다).
6. 확인: `npx vitest run src/lib/db/migrations-corpus.test.ts` + 그 SQL을 읽는 테스트.

### B. **옛 낱개 파일을 고쳤다**(합칠 때 `deleted in HEAD and modified in …` 충돌)

1. 🔴 합본(`s1_season1.sql`)에 붙여 넣어 풀지 않는다 — 지문 가드가 실패하고, 저장소만 바뀌고 운영은 그대로인 채 어긋난다.
2. 내 변경만 뽑는다: `git diff $(git merge-base origin/main HEAD) HEAD -- supabase/migrations/0349a_x.sql`(합치기 전 브랜치 기준).
3. 충돌은 **삭제 쪽**으로 푼다: `git rm supabase/migrations/0349a_x.sql`.
4. 뽑은 변경을 **시즌2 새 파일**로 쓴다 — 그 객체를 다시 정의하는 멱등 문장으로(`create or replace function` · `drop policy if exists … create policy` · `alter table … add column if not exists`). 이미 운영에 적용된 옛 파일을 고친 것이라면, 운영에 필요한 것은 바로 이 새 파일이다.
5. 그 변경을 검사하던 테스트는 `readMigration("s2_NNNN_….sql")`로 옮긴다 — `readMigration("0349a_….sql")`은 얼린 **옛 본문**을 돌려주므로 그대로 두면 새 변경을 검사하지 못한다("마지막 정의" 가드는 `migrationFiles()`라 저절로 새 파일을 본다).

### C. 코드가 **낱개 경로**를 읽는다

| 전 | 후 |
|---|---|
| `readFileSync("supabase/migrations/0349a_x.sql", "utf8")` · `read("supabase", "migrations", "0349a_x.sql")` | `readMigration("0349a_x.sql")` |
| `readdirSync("supabase/migrations").filter(...).sort()` + 파일 읽기 | `migrationFiles()` → `{ name, sql }[]`(적용 순서: 시즌1 구역 → 시즌2) |
| `supabase/migrations/meta/_journal.json` | 없다 — drizzle 번호본 = 이름에 접미 글자가 없는 시즌1 구역(`/^\d{4}_/`) |

- import: src 안은 `import { readMigration } from "@/lib/db/migrations-corpus.mjs"`, 스크립트는 상대 경로(`../src/lib/db/migrations-corpus.mjs` · `.cjs`는 `require`).
- 폴더에 규칙 밖 `.sql`이 하나라도 있으면 `migrationFiles()`가 던진다 — 일부러 시끄럽게 실패하게 했다(조용히 빼면 "마지막 정의" 가드와 `db:alphas`가 그 파일을 못 본다).

### D. 시즌2 번호가 겹쳤다(두 세션이 둘 다 `s2_0001`)

- 가드가 "빈틈·겹침 없이 0001부터"를 본다 — 나중에 합치는 쪽이 자기 번호를 뒤로 민다(§3-A의 2~4).
- push 직전에 한 번 더: `git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | grep s2_`.

## 4. 하지 말 것

- 합본(`s1_season1.sql`)을 고치기 · 지문 값을 바꾸기(원장 승인 없이).
- 운영 DB에 `pnpm db:alphas`(빈 DB가 아니면 멈추지만, 우회하지 말 것) · `supabase db push`.
- 옛 `NNNNa_` 이름으로 새 파일 만들기 — 숫자가 비어 보여도(예: `0459a`) 시즌1은 닫혔다.
