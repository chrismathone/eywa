import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 팔레트 대비 가드 — **globals.css의 실제 값**을 읽어 WCAG 대비를 계산한다.
 *
 * 원장 지시(2026-08-18): *"전체적으로 **대비를 끌어올려서 신뢰성**을 주고 싶은데"*.
 * 대비는 눈으로 못 잰다 — v3에서도 배지 글자가 4.08~4.45:1로 **미달인 채 몇 달 굴러갔고**
 * 아무도 못 봤다(색이 있으니 "보이긴 하는" 상태라 더 안 잡힌다). 그래서 숫자로 잠근다.
 *
 * 🔑 하드코딩한 hex를 비교하는 게 아니라 **CSS를 파싱해서** 잰다 — 값을 바꾸면 이 테스트가 바뀐 값으로
 * 다시 계산하므로, "테스트를 고치려고 값을 되돌리는" 우회가 안 생긴다. 대비가 떨어지면 실패한다.
 * ⚠️ 색을 밝게 되돌리고 싶으면 여기 임계값이 아니라 **왜 밝아야 하는지**를 먼저 답할 것.
 */
const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** `:root { --name: value; }`에서 값 하나. 첫 정의(=`:root` 블록)만 본다. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`토큰을 못 찾음: --${name}`);
  return m[1]!.trim();
}

function rgbOf(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  throw new Error(`파싱 불가: ${value}`);
}

function alphaOf(value: string): number {
  const m = value.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
  return m ? Number(m[1]) : 1;
}

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (rgb: [number, number, number]): number =>
  0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** 알파 색을 불투명 배경 위에 합성한 실효 색. */
function over(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number]
): [number, number, number] {
  return [0, 1, 2].map((i) => fg[i]! * alpha + bg[i]! * (1 - alpha)) as [number, number, number];
}

const WHITE: [number, number, number] = [255, 255, 255];

describe("팔레트 대비 — 화이트 캔버스(v4)", () => {
  it("텍스트 3단이 흰 배경에서 전부 4.5:1 이상", () => {
    for (const name of ["foreground", "text-dim", "text-faint"]) {
      const r = contrast(rgbOf(token(name)), WHITE);
      expect(r, `--${name} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("가장 약한 글자(text-faint)도 회색 채움 위에서 4.5:1 이상", () => {
    // v3에서 여기가 3.75:1이었다 — 화이트 배지 안 캡션이 실제로 흐렸다.
    const faint = rgbOf(token("text-faint"));
    for (const fill of ["bg-soft", "muted", "secondary"]) {
      const r = contrast(faint, rgbOf(token(fill)));
      expect(r, `text-faint on --${fill} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("-soft 배지: 같은 색 글자가 그 틴트 위에서 4.5:1 이상", () => {
    // 🔑 v3에서 danger 4.08 · blue 4.35 · amber 4.39 · gold 4.45로 **전부 미달**이던 자리.
    //    틴트를 진하게 하면 여기가 먼저 무너지므로, 알파를 올릴 땐 잉크도 같이 조여야 한다.
    for (const name of ["green", "danger", "amber", "blue", "purple", "rose", "gold", "primary"]) {
      const ink = rgbOf(token(name));
      const soft = token(`${name}-soft`);
      const badgeBg = over(rgbOf(soft), alphaOf(soft), WHITE);
      const r = contrast(ink, badgeBg);
      expect(r, `--${name} on --${name}-soft = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("솔리드 채움(누른 알약·버튼)의 흰 글자가 4.5:1 이상", () => {
    for (const name of ["green", "danger", "amber", "blue", "purple", "rose", "primary"]) {
      const r = contrast(rgbOf(token(name)), WHITE);
      expect(r, `white on --${name} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("같은 뜻의 차트 슬롯과 배지 색이 어긋나지 않는다", () => {
    // 차트와 배지가 다른 빨강·다른 초록이면 "이어지는 느낌"이 거기서 끊긴다.
    expect(token("chart-1")).toBe(token("blue"));
    expect(token("chart-2")).toBe(token("green"));
    expect(token("chart-4")).toBe(token("danger"));
    // destructive(삭제 버튼)·accent-foreground(gold)도 본색과 같아야 한다.
    expect(token("destructive")).toBe(token("danger"));
    expect(token("accent-foreground")).toBe(token("gold"));
  });

  it("캔버스·카드가 화이트고, 구분선이 보일 만큼 진하다", () => {
    expect(token("background")).toBe("#ffffff");
    expect(token("card")).toBe("#ffffff");
    // 화이트 위 유일한 구조 신호라 v3(9%)보다 진해야 한다.
    expect(alphaOf(token("line"))).toBeGreaterThanOrEqual(0.12);
    // 위계는 유지: faint < line < strong.
    expect(alphaOf(token("line-faint"))).toBeLessThan(alphaOf(token("line")));
    expect(alphaOf(token("line"))).toBeLessThan(alphaOf(token("line-strong")));
  });

  it("카드 그림자 첫 레이어가 헤어라인 링이다 — 화이트 위 카드 경계", () => {
    const shadow = token("shadow-card");
    expect(shadow).toMatch(/^0 0 0 1px/);
  });
});

/**
 * 검색 표식(--search-hit) — 시간표에서 검색에 걸린 학생 줄.
 *
 * 원장 2026-08-20: *"서치된 학생이 갈색으로 보이는데 영 눈에 안띄네"*. 종전 `bg-amber!`는 이름만
 * amber이고 실제 값은 갈색(#995709)이라 **같은 셀의 신입 빨강 옆에서 묻혔다**. 그래서 "눈에 띄나"를
 * 취향이 아니라 숫자로 잠근다 — 되돌리려면 여기 임계값이 아니라 왜 어두워야 하는지를 먼저 답할 것.
 */
describe("검색 표식 — 형광 채움", () => {
  it("진한 글자가 형광 채움 위에서 7:1 이상", () => {
    const r = contrast(rgbOf(token("foreground")), rgbOf(token("search-hit")));
    expect(r, `--foreground on --search-hit = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(7);
  });

  it("바로 옆 줄에 오는 색들과 한눈에 갈린다 — 신입 빨강·전입 네이비·퇴원 잉크", () => {
    const hit = rgbOf(token("search-hit"));
    for (const name of ["danger", "primary", "ink"]) {
      const r = contrast(hit, rgbOf(token(name)));
      expect(r, `--search-hit vs --${name} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("상태색을 빌려 쓰지 않는다 — 표식은 상태가 아니라 '찾은 자리'다(축이 다르다)", () => {
    for (const name of ["green", "amber", "danger", "blue", "purple", "primary"]) {
      expect(token("search-hit"), `--search-hit이 --${name}과 같다`).not.toBe(token(name));
    }
  });
});
