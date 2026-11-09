/**
 * 레지스트리 가드 — 운영실의 **모든 카드와 KPI 칸**이 편집기 팔레트(registry)에 있고, 서버 조회 표·화면 제목 배선과 어긋나지 않는다.
 * 새 카드를 운영실에 더하고 여기를 안 고치면 "있는데 못 넣는 카드"(갤러리에 없음)나 "배치에 넣어도 데이터가 안 오는 카드"가 된다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KPI_KEYS, type PanelId } from "@/features/dashboard/overview/layout";
import { AREA_MENUS, CARDS, cardDef, defaultPreset, presetOf } from "./registry";
import { summaryOf } from "./summary";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const SERVER = read("src/features/dashboard/overview/server.ts");
const OVERVIEW = read("src/app/(shell)/dashboard/_overview/overview.tsx");
const LAYOUT = read("src/features/dashboard/overview/layout.ts");

const PANEL_IDS = [...LAYOUT.matchAll(/^\s+\| "(\w+)";?\r?$/gm)].map((m) => m[1]!).filter((k) => !KPI_KEYS.includes(k as never)) as PanelId[];

describe("레지스트리 = 운영실 카드 전부", () => {
  it("KPI 10칸(옛 9칸 + 오늘 입테) + PanelId 전부가 한 번씩", () => {
    const ids = CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith("kpi:"))).toEqual([...KPI_KEYS, "todayTests"].map((k) => `kpi:${k}`));
    expect(PANEL_IDS.length).toBeGreaterThanOrEqual(24);
    // 대시보드에서 뺀 카드(registry RETIRED_PANELS)는 갤러리에 없다 — 강사별 업무 현황 → 직원 평가 '업무 현황'(2026-10-30).
    for (const p of PANEL_IDS) {
      if (p === "teacherWork") expect(cardDef(`panel:${p}`), p).toBeUndefined();
      else expect(cardDef(`panel:${p}`), p).toBeDefined();
    }
  });

  it("서버 add(영역, 메뉴)와 영역-메뉴 표가 같다(배치 필터가 서버 조회와 어긋나지 않게)", () => {
    const calls = [...SERVER.matchAll(/(?<![\w.])add(?:Sliced)?\("(\w+)", \[([^\]]*)\]/g)].map((m) => [m[1]!, m[2]!.match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)) ?? []] as const);
    expect(calls.length).toBe(Object.keys(AREA_MENUS).length);
    for (const [area, menus] of calls) expect(AREA_MENUS[area as keyof typeof AREA_MENUS], area).toEqual(menus);
  });

  it("🔴 서버 add()는 조회 계획(loadPlan) 밖의 영역을 조회하지 않는다", () => {
    expect(SERVER).toMatch(/function add<[\s\S]*?\{\s*if \(!needed\.has\(area\)\) return;/);
    expect(SERVER).toContain("const needed = loadPlan(view, new Set(allowed));");
    // 원장 시점 전체(full)는 편집기 미리보기 전용 — 갱신 서버 액션은 인자를 받지 않는다.
    expect(read("src/features/dashboard/overview/actions.ts")).toMatch(/export async function refreshOverview\(\)\s*\{\s*return loadOverview\(\);/);
    // 값 정리는 직렬화 전에 서버가
    expect(SERVER).toMatch(/options\.full \? sections : shapeSections\(/);
  });

  it("카드마다 기본 크기가 허용 크기 안에 있다", () => {
    for (const c of CARDS) expect(presetOf(c, c.size), c.id).toEqual(defaultPreset(c));
  });

  it("모든 패널 제목이 배치 제목 바꾸기(t)를 지난다 — 이름을 바꿔도 화면이 안 따라오는 카드가 없게", () => {
    for (const p of PANEL_IDS) expect(OVERVIEW, p).toContain(`t("${p}", `);
  });

  it("요약형을 지원하는 카드는 데이터가 있으면 값을 내고, 없으면 null('—'로 그린다)", () => {
    const empty = { today: "2026-10-01", subjects: {}, sections: {} } as unknown as OverviewSnapshot;
    for (const c of CARDS) expect(summaryOf(c.id, empty), c.id).toBeNull();
    const ok = <T,>(data: T) => ({ data, at: 1, error: false });
    const full = {
      today: "2026-10-01",
      subjects: { math: "수학" },
      sections: {
        students: ok({ enrolled: 3, subjects: [], levels: [], schools: [], concurrent: 0, programs: {}, gradeSplit: { rows: [], neither: 0 } }),
        changes: ok([{ month: "2026-10", enrolled: 2, withdrawn: 1 }]),
        earlyExits: ok({ month: "2026-10", months: ["2026-10"], rows: [], history: [] }),
        enrolledTrend: ok({ monthly: [{ key: "2026-10", count: 3 }], yearly: [], recordsFrom: null }),
        courses: ok({ total: 5, programs: { eie: 0, injaewon: 0, math: 5 }, perStudent: [] }),
        courseTrend: ok({ monthly: [{ key: "2026-10", count: 5 }], yearly: [], trustFrom: null, monthlyFrom: null }),
        withdrawals: ok({ month: "2026-10", rows: [] }),
        intake: ok([]),
        enrolledToday: ok([]),
        firstClass: ok([]),
        absent: ok({ from: "2026-09-23", to: "2026-09-29", students: [] }),
        makeup: ok({ rows: [] }),
        attendance: ok({ total: 1, present: 1, late: 0, absent: 0, excused: 0 }),
        attendanceTrend: ok([{ date: "2026-10-01", rate: 90, total: 1 }]),
        billing: ok([{ totalCount: 1, paidCount: 1, partialCount: 0, unpaidCount: 0, outstanding: 0, totalBilled: 1, totalDiscount: 0 }]),
        expenses: ok({ count: 0 }),
        absences: ok({ anchor: null, rows: [] }),
        admissions: ok({ total: 0, enrolled: 0, rate: null }),
        consultations: ok({ thisMonth: 0, lastWeek: 0, pendingFollowUps: 0, overdueFollowUps: 0 }),
        newcomers: ok({ total: 0, stages: [], checksAvailable: true, items: [] }),
        homework: ok({ students: 0 }),
        schedule: ok([]),
        staff: ok([]),
        operations: ok([]),
        notices: ok([]),
        calendar: ok([]),
        consultProgress: ok({ summary: { from: "2026-09-01", counts: { received: 0 }, stalled: [] }, chips: {} }),
        mathSheet: ok({ period: "", classes: 0, filled: 0, total: 0 }),
      },
    } as unknown as OverviewSnapshot;
    // 오늘 입테는 새 대시보드 전용 칸이라 옛 운영실 요약형(summary.ts)이 없다 — 옛 렌더러는 그리지 않는다.
    for (const c of CARDS.filter((x) => (x.sizes.some((z) => z.mode === "summary") || x.kind === "kpi") && x.id !== "kpi:todayTests")) {
      expect(summaryOf(c.id, full), c.id).not.toBeNull();
    }
  });
});
