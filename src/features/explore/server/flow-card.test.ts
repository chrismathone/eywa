import { describe, expect, it, vi } from "vitest";

// 카드 조립 모듈(student-aside)이 함께 들고 있는 서버 조회(연결 상태)는 이 시험과 무관 — 불러오기만 막는다.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));

import { studentStatusMeta } from "@/features/students/status/status-labels";
import type { FlowInsight, FlowInsightView, FlowKind } from "../flow-insight";
import { standingLine } from "./flow-standing";
import { buildStudentAnalysis } from "./student-aside";

/** 원장 2026-11-06 — 4월 28일 상담만 보고 11월 6일에 '좋아지는 중'. 화면 조립(배지·안내)이 판정 한 곳을 그대로 타는지. */
const TODAY = "2026-11-06";
const insight = (direction: FlowInsight["direction"]): FlowInsight => ({
  headline: "쓰기·문장읽기 칭찬이 이어집니다.",
  direction,
  themes: [],
  recentChange: "",
  watch: [],
  nextSteps: [],
  basis: "",
});
const view = (kind: FlowKind, direction: FlowInsight["direction"], coveredThrough: string): FlowInsightView => ({
  kind,
  label: kind,
  insight: insight(direction),
  generatedAt: "2026-04-28T03:00:00+00:00",
  modelLabel: null,
  coveredCount: 2,
  coveredThrough,
});
const rows = (v: Partial<Record<FlowKind, FlowInsightView>>) => ({ ok: true as const, value: v });
const build = (status: string, withdrawnOn: string | null, v: Partial<Record<FlowKind, FlowInsightView>>, actualAts?: Partial<Record<FlowKind, string[] | null>>) =>
  buildStudentAnalysis({ allowed: true, canRefresh: true, rows: rows(v), standing: { status, withdrawnOn }, today: TODAY, actualAts });

describe("카드 조립 — 배지·안내는 보는 날 기준", () => {
  it("재원생 · 4월 상담뿐 · '좋아지는 중' → '판단 보류' 배지 + 분석이 본 날짜 안내", () => {
    const a = build("enrolled", null, { consultations: view("consultations", "improving", "2026-04-27T16:30:00+00:00") }, { consultations: ["2026-04-27T16:30:00+00:00"] });
    const b = a.blocks.find((x) => x.flowKind === "consultations")!;
    expect(b.badge).toEqual({ label: "판단 보류", color: "neutral" });
    expect(b.notice).toBe("이 분석은 2026-04-28(약 6개월 전)까지의 상담을 본 것이라 지금 흐름은 판단하지 않습니다.");
    expect(b.headline).toBe("쓰기·문장읽기 칭찬이 이어집니다.");
  });
  it("퇴원·휴원 = 원생 상태 배지(원생 상태 라벨·색 한 벌) — 분석 방향 배지를 두지 않는다", () => {
    const w = build("withdrawn", "2026-11-03", { timeline: view("timeline", "improving", "2026-11-01") }).blocks.find((x) => x.flowKind === "timeline")!;
    const meta = studentStatusMeta("withdrawn")!;
    expect(w.badge).toEqual({ label: meta.label, color: meta.color });
    expect(w.notice).toBe("퇴원(2026-11-03) — 이 분석은 2026-11-01(5일 전)까지의 기록 흐름입니다.");
    const h = build("on_hold", null, { consultations: view("consultations", "improving", "2026-10-20T01:00:00+00:00") }).blocks.find((x) => x.flowKind === "consultations")!;
    expect(h.badge?.label).toBe(studentStatusMeta("on_hold")!.label);
    expect(h.notice).toBe("지금 휴원 중입니다 — 이 분석은 2026-10-20(17일 전)까지의 상담 흐름입니다.");
  });
  it("최근 분석 · 반영 전 상담 없음 = 분석 방향 배지 그대로 · 안내 없음 · 분석 없는 종류는 빈 안내", () => {
    const a = build("enrolled", null, { consultations: view("consultations", "improving", "2026-10-30T01:00:00+00:00") }, { consultations: ["2026-10-30T01:00:00+00:00"] });
    const c = a.blocks.find((x) => x.flowKind === "consultations")!;
    expect(c.badge).toEqual({ label: "좋아지는 중", color: "green" });
    expect(c.notice).toBeNull();
    const t = a.blocks.find((x) => x.flowKind === "timeline")!;
    expect(t.badge).toBeNull();
    expect(t.notice).toBeNull();
    expect(t.empty).toContain("아직 분석이 없습니다");
  });
  it("권한 없음·조회 실패는 그대로", () => {
    expect(buildStudentAnalysis({ allowed: false, canRefresh: false, rows: null, standing: { status: "enrolled", withdrawnOn: null }, today: TODAY }).state).toBe("denied");
    expect(buildStudentAnalysis({ allowed: true, canRefresh: false, rows: { ok: false }, standing: { status: "enrolled", withdrawnOn: null }, today: TODAY }).state).toBe("error");
  });
});

describe("지금 상태 한 줄(프롬프트 재료)", () => {
  const classes = { active: ["PL6"], onHold: ["LE2"], upcoming: [{ name: "PL7", from: "2026-12-01" }] };
  it("재원 = 수강 중 · 대기 중인 반(과목 대기 — 휴원 아님) · 배정 예정 · 퇴원 예정", () => {
    expect(standingLine("enrolled", "2026-11-30", classes, TODAY)).toBe("재원 — 수강 중 PL6 · 대기 중인 반(그 반만 쉼) LE2 · 배정 예정 PL7(2026-12-01부터) · 퇴원 예정 2026-11-30");
  });
  it("휴원(원생 전체) = 반은 '쉬는 반' · 퇴원 = 날짜(없으면 날짜를 만들지 않는다 · 재료 문구 없이) · 반을 못 읽으면 상태 이름만", () => {
    expect(standingLine("on_hold", null, { active: [], onHold: ["PL6", "LE2"], upcoming: [] }, TODAY)).toBe("휴원(원생 전체) — 쉬는 반 PL6, LE2");
    expect(standingLine("withdrawn", "2026-11-03", classes, TODAY)).toBe("퇴원(2026-11-03) — 지금 다니는 반 없음");
    expect(standingLine("withdrawn", null, classes, TODAY)).toBe("퇴원 — 지금 다니는 반 없음");
    expect(standingLine("enrolled", null, null, TODAY)).toBe("재원");
  });
});
