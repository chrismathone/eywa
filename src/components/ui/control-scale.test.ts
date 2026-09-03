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
  it("text-[Npx]는 종이 서식 밖에서 0건", () => {
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
    // 보조 텍스트도 7:1에 가깝게 — #58585e(7.1:1). 옅은 회색으로 되돌리지 말 것.
    expect(css).toMatch(/--text-faint: #58585e;/);
  });
});

describe("컨트롤 프리셋 — 높이는 라벨에서 도출, 공용 컨트롤이 한 벌을 읽는다", () => {
  it("높이 = 라벨 ÷ 0.9 (위아래 여백 5%씩)", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    for (const suffix of ["-sm", "", "-lg"]) {
      const label = Number(new RegExp(`--control-label${suffix}: (\\d+)px;`).exec(css)?.[1]);
      const h = Number(new RegExp(`--control-h${suffix}: (\\d+)px;`).exec(css)?.[1]);
      expect(label).toBeGreaterThan(0);
      // 라벨이 높이의 90% 이상 — 여백 합 10% 이하(반올림 1px 허용).
      expect(label / h).toBeGreaterThanOrEqual(0.88);
      expect(h - label).toBeLessThanOrEqual(2);
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
    // 직접 클래스를 적는 부품은 같은 변수를 가리켜야 한다.
    for (const r of ["components/toolbar-controls.ts", "components/face-tabs.tsx", "components/period-nav.tsx"]) {
      const src = readFileSync(join(SRC, r), "utf8");
      expect(src, r).toContain(CONTROL_H);
      expect(src, r).toContain("text-(length:--control-label)");
    }
    expect(CONTROL_LABEL).toContain("leading-none");
  });
});
