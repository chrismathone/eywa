import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **왼쪽 색 띠 금지** — 원장 2026-09-16: *"왼쪽에 이렇게 테두리? 같은거 표시하는거 싹다 제거해. 이거 Ai 공통
 * 디자인인가"* → *"대부분이라는 말은 Ai 제작시에 말이란 뜻"*.
 *
 * 카드·타일·알림 상자의 왼쪽에 굵은 색 띠를 두르는 것은 AI가 만든 화면에 흔한 장식이다. 앱에서 전부 걷어냈고
 * 뜻은 배경색·글자색·문구가 말한다. 🔑 **새 화면을 AI가 만들면 이게 또 들어온다** — 그래서 가드로 잠근다.
 *
 * 🔑 **띠는 테두리로만 그려지지 않는다** — 원장 눈엔 셋 다 같은 물건이다(적대 리뷰 2026-09-16이 둘을 더 찾았다):
 *    ① 굵은 왼쪽 테두리(`border-l-4` · `border-left: 3px`) ② 그림자(`box-shadow: inset 3px 0` · `shadow-[inset_3px_0…]`)
 *    ③ 절대위치 막대(`absolute inset-y-0 left-0 w-[5px]` — 창 전환 카드의 '책등'이 그랬다).
 * ⚠️ **구조선은 대상이 아니다** — 표의 열 구분선처럼 칸과 칸 사이를 가르는 **1px** 선은 장식이 아니다.
 * ⚠️ 뜻을 띠 **하나로만** 나르던 자리는 빼기만 하면 뜻이 사라진다 — 다른 표시로 바꿀 것
 *    (영어 시트 달력 '목표 밖 교재' 줄 = 옅은 앰버 바탕, 원스크린 타일 = tone별 옅은 바탕).
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** 손대지 않는 곳 — 홍보 페이지 · 종이 서식. */
const SKIP_DIRS = ["(marketing)", "(print)"];

/**
 * 막지 않는 **줄**과 이유. 파일 통째로 허용하지 않는다 — 그러면 그 파일에 새 띠가 들어와도 못 잡는다.
 * 이유를 못 적겠으면 넣지 말고 띠를 뺄 것. 각 항목은 **실제로 한 줄 이상에 걸려야** 한다(죽은 항목 금지).
 */
const ALLOWED: { file: string; line: RegExp; reason: string }[] = [
  // ── 2026-11-10 P0-3b 정리 — 띠가 아닌 다섯 줄 ──
  {
    file: "app/(shell)/dashboard/_instruments/instruments.css",
    line: /\.tree-toggle::before \{ content: ''; display: block; width: 0; height: 0;/,
    reason: "폴더 펼침 삼각형 — 폭·높이 0인 요소의 테두리로 그리는 도형이지 띠가 아니다",
  },
  {
    file: "app/(shell)/dashboard/_instruments/work/work.css",
    line: /\.picker-group summary::before \{ content: ''; width: 0; height: 0;/,
    reason: "묶음 펼침 삼각형 — 폭·높이 0인 요소의 테두리로 그리는 도형이지 띠가 아니다",
  },
  {
    file: "features/onescreen/components/monthly-report-sheet.module.css",
    line: /^\s*border-left: 14px solid var\(--eie-red\);/,
    reason: "EiE 월간 보고서 지면의 양쪽 테두리(오른쪽도 같은 굵기) — 시트를 본뜬 종이 틀이지 카드의 왼쪽 강조 띠가 아니다",
  },
  {
    file: "features/student-contribution/components/loyalty-ranking.module.css",
    line: /\.dropTarget\{box-shadow:inset 3px 0 0 #fdb811\}/,
    reason: "열을 끌어 옮길 때 '여기에 끼워진다'는 삽입 위치 표시 — 끄는 동안에만 선다(teacher-head-cell과 같은 성격)",
  },
  {
    file: "features/teacher-hub/workspace.module.css",
    line: /\.branches \{ display: grid;.*border-left: 2px solid #c3c8c5; padding-left: 20px;/,
    reason: "강사 허브 갈래 묶음의 줄기선 — 위 갈래와 아래 가지를 잇는 나무 구조선이지 카드 강조 띠가 아니다",
  },
  {
    file: "app/(shell)/timetable/_components/weekday-group-tables.tsx",
    line: /GROUP_DIVIDER = "border-l-2/,
    reason: "시간표 요일 그룹 사이의 경계선 — 칸과 칸 사이를 가르는 구조선",
  },
  {
    file: "features/timetable-memo/ui/split-panes.tsx",
    line: /className="border-line-strong min-h-0 border-l-2 pl-3"/,
    reason: "영어 시간표 판과 오른쪽 메모 시트 판 사이의 경계선 — 두 판을 가르는 구조선(원장 2026-10-19 '구분해서 침범하지 않게')",
  },
  {
    file: "features/timetable-lab/editor/timetable-views.css",
    line: /\.week-teacher-heading \{.*border-left-width: 2px/,
    reason: "시간표 편집기 강사 열 머리의 경계선 — 운영 시간표와 같은, 강사와 강사 사이를 가르는 구조선",
  },
  {
    file: "features/timetable-lab/editor/timetable-views.css",
    line: /\.teacher-start \{ border-left: 2px solid #777/,
    reason: "시간표 편집기에서 강사가 바뀌는 첫 요일 칸의 경계선 — 칸과 칸 사이를 가르는 구조선",
  },
  {
    file: "app/(shell)/attendance/seat/[seat]/_components/seat-mark-extras.tsx",
    line: /border-t-\[10px\] border-l-\[10px\].*border-l-transparent/,
    reason: "모서리 삼각형 — 두 변의 테두리로 그리는 도형이지 띠가 아니다(왼쪽 변은 투명)",
  },
  {
    file: "app/(shell)/timetable/_components/teacher-head-cell.tsx",
    line: /shadow-\[inset_-?3px_0_0_var\(--primary\)\]/,
    reason: "드래그로 강사 열을 옮길 때 '여기에 끼워진다'는 삽입 위치 표시 — 끄는 동안에만 선다",
  },
  {
    file: "features/timetable-lab/editor/editor-tools.css",
    line: /^\.integrated-class\[data-class-drop=(before|after)\] \.class-name-row \{ box-shadow: inset -?4px 0 /,
    reason: "시간표 편집기 통합뷰에서 반을 끌어 순서를 바꿀 때 '이 반의 앞/뒤에 놓인다'는 삽입 위치 표시 — 끄는 동안에만 선다(teacher-head-cell과 같은 성격)",
  },
  {
    file: "components/ui/sidebar.tsx",
    line: /after:w-\[2px\] hover:after:bg-sidebar-border/,
    reason: "shadcn 사이드바 크기 조절 손잡이 — 마우스를 올릴 때만 2px 선이 뜬다(이 부품은 앱에서 안 쓰인다)",
  },
  {
    file: "app/globals.css",
    line: /border-left: 3px solid var\(--line\)/,
    reason: "`.rich-content blockquote` — 사용자가 쓴 글의 인용문 서식(화면 장식이 아니라 글의 구조)",
  },
];

/** 길이 문자열이 '굵은' 선인가 — 1px 구조선은 통과. 모르는 단위(색·var)는 판정하지 않는다. */
function thick(value: string): boolean {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim());
  if (!m) return false;
  const n = Math.abs(Number(m[1]));
  const unit = m[2] ?? "tw"; // 단위 없음 = Tailwind 숫자(= px)
  return unit === "rem" || unit === "em" ? n >= 0.1 : n >= 1.5;
}

/** Tailwind — `border-l-4` · `border-s-[3px]` · `border-l-[0.25rem]`. */
function tailwindThickLeft(line: string): boolean {
  for (const m of line.matchAll(/(?<![\w-])border-(?:l|s)-(\d+(?:\.\d+)?|\[[^\]]+\])(?![\w-])/g)) {
    const raw = m[1]!;
    if (thick(raw.startsWith("[") ? raw.slice(1, -1) : raw)) return true;
  }
  return false;
}

/** Tailwind 그림자 띠 — `shadow-[inset_3px_0…]`(x만 있고 y가 0 = 세로 막대). */
function tailwindShadowStripe(line: string): boolean {
  for (const m of line.matchAll(/shadow-\[inset_(-?\d+(?:\.\d+)?)px_0(?:[_\]])/g)) {
    if (Math.abs(Number(m[1])) >= 1.5) return true;
  }
  return false;
}

/** 절대위치 막대 — 한 className에 `inset-y-0`·`left-0`·가는 폭이 함께 선다. */
function absoluteStripe(line: string): boolean {
  return (
    /(?<![\w-])inset-y-0(?![\w-])/.test(line) &&
    // 끝 경계에 `/`·`.`도 막는다 — 안 막으면 `w-1/2`(반폭)·`left-0.5`를 `w-1`·`left-0`으로 읽는다(재리뷰 실측).
    /(?<![\w-])(?:left-0|start-0)(?![\w/.-])/.test(line) &&
    /(?<![\w-])w-(?:0\.5|1|1\.5|\[\s*[1-8](?:\.\d+)?px\s*\])(?![\w/.-])/.test(line)
  );
}

/** CSS — `border-left: 3px …` · `solid 3px` 순서 · `border-inline-start` · `box-shadow: inset 3px 0`. */
function cssStripe(line: string): boolean {
  const border = /border-(?:left|inline-start)(?:-width)?\s*:\s*([^;]+)/.exec(line);
  if (border && border[1]!.split(/\s+/).some(thick)) return true;
  const shadow = /box-shadow\s*:[^;]*\binset\s+(-?\d+(?:\.\d+)?)px\s+0(?:px)?\b/.exec(line);
  return !!shadow && Math.abs(Number(shadow[1])) >= 1.5;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || SKIP_DIRS.includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function stripeLines(): { key: string; no: number; text: string }[] {
  const hits: { key: string; no: number; text: string }[] = [];
  for (const file of walk(SRC)) {
    const key = relative(SRC, file).split(sep).join("/");
    const css = file.endsWith(".css");
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((text, i) => {
        const hit = css ? cssStripe(text) : tailwindThickLeft(text) || tailwindShadowStripe(text) || absoluteStripe(text);
        if (hit) hits.push({ key, no: i + 1, text });
      });
  }
  return hits;
}

/** 전수 스캔은 **한 번만** — 두 테스트가 각자 돌리면 병렬 스위트에서 한도 여유가 반으로 준다(아이콘 가드 12→38초 전례). */
let scanned: ReturnType<typeof stripeLines> | null = null;
const scan = () => (scanned ??= stripeLines());

const allowedBy = (hit: { key: string; text: string }) =>
  ALLOWED.find((a) => a.file === hit.key && a.line.test(hit.text));

describe("왼쪽 색 띠 금지", () => {
  it(
    "🔴 카드·알림에 왼쪽 띠를 두르지 않는다 — 테두리·그림자·절대위치 막대 어느 것으로도",
    () => {
      const offenders = scan()
        .filter((hit) => !allowedBy(hit))
        .map((hit) => `${hit.key}:${hit.no}  ${hit.text.trim().slice(0, 90)}`);
      expect(offenders).toEqual([]);
    },
    60_000, // 전수 스캔 — 전체 스위트 병렬에선 기본 5초를 넘긴다(2026-09-16 실측)
  );

  it(
    "허용 목록의 각 항목은 실제로 한 줄 이상에 걸린다 — 죽은 항목이 이유를 달고 남지 않게",
    () => {
      const hits = scan();
      for (const allow of ALLOWED) {
        expect(allow.reason.length, `${allow.file}의 이유`).toBeGreaterThan(10);
        expect(hits.some((h) => h.key === allow.file && allow.line.test(h.text)), `${allow.file} — 걸리는 줄이 없다`).toBe(true);
      }
    },
    60_000,
  );

  it("잡을 것과 안 잡을 것", () => {
    // 굵은 왼쪽 테두리 — 소수·두 자리·rem·논리 속성까지(적대 리뷰가 찾은 구멍)
    for (const bad of ["border-l-[3px]", "border-l-4", "border-l-2", "border-l-10", "border-l-[2.5px]", "border-s-4", "border-l-[0.25rem]"]) {
      expect(tailwindThickLeft(`rounded ${bad} px-3`), bad).toBe(true);
    }
    for (const ok of ["border-l", "border-l-0", "border-l-[1px]", "border-l-green", "[&_tr>*:not(:first-child)]:border-l"]) {
      expect(tailwindThickLeft(`x ${ok} y`), ok).toBe(false);
    }
    expect(tailwindShadowStripe("shadow-[inset_3px_0_0_var(--primary)]")).toBe(true);
    expect(tailwindShadowStripe("shadow-[inset_0_-2px_0_var(--amber)]")).toBe(false); // 밑줄은 띠가 아니다
    expect(absoluteStripe("absolute inset-y-0 left-0 w-[5px] rounded-l-md")).toBe(true);
    expect(absoluteStripe("absolute inset-y-1.5 right-0 w-3.5")).toBe(false);
    expect(absoluteStripe("absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r")).toBe(false); // 반폭 페이드
    expect(absoluteStripe("absolute inset-y-0 left-0.5 w-8")).toBe(false);
    for (const bad of ["border-left: 3px solid red;", "border-left: solid 3px red;", "border-left: 10px solid;", "border-left: 2.5px solid;", "border-inline-start: 3px solid;", "box-shadow: inset 3px 0 #174481;"]) {
      expect(cssStripe(bad), bad).toBe(true);
    }
    for (const ok of ["border-left: 1px solid var(--line);", "box-shadow: inset 0 -2px 0 red;", "box-shadow: 0 1px 2px rgba(0,0,0,.1);"]) {
      expect(cssStripe(ok), ok).toBe(false);
    }
  });
});
