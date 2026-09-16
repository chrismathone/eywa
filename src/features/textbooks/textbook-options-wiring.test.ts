/**
 * 교재 제안(ECS 계획 줄 ↔ 교재목록 마스터) 배선 가드 — **성질**을 검사한다(들여쓰기·따옴표 모양이
 * 아니라 "그 파일이 그 함수를 지나는가"를 본다).
 *
 * 왜 가드가 필요한가: 계획 표(`PlanTable` → `PlanRow`)를 그리는 화면이 **넷**이고 서로 다른 라우트에
 * 산다(주간 시트 · 월간 '그 날 고치기' · 자리 출석부 · 공개 PIN). 프로바이더를 한 곳에만 두면 나머지
 * 화면에서는 제안이 **조용히** 사라진다 — 에러가 안 나서 아무도 모른다.
 *
 * 검사하는 것:
 *  ① `plan-row.tsx`가 `useTextbookOptions()`를 지나고, 페이지/시간은 **빈 칸일 때만** 채운다.
 *  ② 세션이 있는 ECS 라우트(주간·월간)가 `TextbookOptionsProvider`로 감싼다.
 *  ③ 프로바이더 밖 기본값이 **빈 목록**이다(공개 PIN 자리 화면이 그대로 돌아야 한다).
 *  ④ 클라 컨텍스트가 `server-only` 모듈을 import하지 않는다([[#61]]).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const PLAN_ROW = ["src", "features", "class-sheets", "components", "plan-row.tsx"];
const CONTEXT = ["src", "features", "textbooks", "textbook-options-context.tsx"];
/** 세션이 있고 PlanRow를 그리는 ECS 라우트 — 새 화면을 만들면 여기에도 한 줄 추가할 것. */
const PROVIDED_ROUTES = [
  ["src", "app", "(shell)", "ecs", "[classId]", "page.tsx"],
  ["src", "app", "(shell)", "ecs", "[classId]", "month", "page.tsx"],
];

/**
 * 계획 표를 그리는 화면이 **둘**이고(주간/월간/자리가 쓰는 `plan-row` · 오늘 면이 쓰는
 * `today-plan-editor`) 각자 교재 칸을 따로 구현한다 — 그래서 **둘 다** 같은 성질을 지나는지 본다.
 * 한쪽만 고치면 같은 칸이 화면마다 다르게 군다.
 */
const BOOK_CELL_FILES: Array<[string, string[]]> = [
  ["plan-row.tsx", PLAN_ROW],
  ["today-plan-editor.tsx", ["src", "features", "class-sheets", "components", "today-plan-editor.tsx"]],
];

describe("① 계획 줄이 교재 제안을 읽는다", () => {
  for (const [name, path] of BOOK_CELL_FILES) {
    describe(name, () => {
      it("useTextbookOptions()를 지난다", () => {
        const src = read(...path);
        expect(src).toContain("useTextbookOptions");
        expect(src).toContain("@/features/textbooks/textbook-options-context");
      });

      it("교재 칸에 datalist(list)와 떠날 때 처리(onBlur)가 붙어 있다", () => {
        const src = read(...path);
        expect(src).toMatch(/list=\{listId \?\? undefined\}/);
        expect(src).toMatch(/onBlur=\{onCommit/);
        // 교재 칸 전용 컴포넌트가 있고, 그 안에서만 field="textbook"을 넘긴다
        // (진도·과제 칸까지 datalist가 서면 엉뚱한 제안이 뜬다).
        expect(src).toContain("function BookCasInput");
        expect(src).toMatch(/BookCasInput[\s\S]{0,1600}?field="textbook"/);
      });

      it("🔴 페이지/시간은 **빈 칸일 때만** 채운다(덮어쓰기 금지)", () => {
        const src = read(...path);
        expect(src).toMatch(/pageValue\.trim\(\) !== ""\)\s*return;/);
        // CAS 스토어를 우회해 DOM에서 값을 읽지 않는다.
        expect(src).toContain('useCellState(store, buildSaveKey(lineId, "page_range"))');
      });

      it("🔴 구분(skill_area)은 자동으로 바꾸지 않는다", () => {
        const src = read(...path);
        const from = src.indexOf("function BookCasInput");
        const handler = src.slice(from, src.indexOf("return (", from));
        expect(handler).not.toContain("skill_area");
      });

      it("편집 권한이 없으면 아무것도 안 채운다", () => {
        const src = read(...path);
        expect(src).toMatch(/const onCommit = useCallback\(\s*\(raw: string\) => \{\s*if \(!canEdit\) return;/);
      });

      it("🔴 교재 칸은 **따로 떼어 낸 컴포넌트**다 — 행 전체가 매 타건에 다시 그려지지 않게", () => {
        const src = read(...path);
        // 훅을 행 본체에서 부르면 memo가 무의미해진다(페이지/시간 한 글자마다 행이 재렌더).
        const from = src.indexOf("function BookCasInput");
        expect(from).toBeGreaterThan(-1);
        expect(src.indexOf("useTextbookOptions()")).toBeGreaterThan(from);
      });
    });
  }
});

describe("② 세션이 있는 ECS 라우트가 프로바이더로 감싼다", () => {
  for (const route of PROVIDED_ROUTES) {
    it(`${route.slice(2).join("/")} — 프로바이더 + 서버 조회`, () => {
      const src = read(...route);
      expect(src).toContain("TextbookOptionsProvider");
      // 조회는 **공용 헬퍼 한 곳**을 탄다 — 라우트마다 복사하면 한쪽만 고쳐져 화면끼리 갈린다.
      expect(src).toContain("loadEcsTextbookOptions");
      expect(src).not.toContain("getTextbookOptions(");
      // 독립 조회는 같은 Promise.all에(B4 — 직렬 워터폴 금지).
      expect(src).toMatch(/Promise\.all\(\[[\s\S]*?loadEcsTextbookOptions\(\)/);
    });
  }
});

describe("②-1 공용 헬퍼가 fail-soft다", () => {
  it("🔴 0266a 적용 전이든 조회가 실패하든 빈 목록으로 떨어진다([[#95]])", () => {
    const src = read("src", "features", "textbooks", "server", "ecs-options.ts");
    expect(src).toMatch(/catch\s*\{\s*return \[\];/);
    // 과목을 박아 두면 수학 시트가 붙을 때 조용히 영어 교재를 제안한다 — 인자로 받는다.
    expect(src).toMatch(/subject: string = "english"/);
  });
});

describe("③ 프로바이더 밖 기본값 = 빈 목록", () => {
  it("공개 PIN 자리 화면은 세션이 없어 제안이 0개여도 그대로 돈다", () => {
    const src = read(...CONTEXT);
    // 폴백이 모듈 상수라 참조가 안정적이다(매 렌더 새 객체면 memo가 통째로 깨진다).
    expect(src).toMatch(/const EMPTY_OPTIONS: TextbookOptionItem\[\] = \[\];/);
    expect(src).toMatch(/const EMPTY_CTX: TextbookOptionsCtx = \{ options: EMPTY_OPTIONS, listId: null \};/);
    expect(src).toMatch(/useContext\(Ctx\) \?\? EMPTY_CTX/);
  });

  it("제안이 0개면 datalist를 아예 안 그린다(빈 목록 id를 물고 있지 않게)", () => {
    const src = read(...CONTEXT);
    expect(src).toMatch(/if \(options\.length === 0\) return EMPTY_CTX;/);
    expect(src).toMatch(/value\.listId \? \(\s*<datalist/);
  });

  /**
   * 🔴 자리(JJ) 출석부의 **진도 구획은 영어 시트와 "같은 기록·같은 기계"** 다(CLAUDE.md JJ 결정).
   *    그래서 로그인 화면에선 제안이 **있어야** 하고, 공개 PIN 화면에선 세션이 없어 **없어야** 한다.
   *    두 화면은 같은 `SeatBoard`를 그리므로 차이는 **라우트에서만** 난다.
   */
  it("로그인 자리 출석부는 프로바이더가 있다 — 같은 표인데 여기만 제안이 없으면 안 된다", () => {
    const page = read("src", "app", "(shell)", "attendance", "seat", "[seat]", "page.tsx");
    expect(page).toContain("TextbookOptionsProvider");
    expect(page).toContain("loadEcsTextbookOptions");
  });

  it("공개 PIN 자리 화면은 프로바이더를 두지 않는다 — 세션이 없어 마스터를 못 읽는다", () => {
    const pin = read("src", "app", "(seat)", "seat", "[seat]", "page.tsx");
    expect(pin).not.toContain("TextbookOptionsProvider");
  });

  it("공용 표 컴포넌트는 프로바이더를 스스로 두지 않는다(라우트가 정한다)", () => {
    const seat = read("src", "app", "(shell)", "attendance", "seat", "[seat]", "_components", "seat-jj-table.tsx");
    expect(seat).not.toContain("TextbookOptionsProvider");
  });
});

describe("④ 클라 컨텍스트가 server-only를 끌어오지 않는다([[#61]])", () => {
  it("타입을 server/queries.ts에서 import하지 않는다", () => {
    const src = read(...CONTEXT);
    expect(src).toContain('"use client"');
    // 🔴 **import 문**만 본다 — 주석에 적힌 "server-only"라는 낱말까지 막으면 규칙을 적어 둘 수가 없다
    //    (실제로 이 파일의 ⚠️ 주석이 그 이유를 설명한다).
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports.some((l) => l.includes("textbooks/server/"))).toBe(false);
    expect(imports.some((l) => l.includes("server-only"))).toBe(false);
    // 모양만 같은 거울을 자체 선언한다.
    expect(src).toMatch(/export type TextbookOptionItem = \{/);
  });
});
