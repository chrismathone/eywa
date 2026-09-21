import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ notes: null as string | null, withdrawnAt: null as string | null, selects: [] as string[] }));
vi.mock("@/lib/auth/view-mode", () => ({effectiveTeacherId: async () => null}));
vi.mock("@/lib/auth/current-user", () => ({getCurrentUser: async () => null}));
vi.mock("@/features/owner/server/queries", () => ({getTenantSettings: async () => ({operations: {subjects: []}})}));
vi.mock("@/lib/supabase/server", () => ({createClient: async () => ({from: (table: string) => {
  const query = {
    select: (fields: string) => {state.selects.push(fields); return query;},
    eq: () => query,
    maybeSingle: () => query,
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({data: table === "enrollments" ? [
      {id: "top", class_id: "top", start_date: "2026-04-07", end_date: "2026-07-08", is_transferred: false, withdrawal_reason: null, class: {class_name: "중등E_중1 TOP", subject: "english"}},
      {id: "regular", class_id: "regular", start_date: "2026-07-09", end_date: null, is_transferred: false, withdrawal_reason: null, class: [{class_name: "중등E_중1 정규 A", subject: "english"}]},
    ] : table === "students" ? {enrolled_at: null, withdrawn_at: state.withdrawnAt, notes: state.notes} : []}).then(resolve),
  };
  return query;
}})}));
import { getStudentTimeline } from "./queries";
import { TimelineView } from "@/app/(shell)/students/[id]/_tabs/timeline-view";
beforeEach(() => { state.notes = null; state.withdrawnAt = null; state.selects = []; });

it("서버 조회부터 화면까지: 7월에는 반이동 한 건, 전체 두 건으로 표시한다", async () => {
  const events = await getStudentTimeline("student");
  expect(state.selects.some(s => s.includes("class_id") && s.includes("is_transferred") && s.includes("subject"))).toBe(true);
  expect(events).toHaveLength(2);
  const html = renderToStaticMarkup(<TimelineView events={events} />);
  expect(html).toContain("반이동");
  expect(html).toContain("중등E_중1 TOP → 중등E_중1 정규 A");
  expect(html).not.toContain("수강 종료");
  expect(html).not.toContain("정규 A 수강 시작");
});
it("병합 기록의 장부상 퇴원일은 실제 퇴원 이벤트로 만들지 않는다", async () => {
  state.withdrawnAt = "2026-07-07";
  state.notes = "중복 병합: keeper와 통합됨 (2026-07-07)";
  expect((await getStudentTimeline("mergee")).some(e => e.title === "퇴원")).toBe(false);
  expect(state.selects).toContain("enrolled_at, withdrawn_at, withdrawal_metadata, notes");
});
it("실제 퇴원일은 계속 퇴원 이벤트로 표시한다", async () => {
  state.withdrawnAt = "2026-09-20";
  expect(await getStudentTimeline("withdrawn")).toContainEqual(expect.objectContaining({date: "2026-09-20", kind: "status_change", title: "퇴원"}));
});
