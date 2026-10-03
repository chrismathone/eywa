import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/demo-roster/server/actions", () => ({
  switchDemoRoster: vi.fn(async () => ({ ok: true as const, label: "동네형" })),
}));
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { Overview } from "./overview";

const mocks = vi.hoisted(() => ({ data: null as unknown as OverviewSnapshot }));
vi.mock("./use-overview", () => ({
  useOverview: () => ({ data: mocks.data, isFetching: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, children, className, ariaLabel }: { href: string; children: ReactNode; className?: string; ariaLabel?: string }) => (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

/**
 * 운영실 '출결 현황' 카드와 학원설정 휴원일(2026-10-03 합의 A01).
 * 휴원일엔 처리 현황이 빈 목록이라 종전엔 "예정학생 미처리 0건 · 입력 중 0반"과 빈 막대가 섰다 —
 * 다 처리한 날처럼 읽힌다. 휴원일에는 휴일 이름과 실제 입력만 적는다.
 */
const snapshot = (sections: OverviewSnapshot["sections"]): OverviewSnapshot => ({
  scope: "tenant:user:master:all",
  tenantId: "tenant",
  academy: "학원",
  today: "2026-10-03",
  requestedAt: 100,
  allowed: ["dashboard", "attendance"],
  subjects: {},
  sections,
});
const ok = <T,>(data: T) => ({ data, at: 100, error: false });
const cardText = (sections: OverviewSnapshot["sections"]) => {
  mocks.data = snapshot(sections);
  const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
  const start = html.indexOf('data-panel-title="출결 현황"');
  expect(start).toBeGreaterThan(-1);
  // 태그 속성(막대의 aria-label 등)까지 본다 — 입력 막대는 글자가 아니라 라벨로만 드러난다.
  return html.slice(start, html.indexOf("</section>", start)).replace(/\s+/g, " ");
};
const klass = (expected: number, recorded: number) => ({
  classId: `c${expected}-${recorded}`,
  className: "반",
  subject: "math",
  teacherName: null,
  expected,
  recorded,
  unprocessed: Math.max(0, expected - recorded),
  rate: expected > 0 ? Math.round((Math.min(recorded, expected) / expected) * 100) : 100,
});

describe("출결 현황 카드", () => {
  it("평일은 종전 그대로 — 예정학생 미처리 N건 · 입력 중 N반", () => {
    const t = cardText({
      attendance: ok(null),
      processing: ok([klass(22, 5), klass(10, 10)]),
      holidayAttendance: ok(null),
    });
    expect(t.replace(/<[^>]+>/g, "")).toContain("예정학생 미처리 17건");
    expect(t.replace(/<[^>]+>/g, "")).toContain("입력 중 1반");
    expect(t).toContain("오늘 출결 입력");
    expect(t).not.toContain("휴원일");
  });

  it("🔴 휴원일 = 휴일 이름과 실제 입력만 — 미처리 건수·입력 막대·완료율이 없다", () => {
    const t = cardText({
      attendance: ok({ date: "2026-10-03", total: 6, present: 5, absent: 1, late: 0, excused: 0, rate: 83.3 }),
      processing: ok([]),
      holidayAttendance: ok({ name: "개천절", counts: { students: 5, classes: 2, reservations: 1 } }),
    });
    expect(t.replace(/<[^>]+>/g, "")).toContain("개천절 휴원일");
    expect(t.replace(/<[^>]+>/g, "")).toContain("입력된 출결 5명 · 2반");
    expect(t.replace(/<[^>]+>/g, "")).toContain("보강 예약 1건");
    expect(t).not.toContain("예정학생 미처리");
    expect(t).not.toContain("입력 중");
    expect(t).not.toContain("오늘 출결 입력");
    expect(t).not.toMatch(/100\s?%|5\/0|5 \/ 0/);
  });

  it("기록이 없는 휴원일 = 0명 · 0반과 휴원일 문구(‘아직 없습니다’가 아니다)", () => {
    const t = cardText({
      attendance: ok(null),
      processing: ok([]),
      holidayAttendance: ok({ name: "추석", counts: { students: 0, classes: 0, reservations: 0 } }),
    });
    expect(t.replace(/<[^>]+>/g, "")).toContain("추석 휴원일");
    expect(t.replace(/<[^>]+>/g, "")).toContain("입력된 출결 0명 · 0반");
    expect(t).toContain("휴원일 — 오늘 입력된 출결이 없습니다.");
    expect(t).not.toContain("아직 없습니다");
    expect(t).not.toContain("예정학생 미처리");
    expect(t).not.toContain("보강 예약");
  });

  it("입력 현황을 못 읽은 휴원일 = 숫자를 지어내지 않는다", () => {
    const t = cardText({
      attendance: ok(null),
      processing: ok([]),
      holidayAttendance: ok({ name: "개천절", counts: null }),
    });
    expect(t.replace(/<[^>]+>/g, "")).toContain("개천절 휴원일");
    expect(t).toContain("입력 현황을 불러오지 못했습니다");
    expect(t).not.toContain("0명");
  });

  it("옛 스냅샷(휴원일 영역 없음)은 종전처럼 그린다", () => {
    const t = cardText({ attendance: ok(null), processing: ok([klass(4, 4)]) });
    expect(t.replace(/<[^>]+>/g, "")).toContain("예정학생 미처리 0건");
  });
});
