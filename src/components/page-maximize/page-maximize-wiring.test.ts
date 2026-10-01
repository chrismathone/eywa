import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 화면 최대화 배선 가드(원장 2026-10-01). 숨기는 일이 **CSS 한 곳 + 요소에 직접 단 표식**이라 타입·테스트가 못 잡는다 —
 * 표식이 빠지거나 CSS 조건이 셸 경계(`desk`)와 갈라지면 "눌렀는데 사이드바가 그대로"가 조용히 난다.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replaceAll("\r\n", "\n");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) return walk(f);
    return /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [f] : [];
  });
const rel = (f: string) => relative(ROOT, f).replaceAll("\\", "/");
/** 끝의 공백·JSX 주석(`{/* … *\/}`)을 걷는다 — 정규식 역추적 없이(큰 화면 파일에서 느려지지 않게). */
function trimEndTrivia(s: string): string {
  let t = s.trimEnd();
  while (t.endsWith("*/}")) {
    const k = t.lastIndexOf("{/*");
    if (k < 0) break;
    t = t.slice(0, k).trimEnd();
  }
  return t;
}
function trimStartTrivia(s: string): string {
  let t = s.trimStart();
  while (t.startsWith("{/*")) {
    const k = t.indexOf("*/}");
    if (k < 0) break;
    t = t.slice(k + 3).trimStart();
  }
  return t;
}

/**
 * PageHeader를 안 쓰는 화면의 스켈레톤 — 맨 위 막대는 PageHeader 근사가 아니다(JJ 덱·응시 결과 = 본문 카드 ·
 * 수학 강사 시트 랜딩 = 자체 머리 `<h2>`라 최대화 때도 숨지 않는다 — 스켈레톤도 그 머리를 그대로 흉내 낸다).
 */
const NOT_PAGE_HEADER = ["exams/jj/[deckId]/loading.tsx", "exams/jj/attempt/[attemptId]/loading.tsx", "(shell)/mcs/loading.tsx"];

describe("화면 최대화 배선", () => {
  const css = read("src/app/globals.css");

  it("숨김 규칙은 데스크톱 셸과 같은 미디어쿼리 안에 있다(모바일 셸에선 잠든다)", () => {
    const desk = css.match(/@custom-variant desk \{\s*@media ([^{]+)\{/)![1].trim();
    const block = css.match(/@media screen and ([^{]+)\{\s*\[data-page-maximize="on"\] \[data-maximize-hide\]/);
    expect(block, "최대화 CSS 블록").not.toBeNull();
    expect(block![1].trim()).toBe(desk);
  });

  it("사이드바·헤더 제목을 숨기고(동작·스탯은 남긴다), 본문 여백은 위·좌우만 줄인다(아래 여백·저장 바 밀착 규약은 그대로)", () => {
    for (const sel of ["[data-maximize-hide]", '[data-page-header="bare"]', "[data-page-header-title]"]) {
      expect(css).toContain(`[data-page-maximize="on"] ${sel}`);
    }
    // 🔴 헤더 전체(`[data-page-header]` 맨몸)를 숨기면 날짜 이동·새 항목 버튼·KPI까지 사라진다(적대 리뷰).
    expect(css).not.toMatch(/\[data-page-maximize="on"\] \[data-page-header\][\s,{]/);
    expect(css).toMatch(/\[data-page-maximize="on"\] \[data-page-header-slot\] \{\s*display: contents;/);
    const main = css.match(/\[data-page-maximize="on"\] main:not\(\.embed-main\):not\(main main\) \{([^}]*)\}/);
    expect(main).not.toBeNull();
    expect(main![1]).toContain("padding-top");
    expect(main![1]).not.toContain("padding-bottom"); // 본문 하단 여백·.sticky-save-bar(#110)를 건드리지 않는다
    expect(css).toContain("main:has(.sticky-save-bar)");
    // 🔴 `:has(> …)`는 dev CSS에서 사라진다(#127) — 최대화 규칙은 표식을 직접 고른다.
    const section = css.slice(css.indexOf('[data-page-maximize="on"] [data-maximize-hide]'));
    expect(section.slice(0, 800)).not.toMatch(/:has\(\s*>/);
  });

  it("왼쪽 사이드바에 표식이 직접 달려 있다", () => {
    expect(read("src/components/app-sidebar.tsx")).toMatch(/<aside[\s\S]{0,400}data-maximize-hide=""/);
  });

  it("관리자 풀셸만 감싼다 — 창 모드 스위치 안쪽 · 창(embed)·강사·학생 미니셸엔 없다", () => {
    const layout = read("src/app/(shell)/layout.tsx");
    expect(layout.match(/<PageMaximizeShell>/g)).toHaveLength(1);
    expect(layout).toMatch(/<WorkspaceEnabledProvider enabled=\{windowMode\}>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<PageMaximizeShell>/);
    expect(layout.indexOf("<PageMaximizeShell>")).toBeGreaterThan(layout.indexOf("<WorkspaceEnabledProvider enabled={false}>"));
  });

  it("PageHeader와 그 스켈레톤이 표식을 달고, 헤더가 '화면 최대화'를 그린다", () => {
    const header = read("src/components/page-header.tsx");
    expect(header.match(/data-page-header=\{/g)?.length).toBe(2); // 실 헤더·스켈레톤 — bare/tools
    expect(header.match(/data-page-header-title=""/g)?.length).toBe(2);
    expect(header).toContain("<PageMaximizeButton />");
  });

  it("PageHeader를 쓰는 화면의 스켈레톤은 공용 PageHeaderSkeleton(같은 표식) — 손으로 쌓은 헤더 막대는 최대화 중에 혼자 서서 본문을 튀게 한다", () => {
    const missing = walk(join(ROOT, "src/app/(shell)"))
      .filter((f) => f.endsWith("loading.tsx") && !rel(f).includes("timetable-dev/"))
      .filter((f) => {
        const page = f.replace(/loading\.tsx$/, "page.tsx");
        try {
          return read(rel(page)).includes("<PageHeader");
        } catch {
          return false;
        }
      })
      .filter((f) => !read(rel(f)).includes("<PageHeaderSkeleton"))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("헤더 스켈레톤은 공용 PageHeaderSkeleton — 옛 3단 근사(eyebrow·제목·설명 막대를 mt-2로 쌓기)가 남지 않는다", () => {
    const loadings = walk(join(ROOT, "src/app/(shell)"))
      .filter((f) => f.endsWith("loading.tsx"))
      .filter((f) => !rel(f).includes("timetable-dev/")) // 개발 사본(skeleton-canon과 같은 예외)
      .filter((f) => !NOT_PAGE_HEADER.some((x) => rel(f).endsWith(x)));
    const stacked = loadings.filter((f) => /mt-2 h-(6|7) w-/.test(read(rel(f)))).map(rel);
    expect(stacked).toEqual([]);
    expect(loadings.filter((f) => read(rel(f)).includes("<PageHeaderSkeleton")).length).toBeGreaterThanOrEqual(21);
  });

  it("PageHeader **하나만** 감싼 래퍼 div는 `data-page-header-slot`을 단다(빈 래퍼가 gap·space-y 한 칸을 남기지 않게)", () => {
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, "src/app/(shell)"))) {
      const p = rel(f);
      if (p.includes("timetable-dev/")) continue;
      const src = read(p);
      let at = src.indexOf("<PageHeader");
      while (at >= 0) {
        if (src.startsWith("<PageHeaderSkeleton", at)) {
          at = src.indexOf("<PageHeader", at + 1);
          continue;
        }
        // 태그 끝(`/>`)을 중괄호 깊이로 찾는다 — actions={<X />} 안의 `/>`에 속지 않게.
        let depth = 0;
        let end = -1;
        for (let i = at; i < src.length - 1; i++) {
          const ch = src[i];
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          else if (depth === 0 && ch === "/" && src[i + 1] === ">") {
            end = i + 2;
            break;
          }
        }
        const before = trimEndTrivia(src.slice(0, at));
        const after = trimStartTrivia(src.slice(end));
        const open = before.match(/<div([^<>]*)>$/);
        if (open && after.startsWith("</div>") && !open[1].includes("data-page-header-slot")) offenders.push(p);
        at = src.indexOf("<PageHeader", at + 1);
      }
    }
    expect(offenders).toEqual([]);
  });
});
