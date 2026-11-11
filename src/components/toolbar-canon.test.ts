import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SHEET_BAR, sheetPill, sheetSegItem } from "@/features/class-sheets/chrome";
import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_CHIP_ON,
  TOOLBAR_SEARCH_BOX,
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_BOX_WRAP,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON,
  TOOLBAR_SEG_ON_PRIMARY,
  TOOLBAR_SELECT,
} from "./toolbar-controls";

/**
 * 툴바 규약 가드 — *"앞으로 탭을 추가하더라도 일관성 생길 수 있게"*(원장 2026-09-01).
 *
 * 상수([`toolbar-controls.ts`](./toolbar-controls.ts))만 있으면 새 화면이 그걸 **모르고** 자기 클래스를
 * 손으로 적는다 — 2026-09-02 전수 감사에서 108건 중 **58건**이 그렇게 갈려 있었다(카드 껍데기 8 ·
 * 세로 패딩으로 만든 높이 28 · 알약 16 · 나머지 6). 그래서 규약을 세 겹으로 못박는다:
 * ① 부품([`toolbar.tsx`](./toolbar.tsx)) ② 이 가드 ③ 문서(`docs/design-conventions.md`).
 *
 * 🔑 판정은 **구역 한정**이다 — `<Toolbar>`…`</Toolbar>` 안과 규약 상수 자신만 본다.
 *    앱 전역에서 `rounded-full`을 잡으면 **본문 배지**(디자인 캐논상 알약이 맞다)와 패널 안쪽
 *    컨트롤까지 걸린다(실측 11곳, 감사에서 전부 반증됐다). 넓게 잡은 가드는 곧 무시된다.
 * ⚠️ `s`(dotAll) 플래그를 쓰지 말 것 — tsconfig target이 es2017이라 타입체크가 거절한다.
 */
const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");
const BACKSLASH = String.fromCharCode(92);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const FILES = walk(SRC);
const rel = (p: string) => p.slice(ROOT.length + 1).split(BACKSLASH).join("/");

const CONTROLS = readFileSync(join(SRC, "components/toolbar-controls.ts"), "utf8");
const CHROME = readFileSync(join(SRC, "features/class-sheets/chrome.ts"), "utf8");

/** `export const X = "…"` 의 **값**만 뽑는다(주석에 적힌 단어에 걸리지 않게). */
function exportedStrings(src: string): string[] {
  return [...src.matchAll(/export const [A-Z_]+\s*=\s*\n?\s*"([^"]*)"/g)].map((m) => m[1]!);
}

/**
 * `SHEET_SEG_BOX`는 규약 상수를 **문자열 치환**해 만든다 — 규약이 바뀌어 치환이 조용히 빗나가면
 * (no-op) 두 시트만 옛 모양으로 남는다. 그래서 테스트가 값을 다시 계산하지 않고 **같은 방식으로
 * 재현**해 결과를 확인한다.
 */
const SHEET_SEG_BOX = (() => {
  const box = /TOOLBAR_SEG_BOX\s*=\s*"([^"]*)"/.exec(CONTROLS)?.[1] ?? "";
  const expr = /SHEET_SEG_BOX\s*=\s*TOOLBAR_SEG_BOX\.replace\("([^"]*)",\s*"([^"]*)"\)/.exec(CHROME);
  return expr ? box.replace(expr[1]!, expr[2]!) : "";
})();

/**
 * `<Toolbar>` … `</Toolbar>` 구역을 잘라 낸다(중첩 허용).
 * ⚠️ `<ToolbarSegment`·`<ToolbarChip`은 여는 태그로 세지 않는다 — `Toolbar` 뒤가 단어 문자면 다른 부품이다.
 */
function toolbarRegions(src: string): string[] {
  const out: string[] = [];
  const open = /<Toolbar(?![A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    let depth = 0;
    const scan = /<Toolbar(?![A-Za-z])|<\/Toolbar>/g;
    scan.lastIndex = m.index;
    let t: RegExpExecArray | null;
    let closed = false;
    while ((t = scan.exec(src))) {
      depth += t[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        out.push(src.slice(m.index, t.index));
        open.lastIndex = t.index;
        closed = true;
        break;
      }
    }
    if (!closed) break; // 닫히지 않음 — 이 파일은 여기까지
  }
  return out;
}

/** 여는 태그의 className 값 + 그 요소의 태그 이름을 함께 뽑는다. */
type Attr = { tag: string; cls: string };
function classNames(region: string): Attr[] {
  const out: Attr[] = [];
  for (const m of region.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const cls = m[1] ?? m[2] ?? "";
    // ⚠️ 여는 태그를 `<Tag …>`로 통째로 집지 않는다 — 화살표 함수(`() => …`)의 `>`에서 잘려
    //    className까지 못 간다. className을 먼저 찾고 **뒤로 훑어** 그 요소의 태그를 읽는다.
    const head = region.slice(0, m.index);
    const open = [...head.matchAll(/<([A-Za-z][\w.]*)/g)].pop();
    out.push({ tag: open?.[1] ?? "?", cls });
  }
  return out;
}

/** 그 className이 붙은 요소가 **컨트롤**인가(누를 수 있거나 세그먼트 묶음인가). */
function isControl(region: string, cls: string, tag: string): boolean {
  const at = region.indexOf(`className={\`${cls}\``) >= 0 ? region.indexOf(`className={\`${cls}\``) : region.indexOf(`className="${cls}"`);
  const head = at >= 0 ? region.slice(Math.max(0, at - 400), at) : "";
  return (
    /^(button|a|input|select|Link|Button)$/.test(tag) ||
    /\.Trigger$/.test(tag) ||
    /\bonClick=|\bhref=/.test(head) ||
    // 세그먼트 묶음 지문. ⚠️ 경계를 요구한다 — `gap-0.5`가 부분문자열로 걸린다.
    /(^|\s)p-0\.5(\s|$)/.test(cls)
  );
}

describe("툴바 규약 — 값(단일 소스)", () => {
  it("높이는 control-scale 한 값이다 — h-(--control-h), 세로 패딩으로 만들지 않는다", () => {
    // 🔴 이 셋이 툴바 한 줄에 나란히 선다 — 하나라도 다르면 줄이 울퉁불퉁해진다.
    //    2026-09-03: "h-8 고정"은 원장의 90% 규칙(라벨이 높이의 90%)으로 대체 — 높이는 라벨에서 도출(globals.css --control-*).
    expect(CONTROLS).toMatch(/TOOLBAR_SELECT\s*=\s*\n?\s*"[^"]*\bh-\(--control-h\)/);
    expect(CONTROLS).toMatch(/TOOLBAR_SEG_BOX\s*=\s*"[^"]*\bh-\(--control-h\)/);
    expect(CONTROLS).toMatch(/TOOLBAR_CHIP\s*=\s*\n?\s*"[^"]*\bh-\(--control-h\)/);
    // 줄바꿈되는 묶음은 한 줄일 때 같은 높이여야 다른 묶음과 나란히 선다.
    expect(CONTROLS).toMatch(/TOOLBAR_SEG_BOX_WRAP\s*=\s*\n?\s*"[^"]*\bmin-h-\(--control-h\)/);
    // 라벨은 control-scale 토큰(18px·leading-none) — 화면마다 text-xs/sm을 손으로 적던 것을 막는다.
    for (const name of ["TOOLBAR_SELECT", "TOOLBAR_SEG_ITEM", "TOOLBAR_CHIP", "TOOLBAR_SEARCH_BOX"]) {
      expect(CONTROLS).toMatch(new RegExp(name + "\\s*=\\s*\\n?\\s*\"[^\"]*text-\\(length:--control-label\\) leading-none"));
    }
  });

  it("라운드는 덜 둥근 쪽 — 묶음 lg / 안쪽 칩 md, 알약은 안 쓴다", () => {
    expect(CONTROLS).toMatch(/TOOLBAR_SEG_BOX\s*=\s*"[^"]*\brounded-lg\b/);
    expect(CONTROLS).toMatch(/TOOLBAR_SEG_ITEM\s*=\s*\n?\s*"[^"]*\brounded-md\b/);
    expect(CONTROLS).toMatch(/TOOLBAR_CHIP\s*=\s*\n?\s*"[^"]*\brounded-lg\b/);
    // 규약 상수 자체에 알약이 섞이면 소비처 전체가 한 번에 갈린다.
    // ⚠️ **문자열 값만** 본다 — 주석은 "알약을 쓰지 않는다"고 적으려고 그 단어를 쓴다.
    expect(exportedStrings(CONTROLS).filter((v) => /rounded-(full|pill)/.test(v))).toEqual([]);
  });

  it("강사 시트(ECS·MCS)는 같은 규약을 색만 바꿔 쓴다", () => {
    expect(SHEET_SEG_BOX).toContain("border-line-strong");
    expect(SHEET_SEG_BOX).toContain("h-(--control-h)");
    expect(SHEET_SEG_BOX).toContain("rounded-lg");
    expect(SHEET_SEG_BOX).not.toContain("border-line ");
    // 상단 바에 카드 껍데기가 없다.
    const bar = /SHEET_BAR\s*=\s*\n?\s*"([^"]*)"/.exec(CHROME)?.[1] ?? "";
    expect(bar).not.toBe("");
    for (const banned of ["bg-card", "shadow-card", "rounded-2xl"]) expect(bar).not.toContain(banned);
  });
});

describe("툴바 규약 — <Toolbar> 구역", () => {
  const regions = FILES.flatMap((f) => toolbarRegions(readFileSync(f, "utf8")).map((r) => [rel(f), r] as const));

  it("툴바 줄을 부품으로 쓴다 (구역 가드가 빈 채로 통과하지 않게)", () => {
    expect(regions.length).toBeGreaterThanOrEqual(4);
  });

  it("컨트롤에 알약(rounded-full·rounded-pill)을 쓰지 않는다", () => {
    // 🔑 **컨트롤만** 본다 — 툴바 줄에는 읽기 전용 배지("마감 12/34" 같은 것)도 서고, 그건
    //    디자인 캐논상 알약이 맞다("칩 = full"은 본문 배지 규칙이다).
    const bad: string[] = [];
    for (const [f, region] of regions) {
      for (const { tag, cls } of classNames(region)) {
        if (!/rounded-(full|pill)/.test(cls)) continue;
        if (isControl(region, cls, tag)) bad.push(`${f}: <${tag}> ${cls.slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("카드 껍데기를 두지 않는다", () => {
    // ⚠️ 구역 **첫 태그**(=`<Toolbar …>` 자신)만 본다 — 툴바 안에 카드를 든 자식이 있을 수 있다.
    const head = new RegExp("^<Toolbar[^>]*(bg-card|shadow-card|rounded-2xl)");
    const bad = regions.filter(([, r]) => head.test(r)).map(([f]) => f);
    expect(bad).toEqual([]);
  });

  it("치수를 className으로 덮어쓰지 않는다 (그러면 규약이 아니라 기본값일 뿐이다)", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<Toolbar[A-Za-z]*\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2] ?? "";
        if (/(^|\s)(h-\d|rounded-\w+|py-[\d.]+)/.test(cls)) bad.push(`${rel(f)}: ${cls.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * 이미 규약으로 옮긴 툴바 표면 — **되돌아가지 않게** 잠근다(ratchet).
 *
 * 🔑 새 화면을 만들면 이 목록에 **추가**한다. 목록에 없다고 규약 밖인 게 아니라, 여기 있는 것은
 *    "한 번 갈렸다가 고친 자리"라 특히 되돌아가기 쉬운 곳이다.
 * ⚠️ 판정은 "규약을 **읽고 있는가**"다(상수·부품·시트 chrome import 중 하나). 클래스 문자열을
 *    통째로 비교하면 정당한 색 변경까지 막혀서 곧 지워진다.
 */
const CANON_SURFACES = [
  // 원생상담 통계 · 담임별 상담 현황 골라 보기(2026-10-27).
  "src/app/(shell)/consultations/_components/stats/stats-homeroom-filters.tsx",
  "src/features/makeups/components/list-toolbar.tsx",
  "src/app/(shell)/makeups/candidates/page.tsx",
  // 학원 설정 '대시보드 관리'(2026-10-01) — 역할 고르기·편집 동작 줄.
  "src/app/(shell)/owner/_components/dashboard/editor-toolbar.tsx",
  // 영상 제출 현황(2026-10-01) — 툴바가 화면 파일에서 ledger-toolbar.tsx로 갈라졌다(반 다중 선택).
  "src/features/video-homework/components/ledger-toolbar.tsx",
  "src/app/(shell)/exams/_components/exams-toolbar.tsx",
  "src/app/(shell)/exams/view/page.tsx",
  "src/app/(shell)/exams/_components/view-switch.tsx",
  "src/app/(shell)/ecs/goals/page.tsx",
  "src/app/(shell)/ecs/goals/_components/goals-role-switch.tsx",
  "src/features/onescreen/components/top-bar.tsx",
  "src/features/ijw/components/jj-range-bar.tsx",
  "src/app/(shell)/timetable/page.tsx",
  "src/app/(shell)/timetable/_components/view-settings.tsx",
  "src/app/(shell)/timetable/_components/toolbar-actions.tsx",
  "src/app/(shell)/timetable/_components/teacher-order-dialog.tsx",
  "src/app/(shell)/timetable/_components/timetable-board.tsx",
  "src/app/(shell)/attendance/seat/[seat]/page.tsx",
  "src/app/(shell)/attendance/seat/[seat]/month/page.tsx",
  "src/app/(shell)/attendance/seat/[seat]/_components/seat-board.tsx",
  "src/features/attendance/components/subject-filter-chips.tsx",
  "src/app/(shell)/students/[id]/_tabs/attendance-view.tsx",
  "src/app/(shell)/students/[id]/_tabs/billing-view.tsx",
  "src/app/(shell)/students/[id]/_tabs/timeline-view.tsx",
  "src/app/(shell)/enrollment/page.tsx",
  "src/app/(shell)/staff/[id]/_components/monthly-schedule-view.tsx",
  "src/features/class-sheets/components/sheet-toolbar.tsx",
  "src/features/class-sheets/components/sheet-chrome.tsx",
  "src/features/class-sheets/components/seat-day-face.tsx",
  "src/features/math-sheets/components/month-client.tsx",
  "src/app/(shell)/retention/board/page.tsx",
  "src/app/(shell)/newcomers/_components/newcomer-board.tsx",
  "src/app/(shell)/owner/_components/audit-face.tsx",
  // 탭 및 메뉴 구성(2026-09-22) — 관리자뷰·강사뷰 전환이 부품(ToolbarSegment)으로.
  "src/app/(shell)/owner/_components/navigation-section.tsx",
  "src/app/(shell)/class-review/_components/review-table.tsx",
  "src/app/(shell)/class-review/template/page.tsx",
  // 직원 포트폴리오(2026-10-13, 새 면) — 평가 기간·평가 기준·지금 집계가 부품으로.
  "src/app/(shell)/class-review/_components/portfolio/portfolio-board.tsx",
  "src/app/(shell)/documents/_components/document-toolbar.tsx",
  // 수학 학습 진도맵(2026-09-14, 새 화면·시안) — 보기 단위 선택이 부품으로.
  "src/features/math-progress-map/components/period-selector.tsx",
  // 교재목록(2026-09-16, 새 화면) — 만들 때부터 부품으로.
  "src/app/(shell)/textbooks/_components/books-face.tsx",
  "src/app/(shell)/textbooks/_components/plans-face.tsx",
  // 성적관리(2026-09-22, 격자로 다시 지음) — 년도·학기·과목·반·시험 드롭다운이 전부 부품이다.
  "src/app/(shell)/exams/input/page.tsx",
  // 재고관리(2026-09-02, 새 화면) — 만들 때부터 부품으로.
  "src/app/(shell)/inventory/_components/assets-face.tsx",
  "src/app/(shell)/inventory/_components/list-toolbar.tsx",
  "src/app/(shell)/inventory/_components/vendors-face.tsx",
  // 연차 관리(2026-09-08, 새 화면) — 만들 때부터 부품으로. 자리는 직원관리(원장 2026-09-09).
  "src/app/(shell)/staff/annual-leave/_adjust-table.tsx",
  // 직원관리(2026-09-09) — 필터 줄·결과 줄이 손으로 적은 flex였다(좁아지면 검색만 둘째 줄 오른쪽에 떨어짐).
  "src/app/(shell)/staff/page.tsx",
  "src/app/(shell)/meetings/page.tsx",
  "src/app/(shell)/withdrawals/page.tsx",
  // 퇴원보고서(2026-10-14) — 기존 스프레드시트 기록을 한 목록에 합치며 상태·기간·과목·작성 강사 드롭다운과 미연결 칩을 부품으로.
  "src/app/(shell)/withdrawal-reports/_components/list-toolbar.tsx",
  // 슈퍼관리자(2026-09-25 전면 정리) — 손으로 적은 GET 폼·필터 줄을 부품으로(영역 가드: super-admin-design.test.ts).
  "src/app/(super-admin)/super-admin/tenants/page.tsx",
  "src/app/(super-admin)/super-admin/audit/page.tsx",
  // 수납(2026-09-04, 14단계) — 월 네비 부품·면 툴바가 부품을 읽는다(수납 면·환불·정산은 BillingMonthNav 경유라 직접 import 없음).
  "src/app/(shell)/billing/_components/billing-month-nav.tsx",
  "src/app/(shell)/billing/_components/calculator-panel.tsx",
  "src/app/(shell)/billing/_components/catalog-panel.tsx",
  "src/app/(shell)/billing/_components/expenses-panel.tsx",
  "src/app/(shell)/billing/_components/session-terms-face.tsx",
  "src/app/(shell)/billing/_components/session-verification-face.tsx",
  "src/app/(shell)/billing/_components/textbooks-panel.tsx",
  "src/app/(shell)/billing/_components/tuition-prices-panel.tsx",
  // 캘린더(2026-09-04, 15단계) — 보기·태그 드롭다운 + PeriodNav.
  "src/app/(shell)/calendar/page.tsx",
  // 새 탭 디자인 통일(2026-11-11) — 자체 머리 판·자체 탭 단추를 걷고 Toolbar·ToolbarSegment·PeriodNav로.
  "src/features/marketing-archive/workspace.tsx",
  "src/features/organization-okr/workspace.tsx",
  "src/features/work-records/workspace.tsx",
  "src/features/academy-knowledge/workspace.tsx",
  "src/features/academy-knowledge/record-workspace.tsx",
  "src/features/management/workspace.tsx",
  "src/features/enrollment/journey/workspace.tsx",
  "src/features/newcomers/followup-workspace.tsx",
  "src/features/teacher-hub/workspace.tsx",
  "src/features/student-contribution/components/factor-workspace.tsx",
];

describe("툴바 규약 — 옮긴 표면은 되돌아가지 않는다", () => {
  it.each(CANON_SURFACES)("%s 가 규약을 읽는다", (f) => {
    const src = readFileSync(join(ROOT, f), "utf8");
    const readsCanon =
      src.includes("@/components/toolbar-controls") ||
      src.includes("@/components/toolbar") ||
      // 규약 치수를 **부품 안에서** 읽는 공용 컨트롤 — 화면이 이것만 써도 규약을 지킨 것이다
      // (치수를 손으로 안 적는 게 이 가드의 목적이다).
      src.includes("@/components/href-select") ||
      src.includes("@/components/period-nav") ||
      /from "(\.\.\/)+chrome"/.test(src) ||
      src.includes("@/features/class-sheets/chrome");
    expect(readsCanon).toBe(true);
  });
});

/**
 * 같은 축 유틸이 **겹치지 않는지** — 겹치면 승자를 문자열 순서가 아니라 **생성된 CSS 순서**가
 * 정해서 눈으로 못 읽는 버그가 된다([[#116]]).
 *
 * 🔑 이 가드는 실제로 값을 했다: 규약을 옮기면서 `sheetSegItem`이 `font-bold`(이 화면) +
 *    `font-medium`(`TOOLBAR_SEG_ON_PRIMARY`)를, 면 전환 칩이 `px-3.5` + `px-2.5`(`TOOLBAR_SEG_ITEM`)를
 *    함께 내보내고 있었다. 타입체크·빌드·테스트는 전부 통과했다.
 * ⚠️ 축은 **모호하지 않은 것만** 본다 — `text-`는 크기와 색이 섞이고 `border-`는 굵기·색·모양이
 *    섞여서, 넣으면 정상 조합을 오탐한다.
 */
function duplicateAxes(cls: string): string[] {
  // ⚠️ 짧은 쪽(`p-2`·`gap-3`)은 **두 축을 한꺼번에** 정한다 — `p-0.5 px-2`는 진짜 충돌이고
  //    `gap-x-3 gap-y-2`는 충돌이 아니다(column-gap ↔ row-gap). 그래서 축을 나눠 적는다.
  const AXES: [string, RegExp][] = [
    ["height", /^h-/],
    ["padding-x", /^(px-|p-[\d.]|p-\[)/],
    ["padding-y", /^(py-|p-[\d.]|p-\[)/],
    ["gap-x", /^(gap-x-|gap-[\d.]|gap-\[)/],
    ["gap-y", /^(gap-y-|gap-[\d.]|gap-\[)/],
    ["radius", /^rounded-(none|xs|sm|md|lg|xl|2xl|3xl|full|pill)$/],
    ["font-weight", /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/],
  ];
  const seen = new Map<string, string[]>();
  for (const raw of cls.split(/\s+/).filter(Boolean)) {
    // 변형(`hover:`·`compact-chrome:`…)은 다른 조건이라 축이 겹치지 않는다.
    if (raw.includes(":")) continue;
    for (const [axis, re] of AXES) {
      if (!re.test(raw)) continue;
      seen.set(axis, [...(seen.get(axis) ?? []), raw]);
    }
  }
  return [...seen].filter(([, v]) => v.length > 1).map(([axis, v]) => `${axis}: ${v.join(" + ")}`);
}

describe("툴바 규약 — 같은 축 유틸이 겹치지 않는다 (#116)", () => {
  it.each([
    ["TOOLBAR_SELECT", TOOLBAR_SELECT],
    ["TOOLBAR_SEG_BOX", TOOLBAR_SEG_BOX],
    ["TOOLBAR_SEG_BOX_WRAP", TOOLBAR_SEG_BOX_WRAP],
    ["TOOLBAR_SEG_ITEM + ON", `${TOOLBAR_SEG_ITEM} ${TOOLBAR_SEG_ON}`],
    ["TOOLBAR_SEG_ITEM + ON_PRIMARY", `${TOOLBAR_SEG_ITEM} ${TOOLBAR_SEG_ON_PRIMARY}`],
    ["TOOLBAR_SEG_ITEM + OFF", `${TOOLBAR_SEG_ITEM} ${TOOLBAR_SEG_OFF}`],
    ["TOOLBAR_CHIP + ON", `${TOOLBAR_CHIP} ${TOOLBAR_CHIP_ON}`],
    ["TOOLBAR_CHIP + OFF", `${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`],
    ["TOOLBAR_SEARCH_BOX", TOOLBAR_SEARCH_BOX],
    ["SHEET_BAR", SHEET_BAR],
    ["sheetPill(true)", sheetPill(true)],
    ["sheetPill(false)", sheetPill(false)],
    ["sheetSegItem(true)", sheetSegItem(true)],
    ["sheetSegItem(false)", sheetSegItem(false)],
  ])("%s", (_name, cls) => {
    expect(duplicateAxes(cls)).toEqual([]);
  });
});
