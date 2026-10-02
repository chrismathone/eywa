import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, OTHER_T, S, T, seedDb, settings } from "./test-fixture.test-util";

/** 숙제 영상 올리기 사이트(0330a) — 뒷 4자리 조회 · 링크 열기 · 횟수 제한 · 지점 격리. */
const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown, audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));
vi.mock("@/features/audit/server/log", () => ({ logActionAs: m.audit }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-10-02" }));

import { SITE_LINKS_PER_PAIR_PER_DAY, SITE_LOOKUPS_PER_HOUR, SITE_LOOKUPS_PER_HOUR_TENANT, SITE_MAX_STUDENTS_PER_LAST4, SITE_OPENS_PER_HOUR } from "../site";
import { _resetVideoSubmitAvailabilityForTest } from "./availability";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { hashSubmitToken } from "./token";
import { _resetVideoSiteForTest, lookupSite, openSiteLink, siteAvailability } from "./site";

const S2 = "55555555-5555-4555-8555-555555555555";
const C2 = "66666666-6666-4666-8666-666666666666";
let db: FakeDb;

function setup() {
  db = seedDb();
  db.tables.homework_video_links = [];
  db.tables.homework_video_site_attempts = [];
  db.tables.students = [
    { id: S, tenant_id: T, name: "류태경", grade: "초3", status: "enrolled", student_phone: "010-1234-5678", parent_phone: "010-9999-0000" },
    { id: S2, tenant_id: T, name: "김민수", grade: "중1", status: "enrolled", student_phone: null, parent_phone: "01055555678" },
    { id: "s-quit", tenant_id: T, name: "박퇴원", grade: "중1", status: "withdrawn", student_phone: "010-0000-5678", parent_phone: null },
    { id: "s-other", tenant_id: OTHER_T, name: "남지점", grade: "중1", status: "enrolled", student_phone: "010-7777-5678", parent_phone: null },
  ];
  db.tables.classes = [
    { id: C, tenant_id: T, class_name: "LT4", subject: "math", teacher_id: null, is_active: true },
    { id: C2, tenant_id: T, class_name: "영어 A", subject: "english", teacher_id: null, is_active: true },
  ];
  db.tables.enrollments = [
    { tenant_id: T, student_id: S, class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
    { tenant_id: T, student_id: S2, class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
    { tenant_id: T, student_id: S2, class_id: C2, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
    { tenant_id: OTHER_T, student_id: "s-other", class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
  ];
  m.db = db;
}
const withEnglishOff = () => ({ ...settings(), report: { videoHomeworkPolicy: { ...settings().report.videoHomeworkPolicy, disabledSubjectKeys: ["english"] } } });

beforeEach(() => {
  m.settings = withEnglishOff();
  m.audit.mockReset();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  _resetVideoDriveConfigForTest();
  _resetVideoSubmitAvailabilityForTest();
  _resetVideoSiteForTest();
  setup();
});
afterEach(() => vi.unstubAllEnvs());

describe("사이트를 열 수 있나", () => {
  it("Drive가 묶인 지점 + 기능·표가 갖춰졌을 때만", async () => {
    expect(await siteAvailability()).toMatchObject({ ok: true, tenantId: T, academyName: "인재원" });
  });
  it("Drive 값이 없거나 ClassNote 기능이 꺼졌으면 없는 주소(none) · 시도 표가 없으면(0330a 전) 잠시 못 받음", async () => {
    vi.stubEnv("CLASSNOTE_VIDEO_TENANT_ID", "");
    _resetVideoDriveConfigForTest();
    expect(await siteAvailability()).toEqual({ ok: false, reason: "none" });
    vi.stubEnv("CLASSNOTE_VIDEO_TENANT_ID", T);
    _resetVideoDriveConfigForTest();
    m.settings = { ...withEnglishOff(), modules: { disabled: ["classnote"] } };
    expect(await siteAvailability()).toEqual({ ok: false, reason: "none" });
    m.settings = withEnglishOff();
    db.dropTable("homework_video_site_attempts");
    expect(await siteAvailability()).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("뒷 4자리 조회", () => {
  it("본인 번호든 보호자 번호든 그 4자리로 끝나는 재원생 × 영상 숙제를 쓰는 지금 반 — 이름은 가운데를 가린다", async () => {
    const r = await lookupSite({ last4: "5678", ip: "1.1.1.1" });
    expect(r.ok && r.choices.map((c) => `${c.studentLabel}|${c.className}`)).toEqual(["김*수|LT4", "류*경|LT4"]);
    // 영어(학원 설정이 끈 과목)·퇴원생·다른 지점 학생은 없다. 학생·반 번호는 응답에 없다.
    expect(JSON.stringify(r)).not.toMatch(/영어 A|박|남|33333333|44444444|55555555/);
    expect(r.ok && r.choices.every((c) => /^[0-9a-f]{40}$/.test(c.id))).toBe(true);
  });
  it("끝난 수강·휴원·아직 시작 전인 수강의 반은 후보가 아니다", async () => {
    Object.assign(db.tables.enrollments![0]!, { end_date: "2026-10-01" });
    Object.assign(db.tables.enrollments![1]!, { on_hold: true });
    expect(await lookupSite({ last4: "5678", ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "invalid" });
    Object.assign(db.tables.enrollments![1]!, { on_hold: false, start_date: "2026-10-05" });
    expect(await lookupSite({ last4: "5678", ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "invalid" });
  });
  it("모양이 틀린 입력은 DB를 묻지 않고 · 없는 번호는 같은 안내(누가 있는지 흘리지 않는다)", async () => {
    for (const bad of ["567", "56789", "abcd", "", null, 5678]) expect(await lookupSite({ last4: bad, ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
    const none = await lookupSite({ last4: "0001", ip: "1.1.1.1" });
    expect(none).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(1);
  });
  it("🔴 한 IP가 시간당 횟수를 넘으면 막는다 — 다른 IP는 계속 된다 · IP 원본은 저장하지 않는다", async () => {
    for (let i = 0; i < SITE_LOOKUPS_PER_HOUR; i++) expect((await lookupSite({ last4: "5678", ip: "1.1.1.1" })).ok).toBe(true);
    expect(await lookupSite({ last4: "5678", ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "limit" });
    expect((await lookupSite({ last4: "5678", ip: "2.2.2.2" })).ok).toBe(true);
    expect(JSON.stringify(db.tables.homework_video_site_attempts)).not.toContain("1.1.1.1");
  });
  it("🔴 한도를 넘은 시도는 기록에 남기지 않는다 — 다시 눌러도 잠금이 늘어나지 않고, 한 IP가 지점 전체를 잠그지 못한다", async () => {
    for (let i = 0; i < SITE_LOOKUPS_PER_HOUR; i++) await lookupSite({ last4: "5678", ip: "1.1.1.1" });
    for (let i = 0; i < 50; i++) expect(await lookupSite({ last4: "5678", ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "limit" });
    // 한도를 채운 IP가 동시에 몰아쳐도 줄이 늘지 않는다(넣기 전에 먼저 세어 거절한다 — 넣었다 지우는 줄이 지점 전체 수에 잡히지 않게)
    await Promise.all(Array.from({ length: 100 }, () => lookupSite({ last4: "5678", ip: "1.1.1.1" })));
    expect(db.tables.homework_video_site_attempts).toHaveLength(SITE_LOOKUPS_PER_HOUR);
    // 다른 학생(다른 IP)은 그대로 쓴다
    expect((await lookupSite({ last4: "5678", ip: "3.3.3.3" })).ok).toBe(true);
    // 가장 오래된 시도가 한 시간을 넘기면 다시 열린다(거절된 시도가 창을 늘리지 않았다)
    const rows = db.tables.homework_video_site_attempts!;
    Object.assign(rows[0]!, { created_at: new Date(Date.now() - 3_700_000).toISOString() });
    expect((await lookupSite({ last4: "5678", ip: "1.1.1.1" })).ok).toBe(true);
  });
  it("지점 전체 상한은 통과한 조회만 센다 — 넘으면 그 조회도 남기지 않는다", async () => {
    const now = new Date().toISOString();
    db.tables.homework_video_site_attempts = Array.from({ length: SITE_LOOKUPS_PER_HOUR_TENANT }, (_, i) => ({ id: `seed-${i}`, tenant_id: T, ip_hash: `h${i}`, kind: "lookup", created_at: now }));
    expect(await lookupSite({ last4: "5678", ip: "4.4.4.4" })).toMatchObject({ ok: false, code: "limit" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(SITE_LOOKUPS_PER_HOUR_TENANT);
  });
  it("🔴 한 4자리에 학생이 너무 많으면(자리 채움 번호) 아무도 보여 주지 않는다 — 선생님께 링크를 받게 한다", async () => {
    for (let i = 0; i < SITE_MAX_STUDENTS_PER_LAST4 + 1; i++) {
      db.tables.students!.push({ id: `s-pad-${i}`, tenant_id: T, name: `자리${i}`, grade: "중1", status: "enrolled", student_phone: "010-0000-0000", parent_phone: null });
      db.tables.enrollments!.push({ tenant_id: T, student_id: `s-pad-${i}`, class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false });
    }
    const r = await lookupSite({ last4: "0000", ip: "1.1.1.1" });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(!r.ok && r.error).toContain("선생님께 영상 제출 링크를 받아 주세요");
  });
  it("번호 뒤에 글자가 붙은 저장값(`…5678(모)`)도 찾는다 · 가운데에만 그 숫자가 든 번호는 아니다", async () => {
    Object.assign(db.tables.students![0]!, { student_phone: null, parent_phone: "010-1234-5678(모)" });
    Object.assign(db.tables.students![1]!, { parent_phone: "010-5678-1111" });
    const r = await lookupSite({ last4: "5678", ip: "1.1.1.1" });
    expect(r.ok && r.choices.map((c) => c.studentLabel)).toEqual(["류*경"]);
  });
  it("사이트를 못 여는 상태면 조회도 받지 않는다(시도 기록 없음)", async () => {
    m.settings = { ...withEnglishOff(), modules: { disabled: ["classnote"] } };
    expect(await lookupSite({ last4: "5678", ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "unavailable" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
  });
});

describe("링크 열기", () => {
  const pick = async (label: string) => {
    const r = await lookupSite({ last4: "5678", ip: "1.1.1.1" });
    if (!r.ok) throw new Error("lookup failed");
    return r.choices.find((c) => c.studentLabel === label)!.id;
  };
  it("고른 후보의 제출 링크를 만든다 — 출처 site · 만든 날과 다음 날까지 · 토큰 원문은 응답에만 · 감사로그", async () => {
    const r = await openSiteLink({ last4: "5678", choice: await pick("류*경"), ip: "1.1.1.1" });
    expect(r.ok && r.url).toMatch(/^\/v\/[A-Za-z0-9_-]{43}$/);
    const token = r.ok ? r.url.slice(3) : "";
    expect(db.tables.homework_video_links).toHaveLength(1);
    expect(db.tables.homework_video_links![0]).toMatchObject({
      tenant_id: T, student_id: S, class_id: C, origin: "site", expires_at: "2026-10-04T00:00:00+09:00", token_hash: hashSubmitToken(token),
    });
    expect(JSON.stringify(db.tables.homework_video_links)).not.toContain(token);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T }), expect.objectContaining({
      action: "lesson_report_video_link_issue", targetLabel: "류태경 · LT4",
      metadata: expect.objectContaining({ studentId: S, classId: C, origin: "site", lastDay: "2026-10-03" }),
    }));
  });
  it("🔴 다른 번호의 후보 지문·지어낸 지문으로는 만들지 않는다(서버가 같은 4자리로 다시 조회한다)", async () => {
    const choice = await pick("류*경");
    expect(await openSiteLink({ last4: "4321", choice, ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await openSiteLink({ last4: "5678", choice: "f".repeat(40), ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await openSiteLink({ last4: "5678", choice: `${S}:${C}`, ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_links).toHaveLength(0);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("한 학생 × 반이 하루에 만들 수 있는 링크 수를 넘으면 막는다(새 링크로 업로드 횟수 제한을 우회하지 못하게)", async () => {
    const choice = await pick("류*경");
    for (let i = 0; i < SITE_LINKS_PER_PAIR_PER_DAY; i++) expect((await openSiteLink({ last4: "5678", choice, ip: `9.9.9.${i}` })).ok).toBe(true);
    expect(await openSiteLink({ last4: "5678", choice, ip: "8.8.8.8" })).toMatchObject({ ok: false, code: "limit" });
    expect(db.tables.homework_video_links).toHaveLength(SITE_LINKS_PER_PAIR_PER_DAY);
  });
  it("한 IP의 시간당 열기 횟수도 제한한다 — 넘은 시도는 남기지 않는다", async () => {
    const mine = await pick("류*경");
    for (let i = 0; i < SITE_OPENS_PER_HOUR; i++) await openSiteLink({ last4: "5678", choice: mine, ip: "7.7.7.7" });
    const opens = () => db.tables.homework_video_site_attempts!.filter((a) => a.kind === "open").length;
    expect(opens()).toBe(SITE_OPENS_PER_HOUR);
    const r = await openSiteLink({ last4: "5678", choice: mine, ip: "7.7.7.7" });
    expect(r).toMatchObject({ ok: false, code: "limit" });
    expect(!r.ok && r.error).toContain("너무 많이 시도");
    expect(opens()).toBe(SITE_OPENS_PER_HOUR);
  });
  it("🔴 동시에 여러 개를 보내도 학생 × 반의 하루 상한을 넘겨 만들지 못한다(만든 뒤 다시 센다)", async () => {
    const choice = await pick("류*경");
    const results = await Promise.all(Array.from({ length: SITE_LINKS_PER_PAIR_PER_DAY + 6 }, (_, i) => openSiteLink({ last4: "5678", choice, ip: `6.6.6.${i}` })));
    // 정확히 상한만큼 남는다 — 서로를 보고 전부 지워 아무도 못 받는 일이 없다.
    expect(db.tables.homework_video_links!.length).toBe(SITE_LINKS_PER_PAIR_PER_DAY);
    expect(results.filter((r) => r.ok).length).toBe(SITE_LINKS_PER_PAIR_PER_DAY);
  });
  it("🔴 선생님이 오늘 그 학생 × 반의 사이트 링크를 끊었으면 그날은 사이트로 다시 열지 못한다", async () => {
    const choice = await pick("류*경");
    expect((await openSiteLink({ last4: "5678", choice, ip: "1.1.1.1" })).ok).toBe(true);
    Object.assign(db.tables.homework_video_links![0]!, { revoked_at: new Date().toISOString() });
    expect(await openSiteLink({ last4: "5678", choice, ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "limit" });
    expect(db.tables.homework_video_links).toHaveLength(1);
    // 다른 학생은 그대로
    expect((await openSiteLink({ last4: "5678", choice: await pick("김*수"), ip: "1.1.1.1" })).ok).toBe(true);
  });
  it("어제 사이트로 연 링크를 오늘 끊어도 그날은 다시 못 연다 · 어제 끊은 것은 오늘 막지 않는다", async () => {
    const choice = await pick("류*경");
    const base = { tenant_id: T, student_id: S, class_id: C, origin: "site", expires_at: "2026-10-03T00:00:00+09:00" };
    db.tables.homework_video_links = [{ ...base, id: "y1", token_hash: "h1", created_at: "2026-10-01T10:00:00+09:00", revoked_at: "2026-10-01T12:00:00+09:00" }];
    expect((await openSiteLink({ last4: "5678", choice, ip: "1.1.1.1" })).ok).toBe(true);
    db.tables.homework_video_links = [{ ...base, id: "y2", token_hash: "h2", created_at: "2026-10-01T10:00:00+09:00", revoked_at: "2026-10-02T09:00:00+09:00" }];
    expect(await openSiteLink({ last4: "5678", choice, ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "limit" });
  });
  it("자정을 넘겨 고른 후보(어제 날짜 지문)도 받는다 · 그보다 오래된 지문은 받지 않는다", async () => {
    const { createHash } = await import("node:crypto");
    const idOn = (day: string) => createHash("sha256").update(`${T}:${S}:${C}:${day}`).digest("hex").slice(0, 40);
    expect((await openSiteLink({ last4: "5678", choice: idOn("2026-10-01"), ip: "1.1.1.1" })).ok).toBe(true);
    expect(await openSiteLink({ last4: "5678", choice: idOn("2026-09-30"), ip: "1.1.1.1" })).toMatchObject({ ok: false, code: "invalid" });
  });
});
