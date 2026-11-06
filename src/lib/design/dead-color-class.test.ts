import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 죽은 색 클래스 가드 — 토큰이 없어 **조용히 아무 색도 안 나오는** 유틸을 잡는다.
 *
 * 오타가 에러를 내지 않는 게 문제다. `text-danger-foreground`(그런 토큰 없음)는 빌드도 통과하고
 * 타입체크도 통과하는데, 실제로는 색이 안 붙어 **빨간 배경 위에 어두운 글자**가 된다(2026-08-18 실측,
 * 출석부 격자 토스트). `hover:text-text`·`hover:bg-primary-hover`는 hover가 그냥 안 먹는다.
 * 화이트 캔버스에선 더 안 잡힌다 — 배경이 안 칠해져도 흰색으로 "정상처럼" 보인다.
 *
 * 🔑 판정 기준은 globals.css의 `--color-*` 선언 + Tailwind 내장 팔레트뿐이다. 새 색을 쓰려면
 *    토큰을 먼저 만들라는 뜻이고, 그게 "색은 의미에만" 규칙과 같은 방향이다.
 */
const ROOT = resolve(process.cwd());
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

/** `@theme inline`이 선언한 색 토큰 이름(= `bg-<name>` 등으로 쓸 수 있는 것). */
const TOKENS = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]!));

/** Tailwind 내장 색 키워드·팔레트. `red-500`처럼 뒤에 단계가 붙는 것은 앞부분으로 판정한다. */
const BUILTIN = new Set([
  "white", "black", "transparent", "current", "inherit",
  "red", "blue", "green", "amber", "gray", "slate", "zinc", "neutral", "stone",
  "emerald", "sky", "violet", "indigo", "orange", "yellow", "teal", "cyan",
  "lime", "fuchsia", "pink", "rose", "purple",
]);

/**
 * `text-`/`border-`/`bg-`는 색이 아닌 유틸과 접두사를 공유한다(크기·정렬·선 종류·그라디언트).
 * 색 후보만 남기려고 그것들을 걸러낸다 — 걸러내지 못한 건 아래 ALLOW에 이유와 함께 적는다.
 */
// `anchor` = SVG 속성 이름 `text-anchor`(그림 모듈이 setAttribute로 쓰는 속성 키 — 클래스가 아니다 · 연결 탐색 네트워크 draw.ts).
const NON_COLOR =
  /^(xs|sm|md|lg|xl|[2-9]xl|base|left|right|center|justify|start|end|top|bottom|solid|dashed|dotted|double|hidden|none|collapse|separate|balance|pretty|nowrap|wrap|ellipsis|clip|visible|auto|fixed|local|scroll|repeat|contain|cover|origin|opacity|box|color|gradient|linear|radial|conic|anchor|t|b|l|r|x|y|s|e|\d)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("죽은 색 클래스", () => {
  it("정의되지 않은 색 토큰을 쓰는 곳이 없다", () => {
    const bad: string[] = [];
    for (const f of walk(join(ROOT, "src"))) {
      const lines = readFileSync(f, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        // 주석·import는 건너뛴다(설명문과 모듈 경로에 같은 낱말이 자주 나온다).
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("{/*")) return;
        if (/^\s*import\b/.test(line)) return;
        // 임의값(`text-[color:var(--text-faint)]`)과 CSS 변수(`var(--color-text-dim)`)는 클래스가 아니다.
        // 대괄호 안과 `var(...)` 안을 통째로 지운 뒤에 스캔한다 — 안 지우면 그 안의 낱말이 오탐이 된다.
        const scan = line.replace(/\[[^\]]*\]/g, "[]").replace(/var\([^)]*\)/g, "var()");
        // 앞이 `-`나 글자면 더 긴 식별자의 일부다(`--color-text-faint`, `extension-text-align`).
        for (const m of scan.matchAll(/(?<![\w-])(bg|text|border)-([a-z][a-z0-9-]*)\b/g)) {
          const name = m[2]!;
          if (TOKENS.has(name)) continue;
          // 🔴 팔레트 이름 뒤에는 **숫자 단계만** 온다(`amber-500` ○ / `amber-strong` ✗).
          //    예전엔 앞부분만 봐서 `text-amber-strong` 14곳이 몇 달간 **아무 색도 없이** 통과했다
          //    (오늘 출결·어제 요약의 '조치 미완료'·'데스크 확인 요청'이 검정으로 떴다, 2026-08-20).
          if (BUILTIN.has(name)) continue;
          const head = name.split("-")[0]!;
          if (BUILTIN.has(head) && /^\d{2,3}$/.test(name.slice(head.length + 1))) continue;
          if (NON_COLOR.test(name)) continue;
          bad.push(`${m[0]} — ${f.replace(ROOT, "").replace(/\\/g, "/")}:${i + 1}`);
        }
      });
    }
    expect(bad, `정의되지 않은 색 클래스:\n${bad.join("\n")}`).toEqual([]);
  }, 60_000); // 전수 스캔 — 혼자 1초대지만 전체 스위트 병렬에선 기본 5초를 넘겨 헛실패한다(2026-09-16 두 번 실측).
});
