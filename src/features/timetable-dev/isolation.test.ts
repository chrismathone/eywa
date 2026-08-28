/**
 * 🔴 시간표(개발중)이 **본 시간표·급여·출결·청구에 새지 않는다**는 것을 구조로 잠근다.
 *
 * 원장 확인(2026-08-28): *"9월 시간표를 넣는다고 시간표(개발중) 여기는 반영되지만 시간표 메뉴에는
 * 적용안되지? 적용되면 지금 급여랑 출결이 모두 꼬이게 되자나"* — 그렇다. 그리고 그 보장이 사람의
 * 기억이 아니라 **테스트**여야 한다(리뷰어가 바뀌고 몇 달 뒤에 누가 한 줄 이으면 그대로 꼬인다).
 *
 * 격리의 근거:
 *   · 계획은 `timetable_plan_slots`(0232a)에만 산다. `class_schedules`에는 한 행도 안 쓴다.
 *   · `class_schedules`는 실측 **73개 파일**(출결 귀속·청구 계획·급여·ECS·원스크린·좌석표)이 읽는다 —
 *     거기에 미래 달 행이 섞이면 그 전부가 조용히 틀린 답을 낸다.
 *
 * 그래서 세 가지를 검사한다:
 *   A. `timetable_plan_slots`를 아는 코드는 **시간표(개발중) 안에만** 있다.
 *   B. 시간표(개발중)은 `class_schedules`를 **읽기만** 한다(시드 복사용) — 쓰기 금지.
 *   C. 본 시간표(그리고 그 밖의 어떤 화면도)는 `timetable-dev`를 **import 하지 않는다**.
 *
 * ⚠️ 이 가드를 풀어야 할 일이 생기면(예: "이 달 계획을 실제로 적용") 그건 **별건 설계**다 —
 *    valid_from/valid_to 행 분할 규약(2026-08-04)과 어떻게 만날지, 돈 골든마스터를 어떻게 통과할지
 *    정한 다음에 이 파일을 고칠 것. 통과시키려고 먼저 지우지 말 것.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");
const DEV_FEATURE = path.join("src", "features", "timetable-dev");
const DEV_ROUTE = path.join("src", "app", "(shell)", "timetable-dev");

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = tsFiles(SRC).map((abs) => ({
  rel: path.relative(process.cwd(), abs),
  src: fs.readFileSync(abs, "utf8"),
}));

const inDev = (rel: string) => rel.startsWith(DEV_FEATURE) || rel.startsWith(DEV_ROUTE);

describe("시간표(개발중) 격리", () => {
  it("A. 월별 계획 표를 아는 코드는 시간표(개발중) 안에만 있다", () => {
    const leaks = files
      .filter((f) => f.src.includes("timetable_plan_slots"))
      .map((f) => f.rel)
      .filter((rel) => !inDev(rel) && !rel.endsWith("isolation.test.ts"));
    expect(
      leaks,
      "월별 계획 표가 시간표(개발중) 밖으로 샜다 — 이 표를 본 시간표·출결·급여·청구가 읽기 시작하면 " +
        "미래 달 행이 그 달 계산에 섞인다(원장 지시: 개발중에서만 적용)",
    ).toEqual([]);
  });

  it("B. 시간표(개발중)은 class_schedules를 읽기만 한다 — 쓰기 금지", () => {
    const writes: string[] = [];
    for (const f of files.filter((x) => inDev(x.rel))) {
      // `.from("class_schedules")` 부터 그 체인이 끝나는 곳(다음 세미콜론)까지를 한 문장으로 본다.
      // 텍스트 스캔이라 완벽하진 않지만, 이 리포의 쿼리는 전부 한 체인으로 쓰여 실효가 있다.
      let i = f.src.indexOf('from("class_schedules")');
      while (i !== -1) {
        const end = f.src.indexOf(";", i);
        const stmt = f.src.slice(i, end === -1 ? f.src.length : end);
        if (/\.(insert|update|upsert|delete)\s*\(/.test(stmt)) writes.push(f.rel);
        i = f.src.indexOf('from("class_schedules")', i + 1);
      }
    }
    expect(
      [...new Set(writes)],
      "시간표(개발중)이 본 시간표 표(class_schedules)에 썼다 — 그 순간 급여·출결·청구가 함께 움직인다. " +
        "계획은 timetable_plan_slots에만 쓸 것(읽기는 시드 복사용으로 허용).",
    ).toEqual([]);
  });

  it("B2. 시간표(개발중)은 본 시간표에 쓰는 공유 서버 액션을 부르지 않는다", () => {
    // 🔴 B(직접 쿼리)만 막으면 구멍이 남는다 — 쓰기가 **공유 파일 안**에서 일어나면 개발중 폴더를 아무리
    //    뒤져도 `from("class_schedules")`가 안 보인다. 실제로 복사본의 시트 가져오기 다이얼로그가
    //    `applySheetImport`/`applyStructureImport`를 부르고 있었고, 그 액션 주석엔 이렇게 적혀 있다:
    //    "적용(class_schedules 쓰기). ⚠️ 프로덕션 반영."  = 개발중 화면에서 누르면 진짜 시간표가 바뀐다.
    // ⚠️ 읽기 전용 모듈(`server/queries`·`import-access`)과 화면 표시 설정(`view-prefs-actions`)은 허용한다 —
    //    전자는 시드·표시용 조회이고, 후자는 그 사람 글씨 크기·색이라 시간표 데이터가 아니다.
    // 🔴 **긴 경로부터** — `structure-import-actions`는 `import-actions`를 부분 문자열로 품는다.
    //    순서를 뒤집으면 구조 임포트가 엉뚱한 이름으로 보고돼 어느 파일을 고쳐야 할지 헷갈린다.
    const FORBIDDEN = [
      "features/timetable/server/structure-import-actions",
      "features/timetable/server/import-actions",
      "features/timetable/server/actions",
    ];
    // ⚠️ 정규식을 **템플릿 문자열로 조립하지 말 것** — `` `from\s+...` ``의 `\s`는 템플릿 안에서 그냥 `s`가
    //    되어 패턴이 조용히 아무것도 안 잡는다(처음 이렇게 짰다가 위반 2건을 놓치고 초록색을 봤다).
    //    import 줄만 골라 문자열 포함 검사로 충분하다.
    const offenders: string[] = [];
    for (const f of files.filter((x) => inDev(x.rel))) {
      for (const line of f.src.split(/\r?\n/)) {
        if (!line.includes("from ")) continue; // import 줄만 — 주석에 적힌 경로는 잡지 않는다
        // `structure-import-actions`가 `import-actions`를 포함하므로 **긴 것부터** 보고 한 줄에 하나만 센다.
        const hit = FORBIDDEN.find((mod) => line.includes(mod));
        if (hit) offenders.push(`${f.rel} → ${hit}`);
      }
    }
    expect(
      offenders,
      "개발중 화면이 본 시간표를 **쓰는** 액션을 부른다 — 그 버튼을 누르는 순간 실제 시간표가 바뀌고 " +
        "급여·출결·청구가 함께 움직인다. 계획 층에서 시트를 받으려면 timetable-dev 전용 액션을 따로 만들 것.",
    ).toEqual([]);
  });

  it("C. 본 시간표·다른 화면은 timetable-dev를 import 하지 않는다", () => {
    const importers = files
      .filter((f) => !inDev(f.rel) && !f.rel.endsWith("isolation.test.ts"))
      .filter((f) => /from\s+["'][^"']*timetable-dev/.test(f.src))
      .map((f) => f.rel);
    expect(
      importers,
      "시간표(개발중)의 코드가 밖으로 흘러들어갔다 — 개발중 기능은 그 화면 안에서만 살아야 한다",
    ).toEqual([]);
  });

  it("D. 본 시간표 라우트는 그대로다 — 개발중 복사본이 원본을 참조하지 않는다(반대 방향은 허용)", () => {
    // 복사본이 원본 라우트의 컴포넌트를 import하면 원본을 고칠 때 개발중이 함께 움직인다(복사의 의미가 사라진다).
    // ⚠️ 반대로 `@/features/timetable/**`(순수 로직) 공유는 **의도된 것**이다 — 그쪽은 아무도 수정하지 않는다.
    const crossRoute = files
      .filter((f) => f.rel.startsWith(DEV_ROUTE))
      .filter((f) => /from\s+["'][^"']*\(shell\)\/timetable\//.test(f.src))
      .map((f) => f.rel);
    expect(crossRoute, "개발중 복사본이 본 시간표 라우트 파일을 import한다").toEqual([]);
  });
});
