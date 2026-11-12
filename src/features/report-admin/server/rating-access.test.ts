import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ optedIn: vi.fn(), canWrite: vi.fn(), visible: true }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: m.optedIn }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("../report-rating", () => ({
  get REPORT_RATING_VISIBLE() {
    return m.visible;
  },
}));

import { canViewReportRatings } from "./rating-access";

beforeEach(() => {
  vi.clearAllMocks();
  m.visible = true;
  m.optedIn.mockResolvedValue(true);
  m.canWrite.mockResolvedValue(true);
});

describe("수업보고서 평점 서버 공통 문", () => {
  it("침산처럼 코드 표시 스위치 ∧ 지점 report_rating ∧ 쓰기 권한이 모두 켜지면 연다", async () => {
    await expect(canViewReportRatings("tenant-a", "admin")).resolves.toBe(true);
    expect(m.optedIn).toHaveBeenCalledWith("tenant-a", "report_rating");
    expect(m.canWrite).toHaveBeenCalledWith("admin", "lesson_reports");
  });

  it("코드 표시 스위치가 꺼지면 조회 없이 닫는다", async () => {
    m.visible = false;
    await expect(canViewReportRatings("tenant-a", "admin")).resolves.toBe(false);
    expect(m.optedIn).not.toHaveBeenCalled();
    expect(m.canWrite).not.toHaveBeenCalled();
  });

  it("지점 스위치가 꺼졌거나 조회 실패를 꺼짐으로 돌려받으면 권한이 있어도 닫는다", async () => {
    m.optedIn.mockResolvedValue(false);
    await expect(canViewReportRatings("tenant-a", "admin")).resolves.toBe(false);
  });

  it("쓰기 권한이 없으면 지점 스위치가 켜져도 닫는다", async () => {
    m.canWrite.mockResolvedValue(false);
    await expect(canViewReportRatings("tenant-a", "viewer")).resolves.toBe(false);
  });
});

describe("평점 공통 문 배선", () => {
  const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

  it("목록 화면은 서버 응답을 상태로 받고 클라이언트 상수로 다시 판정하지 않는다", () => {
    const page = read("src/app/(shell)/lesson-reports/page.tsx");
    const list = read("src/app/(shell)/lesson-reports/_components/report-list.tsx");
    expect(page).toContain("showRating: firstPage.showRating ?? false");
    expect(list).toContain("const { rows, total, page, pageSize, showRating } = result");
    expect(list).not.toContain("REPORT_RATING_VISIBLE");
  });

  it("목록 조회와 업무 완성도가 같은 서버 공통 문을 쓴다", () => {
    const actions = read("src/features/report-admin/server/actions.ts");
    const duties = read("src/features/duties/server/admin.ts");
    expect(actions).toContain("canViewReportRatings(user.tenantId, user.systemRole)");
    expect(duties).toContain("canViewReportRatings(viewer.tenantId, viewer.systemRole)");
  });
});
