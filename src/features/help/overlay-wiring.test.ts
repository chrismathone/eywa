import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANUALS } from "./manuals";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, "src", p), "utf8");

describe("F1 겹침 배선", () => {
  it("셸 세 경로(창·미니셸·풀셸)에 ScreenHelpOverlay 가 있다", () => {
    const layout = read("app/(shell)/layout.tsx");
    const n = layout.split("<ScreenHelpOverlay").length - 1;
    expect(n).toBe(3);
    expect(layout).toContain("<ScreenHelpOverlay beneathWindows");
  });

  it("창 크롬에서 F1 이면 그 창 iframe 으로 넘긴다", () => {
    const overlay = read("components/help/screen-help-overlay.tsx");
    expect(overlay).toContain("eywa-help-toggle");
    expect(overlay).toContain("iframeRegistry");
    expect(read("components/workspace/floating-window.tsx")).toContain("data-window-id");
  });

  it("브라우저 기본 F1 을 preventDefault 한다", () => {
    expect(read("features/help/overlay-hotkey.ts")).toContain('e.key === "F1"');
    expect(read("components/help/screen-help-overlay.tsx")).toContain("preventDefault");
  });

  it("시간표 data-help 키는 manuals/timetable callouts 에 있다", () => {
    const keys = new Set(
      MANUALS.find((m) => m.slug === "timetable")?.callouts.map((c) => c.key).filter(Boolean),
    );
    const src = [
      read("app/(shell)/timetable/page.tsx"),
      read("app/(shell)/timetable/_components/week-nav.tsx"),
      read("app/(shell)/timetable/_components/student-tally.tsx"),
      read("app/(shell)/timetable/_components/class-cell.tsx"),
      read("app/(shell)/timetable/_components/reserved-section.tsx"),
      read("app/(shell)/timetable/_components/teacher-head-cell.tsx"),
      read("app/(shell)/timetable/_components/weekday-group-tables.tsx"),
    ].join("\n");
    const used = [...src.matchAll(/data-help="([^"]+)"/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(8);
    for (const k of used) {
      expect(keys.has(k), `시간표에 없는 키 ${k}`).toBe(true);
    }
  });

  it("화면에 붙인 data-help 는 그 화면 manuals 키다", () => {
    const files: { file: string; slug: string }[] = [
      { file: "app/(shell)/attendance/page.tsx", slug: "attendance" },
      { file: "app/(shell)/attendance/_components/matrix-table.tsx", slug: "attendance" },
      { file: "app/(shell)/students/page.tsx", slug: "students" },
      { file: "app/(shell)/dashboard/_overview/kpi-strip.tsx", slug: "dashboard" },
      { file: "features/onescreen/components/top-bar.tsx", slug: "onescreen" },
      // 🔴 도움말 허브 자신도 본다 — 2026-09-15에 설명서 목록을 되살리며 `helpAttr("help-guides")`를 붙였는데
      // manuals 에 그 키가 없어 **그 구역만 F1 번호가 조용히 안 섰다**(알약이 하나 빠졌을 뿐이라 눈에 안 띈다).
      { file: "app/(shell)/help/page.tsx", slug: "help" },
      { file: "app/(shell)/help/_help-browser.tsx", slug: "help" },
    ];
    for (const { file, slug } of files) {
      const keys = new Set(
        MANUALS.find((m) => m.slug === slug)?.callouts.map((c) => c.key).filter(Boolean),
      );
      const used = [
        ...read(file).matchAll(/data-help="([^"]+)"/g),
        ...read(file).matchAll(/helpKey="([^"]+)"/g),
        ...read(file).matchAll(/helpAttr\("([^"]+)"\)/g),
      ].map((m) => m[1]!);
      expect(used.length, file).toBeGreaterThan(0);
      for (const k of used) {
        expect(keys.has(k), `${file} 키 ${k} 는 ${slug} manuals 에 없음`).toBe(true);
      }
    }
  });

  it("강사뷰 영어 화면은 이번엔 한국어 그대로라는 한계를 적는다", () => {
    expect(read("components/help/screen-help-overlay.tsx")).toContain("teacher_view_lang");
  });

  it("운영실 kpi-strip 의 helpKey 는 dashboard manuals 키다", () => {
    const keys = new Set(
      MANUALS.find((m) => m.slug === "dashboard")?.callouts.map((c) => c.key).filter(Boolean),
    );
    const used = [...read("app/(shell)/dashboard/_overview/kpi-strip.tsx").matchAll(/helpKey="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(used.length).toBeGreaterThan(5);
    for (const k of used) expect(keys.has(k), k).toBe(true);
  });
});
