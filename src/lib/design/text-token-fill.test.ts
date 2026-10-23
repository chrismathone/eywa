import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 글자 토큰을 **면**(배경·링·테두리·채움)에 쓰지 못하게 잠근다.
 *
 * 2026-09-08에 글자색이 한 값(`#121212`)이 되면서, `--text-faint`를 "중립 회색"이라는 뜻의
 * **채움색**으로 쓰던 자리가 통째로 새까매졌다 — 파이 '기타' 조각·'미상' 막대·달력 회색 점·
 * 좌석 '수업 후 기록' 링·과목 neutral 스와치. 원장 지시는 *"이런식의 글자만"* 이었으니
 * 면 회색은 제 토큰(`--neutral-fill`)을 쓴다.
 *
 * 🔑 반대 방향(면 토큰을 글자에)은 막지 않는다 — `--neutral-fill`(#58585e)은 화이트 위 **7.1:1**이라
 *    대비는 넉넉하고, 글자에 안 쓰는 이유는 09-08 '글자는 한 값' 규칙이지 대비가 아니다.
 */
const ROOT = resolve(process.cwd());
// 🔴 `--ink`·`--foreground`는 대상이 아니다 — 원래도 근검정이라 `bg-ink`(어두운 머리띠 등)는
//    의도된 관용구고 09-08 변경으로 눈에 띄게 달라지지도 않았다(#1d1d1f → #121212).
//    문제는 **중간 회색**이던 둘뿐이다.
//
// 🔴 **방향 접미사를 반드시 포함할 것**(`border-t-`·`divide-y-`·`border-s-`) — 처음엔 `border-`만
//    봐서 원스크린 학생 묶음 구분선 `border-t-2 border-t-text-faint/50` 두 줄이 가드를 그대로
//    통과했고(초록인데 규칙은 깨진 상태), 09-08 글자색 통일에 딸려 그 선만 진해졌다.
const PREFIX = "(?:bg|ring|ring-offset|fill|border|stroke|divide|outline|accent|caret)";
const SIDE = "(?:-(?:t|b|l|r|x|y|s|e|top|bottom|left|right|inline|block))?";
const UTIL = new RegExp(`(?<![\\w-])${PREFIX}${SIDE}-(text-dim|text-faint)\\b`, "g");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("글자 토큰은 글자에만", () => {
  // ⚠️ 전수 스캔이라 전체 vitest와 겹쳐 돌면 기본 5초를 넘긴다(헛실패).
  it("bg-/ring-/fill-/border- 로 글자 토큰을 쓰지 않는다 — 면 회색은 --neutral-fill", { timeout: 60_000 }, () => {
    const bad: string[] = [];
    for (const f of walk(join(ROOT, "src"))) {
      // 테스트 파일은 규칙을 인용한다.
      if (/\.test\.tsx?$/.test(f)) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("*") || t.startsWith("//") || t.startsWith("{/*")) return;
          for (const m of line.matchAll(UTIL)) {
            bad.push(`${m[0]} — ${f.slice(ROOT.length + 1).split("\\").join("/")}:${i + 1}`);
          }
        });
    }
    expect(bad, `글자 토큰을 면에 씀:\n${bad.join("\n")}`).toEqual([]);
  });

  /**
   * 가드의 가드 — 정규식이 **방향 접미사를 계속 본다**는 것 자체를 잠근다.
   * 위 형태가 실제로 새어 나간 적이 있어서(원스크린 묶음 구분선), 정규식을 좁히는 편집이
   * "스캔 결과 0건 = 초록"으로 조용히 통과하지 못하게 한다.
   */
  it("정규식이 방향 접미사 형태를 잡는다", () => {
    for (const s of [
      "border-text-faint",
      "border-t-2 border-t-text-faint/50 px-2",
      "divide-y-text-dim",
      "bg-text-faint",
      "ring-offset-text-dim",
    ]) {
      expect([...s.matchAll(UTIL)], s).not.toEqual([]);
    }
    // 반대편 — 글자 자리는 잡지 않는다.
    for (const s of ["text-text-faint", "text-text-dim/70", "border-line"]) {
      expect([...s.matchAll(UTIL)], s).toEqual([]);
    }
  });

  it("면 회색 토큰이 실제로 선언돼 있다", () => {
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toMatch(/--neutral-fill: #[0-9a-f]{6};/);
    expect(css).toContain("--color-neutral-fill: var(--neutral-fill);");
  });

  /**
   * 유틸 클래스(`bg-text-faint`)만 막으면 절반이다 — 이번에 옮긴 17곳 중 11곳은
   * `var(--color-text-faint)`를 **인라인 style·recharts props**로 쓰던 자리였다.
   * 그 형태로 되돌리면 위 가드는 초록인 채 파이 조각·막대가 다시 새까매진다.
   *
   * 🔑 속성 이름으로는 못 가른다 — recharts는 **축 라벨 글자도 `fill`**로 칠한다.
   *    그래서 "어디에 썼나"가 아니라 **"쓴 파일이 허용 목록에 있나"**로 잠근다.
   */
  // ⚠️ 형제 테스트와 같은 전수 스캔이라 전체 vitest와 겹치면 기본 5초를 넘긴다(헛실패).
  it("var(--color-text-dim/faint)는 허용된 글자 자리에서만 쓴다", { timeout: 60_000 }, () => {
    // 차트 축 눈금 = 글자다(면이 아니다). 여기 더할 땐 그 값이 정말 글자인지 확인할 것.
    const ALLOW = [/enrollment\/_components\/stats-trend-impl\.tsx$/];
    const bad: string[] = [];
    for (const f of walk(join(ROOT, "src"))) {
      const rel = f.slice(ROOT.length + 1).split("\\").join("/");
      if (/\.test\.tsx?$/.test(f) || ALLOW.some((re) => re.test(rel))) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/var\(--color-text-(dim|faint)\)/.test(line)) bad.push(`${rel}:${i + 1}`);
        });
    }
    expect(bad, `면 회색은 var(--color-neutral-fill)로:\n${bad.join("\n")}`).toEqual([]);
  });
});
