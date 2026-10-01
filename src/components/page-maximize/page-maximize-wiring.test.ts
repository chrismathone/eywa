import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 화면 최대화 배선 가드(원장 2026-10-01). 숨기는 일이 **CSS 한 곳 + 요소에 직접 단 표식**이라 타입·테스트가 못 잡는다 —
 * 표식이 빠지거나 CSS 조건이 셸 경계(`desk`)와 갈라지면 "눌렀는데 사이드바가 그대로"가, 머리글을 숨기는 규칙이 다시 생기면
 * **"최대화했는데 돌아올 버튼이 없다"**가 조용히 난다.
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
/** 실 머리글(`<PageHeader` — 스켈레톤 아님)을 그리는 파일인가. */
const drawsHeader = (src: string) => /<PageHeader[\s>/]/.test(src);

/**
 * PageHeader를 안 쓰는 화면의 스켈레톤 — 맨 위 막대는 PageHeader 근사가 아니다(JJ 덱·응시 결과 = 본문 카드 ·
 * 수학 강사 시트 랜딩 = 자체 머리 `<h2>` — 스켈레톤도 그 머리를 그대로 흉내 낸다).
 */
const NOT_PAGE_HEADER = ["exams/jj/[deckId]/loading.tsx", "exams/jj/attempt/[attemptId]/loading.tsx", "(shell)/mcs/loading.tsx"];

/** 최대화 CSS 블록(데스크톱 미디어쿼리 안) — 첫 규칙부터 블록 끝까지. */
function maximizeBlock(css: string): string {
  const at = css.indexOf('[data-page-maximize="on"] [data-maximize-hide]');
  const open = css.lastIndexOf("@media", at);
  let depth = 0;
  for (let i = css.indexOf("{", open); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open, i + 1);
  }
  return "";
}

/** page.tsx가 직접 그리거나, 그 파일이 직접 import한 로컬 컴포넌트(상대 경로·`@/app`·`@/features`)가 그리는 머리글. */
function pageDrawsHeader(page: string): boolean {
  const src = read(page);
  if (drawsHeader(src)) return true;
  for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+|@\/(?:app|features)\/[^"]+)"/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : resolve(dirname(join(ROOT, page)), spec);
    for (const f of [`${base}.tsx`, join(base, "index.tsx")]) {
      if (existsSync(f) && drawsHeader(readFileSync(f, "utf8"))) return true;
    }
  }
  return false;
}

describe("화면 최대화 배선", () => {
  const css = read("src/app/globals.css");
  const block = maximizeBlock(css);
  const layout = read("src/app/(shell)/layout.tsx");

  it("숨김 규칙은 데스크톱 셸과 같은 미디어쿼리 안에 있다(모바일 셸에선 잠든다 · 인쇄엔 안 걸린다)", () => {
    const desk = css.match(/@custom-variant desk \{\s*@media ([^{]+)\{/)![1].trim();
    expect(block).not.toBe("");
    expect(block.match(/^@media screen and ([^{]+)\{/)![1].trim()).toBe(desk);
  });

  it("사이드바·머리글의 eyebrow·설명만 숨긴다 · 아래 여백·저장 바 밀착 규약은 그대로 · `:has(> …)` 없음", () => {
    for (const sel of ["[data-maximize-hide]", "[data-page-header-extra]"]) {
      expect(block).toContain(`[data-page-maximize="on"] ${sel} {\n    display: none;`);
    }
    const main = block.match(/\[data-page-maximize="on"\] main:not\(\.embed-main\):not\(main main\) \{([^}]*)\}/);
    expect(main).not.toBeNull();
    expect(main![1]).not.toContain("padding-bottom"); // 본문 하단 여백·.sticky-save-bar(#110)를 건드리지 않는다
    expect(css).toContain("main:has(.sticky-save-bar)");
    expect(block).not.toMatch(/:has\(\s*>/); // [[#127]]
  });

  it("🔴 버튼은 픽셀 그대로 — 본문 위 여백은 안 줄이고, 줄인 오른쪽 여백만큼 머리글 줄 오른쪽 여백을 늘린다", () => {
    const main = block.match(/\[data-page-maximize="on"\] main:not\(\.embed-main\):not\(main main\) \{([^}]*)\}/)![1];
    expect(main).not.toContain("padding-top"); // 머리글 줄이 위로 뜨면 누른 손 밑에서 버튼이 달아난다
    expect(main).toContain("padding-inline: 0.375rem;");
    // 상쇄값의 전제 = 셸 본문 여백(desk:px-6 · desk:pt-5) · 머리글 줄 px-1 · 거터 stable. 하나가 바뀌면 같이 고칠 것.
    expect(layout).toMatch(/<main className="relative flex-1 overflow-auto [^"]*desk:px-6 desk:pt-5[^"]*\[scrollbar-gutter:stable\]/);
    expect(read("src/components/page-header.tsx")).toMatch(/data-page-header-row="" className="flex flex-col gap-2 px-1 /);
    expect(block).toContain('main:not(.embed-main):not(main main) [data-page-header-row] {\n    padding-right: 1.375rem;'); // 0.25 + (1.5 - 0.375)
    expect(block).toContain(":has(.edge-to-edge) [data-page-header-row] {\n    padding-right: 1.75rem;"); // 0.25 + 1.5
    // 🔴 스크롤바 거터는 숫자로 상쇄하지 않는다 — 전역 `scrollbar-width: thin`이라 폭이 브라우저마다 다르다(6px 가정이 실측 10px에서 4px 어긋났다).
    //    최대화 중에도 거터를 풀지 않는다(시간표 포함).
    expect(block).not.toMatch(/scrollbar-gutter:\s*auto/);
    expect(block).not.toMatch(/calc\([^;]*\+ \d+px\)/);
    // 오른쪽 묶음은 관리자 풀셸 본문에서 위 정렬 + 제목 한 줄 높이 — 설명이 접힌 줄이 최대화로 한 줄이 돼도 버튼이 안 뜬다.
    expect(block).toMatch(/\[data-page-maximize\] main:not\(\.embed-main\):not\(main main\) \[data-page-header-actions\] \{\s*align-self: flex-start;\s*min-height: calc\(var\(--text-xl\) \* var\(--text-xl--line-height\)\);/);
  });

  it("🔴 최대화 규칙(`data-page-maximize`가 든 선택자) 어디에도 머리글 줄·제목·버튼을 숨기는 것이 없다 — 최대화 전후 같은 자리에 '화면 원래대로'가 있어야 한다", () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders = [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel, decls]) => sel.includes("data-page-maximize") && /display:\s*none|visibility:\s*hidden|opacity:\s*0[;\s]/.test(decls))
      // `:has(…)` 안의 표식은 "있으면"이라는 조건이지 숨김 대상이 아니다 — 걷고 본다.
      .map(([, sel]) => sel.replace(/:has\(\[[^\]]*\]\)/g, "").trim())
      .filter((sel) =>
        /\[data-page-header\]|\[data-page-header-row\]|\[data-page-header-title\]|\[data-page-header-actions\]|\[data-page-maximize-button\]|\[data-page-maximize-toggle\]|(?:^|[\s>+~])header(?:$|[\s.:[>])/.test(sel),
      );
    expect(offenders).toEqual([]);
    // 옛 구조의 잔재(통째로 숨던 bare 머리글 · 헤더 래퍼 지우기 · 떠 있는 복원 버튼)가 돌아오지 않는다.
    expect(css).not.toContain('data-page-header="bare"');
    expect(css).not.toContain("data-page-header-slot");
    expect(css).not.toContain("data-maximize-restore");
  });

  it("🔴 출구 보장 — PageHeader가 없는 화면엔 출구 줄이 서고(버튼은 머리글 버튼과 같은 자리), 머리글 버튼이 있으면 그 줄을 끈다", () => {
    // 오른쪽 = 본문 오른쪽 여백 + 머리글 줄 px-1(1.75rem) + 본문과 같은 거터(overflow hidden + scrollbar-gutter stable — 숫자로 적지 않는다).
    expect(block).toMatch(
      /\[data-page-maximize="on"\] \[data-maximize-fallback\] \{\s*display: flex;\s*overflow: hidden;\s*scrollbar-gutter: stable;\s*padding: calc\(1\.25rem \+ [^;]+\) 1\.75rem 0 0\.375rem;/,
    );
    expect(block).toMatch(/\[data-page-maximize="on"\]:has\(\[data-page-maximize-button\]\) \[data-maximize-fallback\] \{\s*display: none;/);
    // 출구 줄은 셸 본문(<main>) 바로 위 — 스크롤 밖(본문 높이를 쓰는 화면을 밀어 넘치게 하지 않는다)
    expect(layout.match(/<PageMaximizeFallbackBar \/>/g)).toHaveLength(1);
    expect(layout).toMatch(/<PageMaximizeFallbackBar \/>\s*<main className="relative flex-1/);
    // 출구 줄의 버튼엔 머리글 표식이 붙지 않는다(붙으면 `:has`가 늘 참이라 출구 줄이 영영 안 선다)
    const button = read("src/components/page-maximize/page-maximize-button.tsx");
    expect(button).toMatch(/marker === "header" \? \{ "data-page-maximize-button": "" \}/);
  });

  it("떠 있던 모서리 버튼·자리 판정 타이머는 없다(원장 *\"위치 못찾겠는데\"*)", () => {
    expect(existsSync(join(ROOT, "src/components/page-maximize/restore-corner.ts"))).toBe(false);
    const root = read("src/components/page-maximize/page-maximize-root.tsx");
    expect(root).not.toMatch(/setInterval|elementsFromPoint|data-maximize-restore/);
  });

  it("왼쪽 사이드바에 표식이 직접 달려 있다", () => {
    expect(read("src/components/app-sidebar.tsx")).toMatch(/<aside[\s\S]{0,400}data-maximize-hide=""/);
  });

  it("관리자 풀셸만 감싼다 — 창 모드 스위치 안쪽 · 창(embed)·강사·학생 미니셸엔 없다", () => {
    expect(layout.match(/<PageMaximizeShell>/g)).toHaveLength(1);
    expect(layout).toMatch(/<WorkspaceEnabledProvider enabled=\{windowMode\}>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?(<ShellHomeProvider[^>]*>\s*)?(\{\/\*[\s\S]*?\*\/\}\s*)?<PageMaximizeShell>/);
    expect(layout.indexOf("<PageMaximizeShell>")).toBeGreaterThan(layout.indexOf("<WorkspaceEnabledProvider enabled={false}>"));
  });

  it("PageHeader와 그 스켈레톤이 표식을 달고, 둘 다 같은 자리에 토글 버튼을 그린다", () => {
    const header = read("src/components/page-header.tsx");
    expect(header.match(/data-page-header=""/g)?.length).toBe(2); // 실 헤더·스켈레톤
    expect(header.match(/data-page-header-title=""/g)?.length).toBe(2);
    expect(header.match(/data-page-header-actions=""/g)?.length).toBe(2);
    expect(header.match(/<PageMaximizeButton \/>/g)?.length).toBe(2);
  });

  it("머리글을 그리는 화면을 덮는 loading.tsx는 공용 PageHeaderSkeleton — 손으로 쌓은 막대는 로딩 동안 버튼을 지워 출구 줄이 깜빡인다", () => {
    const pages = walk(join(ROOT, "src/app/(shell)"))
      .filter((f) => f.endsWith("page.tsx") && !rel(f).includes("timetable-dev/"))
      .map(rel);
    // 그 화면을 덮는 loading = 같은 폴더부터 위로 올라가며 처음 만나는 loading.tsx(Next 세그먼트 규칙 — (shell) 루트엔 없다).
    const coveringLoading = (page: string): string | null => {
      for (let dir = dirname(page); dir.startsWith("src/app/(shell)"); dir = dirname(dir)) {
        const f = `${dir}/loading.tsx`;
        if (existsSync(join(ROOT, f))) return f;
      }
      return null;
    };
    const missing = new Set<string>();
    for (const page of pages) {
      const loading = coveringLoading(page);
      if (!loading || NOT_PAGE_HEADER.some((x) => loading.endsWith(x))) continue;
      if (pageDrawsHeader(page) && !read(loading).includes("<PageHeaderSkeleton")) missing.add(`${loading} ← ${page}`);
    }
    expect([...missing]).toEqual([]);
  });

  it("헤더 스켈레톤은 공용 PageHeaderSkeleton — 옛 3단 근사(eyebrow·제목·설명 막대를 mt-2로 쌓기)가 남지 않는다", () => {
    const loadings = walk(join(ROOT, "src/app/(shell)"))
      .filter((f) => f.endsWith("loading.tsx"))
      .filter((f) => !rel(f).includes("timetable-dev/")) // 개발 사본(skeleton-canon과 같은 예외)
      .filter((f) => !NOT_PAGE_HEADER.some((x) => rel(f).endsWith(x)));
    const stacked = loadings.filter((f) => /mt-2 h-(6|7) w-/.test(read(rel(f)))).map(rel);
    expect(stacked).toEqual([]);
    expect(loadings.filter((f) => read(rel(f)).includes("<PageHeaderSkeleton")).length).toBeGreaterThanOrEqual(22);
  });

  it("🔴 PageHeader를 감싼 래퍼가 데스크톱에서 머리글을 숨기지 않는다 — 버튼 표식은 있는데 안 보이면 출구 줄도 꺼져 돌아올 길이 없다", () => {
    // 데스크톱(≥1240px)에서 켜질 수 있는 숨김: 맨 hidden·invisible·sr-only · desk:/sm:~2xl: 접두 · max-xl·max-2xl(1240~1535 겹침).
    // 허용: compact-chrome:hidden(창·모바일·미니셸 — 최대화가 없는 곳) · phone:·print:·max-sm/md/lg:(1240 미만만).
    // 맨 `hidden`이라도 데스크톱에서 다시 보이게 하는 짝(`desk:block`·`lg:flex` 등)이 있으면 숨김이 아니다.
    const desktopHide = /^(?:(?:desk|sm|md|lg|xl|2xl|max-xl|max-2xl):)?(?:hidden|invisible|sr-only)$/;
    const desktopReveal = /^(?:desk|sm|md|lg|xl|2xl):(?:block|flex|grid|contents|inline|inline-flex|inline-block|visible|not-sr-only)$/;
    const offenders: string[] = [];
    for (const f of [...walk(join(ROOT, "src/app/(shell)")), ...walk(join(ROOT, "src/features"))]) {
      const p = rel(f);
      if (p.includes("timetable-dev/")) continue;
      const src = read(p);
      let at = src.indexOf("<PageHeader");
      while (at >= 0) {
        if (!src.startsWith("<PageHeaderSkeleton", at)) {
          const open = trimEndTrivia(src.slice(0, at)).match(/<[A-Za-z][\w.]*([^<>]*)>$/);
          const cls = open?.[1].match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
          const tokens = (cls?.[1] ?? cls?.[2] ?? "").split(/\s+/);
          const hides = tokens.filter((c) => desktopHide.test(c));
          const revealed = tokens.some((c) => desktopReveal.test(c));
          if (hides.some((c) => !["hidden", "invisible", "sr-only"].includes(c)) || (hides.length > 0 && !revealed)) offenders.push(p);
        }
        at = src.indexOf("<PageHeader", at + 1);
      }
    }
    expect(offenders).toEqual([]);
  });
});
