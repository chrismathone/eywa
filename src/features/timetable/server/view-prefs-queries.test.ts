import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseViewPrefs } from "../lib/view-prefs";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), teacherId: vi.fn(), admin: vi.fn(), session: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: mocks.teacherId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.session }));
import { getMyTimetableViewPrefs, getTimetableEntryPreferences } from "./view-prefs-queries";

function database(data: unknown, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { from: vi.fn().mockReturnValue(query), query };
}

describe("시간표 진입 계정 설정", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ id: "viewer", tenantId: "academy" });
    mocks.teacherId.mockResolvedValue(null);
  });

  it("기존 설정 조회 한 번에 공식 담당 과목도 읽고 테넌트와 계정을 고정한다", async () => {
    const db = database({ ui_prefs: { timetable: { hideStudents: true } }, subjects: ["english"] });
    mocks.admin.mockReturnValue(db);
    const entry = await getTimetableEntryPreferences();
    expect(entry.subjects).toEqual(["english"]);
    expect(entry.viewPrefs.hideStudents).toBe(true);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.query.select).toHaveBeenCalledWith("ui_prefs, subjects");
    expect(db.query.eq.mock.calls).toEqual([["id", "viewer"], ["tenant_id", "academy"]]);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("본인 강사 뷰는 추가 조회하지 않는다", async () => {
    mocks.teacherId.mockResolvedValue("viewer");
    mocks.admin.mockReturnValue(database({ subjects: ["english", null, 1] }));
    expect((await getTimetableEntryPreferences()).subjects).toEqual(["english"]);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("다른 강사 뷰는 대상의 과목과 본인의 표시 설정을 조합한다", async () => {
    mocks.teacherId.mockResolvedValue("english-teacher");
    mocks.admin.mockReturnValue(database({ ui_prefs: { timetable: { hideStudents: true } }, subjects: ["math"] }));
    const target = database({ subjects: ["english"] });
    mocks.session.mockResolvedValue(target);
    const entry = await getTimetableEntryPreferences();
    expect(entry.subjects).toEqual(["english"]);
    expect(entry.viewPrefs.hideStudents).toBe(true);
    expect(target.query.eq.mock.calls).toEqual([["id", "english-teacher"], ["tenant_id", "academy"]]);
  });

  it("대상 조회가 실패해도 다른 사람의 담당 과목으로 대체하지 않는다", async () => {
    mocks.teacherId.mockResolvedValue("english-teacher");
    mocks.admin.mockReturnValue(database({ subjects: ["math"] }));
    mocks.session.mockResolvedValue(database(null, { message: "denied" }));
    expect((await getTimetableEntryPreferences()).subjects).toEqual([]);
  });

  it("기존 뷰 설정 소비처는 반환 형태가 유지되고 조회 실패는 미설정으로 처리한다", async () => {
    mocks.admin.mockReturnValue(database(null, { message: "unavailable" }));
    expect(await getMyTimetableViewPrefs()).toEqual(parseViewPrefs(null));
    expect(await getTimetableEntryPreferences()).toEqual({ viewPrefs: parseViewPrefs(null), subjects: [] });
  });

  it("미로그인은 데이터 조회 없이 미설정으로 처리한다", async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect(await getTimetableEntryPreferences()).toEqual({ viewPrefs: parseViewPrefs(null), subjects: [] });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
});
