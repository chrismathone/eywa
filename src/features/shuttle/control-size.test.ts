import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_ICON_BTN,
  SHUTTLE_INPUT,
  SHUTTLE_ROW,
} from "./control-size";

/**
 * 셔틀 컨트롤 크기 가드 — 원장 제보(2026-08-20) *"내부 정렬 및 버튼들 레이아웃 수준이 다른 탭들에
 * 비해 떨어져"* 를 다시 못 나게 잡는다.
 *
 * 🔑 **상수만으로는 못 막는다**: 크기를 [`control-size.ts`](./control-size.ts)로 모아도, 다음 사람이
 *    화면 파일에 `h-9`나 `text-[12px]`를 새로 적으면 조용히 다시 갈린다(실제 회귀는 그렇게 난다).
 *    그래서 죽은 색 클래스 가드([`dead-color-class.test.ts`](@/lib/design/dead-color-class.test.ts))처럼
 *    **파일을 훑어 값 자체를 막는다**.
 *
 * 두 가지를 본다:
 *  ① **폰 탭 타겟 44px** — 접두사 없는(=폰에도 적용되는) `h-8`·`h-9`·`h-10`류 금지.
 *     `sm:h-8`처럼 데스크톱 한정은 통과한다(그게 캐논이다).
 *  ② **글자 계단** — control-size.ts 머리에 적힌 여덟 크기 밖은 금지.
 */

const ROOT = resolve(process.cwd());

/** 셔틀 화면(그리는 쪽)만 본다 — `(print)`는 종이 서식이라 자체 스케일이고 캐논 밖이다(라운드 캐논과 같은 예외). */
const DIRS = [
  join(ROOT, "src/app/(shell)/shuttle"),
  join(ROOT, "src/features/shuttle/components"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (extname(p) === ".tsx") out.push(p);
  }
  return out;
}

const FILES = DIRS.flatMap((d) => walk(d)).map((p) => ({
  path: p.slice(ROOT.length + 1).replaceAll("\\", "/"),
  text: readFileSync(p, "utf8"),
}));

describe("셔틀 컨트롤 크기", () => {
  it("화면 파일이 하나라도 잡힌다(가드가 빈 목록을 훑고 통과하는 것 방지)", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  /**
   * ① 폰 탭 타겟 — 접두사 없는 32/36/40px 컨트롤 금지.
   *
   * 📱 셔틀은 "탭 타겟 44px"가 결정 사항이다(CLAUDE.md, 원장 2026-08-19 *"셔틀 선생님은 모바일을
   *    대부분 이용하시니까"*). 2026-08-20 실측에서 23곳이 이 결정을 어기고 있었다.
   * ⚠️ 스켈레톤(`loading.tsx`)은 **대응 실표면과 같은 크기**여야 하므로 같은 규칙을 받는다
   *    (여기만 빼 두면 로드되는 순간 줄이 뛴다).
   *
   * 🔑 예외는 **줄에 `size-guard-ok:` + 사유**를 적어 연다 — 셔틀 캐논 밖 공용 컴포넌트
   *    (FaceTabs 등)의 자리를 잡는 스켈레톤이 그렇다. 규칙을 느슨하게 푸는 대신 예외를 **눈에
   *    보이게** 남기는 쪽을 고른다(사유 없는 예외가 쌓이면 가드가 없는 것과 같아진다).
   */
  const TOO_SMALL = /(?<![a-z0-9:-])(?:min-h|h|size)-(?:8|9|10)(?![.0-9a-z-])/g;
  const OPT_OUT = "size-guard-ok:";

  it.each(FILES)("$path — 폰에서 44px 미만 컨트롤이 없다", ({ text }) => {
    // 표식은 **그 줄 또는 바로 윗줄**에서 찾는다(eslint-disable-next-line과 같은 관용구) —
    // JSX에선 사유를 속성 사이에 끼워 넣을 수 없어 대개 바로 위 주석에 적힌다.
    const lines = text.split(/\r?\n/);
    const hits = lines.flatMap((line, i) =>
      line.includes(OPT_OUT) || (lines[i - 1]?.includes(OPT_OUT) ?? false)
        ? []
        : [...line.matchAll(TOO_SMALL)].map((m) => m[0]),
    );
    expect(hits).toEqual([]);
  });

  /**
   * ② 글자 계단 — 여덟 크기만. 새 크기가 필요하면 **이유와 함께** 여기 추가한다.
   *
   * ⚠️ `sm:`이 붙은 것도 같이 본다 — 데스크톱만 몰래 다른 크기를 갖는 게 정확히 "한 벌"이 깨지는
   *    방식이었다(전엔 데스크톱 글자가 12.5·11.5·13·12·11px 다섯 벌이었다).
   */
  const ALLOWED_PX = new Set([
    "16", // 회차 출발 시각 — 기사가 가장 먼저 보는 값
    "15", // 패널·다이얼로그 제목 (+ 배정 칩의 '×' 글리프)
    "14.5", // 오늘 날짜
    "14", // 줄의 학생 이름(폰)
    "13.5", // 카드·열 소제목
    "13", // 컨트롤 글자(폰)
    "12.5", // 본문·컨트롤 글자(데스크톱)
    "11.5", // 보조 정보
  ]);
  const TEXT_PX = /text-\[([0-9.]+)px\]/g;

  it.each(FILES)("$path — 글자 크기가 계단 안에 있다", ({ text }) => {
    const off = [...text.matchAll(TEXT_PX)].map((m) => m[1]!).filter((px) => !ALLOWED_PX.has(px));
    expect([...new Set(off)]).toEqual([]);
  });
});

describe("크기 상수 자체의 계약", () => {
  it("누르는 것은 폰에서 44px", () => {
    expect(SHUTTLE_ACTION).toContain("h-11");
    expect(SHUTTLE_CHIP).toContain("h-11");
    expect(SHUTTLE_ROW).toContain("min-h-11");
    expect(SHUTTLE_ICON_BTN).toContain("size-11");
    expect(SHUTTLE_INPUT).toContain("h-11");
  });

  it("입력은 폰에서 16px — iOS 자동확대 방지", () => {
    // `text-base`(=16px)가 접두사 없이 있어야 한다. `sm:text-…`는 데스크톱 몫이라 별개다.
    expect(SHUTTLE_INPUT).toMatch(/(?<![a-z:-])text-base\b/);
  });

  it("데스크톱은 한 벌 — 칩·입력·줄이 같은 크기로 되돌아간다", () => {
    expect(SHUTTLE_CHIP).toContain("sm:text-[12.5px]");
    expect(SHUTTLE_INPUT).toContain("sm:text-[12.5px]");
    for (const c of [SHUTTLE_ACTION, SHUTTLE_CHIP, SHUTTLE_INPUT]) expect(c).toContain("sm:h-8");
  });

  it("수제 칩은 커서를 명시한다 — Tailwind v4가 preflight의 button{cursor:pointer}를 지웠다", () => {
    expect(SHUTTLE_CHIP).toContain("cursor-pointer");
  });
});
