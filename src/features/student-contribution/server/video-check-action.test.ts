import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "@/features/video-submit/server/fake-db.test-util";
const m = vi.hoisted(() => ({ context: vi.fn(), assignments: vi.fn(), videos: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("./live-context", () => ({ getLiveContext: m.context }));
vi.mock("@/features/video-homework/server/assignments", () => ({ getAssignedVideoHomework: m.assignments }));
vi.mock("@/features/video-homework/server/ledger-queries", () => ({ loadClassVideos: m.videos }));
import { readContributionVideoCheck } from "./video-check-action";
const studentId = "48dda80d-514f-4b30-b283-54c85ad4adf7";
beforeEach(() => {
  vi.resetAllMocks(); const db = createFakeDb({ video_homework_marks: [] });
  // 이 가짜 DB에는 lte가 없어 날짜 열의 <=를 < 다음 사전식 경계로 확장한다.
  const contextDb = { from: (table: string) => { const query = db.from(table); return Object.assign(query, { lte: (col: string, value: string) => query.lt(col, `${value}T`) }); } };
  m.admin.mockReturnValue(contextDb);
  m.context.mockResolvedValue({ db: { from: () => { throw new Error("검사 기록은 세션 DB로 읽을 수 없음"); } }, tenant: "t", today: "2026-10-26", checkedAt: "2026-10-26T06:00:00Z" });
  m.assignments.mockResolvedValue([{ studentId, classId: "c", date: "2026-10-01" }, { studentId, classId: "c", date: "2026-10-25" }]); m.videos.mockResolvedValue([]);
});
it("미제출과 제출기한이 남은 숙제를 구분하고 학생 한 명의 원본만 요청한다", async () => {
  const result = await readContributionVideoCheck({ studentId, month: "2026-10" });
  expect(result.data?.current).toBe(true);
  expect(result.data?.rows.map((r) => r.status)).toEqual(["missing", "unchecked"]);
  expect(m.assignments).toHaveBeenCalledWith("t", "2026-01-01", "2026-10-26", { studentId });
  expect(m.videos).toHaveBeenCalledWith("t", [studentId], "2026-01-01", "2026-10-26", true);
});
it("권한 없음과 잘못된 월은 원본 조회 전에 차단한다", async () => {
  expect(await readContributionVideoCheck({ studentId, month: "2026-99" })).toHaveProperty("error");
  m.context.mockResolvedValue(null); expect(await readContributionVideoCheck({ studentId, month: "2026-10" })).toHaveProperty("error");
  expect(m.assignments).not.toHaveBeenCalled(); expect(m.videos).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
it("원본 조회 실패를 배정·제출 0건으로 보여주지 않는다", async () => {
  m.videos.mockResolvedValue(null);
  expect(await readContributionVideoCheck({ studentId, month: "2026-10" })).toHaveProperty("error");
});
