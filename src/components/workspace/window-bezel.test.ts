import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 창(플로팅 창 = `?embed=1`) 본문의 **베젤** 가드 — 원장 2026-09-08
 * *"창 열었을때 여백을 정말 최소화"* · *"좌우는 특히"* · *"베젤이 있으니까 오히려 공간낭비"* ·
 * *"베젤 필요한 곳에만 베젤을 남겨둬야할거같은데"*.
 *
 * 규약: **셸은 여백을 만들지 않는다. 베젤이 필요한 화면이 스스로 준다.**
 * (전수 조사 2026-09-08: 문서형 26개 라우트가 이미 `p-6`·`p-4 md:p-6`를 갖고 있어 그동안 이중 여백이었다.)
 *
 * 🔴 그렇다고 **0은 아니다** — 셋이 걸린다:
 *  ① 카드 테두리가 **박스 밖 그림자 링**이고 이 `<main>`이 `overflow-auto`라, 0이면 전폭 카드의 좌·우 선이
 *     잘린다([[#114]]). `loading.tsx` 스켈레톤은 거의 전부가 전폭 `shadow-card` 띠다.
 *  ② 플로팅 창의 **리사이즈 핸들이 좌·우 각 6px을 콘텐츠 위에 겹쳐** 깐다 — 0이면 맨 좌우가 클릭 불가.
 *  ③ `[scrollbar-gutter:stable]`은 inline-end 한쪽만 자리를 판다 — 0이면 좌우 비대칭이 두드러진다.
 *
 * ⚠️ 이 가드는 "작아야 한다"와 "0이면 안 된다"를 **동시에** 잠근다. 둘 중 하나만 지키면 규약이 아니다.
 *
 * 🔑 **0이 필요한 화면은 셸이 아니라 화면이 말한다** — 페이지 루트의 `.edge-to-edge` 마커를 globals.css의
 *    `main.embed-main:has(.edge-to-edge)`가 받아 그 창만 좌우·아래 0 + 거터 해제(원장 2026-09-08 *"시간표 탭에서
 *    좌우와 하단 여백이 거의 느껴지지 않도록 딱 붙여야겠어"*). 시간표가 첫 소비처. `.sticky-save-bar`([[#110]])와
 *    같은 결이라 레이아웃은 손대지 않는다(soft nav에서 <main>은 재렌더되지 않는다).
 */
const ROOT = resolve(process.cwd());
const LAYOUT = readFileSync(join(ROOT, "src/app/(shell)/layout.tsx"), "utf8");
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const TIMETABLE_PAGE = readFileSync(join(ROOT, "src/app/(shell)/timetable/page.tsx"), "utf8");
const TIMETABLE_LOADING = readFileSync(join(ROOT, "src/app/(shell)/timetable/loading.tsx"), "utf8");

/** `embed-main` 클래스를 단 `<main>` 한 줄. */
// (이전 화면 유지 방식의 창 문서는 같은 <main>의 className이 `keepaliveFrame ? KEEPALIVE_MAIN_CLASS : "embed-main …"` 삼항이다 — 창 모드 쪽 문자열을 가드한다.)
const EMBED_MAIN = /<main[^>]*className=(?:\{keepaliveFrame \? KEEPALIVE_MAIN_CLASS : )?"embed-main[^"]*"/.exec(LAYOUT)?.[0] ?? "";

function pxOf(cls: string, prefix: string): number | null {
  // Tailwind 간격 단위 = 0.25rem = 4px. `px-1` → 4, `px-1.5` → 6, `px-3` → 12.
  const m = new RegExp(`(?:^|\\s|:)${prefix}-(\\d+(?:\\.\\d+)?)`).exec(cls);
  return m ? Number(m[1]) * 4 : null;
}

describe("창 본문 베젤 — 셸은 여백을 만들지 않는다(단, 0도 아니다)", () => {
  it("embed <main>을 찾는다", () => {
    expect(EMBED_MAIN).not.toBe("");
  });

  it("좌우 여백은 0보다 크고 8px 이하", () => {
    const base = pxOf(EMBED_MAIN, "px");
    expect(base).not.toBeNull();
    // 0 금지(링 잘림·리사이즈 핸들·거터 비대칭) · 8px 초과 금지(원장 "공간낭비").
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThanOrEqual(8);
  });

  it("넓은 화면(lg)에서도 좌우 여백이 8px 이하 — 여기가 옛 24px 자리다", () => {
    const lg = pxOf(EMBED_MAIN, "lg:px");
    // lg 변형이 없으면 base 값을 그대로 쓰는 것이라 통과. 있으면 같은 상한을 지킨다.
    if (lg !== null) {
      expect(lg).toBeGreaterThan(0);
      expect(lg).toBeLessThanOrEqual(8);
    }
  });

  it("스크롤바 거터와 하단 여백 규약은 그대로 둔다", () => {
    // 거터를 빼면 스크롤 등장 시 본문이 가로로 튄다.
    expect(EMBED_MAIN).toContain("[scrollbar-gutter:stable]");
    // 하단 여백은 별개 축(디자인 규약: 마지막 카드가 바닥에 안 붙게) — 좌우를 줄인다고 같이 지우지 말 것.
    expect(pxOf(EMBED_MAIN, "pb")).toBeGreaterThanOrEqual(24);
  });
});

describe("`.edge-to-edge` — 베젤 0이 필요한 화면은 마커로 말한다(시간표)", () => {
  /** globals.css의 마커 규칙 본문. */
  const RULE = /main\.embed-main:has\(\.edge-to-edge\)\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";

  it("globals.css에 embed <main> 한정 규칙이 있고 좌우·아래 0 + 거터 해제를 전부 적는다", () => {
    expect(RULE).not.toBe("");
    // 좌우 — `padding-inline: 0` 또는 left/right 둘 다.
    expect(/padding-inline:\s*0/.test(RULE) || (/padding-left:\s*0/.test(RULE) && /padding-right:\s*0/.test(RULE))).toBe(true);
    expect(RULE).toMatch(/padding-bottom:\s*0/);
    // 거터를 그대로 두면 오른쪽에 스크롤바 폭만큼 빈 띠가 남는다(원장이 본 우측 여백의 절반).
    expect(RULE).toMatch(/scrollbar-gutter:\s*auto/);
    // 위는 남긴다 — 툴바가 창 타이틀바에 붙지 않게.
    expect(RULE).not.toMatch(/padding-top|(^|[^-])padding:/);
  });

  it("규칙은 창(.embed-main)에만 — 풀셸·미니셸 <main>을 같이 잡는 선택자를 쓰지 않는다", () => {
    // `main:has(.edge-to-edge)`(셸 불문)로 넓히면 풀셸에서 시간표가 사이드바 경계에 붙는다.
    expect(/(^|[^.\w-])main:has\(\.edge-to-edge\)/m.test(CSS)).toBe(false);
    // `:has(> …)`는 dev 산출 CSS에서 조용히 사라진다([[#127]]).
    expect(CSS).not.toMatch(/:has\(\s*>\s*\.edge-to-edge/);
  });

  function rootClassOf(src: string): string {
    return /<div\b[^>]*\bclassName="([^"]*\bedge-to-edge\b[^"]*)"[^>]*>/.exec(src)?.[1] ?? "";
  }

  it("시간표 page.tsx 루트와 loading.tsx 루트가 같은 마커·같은 className을 단다", () => {
    const page = rootClassOf(TIMETABLE_PAGE);
    const loading = rootClassOf(TIMETABLE_LOADING);
    expect(page).not.toBe("");
    // 스켈레톤이 본문과 다른 폭으로 서면 데이터 도착 때 화면이 튄다(design-conventions 본문 하단 여백 규약).
    expect(loading).toBe(page);
  });
});
