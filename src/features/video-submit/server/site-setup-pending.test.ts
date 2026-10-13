import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, OTHER_T, S, T, seedDb, settings } from "./test-fixture.test-util";
import { CONN, CONN_B, WEB_ENV, addConnection, withAccountSchema } from "./account-fixture.test-util";

/**
 * 올리기 사이트(`/v`) — **받고 있던 지점이 계정을 바꾸는 동안**(2026-10-04).
 * 계정은 골랐고 저장 폴더는 아직인 지점을 '없는 지점'으로 치면, 남은 한 지점이 저절로 정해져 그 지점 학생이 다른 지점의
 * 같은 이름·같은 뒷자리 학생에게 올리게 된다. 이 상태는 '잠시 못 받음'이다 — 지점을 직접 골라야 한다.
 * 연결을 해제한 지점은 받지 않기로 한 것이라 종전대로 목록에서 빠진다.
 */
const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown, audit: vi.fn(), branches: [] as { id: string; name: string }[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));
vi.mock("@/features/owner/server/public-branding", () => ({ listPublicBranchChoices: async () => m.branches }));
vi.mock("@/features/audit/server/log", () => ({ logActionAs: m.audit }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-10-02" }));

import { _resetVideoHomeworkProbeForTest } from "@/features/video-homework/server/assignments";
import { _resetVideoSubmitAvailabilityForTest, videoSubmitAvailability } from "./availability";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoSiteForTest, lookupSite, openSiteLink, siteAvailability, siteDirectory } from "./site";

const C_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ROOT = "OTHER_BRANCH_ROOT_1";
const VERSION = "12121212-1212-4121-8121-121212121212";
let db: FakeDb;
const report = (id: string, student: string, klass: string, tenant = T) =>
  ({ id, tenant_id: tenant, student_id: student, class_id: klass, report_date: "2026-10-01", video_homework: true });
const setSetting = (row: Record<string, unknown>) => { db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, version: VERSION, ...row }]; };
const classes = (r: Awaited<ReturnType<typeof lookupSite>>) => (r.ok ? r.choices.filter((c) => !c.free).map((c) => c.className) : r);
const lookup = (tenant: unknown) => lookupSite({ last4: "5678", name: "류태경", ip: "1.1.1.1", tenant });
const reasonOf = async (tenant: string) => {
  const availability = await videoSubmitAvailability(tenant, settings() as never, m.db as never);
  return availability.ok ? "ok" : availability.reason;
};

beforeEach(() => {
  m.settings = settings();
  m.branches = [{ id: T, name: "인재원 침산" }, { id: OTHER_T, name: "인재원 수성" }];
  for (const [k, v] of Object.entries({ ...ENV, ...WEB_ENV })) vi.stubEnv(k, v);
  _resetVideoDriveConfigForTest(); _resetVideoSubmitAvailabilityForTest(); _resetVideoSiteForTest(); _resetVideoHomeworkProbeForTest();
  db = withAccountSchema(seedDb());
  db.tables.homework_video_links = [];
  db.tables.homework_video_site_attempts = [];
  // 🔴 두 지점에 **이름도 뒷자리도 같은** 학생이 한 명씩 있다(침산 류태경 · 수성 류태경).
  db.tables.students = [
    { id: S, tenant_id: T, name: "류태경", grade: "초3", status: "enrolled", student_phone: "010-1234-5678", parent_phone: null },
    { id: "s-other", tenant_id: OTHER_T, name: "류태경", grade: "중1", status: "enrolled", student_phone: "010-7777-5678", parent_phone: null },
  ];
  db.tables.classes = [
    { id: C, tenant_id: T, class_name: "LT4", subject: "math", teacher_id: null, is_active: true },
    { id: C_OTHER, tenant_id: OTHER_T, class_name: "수성 A", subject: "math", teacher_id: null, is_active: true },
  ];
  db.tables.enrollments = [
    { tenant_id: T, student_id: S, class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
    { tenant_id: OTHER_T, student_id: "s-other", class_id: C_OTHER, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
  ];
  db.tables.lesson_reports = [report("r1", S, C), report("r-other", "s-other", C_OTHER, OTHER_T)];
  db.tables.video_homework_marks = [];
  db.tables.student_homework_videos = [];
  db.tables.classnote_video_history = [{ tenant_id: T, center_id: 96575 }, { tenant_id: OTHER_T, center_id: 77777 }];
  // 수성 = 자기 계정(CONN)으로 받고 있던 지점. 침산 = 기존 연결.
  addConnection(db, OTHER_T);
  addConnection(db, OTHER_T, CONN_B);
  db.tables.homework_video_drive_roots!.push({ root_folder_id: OTHER_ROOT, tenant_id: OTHER_T, connection_id: CONN, folder_name: "수성" });
  setSetting({ enabled: true, root_folder_id: OTHER_ROOT, connection_id: CONN });
  m.db = db;
});
afterEach(() => vi.unstubAllEnvs());

describe("받고 있던 지점이 다른 계정으로 바꾸는 동안(계정은 골랐고 폴더는 아직)", () => {
  beforeEach(() => setSetting({ enabled: false, root_folder_id: null, connection_id: CONN_B }));

  it("그 지점은 '없는 지점'이 아니라 '잠시 못 받음'이다 — 남은 한 지점으로 저절로 정해지지 않는다", async () => {
    expect(await reasonOf(OTHER_T)).toBe("setup_pending");
    expect(await siteAvailability(undefined, OTHER_T)).toEqual({ ok: false, reason: "unavailable" });
    const directory = await siteDirectory();
    expect(directory).toMatchObject({ ok: true, partial: true }); // 화면이 지점을 직접 고르게 한다
    expect(directory.ok && directory.sites.map((site) => site.tenantId)).toEqual([T]);
    expect(await siteAvailability()).toEqual({ ok: false, reason: "choose" });
  });
  it("🔴 지점을 고르지 않은 요청은 침산에서 찾지 않는다 — 수성 류태경에게 침산 류태경의 숙제가 나오지 않는다", async () => {
    const unchosen = await lookup(undefined);
    expect(unchosen).toMatchObject({ ok: false });
    expect(JSON.stringify(unchosen)).not.toMatch(/LT4|류/);
    expect(await openSiteLink({ last4: "5678", name: "류태경", choice: "a".repeat(40), ip: "1.1.1.1", tenant: undefined })).toMatchObject({ ok: false });
    expect(db.tables.homework_video_links).toHaveLength(0);
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
  });
  it("수성을 실어 보낸 요청(열어 둔 화면·기억해 둔 기기)은 거절되고 고를 수 있는 지점만 받는다 — 침산으로 옮겨 찾지 않는다", async () => {
    const r = await lookup(OTHER_T);
    expect(r).toMatchObject({ ok: false, code: "branch", branches: [{ id: T, name: "인재원 침산" }] });
    expect(JSON.stringify(r)).not.toMatch(/LT4|류/);
  });
  it("침산을 직접 고른 요청은 그대로 된다(다른 지점의 상태가 침산 학생을 막지 않는다)", async () => {
    expect(classes(await lookup(T))).toEqual(["LT4"]);
  });
  it("폴더를 정하면 다시 받는다", async () => {
    db.tables.homework_video_drive_roots!.push({ root_folder_id: "OTHER_NEW_ROOT_01", tenant_id: OTHER_T, connection_id: CONN_B, folder_name: "수성 새 폴더" });
    setSetting({ enabled: true, root_folder_id: "OTHER_NEW_ROOT_01", connection_id: CONN_B });
    expect(await reasonOf(OTHER_T)).toBe("ok");
    expect(classes(await lookup(OTHER_T))).toEqual(["수성 A"]);
    expect(await siteDirectory()).toMatchObject({ ok: true, partial: false });
  });
});

describe("받지 않기로 한 지점은 종전대로 목록에서 빠진다(있었는지조차 모르게)", () => {
  it("연결을 해제했거나(연결 없음) 폴더가 적힌 채 꺼 둔 설정은 '잠시 못 받음'이 아니다", async () => {
    setSetting({ enabled: false, root_folder_id: null, connection_id: null });
    expect(await reasonOf(OTHER_T)).toBe("no_config");
    expect(await siteDirectory()).toMatchObject({ ok: true, partial: false, sites: [{ tenantId: T }] });
    expect(await siteAvailability()).toMatchObject({ ok: true, tenantId: T });
    setSetting({ enabled: false, root_folder_id: OTHER_ROOT, connection_id: CONN });
    _resetVideoSubmitAvailabilityForTest();
    expect(await reasonOf(OTHER_T)).toBe("no_config");
    expect(await siteDirectory()).toMatchObject({ ok: true, partial: false });
  });
  it("계정을 한 번도 연결하지 않은 지점·기존 연결 지점은 영향이 없다", async () => {
    db.tables.homework_video_drive_settings = [];
    expect(await reasonOf(OTHER_T)).toBe("no_config");
    expect(await reasonOf(T)).toBe("ok");
    expect(await siteAvailability()).toMatchObject({ ok: true, tenantId: T });
    expect(classes(await lookup(undefined))).toEqual(["LT4"]);
  });
});
