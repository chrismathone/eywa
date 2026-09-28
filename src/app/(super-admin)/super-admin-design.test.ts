import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 슈퍼관리자 영역 **디자인 가드** — 이 영역이 다시 따로 놀지 않게 잠근다.
 *
 * 계기(원장 2026-09-25, 폰 캡처): *"색상 등이 기존과 너무 차이나는걸?"* → *"완전한 리팩토링하면서 모바일 레이아웃까지
 * 잡아. 이것까지 관리된다 싶을정도로 전부 관리"*. 2026-05-28 첫 구현(검정 사이드바·금색·영문 모노 대문자·이니셜 배지·
 * 화면 로컬 Kpi 카드·JSON 원문 로그·폰 레이아웃 없음)이 팔레트 v3·v4·v5 전환에서 통째로 빠져 있었다.
 * 앱 전역 가드(`control-scale`·`toolbar-canon` 등)는 **개별 규칙**만 봐서 "영역 하나가 옛 옷 그대로"는 못 잡았다 —
 * 그래서 영역 단위로 한 번 더 건다.
 */

const ROOT = process.cwd();
const DIRS = ["src/app/(super-admin)", "src/components/super-admin"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const FILES = DIRS.flatMap((d) => walk(join(ROOT, d))).map((full) => ({
  path: relative(ROOT, full).replaceAll("\\", "/"),
  src: readFileSync(full, "utf8"),
}));

/** 주석을 뺀 코드 줄 — 주석에 옛 토큰 이름을 적어 두는 것(기록)은 막지 않는다. */
function codeLines(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\{\/\*.*?\*\/\}/g, ""))
    .filter((l) => !l.trim().startsWith("//"));
}

const BANNED: { re: RegExp; why: string }[] = [
  { re: /\bbg-ink\b/, why: "검정 사이드바 — 앱은 bg-sidebar(화이트)" },
  { re: /\b(?:bg|text|border|hover:text|hover:bg)-gold\b/, why: "금색 강조 — 자리 표시는 primary, 뜻은 tone" },
  { re: /rgba\(184/, why: "금색 빛 번짐 그림자" },
  { re: /\buppercase\b/, why: "영문 대문자 라벨 — 한글로(de-mono 정책)" },
  { re: /tracking-\[/, why: "넓은 자간 장식 라벨(de-mono 정책)" },
  { re: /text-\[\d/, why: "px 글자 — 타입 스케일 토큰만(v5)" },
  { re: /<select\b/, why: "native select 금지 — SearchableSelect/FilterSelect" },
  { re: /<Pill[^>]*\bcolor="/, why: "배지 색 직접 선택 — tone(toneColor)·roleMeta·studentStatusMeta로" },
  { re: /\bfunction (?:Kpi|KpiCard|Stat)\b/, why: "화면 로컬 지표 카드 — BigStat" },
  { re: /\b(?:ACTION_META|STATUS_LABEL|ROLE_OPTIONS|SEAT_FEATURES|TOGGLE_FEATURES|ACTION_FILTERS)\s*[:=]/, why: "라벨 표 사본 — features/super-admin/labels.ts" },
  { re: /SuperAdminHeader/, why: "옛 헤더 — PageHeader" },
  { re: /displayName\.slice\(0,\s*1\)/, why: "이름 이니셜 배지(영구 금지)" },
];

describe("슈퍼관리자 디자인 가드", () => {
  it("대상 파일을 실제로 읽는다", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(BANNED)("금지: $why", ({ re }) => {
    const hits = FILES.flatMap(({ path, src }) =>
      codeLines(src)
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => re.test(line))
        .map(({ line, i }) => `${path}:${i + 1}  ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("mono 글꼴은 코드·ID(학원 코드·임시 비밀번호)에만", () => {
    const hits = FILES.flatMap(({ path, src }) =>
      codeLines(src)
        .filter((line) => /\bfont-mono\b/.test(line) && !/slug|tempPassword/.test(line))
        .map((line) => `${path}  ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("JSON 원문은 화면이 아니라 title 툴팁으로만", () => {
    const hits = FILES.flatMap(({ path, src }) =>
      codeLines(src)
        .filter((line) => line.includes("JSON.stringify(") && !/title=\{/.test(line))
        .map((line) => `${path}  ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("모든 화면이 PageHeader로 시작한다(Editorial ①)", () => {
    const pages = FILES.filter((f) => f.path.endsWith("/page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(6);
    for (const p of pages) expect(p.src, p.path).toContain("<PageHeader");
  });

  it("셸 = 앱과 같은 축: 데스크톱은 사이드바, 그 외는 상단 바 · 본문 하단 여백 규약", () => {
    const layout = FILES.find((f) => f.path === "src/app/(super-admin)/layout.tsx")!.src;
    expect(layout).toMatch(/<SuperAdminSidebar[^>]*className="hidden desk:flex"/);
    expect(layout).toMatch(/<SuperAdminMobileBar[^>]*className="desk:hidden"/);
    expect(layout).toContain("desk:flex-row");
    const main = layout.match(/<main className="([^"]*)"/)![1].split(" ");
    expect(main).toEqual(expect.arrayContaining(["pb-8", "lg:pb-10"]));
  });

  it("사이드바와 상단 바가 같은 메뉴 목록을 읽는다", () => {
    for (const name of ["sidebar.tsx", "mobile-bar.tsx"]) {
      const src = FILES.find((f) => f.path === `src/components/super-admin/${name}`)!.src;
      expect(src, name).toContain("SUPER_ADMIN_NAV");
      expect(src, name).not.toMatch(/href: "\/super-admin/);
    }
  });
});
