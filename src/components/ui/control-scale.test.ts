import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTROL_H, CONTROL_LABEL } from "./control-scale";

/**
 * 타입 스케일 v5 + 컨트롤 프리셋 가드 — 원장 2026-09-03 *"다 제각각인 버튼, 라벨 등을 스타일 통일 —
 * 지금 수정도 그렇고 앞으로 생성 시에도"*.
 *
 * 2026-09-03 코드모드로 `text-[Npx]` 2,910곳을 토큰으로 접었다. 이 가드가 없으면 다음 화면이 다시
 * `text-[11px]`를 적고, 그 화면만 조용히 작아진다(툴바 규약도 같은 이유로 58건이 갈려 있었다).
 *
 * 🔑 판정 둘:
 *  ① **임의 px 글자 크기 금지** — 종이 서식(인쇄·A4 미리보기)·px 정밀 사다리(name-fit)만 허용 목록.
 *  ② **공용 컨트롤은 control-scale을 읽는다** — Button·툴바 상수·FaceTabs·PeriodNav.
 * ⚠️ `s`(dotAll) 플래그를 쓰지 말 것 — tsconfig target이 es2017이라 타입체크가 거절한다.
 */
const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");
const BACKSLASH = String.fromCharCode(92);
const rel = (p: string) => p.slice(ROOT.length + 1).split(BACKSLASH).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const FILES = walk(SRC);

/**
 * 임의 px 글자 크기를 **써도 되는 곳** — 지면이 고정인 종이 서식과 px 정밀 계산 사다리.
 * 🔴 여기 더하는 건 "종이"뿐이다. 화면 컴포넌트가 "글자가 커서" 들어오면 안 된다(그러면 토큰이 아니라 기본값일 뿐).
 */
const PAPER_ALLOW: RegExp[] = [
  /^src\/app\/\(print\)\//,
  /^src\/app\/\(marketing\)\//,
  /^src\/app\/\(academy\)\//,
  /quote-document\.tsx$/,
  /expense-document\.tsx$/,
  /resume-sheet\.tsx$/,
  /refund-sheet\.tsx$/,
  /month-plan-sheet-style\.ts$/,
  /attendance\/seat\/name-fit(\.test)?\.ts$/,
  /control-scale\.test\.ts$/,
];

// print: 변형은 지면 스케일이라 그대로 둔다.
const ARBITRARY_PX = /(?<!print:)(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g;

describe("타입 스케일 v5 — 임의 px 글자 크기를 화면에 적지 않는다", () => {
  // ⚠️ 전수 스캔(2,300파일)이라 전체 vitest와 겹쳐 돌면 기본 5초를 넘긴다(헛실패, [[reference_vitest-guard-test-timeout-flakes]]).
  it("text-[Npx]는 종이 서식 밖에서 0건", { timeout: 60_000 }, () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const r = rel(f);
      if (PAPER_ALLOW.some((re) => re.test(r))) continue;
      const hits = readFileSync(f, "utf8").match(ARBITRARY_PX);
      if (hits) bad.push(`${r}: ${[...new Set(hits)].join(" ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("토큰 스케일이 지시서 하한을 지킨다 — xs 14 · sm 16 · 창 제목 xl 24", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const px = (name: string) => Number(/--text-(\w+): (\d+)px;/.exec(css.slice(css.indexOf(`--text-${name}:`)))?.[2]);
    expect(px("xs")).toBeGreaterThanOrEqual(14);
    expect(px("sm")).toBeGreaterThanOrEqual(16);
    expect(px("xl")).toBeGreaterThanOrEqual(20);
    expect(px("xl")).toBeLessThanOrEqual(24);
    // 🔴 글자색은 **한 값 #121212**(원장 2026-09-08 "모든 회색계열은 18 18 18 로"). 회색 3단으로 되돌리지 말 것.
    for (const t of ["foreground", "ink", "text-dim", "text-faint"]) {
      expect(css, `--${t}`).toMatch(new RegExp(`--${t}: #121212;`));
    }
    // 예외 하나 = 플레이스홀더는 연한 회색(원장 2026-10-16 "플레이스홀더는 완전히 연하게") — 값과 같은 색이면
    // 예시 글자('김영희')를 입력된 값으로 읽는다. 규칙은 레이어 밖(줄 맨 앞)이어야 `placeholder:text-*` 유틸을 덮는다.
    expect(css).toMatch(/--text-placeholder: #[0-9a-f]{6};/);
    expect(css).not.toMatch(/--text-placeholder: #121212;/);
    expect(css).toMatch(/\n::placeholder \{\s*color: var\(--text-placeholder\);/);
    // 글자로 그리는 placeholder(공용 선택 칸의 빈 값)는 `::placeholder`가 아니라서 같은 색 유틸을 단다.
    expect(css).toMatch(/--color-text-placeholder: var\(--text-placeholder\);/);
    expect(readFileSync(join(SRC, "components/ui/searchable-select.tsx"), "utf8")).toMatch(/selected \? "" : "text-text-placeholder"/);
    expect(readFileSync(join(SRC, "components/ui/select.tsx"), "utf8")).toContain("data-placeholder:text-text-placeholder");
    // 카드 = 헤어라인 링 하나, 블러 없음(원장 2026-09-03 "적당한 테두리는 있어야") — 313곳이 이 토큰을 읽는다.
    expect(css).toMatch(/--shadow-card: 0 0 0 1px rgba\(29, 29, 31, 0\.14\);/);
  });
});

describe("컨트롤 프리셋 — 높이는 라벨에서 도출, 공용 컨트롤이 한 벌을 읽는다", () => {
  it("세로 채움 — 높이 = 라벨 ÷ --control-fill, 세 벌이 같은 비율 · 기본 라벨 18px 확정", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    // 채움 비율은 한 곳에서만 정한다 — 크기마다 고정 여백(옛 "라벨 + 8px")을 다시 적으면 채움이 또 갈린다.
    // 🔴 **값을 리터럴로 잠그지 말 것**(2026-09-08): 0.7을 박아 둔 탓에 원장이 0.62로 내리는 순간
    //    가드가 빨개졌다 — 이 가드가 지켜야 하는 건 "비율이 한 곳에서 나오고 세 벌이 그걸 나눈다"는
    //    **구조**이지 특정 숫자가 아니다. 숫자는 눈으로 정하는 값이다(원장이 캡처를 보고 고른다).
    const fill = /--control-fill: (0\.\d+);/.exec(css);
    expect(fill, "--control-fill이 globals.css에 한 번은 정의돼야 한다").not.toBeNull();
    // 상·하한만 잠근다: 0.8 위면 글자가 상자에 붙고, 0.5 아래면 컨트롤이 제 라벨의 두 배로 뚱뚱해진다.
    const ratio = Number(fill![1]);
    expect(ratio).toBeGreaterThanOrEqual(0.5);
    expect(ratio).toBeLessThanOrEqual(0.8);
    expect(css.match(/--control-fill:/g)).toHaveLength(1);
    for (const suffix of ["-sm", "", "-lg"]) {
      expect(css, `--control-label${suffix}`).toMatch(
        new RegExp(`--control-label${suffix}: \\d+px;`),
      );
      expect(css, `--control-h${suffix}`).toMatch(
        new RegExp(
          `--control-h${suffix}: calc\\(var\\(--control-label${suffix}\\) / var\\(--control-fill\\)\\);`,
        ),
      );
    }
    expect(css).toMatch(/--control-label: 18px;/);
  });

  it("검색 입력은 상자 높이를 다 쓴다 — leading-none 18px 줄에 18px 한글은 잘린다(원장 캡처 2026-09-03)", () => {
    for (const r of [
      "components/search-form.tsx",
      // 수업목록 필터바는 2026-09-03 열 머리 필터로 바뀌며 사라졌다(검색은 공용 SearchToggle → search-form.tsx).
      "app/(shell)/documents/_components/document-toolbar.tsx",
      // 성적관리는 2026-09-22 격자로 바뀌며 검색 입력이 사라졌다(명단은 반 드롭다운이 고른다).
      "app/(shell)/inventory/_components/list-toolbar.tsx",
      // 학생목록 필터바는 2026-09-03 열 머리 필터로 바뀌며 사라졌다(검색은 공용 SearchToggle → search-form.tsx).
    ]) {
      const src = readFileSync(join(SRC, r), "utf8");
      // TOOLBAR_SEARCH_BOX 안의 <input>마다 h-full leading-normal.
      const inputs = [...src.matchAll(/<input[\s\S]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "");
      const inBox = inputs.filter((c) => c.includes("bg-transparent"));
      expect(inBox.length, r).toBeGreaterThan(0);
      for (const c of inBox) {
        expect(c, r).toContain("h-full");
        expect(c, r).toContain("leading-normal");
        expect(c, r).not.toMatch(/\btext-xs\b/);
      }
    }
  });

  it("공용 컨트롤 부품이 control-scale을 읽는다 (h-8·text-xs를 손으로 적지 않는다)", () => {
    const readers = [
      "components/ui/button.tsx",
      "components/toolbar.tsx",
      "components/search-form.tsx",
    ];
    for (const r of readers) {
      const src = readFileSync(join(SRC, r), "utf8");
      expect(src, r).toMatch(/control-scale|toolbar-controls/);
      // 클래스 문자열 안의 h-8만 본다 — 주석은 "h-8을 대체했다"고 적으려고 그 단어를 쓴다.
      expect(src, r).not.toMatch(/["`][^"`\n]*\bh-8\b[^"`\n]*["`]/);
    }
    // 직접 클래스를 적는 부품은 같은 변수를 가리켜야 한다. 부품이 치수 상수를 순수 모듈로 꺼냈으면(스켈레톤과 함께 쓰려고 —
    // 2026-11-05) 그 모듈까지 한 덩어리로 본다.
    const parts: Record<string, string[]> = {
      "components/toolbar-controls.ts": ["components/toolbar-controls.ts"],
      "components/face-tabs.tsx": ["components/face-tabs.tsx", "components/face-tabs-classes.ts"],
      "components/period-nav.tsx": ["components/period-nav.tsx", "components/period-nav-metrics.ts"],
    };
    for (const [r, files] of Object.entries(parts)) {
      const src = files.map((f) => readFileSync(join(SRC, f), "utf8")).join("\n");
      expect(src, r).toContain(CONTROL_H);
      expect(src, r).toContain("text-(length:--control-label)");
    }
    // 꺼낸 상수를 실물 부품이 실제로 쓴다(모듈만 맞고 부품은 손 클래스로 돌아가면 안 된다).
    expect(readFileSync(join(SRC, "components/period-nav.tsx"), "utf8")).toContain("period-nav-metrics");
    expect(readFileSync(join(SRC, "components/face-tabs.tsx"), "utf8")).toContain("face-tabs-classes");
    expect(CONTROL_LABEL).toContain("leading-none");
  });
});
