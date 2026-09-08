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
 */
const ROOT = resolve(process.cwd());
const LAYOUT = readFileSync(join(ROOT, "src/app/(shell)/layout.tsx"), "utf8");

/** `embed-main` 클래스를 단 `<main>` 한 줄. */
const EMBED_MAIN = /<main[^>]*className="embed-main[^"]*"/.exec(LAYOUT)?.[0] ?? "";

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
