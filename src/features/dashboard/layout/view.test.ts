import { describe, expect, it } from "vitest";
import { MENU_KEYS, type MenuKey } from "@/lib/permissions";
import type { OverviewSnapshot, Sections } from "@/features/dashboard/overview/model";
import { defaultItems } from "./defaults";
import { previewSnapshot } from "./preview";
import { shapeSections } from "./shape";
import { BUNDLES, DASHBOARD_VERSION, EMPTY_DASHBOARD, type Bundle, type Item } from "./types";
import { loadPlan, neededAreas, resolveView } from "./view";

const ALL = new Set<MenuKey>(MENU_KEYS);
const without = (...drop: MenuKey[]) => new Set<MenuKey>(MENU_KEYS.filter((m) => !drop.includes(m)));
const stored = (role: Bundle, items: Item[]) => ({ version: DASHBOARD_VERSION, layouts: [{ role, items }] });
const ok = <T,>(data: T) => ({ data, at: 1, error: false });

describe("resolveView — 보는 사람의 배치", () => {
  it("원장도 배치 목록으로 그린다(새 대시보드 · 옛 격자 없음) — 저장값이 있으면 그 배치", () => {
    const base = resolveView({ stored: EMPTY_DASHBOARD, bundle: "owner", menus: ALL });
    expect(base.mode).toBe("grid");
    expect(base.items?.slice(0, 3).map((i) => i.id)).toEqual(["core:newcomers", "core:management", "core:workRecords"]);
    const v = resolveView({ stored: stored("owner", [{ id: "panel:notices", w: 6, h: 1 }]), bundle: "owner", menus: ALL });
    expect(v.mode).toBe("grid");
    expect(v.items?.map((i) => i.id)).toEqual(["panel:notices"]);
  });

  it("🔴 메뉴 권한이 상한 — 배치에 넣어도 권한 없는 카드는 빠지고, 카드가 없어진 구역 제목도 빠진다", () => {
    const items: Item[] = [
      { id: "panel:notices", w: 6, h: 1 },
      { id: "heading:money", w: 24, h: 1, title: "돈" },
      { id: "panel:billing6", w: 12, h: 1 },
      { id: "panel:expenses", w: 12, h: 1 },
    ];
    const v = resolveView({ stored: stored("desk", items), bundle: "desk", menus: without("billing") });
    expect(v.items?.map((i) => i.id)).toEqual(["panel:notices"]);
  });

  it("금액·전화번호 옵션 — 원장 밖 역할은 기본 가림, 카드마다 켜면 열린다", () => {
    const month: Item = { id: "panel:billingMonth", w: 6, h: 1 };
    const cal: Item = { id: "panel:admissionsSchedule", w: 6, h: 1 };
    const base = resolveView({ stored: stored("desk", [month, cal]), bundle: "desk", menus: ALL });
    expect([base.amounts, base.monthAmounts, base.phones]).toEqual([false, false, false]);
    const open = resolveView({ stored: stored("desk", [{ ...month, amounts: true }, { ...cal, phones: true }]), bundle: "desk", menus: ALL });
    expect([open.amounts, open.monthAmounts, open.phones]).toEqual([true, true, true]);
    // 일정 카드가 둘이면 둘 다 켜야 번호가 그대로(한쪽이라도 가리면 가린다)
    const mixed = resolveView({ stored: stored("desk", [{ ...cal, phones: true }, { id: "kpi:calendar", w: 3, h: 1 }]), bundle: "desk", menus: ALL });
    expect(mixed.phones).toBe(false);
  });

  it("과목 관리자 — 제목 뒤 담당 과목, 원장이 넣은 카드는 다 보이고 과목으로 못 나누는 카드엔 '(학원 전체)'", () => {
    // 원장 2026-10-14 *"위젯은 똑같이 넣어주고 내가 커스텀"* — 예전엔 학원 전체 카드를 숨겼다.
    // 2단계(같은 날) — 출결·수납 등은 과목으로 다시 세어 꼬리표가 없고, 원천에 과목이 없는 지출·행정만 '(학원 전체)'다.
    const v = resolveView({ stored: stored("subject", [{ id: "panel:subjects", w: 6, h: 1 }, { id: "panel:attendance", w: 6, h: 1 }, { id: "panel:expenses", w: 6, h: 1 }]), bundle: "subject", menus: ALL, subjectLabels: ["수학"] });
    expect(v.scopeLabel).toBe("수학");
    expect(v.items?.map((i) => i.id)).toEqual(["panel:subjects", "panel:attendance", "panel:expenses"]);
    expect(v.academyWide).toEqual(["panel:expenses"]);
    expect(loadPlan(v, ALL).has("expenses")).toBe(true);
    // 메뉴 권한 상한은 그대로 — 권한이 없으면 빠진다.
    const capped = resolveView({ stored: stored("subject", [{ id: "panel:attendance", w: 6, h: 1 }]), bundle: "subject", menus: new Set(), subjectLabels: ["수학"] });
    expect(capped.items?.map((i) => i.id)).toEqual([]);
  });

  it("과목 범위를 받은 다른 역할(실장 등)은 종전대로 학원 전체 카드를 숨긴다 — 편집기에 꼬리표가 안 서는 역할이라(리뷰 2026-10-14)", () => {
    const v = resolveView({ stored: stored("manager", [{ id: "panel:subjects", w: 6, h: 1 }, { id: "panel:attendance", w: 6, h: 1 }, { id: "panel:expenses", w: 6, h: 1 }]), bundle: "manager", menus: ALL, subjectScoped: true, subjectLabels: ["수학"] });
    // 출결은 과목으로 다시 세는 카드라 열리고(2단계), 학원 전체 카드(지출)만 숨는다.
    expect(v.items?.map((i) => i.id)).toEqual(["panel:subjects", "panel:attendance"]);
    expect(v.academyWide).toEqual([]);
  });

  it("배치가 바뀌면 rev가 바뀐다(갱신이 옛 배치를 안 붙든다)", () => {
    const a = resolveView({ stored: EMPTY_DASHBOARD, bundle: "desk", menus: ALL });
    const b = resolveView({ stored: stored("desk", [{ id: "panel:notices", w: 6, h: 1 }]), bundle: "desk", menus: ALL });
    expect(a.rev).not.toBe(b.rev);
  });
});

describe("loadPlan — 서버가 조회할 영역(배치에 없으면 미조회 · 메뉴 권한이 상한)", () => {
  const plan = (b: Bundle, menus = ALL) => loadPlan(resolveView({ stored: EMPTY_DASHBOARD, bundle: b, menus, subjectLabels: ["수학"] }), menus);

  it("원장 기본은 전 영역", () => {
    expect([...plan("owner")]).toEqual(expect.arrayContaining(["billing", "expenses", "staff", "students", "calendar"]));
  });

  it("원장 밖 기본은 지출·직원 영역을 읽지 않는다", () => {
    for (const b of BUNDLES.filter((x) => x !== "owner" && x !== "super")) {
      expect(plan(b).has("expenses")).toBe(false);
      expect(plan(b).has("staff")).toBe(false);
    }
  });

  it("과목 관리자 기본은 놓인 카드의 영역만", () => {
    // 과목별 수강 → 반복 결석 학생(원장 2026-10-15) — 결석 위험 영역(`absences`)을 읽는다.
    expect([...plan("subject")].sort()).toEqual(["absences", "absent", "attendance", "attendanceTrend", "changes", "consultations", "courseTrend", "courses", "enrolledTrend",
      "firstClass", "holidayAttendance", "homework", "makeup", "newcomers", "notices", "processing", "schedule", "students", "unread", "withdrawals"]);
  });

  it("배치에 있어도 메뉴 권한이 없으면 조회하지 않는다", () => {
    expect(plan("owner", without("billing", "staff")).has("billing")).toBe(false);
    expect(plan("owner", without("billing", "staff")).has("staff")).toBe(false);
    expect(neededAreas(resolveView({ stored: EMPTY_DASHBOARD, bundle: "owner", menus: ALL })).has("billing")).toBe(true);
  });
});

describe("shapeSections — 값 정리는 서버에서", () => {
  const bill = (period: string) => ({ period, totalCount: 10, paidCount: 6, partialCount: 1, unpaidCount: 3, totalBilled: 5_000_000, totalCollected: 3_000_000, totalDiscount: 100_000, outstanding: 2_000_000, paymentRate: 60 });
  const full: Sections = {
    billing: ok([bill("2026-09"), bill("2026-10")]),
    expenses: ok({ period: "2026-10", count: 1, byCurrency: [], primaryCurrency: "KRW", byCategory: [], categoryCount: 0 }),
    calendar: ok([{ id: "e", title: "입테 김철수 010-1234-5678", displayTitle: "입테 김철수A 010-1234-5678", startDate: "2026-10-02", endDate: "2026-10-02", startTime: null, source: "manual", kind: "levelTest" as const }]),
    notices: ok([]),
  };
  const ctx = { groups: [], groupOf: () => null };

  it("금액을 가린 역할: 수납 금액이 0으로 비고 지난 달 이력은 내려가지 않는다 · 놓지 않은 카드의 영역은 지운다", () => {
    const view = resolveView({ stored: stored("desk", [{ id: "panel:billingMonth", w: 6, h: 1 }, { id: "panel:notices", w: 6, h: 1 }]), bundle: "desk", menus: ALL });
    const out = shapeSections(full, view, ctx);
    expect(out.billing?.data).toHaveLength(1);
    expect(out.billing?.data?.[0]).toMatchObject({ paidCount: 6, unpaidCount: 3, totalBilled: 0, totalCollected: 0, outstanding: 0, paymentRate: 0 });
    expect(out.expenses).toBeUndefined();
    expect(out.calendar).toBeUndefined();
  });

  it("전화번호는 뒤 네 자리만 남긴다(제목·표시 제목 둘 다)", () => {
    const view = resolveView({ stored: stored("manager", [{ id: "panel:admissionsSchedule", w: 6, h: 1 }]), bundle: "manager", menus: ALL });
    const ev = shapeSections(full, view, ctx).calendar?.data?.[0];
    expect(ev?.title).toBe("입테 김철수 010-****-5678");
    expect(ev?.displayTitle).toBe("입테 김철수A 010-****-5678");
  });

  it("원장 기본(옛 격자)은 아무것도 가리지 않는다", () => {
    const view = resolveView({ stored: EMPTY_DASHBOARD, bundle: "owner", menus: ALL });
    const out = shapeSections(full, view, ctx);
    expect(out.billing?.data?.[1]?.totalBilled).toBe(5_000_000);
    expect(out.calendar?.data?.[0]?.title).toContain("010-1234-5678");
  });
});

describe("previewSnapshot — 편집기 미리보기가 서버와 같은 길을 지난다", () => {
  const snap = {
    scope: "t:u:master:all:x:full",
    tenantId: "t",
    academy: "학원",
    today: "2026-10-01",
    requestedAt: 1,
    allowed: [...MENU_KEYS],
    subjects: { math: "수학", english: "영어" },
    sections: {
      billing: ok([{ period: "2026-10", totalCount: 1, paidCount: 1, partialCount: 0, unpaidCount: 0, totalBilled: 1, totalCollected: 1, totalDiscount: 0, outstanding: 0, paymentRate: 100 }]),
      staff: ok([]),
      notices: ok([]),
      schedule: ok([
        { id: "1", classId: "c1", className: "수학A", subject: "math", startTime: "16:00", endTime: "17:00", teacherName: "갑", classroomName: "1", status: "ongoing" as const },
        { id: "2", classId: "c2", className: "영어A", subject: "english", startTime: "16:00", endTime: "17:00", teacherName: "을", classroomName: "2", status: "ongoing" as const },
      ]),
    },
  } as unknown as OverviewSnapshot;

  it("역할이 메뉴로 못 읽는 영역은 지운다(서버는 애초에 조회하지 않는다)", () => {
    const out = previewSnapshot(snap, { role: "desk", items: [{ id: "panel:staff", w: 6, h: 1 }, { id: "panel:notices", w: 6, h: 1 }], menus: without("staff"), subject: null });
    expect(out.sections.staff).toBeUndefined();
    expect(out.view?.items?.map((i) => i.id)).toEqual(["panel:notices"]);
    expect(out.allowed).not.toContain("staff");
  });

  it("과목 관리자 미리보기는 고른 과목으로 좁힌다", () => {
    const out = previewSnapshot(snap, { role: "subject", items: defaultItems("subject"), menus: ALL, subject: { key: "math", label: "수학" } });
    expect(out.sections.schedule?.data?.map((r) => r.className)).toEqual(["수학A"]);
    expect(out.view?.scopeLabel).toBe("수학");
  });

  it("원장 기본 미리보기도 새 대시보드 배치(핵심 업무 칸 포함)", () => {
    const view = previewSnapshot(snap, { role: "owner", items: defaultItems("owner"), menus: ALL, subject: null }).view;
    expect(view?.mode).toBe("grid");
    expect(view?.items?.some((i) => i.id === "core:management")).toBe(true);
  });

  it("핵심 업무 칸은 열 수 있는 사람에게만 — 경영 분석은 원장·관리자 · 신입생 90일은 신규생 관리 권한", () => {
    const core = (b: Bundle, menus = ALL) => resolveView({ stored: EMPTY_DASHBOARD, bundle: b, menus, subjectLabels: ["수학"] }).items?.filter((i) => i.id.startsWith("core:")).map((i) => i.id);
    expect(core("manager")).toEqual(["core:newcomers", "core:workRecords"]);
    expect(core("desk", without("newcomers"))).toEqual(["core:management", "core:workRecords"]);
  });
});

describe("과목별 값 끼우기(원장 2026-10-14 2단계) — shapeSections", () => {
  const groupOf = (key: string | null | undefined) => (key === "math" ? "math" : key === "english" ? "english" : null);
  const money = { period: "2026-10", totalCount: 3, paidCount: 3, partialCount: 0, unpaidCount: 0, totalBilled: 900, totalCollected: 900, totalDiscount: 0, outstanding: 0, paymentRate: 100 };
  const sections: Sections = {
    intake: { data: [{ id: "a", name: "A", time: null }, { id: "b", name: "B", time: null }], at: 1, error: false },
    billing: { data: [money], at: 1, error: false },
  };
  const slices = {
    intake: { math: [{ id: "a", name: "A", time: null }] },
    billing: { math: [{ ...money, totalCount: 1, totalBilled: 300, totalCollected: 300, unclassified: { billed: 50, outstanding: 50, count: 1, lines: 1 } }] },
  };
  const items: Item[] = [{ id: "kpi:intake", w: 3, h: 1 }, { id: "panel:billingMonth", w: 6, h: 1, amounts: false }];

  it("과목 관리자 = 그 묶음의 값 · 금액 가림은 끼운 값(과목 모름 포함)에도 걸린다", () => {
    const view = resolveView({ stored: stored("subject", items), bundle: "subject", menus: ALL, subjectLabels: ["수학"] });
    const out = shapeSections(sections, view, { groups: ["math"], groupOf, slices });
    expect(out.intake?.data?.map((r) => r.id)).toEqual(["a"]);
    expect(out.billing?.data?.[0]).toMatchObject({ totalCount: 1, totalBilled: 0, unclassified: { billed: 0, outstanding: 0, count: 1, lines: 1 } });
  });

  it("과목 관리자가 아니면 과목 값을 쓰지 않는다(학원 전체 값 그대로)", () => {
    const view = resolveView({ stored: stored("desk", items), bundle: "desk", menus: ALL });
    const out = shapeSections(sections, view, { groups: [], groupOf, slices });
    expect(out.intake?.data?.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out.billing?.data?.[0]?.totalCount).toBe(3);
  });
});
