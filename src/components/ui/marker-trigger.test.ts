/**
 * 형광 표기(`--marker`)가 **화면에 하나뿐**임을 지키는 구조 가드.
 *
 * 원장 2026-08-18: *"수업명을 확실하게 보기 위함"* — 이 표기의 값어치는 **희소성**에서 나온다.
 * 노란 덩어리가 둘이 되는 순간 눈이 어디로 갈지 몰라 첫째가 안 보이고, 그러면 표기를 넣은 이유가
 * 통째로 사라진다. 그래서 "어디에 켜져 있나"를 코드가 아니라 **목록으로 못 박는다.**
 *
 * ⚠️ 이 테스트는 "무엇을 하는가"까지는 못 본다(참조만 확인). 실제 모양은 marker-trigger.ts가 정한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * 표기를 **켜도 되는** 자리 = "반을 고르면 그 반의 내용이 아래를 채우는" 드롭다운.
 * 새로 켜려면 그게 정말 이 성격인지 먼저 판단하고 여기에 적을 것(적기 싫으면 켜지 말 것).
 */
const MARKED = [
  {
    // 2026-09-01 상단 바 통일로 **주간·월간이 같은 조각**을 쓴다 — 그래서 표기도 여기 한 곳에서 켜진다
    // (화면마다는 여전히 하나뿐이다: 주간 시트에 하나, 월간 뷰에 하나).
    path: "src/features/class-sheets/components/sheet-chrome.tsx",
    why: "ECS 시트(주간·월간) — 반 전환",
  },
  { path: "src/app/(shell)/attendance/page.tsx", why: "출석부 — 반을 고르면 그 반 월 시트" },
  // ⚠️ 성적관리(2026-09-22 오후)는 **뺐다** — 원장이 화면을 보고 *"어떤 반은 누르면 작고 어떤 반은 겁나
  //    크게 뜨고 너무 난장판임 … 그럴 거면 통일하고"*라고 했다. 그 화면은 드롭다운이 여섯이라 하나만
  //    커지면 툴바가 반을 고를 때마다 널뛴다. 다른 화면의 표기는 그대로다(여기 목록이 정본).
];

describe("형광 반 표기(marker)", () => {
  it("표기 규약은 한 곳에서만 정의된다 — 인라인 복사가 없다", () => {
    const src = read("src/components/ui/marker-trigger.ts");
    expect(src).toContain("bg-marker");
    expect(src).toContain("text-2xl");
    // 🔴 서버 컴포넌트가 import하면 런타임에 값이 사라진다([[#81]]) — 이 파일은 클라 모듈이면 안 된다.
    // ⚠️ 문자열 포함 여부로 보면 **주석에 적힌 경고 문구까지 걸린다**(이 가드를 처음 짤 때 실제로 걸렸다)
    //    → 지시문은 반드시 자기 줄에 홀로 서야 효력이 있으므로 **줄 단위**로 본다.
    const directive = /^\s*["']use client["'];?\s*$/m;
    expect(directive.test(src)).toBe(false);
  });

  it("--marker 토큰과 bg-marker 유틸리티가 살아 있다", () => {
    const css = read("src/app/globals.css");
    // 토큰 이름이 틀려도 Tailwind는 에러 없이 유틸리티만 조용히 안 만든다 → 둘 다 확인한다.
    expect(css).toMatch(/--color-marker:\s*var\(--marker\)/);
    expect(css).toMatch(/--marker:\s*#/);
  });

  it("허용 목록의 세 곳만 표기를 켠다", () => {
    for (const { path, why } of MARKED) {
      const src = read(path);
      const on = src.includes("MARKER_TRIGGER") || /\bmarker\b(?!-)/.test(src);
      expect(on, `${path}에 표기가 없다 — ${why}`).toBe(true);
    }
  });

  it("FilterSelect의 표기는 opt-in이고 '전체'에선 꺼진다", () => {
    const src = read("src/components/filter-select.tsx");
    expect(src).toContain("marker = false"); // 기본은 꺼짐 — 다른 필터가 딸려 켜지지 않는다
    // "전체"(allValue)일 땐 표기를 켜지 않는다 — 아무 반도 안 골랐는데 노랗게 칠하지 않기 위해.
    expect(src).toMatch(/markerOn\s*=\s*marker\s*&&/);
    expect(src).toContain("!== allValue");
  });
});
