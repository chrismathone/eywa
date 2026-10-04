import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, OTHER_T, S, T, seedDb, settings } from "./test-fixture.test-util";
import { CONN, WEB_ENV, addConnection, withAccountSchema } from "./account-fixture.test-util";

/**
 * 숙제 영상 올리기 사이트(0330a) — 뒷 4자리 + 이름 조회 · 선생님이 낸 영상 숙제 목록 · 링크 열기 · 횟수 제한 · 지점 격리.
 * 원장 2026-10-03: 이름까지 넣어야 하고, 선생님이 낸 영상 숙제가 있어야 올릴 수 있으며, 고른 숙제에 영상이 묶인다.
 */
const m = vi.hoisted(() => ({
  db: null as unknown, settings: null as unknown, audit: vi.fn(),
  /** 공개 지점 목록(자리 PIN과 같은 목록) — 기본은 지점 하나(지금까지의 환경). */
  branches: [] as { id: string; name: string }[],
  /** 지점별 학원 설정 — 없으면 `settings`(전 지점 공통). */
  settingsOf: {} as Record<string, unknown>,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async (tenantId: string) => m.settingsOf[tenantId] ?? m.settings }));
vi.mock("@/features/owner/server/public-branding", () => ({ listPublicBranchChoices: async () => m.branches }));
vi.mock("@/features/audit/server/log", () => ({ logActionAs: m.audit }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-10-02" }));

import { formatShortKoreanDate } from "@/lib/date-kst";
import { _resetVideoHomeworkProbeForTest } from "@/features/video-homework/server/assignments";
import { SITE_LINKS_PER_PAIR_PER_DAY, SITE_LOOKUPS_PER_HOUR, SITE_LOOKUPS_PER_HOUR_TENANT, SITE_MAX_STUDENTS_PER_LAST4, SITE_OPENS_PER_HOUR } from "../site";
import { _resetVideoSubmitAvailabilityForTest } from "./availability";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { hashSubmitToken } from "./token";
import { _resetVideoSiteForTest, lookupSite, openSiteLink, siteAvailability, siteDirectory } from "./site";

const S2 = "55555555-5555-4555-8555-555555555555";
const C2 = "66666666-6666-4666-8666-666666666666";
const C3 = "77777777-7777-4777-8777-777777777777";
let db: FakeDb;

const report = (id: string, studentId: string, classId: string, date: string, videoHomework: boolean | null = true, tenant = T) =>
  ({ id, tenant_id: tenant, student_id: studentId, class_id: classId, report_date: date, video_homework: videoHomework });

function setup() {
  db = seedDb();
  db.tables.homework_video_links = [];
  db.tables.homework_video_site_attempts = [];
  db.tables.students = [
    { id: S, tenant_id: T, name: "류태경", grade: "초3", status: "enrolled", student_phone: "010-1234-5678", parent_phone: "010-9999-0000" },
    { id: S2, tenant_id: T, name: "김민수", grade: "중1", status: "enrolled", student_phone: null, parent_phone: "01055555678" },
    { id: "s-quit", tenant_id: T, name: "박퇴원", grade: "중1", status: "withdrawn", student_phone: "010-0000-5678", parent_phone: null },
    { id: "s-other", tenant_id: OTHER_T, name: "류태경", grade: "중1", status: "enrolled", student_phone: "010-7777-5678", parent_phone: null },
  ];
  db.tables.classes = [
    { id: C, tenant_id: T, class_name: "LT4", subject: "math", teacher_id: null, is_active: true },
    { id: C2, tenant_id: T, class_name: "영어 A", subject: "english", teacher_id: null, is_active: true },
    { id: C3, tenant_id: T, class_name: "PS2", subject: "math", teacher_id: null, is_active: true },
  ];
  db.tables.enrollments = [
    { tenant_id: T, student_id: S, class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
    { tenant_id: T, student_id: S2, class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
    { tenant_id: T, student_id: S2, class_id: C2, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
    { tenant_id: OTHER_T, student_id: "s-other", class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false },
  ];
  // 오늘 = 2026-10-02. 류태경: 10/1·9/29 숙제(둘 다 안 냄) · 9/10 숙제(2주 지남) · 9/30은 숙제 없음. 김민수: 10/1 숙제 + 영어 반 숙제(영어는 설정이 끔).
  db.tables.lesson_reports = [
    report("r1", S, C, "2026-10-01"),
    report("r2", S, C, "2026-09-29"),
    report("r3", S, C, "2026-09-10"),
    report("r4", S, C, "2026-09-30", false),
    report("r5", S, C, "2026-09-28", null),
    report("r6", S2, C, "2026-10-01"),
    report("r7", S2, C2, "2026-10-01"),
    report("r8", S, C, "2026-10-02", true, OTHER_T),
  ];
  db.tables.video_homework_marks = [];
  db.tables.student_homework_videos = [];
  m.db = db;
}
const withEnglishOff = () => ({ ...settings(), report: { videoHomeworkPolicy: { ...settings().report.videoHomeworkPolicy, disabledSubjectKeys: ["english"] } } });
const look = (name: unknown = "류태경", last4: unknown = "5678", ip = "1.1.1.1") => lookupSite({ last4, name, ip });
const dates = (r: Awaited<ReturnType<typeof lookupSite>>) => (r.ok ? r.choices.map((c) => `${c.homeworkLabel}|${c.className}`) : r);
const label = formatShortKoreanDate;

beforeEach(() => {
  m.settings = withEnglishOff();
  m.settingsOf = {};
  m.branches = [{ id: T, name: "인재원 침산" }];
  m.audit.mockReset();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  _resetVideoDriveConfigForTest();
  _resetVideoSubmitAvailabilityForTest();
  _resetVideoSiteForTest();
  _resetVideoHomeworkProbeForTest();
  setup();
});
afterEach(() => vi.unstubAllEnvs());

describe("사이트를 열 수 있나", () => {
  it("저장 폴더가 있는 지점 + 기능·표가 갖춰졌을 때만 — 지점이 하나면 고르지 않아도 그 지점", async () => {
    expect(await siteAvailability()).toMatchObject({ ok: true, tenantId: T, academyName: "인재원" });
    expect(await siteAvailability(undefined, T)).toMatchObject({ ok: true, tenantId: T });
    expect(await siteDirectory()).toMatchObject({ ok: true, sites: [{ tenantId: T, branchName: "인재원 침산" }] });
  });
  it("🔴 지점을 정해 물으면 그 지점만 본다 — 저장 폴더가 없는 지점은 다른 지점이 써도 없는 주소(none) · 모양이 틀린 지점 번호도", async () => {
    expect(await siteAvailability(undefined, OTHER_T)).toEqual({ ok: false, reason: "none" });
    expect(await siteAvailability(undefined, "not-a-uuid")).toEqual({ ok: false, reason: "none" });
    expect(await siteAvailability(undefined, "")).toEqual({ ok: false, reason: "none" });
  });
  it("지점 목록을 못 읽으면(빈 목록) 없는 주소로 단정하지 않고 잠시 못 받음", async () => {
    m.branches = [];
    expect(await siteAvailability()).toEqual({ ok: false, reason: "unavailable" });
    expect(await siteDirectory()).toEqual({ ok: false, reason: "unavailable" });
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

describe("뒷 4자리 + 이름 조회 — 선생님이 낸 영상 숙제 중 아직 안 낸 것", () => {
  it("번호와 이름이 둘 다 맞아야 한다 — 그 학생의 숙제만(최신 숙제부터) · 2주 지난 숙제·'없음'·모름인 수업은 없다", async () => {
    const r = await look("류태경");
    expect(dates(r)).toEqual([`${label("2026-10-01")}|LT4`, `${label("2026-09-29")}|LT4`]);
    // 같은 4자리를 쓰는 다른 학생(김민수)의 숙제는 없다. 학생·반·보고서 번호는 응답에 없다.
    expect(JSON.stringify(r)).not.toMatch(/김|33333333|44444444|55555555|"r\d"/);
    expect(r.ok && r.choices.every((c) => /^[0-9a-f]{40}$/.test(c.id))).toBe(true);
    expect(r.ok && new Set(r.choices.map((c) => c.id)).size).toBe(2);
    // 김민수 — 영어(학원 설정이 끈 과목) 반의 숙제는 없다
    expect(dates(await look("김민수"))).toEqual([`${label("2026-10-01")}|LT4`]);
  });
  it("🔴 올릴 수 있는 숙제 = 숙제일 + 7일까지(원장 '숙제날짜 기준 7일') — 오늘(10/2)이면 9/25 숙제까지 · 9/24 숙제는 없다", async () => {
    db.tables.lesson_reports!.push(report("r8", S, C, "2026-09-25"), report("r9", S, C, "2026-09-24"));
    expect(dates(await look())).toEqual([`${label("2026-10-01")}|LT4`, `${label("2026-09-29")}|LT4`, `${label("2026-09-25")}|LT4`]);
  });
  it("🔴 이름이 틀리면 '찾지 못했다' — 번호만 맞아서는 아무것도 안 나온다(다른 지점의 같은 이름도)", async () => {
    for (const name of ["류태영", "김태경", "박퇴원", "류태경이"]) {
      const r = await look(name);
      expect(r, name).toMatchObject({ ok: false, code: "invalid" });
      expect(!r.ok && r.error, name).toContain("번호와 이름이 맞는 학생을 찾지 못했습니다");
    }
    // 다른 지점의 류태경(번호 끝 5678)은 이 지점 조회에 걸리지 않는다 — 걸렸다면 숙제(r8)가 하나 더 나온다
    expect(dates(await look("류태경"))).toHaveLength(2);
    // 이름은 맞는데 번호가 다르다
    expect(await look("류태경", "4321")).toMatchObject({ ok: false, code: "invalid" });
    // 보호자 번호(…0000)로도 찾는다 — 본인 번호가 없어도 된다
    expect(dates(await look("류태경", "0000"))).toHaveLength(2);
  });
  it("동명이인 구분 글자(알파벳)는 안 쳐도 되고 쳐도 된다 · 공백은 무시한다", async () => {
    Object.assign(db.tables.students![0]!, { name: "류태경A" });
    for (const typed of ["류태경", "류태경A", "류태경a", " 류 태경 "]) expect(dates(await look(typed)), typed).toHaveLength(2);
    // 구분 글자가 다른 것을 쳤으면 그 학생이 아니다 — 글자를 뗀 이름이 같으므로 맞는다(학생은 그 글자를 모른다)
    expect(dates(await look("류태경B"))).toHaveLength(2);
    // 구분 글자만 다른 두 학생이 같은 4자리를 쓰면 둘 다 나오고, 가린 이름으로 가른다
    Object.assign(db.tables.students![1]!, { name: "류태경B" });
    const both = await look("류태경");
    expect(both.ok && [...new Set(both.choices.map((c) => c.studentLabel))].sort()).toEqual(["류**A", "류**B"]);
  });
  it("🔴 번호·이름은 맞는데 올릴 숙제가 없으면 '찾지 못했다'가 아니라 '올릴 영상 숙제가 없다' — 영상 숙제가 없는 반의 학생이 검색이 안 되는 것으로 오해하지 않게", async () => {
    // ① 영상 숙제를 안 쓰는 반(영어)만 다니는 학생
    db.tables.enrollments = db.tables.enrollments!.filter((e) => !(e.student_id === S2 && e.class_id === C));
    const english = await look("김민수");
    expect(english).toMatchObject({ ok: false, code: "no_homework" });
    expect(!english.ok && english.error).toContain("지금 올릴 영상 숙제가 없습니다");
    // ② 숙제가 나간 적이 없다
    db.tables.lesson_reports = [];
    expect(await look("류태경")).toMatchObject({ ok: false, code: "no_homework" });
    // ③ 끝난 수강·휴원·아직 시작 전 — 지금 다니는 반이 없다
    setup();
    Object.assign(db.tables.enrollments![0]!, { end_date: "2026-10-01" });
    expect(await look("류태경")).toMatchObject({ ok: false, code: "no_homework" });
    Object.assign(db.tables.enrollments![0]!, { end_date: null, on_hold: true });
    expect(await look("류태경")).toMatchObject({ ok: false, code: "no_homework" });
    Object.assign(db.tables.enrollments![0]!, { on_hold: false, start_date: "2026-10-05" });
    expect(await look("류태경")).toMatchObject({ ok: false, code: "no_homework" });
  });
  it("이미 낸 숙제는 목록에서 빠진다 — 선생님이 찍은 완료 · 그 숙제를 골라 올린 영상 · 게시일순으로 짝지어진 영상(장부와 같은 판정)", async () => {
    // 선생님이 10/1 숙제를 완료로 찍었다
    db.tables.video_homework_marks = [{ id: "m1", tenant_id: T, class_id: C, student_id: S, check_date: "2026-10-02", homework_date: "2026-10-01", submitted_date: "2026-10-02", status: "submitted", updated_at: "2026-10-02T10:00:00+09:00" }];
    expect(dates(await look())).toEqual([`${label("2026-09-29")}|LT4`]);
    // 학생이 9/29 숙제를 골라 올렸다(고른 숙제일이 영상에 실려 있다) → 남은 숙제 없음
    db.tables.student_homework_videos = [{ id: "v1", tenant_id: T, student_id: S, posted_at: "2026-10-02T09:00:00+09:00", route: { classId: C, homeworkDate: "2026-09-29" } }];
    expect(await look()).toMatchObject({ ok: false, code: "no_homework" });
    // 고르지 않고 올라온 영상(ClassNote·옛 링크)은 가장 오래된 미확인 숙제(9/29)부터 채운다 → 10/1이 남는다
    db.tables.video_homework_marks = [];
    db.tables.student_homework_videos = [{ id: "v2", tenant_id: T, student_id: S, posted_at: "2026-10-01T21:00:00+09:00", route: { classId: C } }];
    expect(dates(await look())).toEqual([`${label("2026-10-01")}|LT4`]);
    // 다른 반으로 분류된 영상·다른 지점의 영상은 이 반 숙제를 채우지 않는다
    db.tables.student_homework_videos = [
      { id: "v3", tenant_id: T, student_id: S, posted_at: "2026-10-01T21:00:00+09:00", route: { classId: C3 } },
      { id: "v4", tenant_id: OTHER_T, student_id: S, posted_at: "2026-10-01T21:00:00+09:00", route: { classId: C, homeworkDate: "2026-10-01" } },
    ];
    expect(dates(await look())).toHaveLength(2);
  });
  it("미수행(✕)으로 찍힌 숙제도 목록에 남는다(늦게라도 올릴 수 있다)", async () => {
    db.tables.video_homework_marks = [{ id: "m1", tenant_id: T, class_id: C, student_id: S, check_date: "2026-10-02", homework_date: "2026-10-01", submitted_date: null, status: "missing", updated_at: "2026-10-02T10:00:00+09:00" }];
    expect(dates(await look())).toEqual([`${label("2026-10-01")}|LT4`, `${label("2026-09-29")}|LT4`]);
    // 🔴 그 ✕ 숙제를 골라 이미 올렸으면 빠진다 — 칸은 ✕ 그대로라(직접 찍은 기록이 이긴다) 빼지 않으면 2주 내내 남아 되풀이해 올린다
    db.tables.student_homework_videos = [{ id: "v1", tenant_id: T, student_id: S, posted_at: "2026-10-02T09:00:00+09:00", route: { classId: C, homeworkDate: "2026-10-01" } }];
    expect(dates(await look())).toEqual([`${label("2026-09-29")}|LT4`]);
  });
  it("🔴 먼저 들어온 ClassNote 영상은 늦게 마무리된 사이트 업로드 때문에 빠지지 않는다(들어온 시각이 영상에 실린다 — 숙제가 목록에 되살아나지 않게)", async () => {
    db.tables.student_homework_videos = [
      // 학부모가 09:00에 ClassNote로 올린 영상(09:03 수집) → 가장 오래된 미확인(9/29)
      { id: "v1", tenant_id: T, student_id: S, post_id: 11, posted_at: "2026-10-02T09:00:00+09:00", created_at: "2026-10-02T09:03:00+09:00", route: { classId: C } },
      // 08:00에 시작해 10:00에야 마무리된 사이트 업로드(10/1 숙제) — 게시 시각은 시작 시각이다
      { id: "v2", tenant_id: T, student_id: S, posted_at: "2026-10-02T08:00:00+09:00", created_at: "2026-10-02T10:00:00+09:00", uploaded_at: "2026-10-02T10:00:00+09:00", route: { classId: C, homeworkDate: "2026-10-01" } },
    ];
    expect(await look()).toMatchObject({ ok: false, code: "no_homework" });
  });
  it("🔴 같은 파일을 ClassNote에 먼저, 사이트에도 올렸으면 ClassNote 사본이 채웠던 숙제가 목록에 다시 선다(지문이 영상에 실린다)", async () => {
    const md5 = "0123456789abcdef0123456789abcdef";
    db.tables.student_homework_videos = [
      { id: "v1", tenant_id: T, student_id: S, post_id: 11, posted_at: "2026-10-02T09:00:00+09:00", created_at: "2026-10-02T09:03:00+09:00", md5, bytes: 34795724, route: { classId: C } },
      { id: "v2", tenant_id: T, student_id: S, posted_at: "2026-10-02T15:00:00+09:00", created_at: "2026-10-02T15:02:00+09:00", md5, bytes: 34795724, route: { classId: C, homeworkDate: "2026-10-01" } },
    ];
    expect(dates(await look())).toEqual([`${label("2026-09-29")}|LT4`]);
    // 파일이 다르면 ClassNote 영상이 9/29를 그대로 채운다
    db.tables.student_homework_videos[0]!.md5 = "fedcba9876543210fedcba9876543210";
    expect(await look()).toMatchObject({ ok: false, code: "no_homework" });
  });
  it("🔴 다른 지점의 검사 기록은 이 지점 숙제를 '낸 것'으로 만들지 않는다", async () => {
    db.tables.video_homework_marks = [{ id: "m9", tenant_id: OTHER_T, class_id: C, student_id: S, check_date: "2026-10-02", homework_date: "2026-10-01", submitted_date: "2026-10-02", status: "submitted", updated_at: "2026-10-02T10:00:00+09:00" }];
    expect(dates(await look())).toHaveLength(2);
  });
  it("🔴 한 조회가 행 상한(500)을 넘으면 조용히 잘라 판정하지 않는다 — 숙제 목록 대신 '다시 시도' 안내", async () => {
    db.tables.video_homework_marks = Array.from({ length: 501 }, (_, i) => ({ id: `m${i}`, tenant_id: T, class_id: C, student_id: S,
      check_date: "2026-10-02", homework_date: "2026-10-01", submitted_date: null, status: "missing", updated_at: "2026-10-02T10:00:00+09:00" }));
    expect(await look()).toMatchObject({ ok: false, code: "error" });
    // 다른 반으로 분류된 영상은 아무리 많아도 이 반의 상한을 먹지 않는다(영상 조회도 반으로 좁힌다)
    db.tables.video_homework_marks = [];
    db.tables.student_homework_videos = Array.from({ length: 501 }, (_, i) => ({ id: `v${i}`, tenant_id: T, student_id: S,
      posted_at: "2026-10-01T21:00:00+09:00", route: { classId: C3 } }));
    expect(dates(await look())).toHaveLength(2);
  });
  it("🔴 영상 과제 값을 읽을 수 없으면(0308a 전·순간 오류) '숙제 없음'이 아니라 '지금은 받을 수 없다'", async () => {
    db.dropTable("lesson_reports");
    expect(await look()).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("모양이 틀린 입력은 DB를 묻지 않는다 — 번호·이름 둘 다", async () => {
    for (const bad of ["567", "56789", "abcd", "", null, 5678]) expect(await look("류태경", bad)).toMatchObject({ ok: false, code: "invalid" });
    for (const bad of ["", "류", " ", null, 123, "가".repeat(60), "류A"]) expect(await look(bad), String(bad)).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
    expect(await look("없는이름", "0001")).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(1);
  });
  it("🔴 한 IP가 시간당 횟수를 넘으면 막는다 — 다른 IP는 계속 된다 · IP 원본은 저장하지 않는다", async () => {
    for (let i = 0; i < SITE_LOOKUPS_PER_HOUR; i++) expect((await look()).ok).toBe(true);
    expect(await look()).toMatchObject({ ok: false, code: "limit" });
    expect((await look("류태경", "5678", "2.2.2.2")).ok).toBe(true);
    expect(JSON.stringify(db.tables.homework_video_site_attempts)).not.toContain("1.1.1.1");
  });
  it("🔴 한도를 넘은 시도는 기록에 남기지 않는다 — 다시 눌러도 잠금이 늘어나지 않고, 한 IP가 지점 전체를 잠그지 못한다", async () => {
    for (let i = 0; i < SITE_LOOKUPS_PER_HOUR; i++) await look();
    for (let i = 0; i < 50; i++) expect(await look()).toMatchObject({ ok: false, code: "limit" });
    // 한도를 채운 IP가 동시에 몰아쳐도 줄이 늘지 않는다(넣기 전에 먼저 세어 거절한다 — 넣었다 지우는 줄이 지점 전체 수에 잡히지 않게)
    await Promise.all(Array.from({ length: 100 }, () => look()));
    expect(db.tables.homework_video_site_attempts).toHaveLength(SITE_LOOKUPS_PER_HOUR);
    // 다른 학생(다른 IP)은 그대로 쓴다
    expect((await look("류태경", "5678", "3.3.3.3")).ok).toBe(true);
    // 가장 오래된 시도가 한 시간을 넘기면 다시 열린다(거절된 시도가 창을 늘리지 않았다)
    const rows = db.tables.homework_video_site_attempts!;
    Object.assign(rows[0]!, { created_at: new Date(Date.now() - 3_700_000).toISOString() });
    expect((await look()).ok).toBe(true);
  });
  it("🔴 이름을 틀리게 넣은 시도도 횟수에 센다(이름을 바꿔 가며 훑지 못하게)", async () => {
    for (let i = 0; i < SITE_LOOKUPS_PER_HOUR; i++) await look(`아무개${i}`);
    expect(await look("류태경")).toMatchObject({ ok: false, code: "limit" });
  });
  it("지점 전체 상한은 통과한 조회만 센다 — 넘으면 그 조회도 남기지 않는다", async () => {
    const now = new Date().toISOString();
    db.tables.homework_video_site_attempts = Array.from({ length: SITE_LOOKUPS_PER_HOUR_TENANT }, (_, i) => ({ id: `seed-${i}`, tenant_id: T, ip_hash: `h${i}`, kind: "lookup", created_at: now }));
    expect(await look("류태경", "5678", "4.4.4.4")).toMatchObject({ ok: false, code: "limit" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(SITE_LOOKUPS_PER_HOUR_TENANT);
  });
  it("🔴 한 4자리에 학생이 너무 많으면(자리 채움 번호) 이름이 맞아도 보여 주지 않는다 — 선생님께 링크를 받게 한다", async () => {
    for (let i = 0; i < SITE_MAX_STUDENTS_PER_LAST4 + 1; i++) {
      db.tables.students!.push({ id: `s-pad-${i}`, tenant_id: T, name: `자리${i}`, grade: "중1", status: "enrolled", student_phone: "010-0000-0000", parent_phone: null });
      db.tables.enrollments!.push({ tenant_id: T, student_id: `s-pad-${i}`, class_id: C, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false });
      db.tables.lesson_reports!.push(report(`rp${i}`, `s-pad-${i}`, C, "2026-10-01"));
    }
    const r = await look("자리1", "0000");
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    // 학생마다 링크를 새로 만들지 않으므로 "선생님께 링크를 받으라"는 막다른 안내를 하지 않는다(2026-10-03)
    expect(!r.ok && r.error).toContain("ClassNote 알림장에 올려 주세요");
  });
  it("번호 뒤에 글자가 붙은 저장값(`…5678(모)`)도 찾는다 · 가운데에만 그 숫자가 든 번호는 아니다", async () => {
    Object.assign(db.tables.students![0]!, { student_phone: null, parent_phone: "010-1234-5678(모)" });
    Object.assign(db.tables.students![1]!, { parent_phone: "010-5678-1111" });
    expect(dates(await look("류태경"))).toHaveLength(2);
    expect(await look("김민수")).toMatchObject({ ok: false, code: "invalid" });
  });
  it("사이트를 못 여는 상태면 조회도 받지 않는다(시도 기록 없음)", async () => {
    m.settings = { ...withEnglishOff(), modules: { disabled: ["classnote"] } };
    expect(await look()).toMatchObject({ ok: false, code: "unavailable" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
  });
});

describe("링크 열기 — 고른 숙제", () => {
  const pick = async (date = "2026-10-01", name = "류태경") => {
    const r = await look(name);
    if (!r.ok) throw new Error("lookup failed");
    return r.choices.find((c) => c.homeworkLabel === label(date))!.id;
  };
  const open = (choice: unknown, over: { last4?: unknown; name?: unknown; ip?: string } = {}) =>
    openSiteLink({ last4: over.last4 ?? "5678", name: over.name ?? "류태경", choice, ip: over.ip ?? "1.1.1.1" });
  it("고른 숙제의 제출 링크를 만든다 — 주소에 숙제일 · 출처 site · 그 반의 가장 늦은 안 낸 숙제 + 7일까지 · 토큰 원문은 응답에만 · 감사로그", async () => {
    const r = await open(await pick("2026-09-29"));
    expect(r.ok && r.url).toMatch(/^\/v\/[A-Za-z0-9_-]{43}\?h=2026-09-29$/);
    const token = r.ok ? r.url.slice(3, 46) : "";
    expect(db.tables.homework_video_links).toHaveLength(1);
    expect(db.tables.homework_video_links![0]).toMatchObject({
      // 9/29 숙제를 골랐어도 링크는 같은 반의 가장 늦은 안 낸 숙제(10/1) + 7일 = 10/8까지(같은 링크로 다른 숙제도 올린다)
      tenant_id: T, student_id: S, class_id: C, origin: "site", expires_at: "2026-10-09T00:00:00+09:00", token_hash: hashSubmitToken(token),
    });
    expect(JSON.stringify(db.tables.homework_video_links)).not.toContain(token);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T }), expect.objectContaining({
      action: "lesson_report_video_link_issue", targetLabel: "류태경 · LT4",
      metadata: expect.objectContaining({ studentId: S, classId: C, origin: "site", lastDay: "2026-10-08", homeworkDate: "2026-09-29" }),
    }));
  });
  it("🔴 다른 번호·다른 이름·지어낸 지문으로는 만들지 않는다(서버가 같은 번호·이름으로 다시 조회한다)", async () => {
    const choice = await pick();
    expect(await open(choice, { last4: "4321" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await open(choice, { name: "김민수" })).toMatchObject({ ok: false, code: "invalid" }); // 같은 4자리의 다른 학생 이름
    expect(await open(choice, { name: "류" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await open("f".repeat(40))).toMatchObject({ ok: false, code: "invalid" });
    expect(await open(`${S}:${C}`)).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_links).toHaveLength(0);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("🔴 조회한 뒤 그 숙제가 없어졌으면(선생님이 '없음'으로 바꿈·그사이 냄) 열지 않는다", async () => {
    const choice = await pick("2026-10-01");
    Object.assign(db.tables.lesson_reports![0]!, { video_homework: false });
    expect(await open(choice)).toMatchObject({ ok: false, code: "invalid" });
    Object.assign(db.tables.lesson_reports![0]!, { video_homework: true });
    db.tables.student_homework_videos = [{ id: "v1", tenant_id: T, student_id: S, posted_at: "2026-10-02T09:00:00+09:00", route: { classId: C, homeworkDate: "2026-10-01" } }];
    expect(await open(choice)).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_links).toHaveLength(0);
  });
  it("한 학생 × 반이 하루에 만들 수 있는 링크 수를 넘으면 막는다(새 링크로 업로드 횟수 제한을 우회하지 못하게) — 숙제를 바꿔 골라도 같은 상한", async () => {
    const a = await pick("2026-10-01");
    const b = await pick("2026-09-29");
    for (let i = 0; i < SITE_LINKS_PER_PAIR_PER_DAY; i++) expect((await open(i % 2 ? a : b, { ip: `9.9.9.${i}` })).ok).toBe(true);
    expect(await open(a, { ip: "8.8.8.8" })).toMatchObject({ ok: false, code: "limit" });
    expect(db.tables.homework_video_links).toHaveLength(SITE_LINKS_PER_PAIR_PER_DAY);
  });
  it("한 IP의 시간당 열기 횟수도 제한한다 — 넘은 시도는 남기지 않는다", async () => {
    const mine = await pick();
    for (let i = 0; i < SITE_OPENS_PER_HOUR; i++) await open(mine, { ip: "7.7.7.7" });
    const opens = () => db.tables.homework_video_site_attempts!.filter((a) => a.kind === "open").length;
    expect(opens()).toBe(SITE_OPENS_PER_HOUR);
    const r = await open(mine, { ip: "7.7.7.7" });
    expect(r).toMatchObject({ ok: false, code: "limit" });
    expect(!r.ok && r.error).toContain("너무 많이 시도");
    expect(opens()).toBe(SITE_OPENS_PER_HOUR);
  });
  it("🔴 동시에 여러 개를 보내도 학생 × 반의 하루 상한을 넘겨 만들지 못한다(만든 뒤 다시 센다)", async () => {
    const choice = await pick();
    const results = await Promise.all(Array.from({ length: SITE_LINKS_PER_PAIR_PER_DAY + 6 }, (_, i) => open(choice, { ip: `6.6.6.${i}` })));
    // 정확히 상한만큼 남는다 — 서로를 보고 전부 지워 아무도 못 받는 일이 없다.
    expect(db.tables.homework_video_links!.length).toBe(SITE_LINKS_PER_PAIR_PER_DAY);
    expect(results.filter((r) => r.ok).length).toBe(SITE_LINKS_PER_PAIR_PER_DAY);
  });
  it("🔴 선생님이 오늘 그 학생 × 반의 사이트 링크를 끊었으면 그날은 사이트로 다시 열지 못한다", async () => {
    const choice = await pick();
    expect((await open(choice)).ok).toBe(true);
    Object.assign(db.tables.homework_video_links![0]!, { revoked_at: new Date().toISOString() });
    expect(await open(choice)).toMatchObject({ ok: false, code: "limit" });
    expect(db.tables.homework_video_links).toHaveLength(1);
    // 다른 학생은 그대로
    expect((await open(await pick("2026-10-01", "김민수"), { name: "김민수" })).ok).toBe(true);
  });
  it("어제 사이트로 연 링크를 오늘 끊어도 그날은 다시 못 연다 · 어제 끊은 것은 오늘 막지 않는다", async () => {
    const choice = await pick();
    const base = { tenant_id: T, student_id: S, class_id: C, origin: "site", expires_at: "2026-10-03T00:00:00+09:00" };
    db.tables.homework_video_links = [{ ...base, id: "y1", token_hash: "h1", created_at: "2026-10-01T10:00:00+09:00", revoked_at: "2026-10-01T12:00:00+09:00" }];
    expect((await open(choice)).ok).toBe(true);
    db.tables.homework_video_links = [{ ...base, id: "y2", token_hash: "h2", created_at: "2026-10-01T10:00:00+09:00", revoked_at: "2026-10-02T09:00:00+09:00" }];
    expect(await open(choice)).toMatchObject({ ok: false, code: "limit" });
  });
  it("🔴 며칠 전 사이트로 연 링크(숙제 기한까지 살아 있다)를 오늘 끊어도 그날은 다시 못 연다 — 살아 있을 수 있는 링크를 다 본다", async () => {
    const choice = await pick();
    const base = { tenant_id: T, student_id: S, class_id: C, origin: "site", expires_at: "2026-10-09T00:00:00+09:00" };
    db.tables.homework_video_links = [{ ...base, id: "d5", token_hash: "h5", created_at: "2026-09-27T10:00:00+09:00", revoked_at: "2026-10-02T09:00:00+09:00" }];
    expect(await open(choice)).toMatchObject({ ok: false, code: "limit" });
  });
  it("자정을 넘겨 고른 숙제(어제 날짜 지문)도 받는다 · 그보다 오래된 지문은 받지 않는다 · 지문은 숙제마다 다르다", async () => {
    const { createHash } = await import("node:crypto");
    const idOn = (day: string, homework = "2026-10-01") => createHash("sha256").update(`${T}:${S}:${C}:${homework}:${day}`).digest("hex").slice(0, 40);
    const r = await open(idOn("2026-10-01", "2026-09-29"));
    expect(r.ok && r.url.endsWith("?h=2026-09-29")).toBe(true);
    expect(await open(idOn("2026-09-30"))).toMatchObject({ ok: false, code: "invalid" });
    expect(await open(idOn("2026-10-02", "2026-09-30"))).toMatchObject({ ok: false, code: "invalid" }); // 숙제가 나가지 않은 날
  });
});

describe("지점이 여럿일 때 — 주소는 하나(/v), 지점은 화면에서 고른다(원장 2026-10-04 · 멀티테넌트 C안)", () => {
  const THIRD_T = "88888888-8888-4888-8888-888888888888";
  const C_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OTHER_ROOT = "OTHER_BRANCH_ROOT_1";
  /**
   * 둘째 지점(OTHER_T)이 **자기 Google 계정을 연결하고** 저장 폴더를 정했다 — 계정 연결 + 저장된 지점 설정 + 그 지점 워커 기록 + 그 지점의 반·수강·숙제.
   * 🔴 계정 연결 없이 폴더만 정한 지점은 사이트를 쓰지 못한다(첫 지점의 기존 연결을 남의 지점이 쓰지 않는다 — 아래 따로 잠근다).
   */
  function enableOther(enabled = true) {
    m.branches = [{ id: T, name: "인재원 침산" }, { id: OTHER_T, name: "인재원 수성" }];
    for (const [key, value] of Object.entries(WEB_ENV)) vi.stubEnv(key, value);
    withAccountSchema(db);
    if (!db.tables.homework_video_drive_connections!.some((row) => row.tenant_id === OTHER_T)) addConnection(db, OTHER_T);
    // 꺼진 상태 = **연결 해제**(DB 함수가 폴더와 연결을 함께 비운다). 계정은 골랐고 폴더만 없는 상태는 따로 본다(site-setup-pending.test.ts).
    db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, enabled, root_folder_id: enabled ? OTHER_ROOT : null, connection_id: enabled ? CONN : null, version: "12121212-1212-4121-8121-121212121212" }];
    // 첫 지점(T)의 기존 루트 소유 행은 그대로 둔다 — 소유권 표가 있으면 거기 등록된 루트만 기존 연결로 인정한다.
    db.tables.homework_video_drive_roots = [
      ...(db.tables.homework_video_drive_roots ?? []).filter((row) => row.root_folder_id !== OTHER_ROOT),
      { root_folder_id: OTHER_ROOT, tenant_id: OTHER_T, folder_name: "수성 숙제영상", connection_id: CONN },
    ];
    db.tables.classnote_video_history = [{ tenant_id: T, center_id: 96575 }, { tenant_id: OTHER_T, center_id: 77777 }];
    db.tables.classes = [...db.tables.classes!.filter((c) => c.id !== C_OTHER), { id: C_OTHER, tenant_id: OTHER_T, class_name: "수성 A", subject: "math", teacher_id: null, is_active: true }];
    db.tables.enrollments = [...db.tables.enrollments!.filter((e) => e.class_id !== C_OTHER), { tenant_id: OTHER_T, student_id: "s-other", class_id: C_OTHER, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false }];
    db.tables.lesson_reports = [...db.tables.lesson_reports!.filter((r) => r.id !== "r-other"), report("r-other", "s-other", C_OTHER, "2026-10-01", true, OTHER_T)];
  }
  const lookIn = (tenant: unknown, name = "류태경", ip = "1.1.1.1") => lookupSite({ last4: "5678", name, ip, tenant });
  const openIn = (tenant: unknown, choice: unknown, ip = "1.1.1.1") => openSiteLink({ last4: "5678", name: "류태경", choice, ip, tenant });

  it("쓸 수 있는 지점만 목록에 선다 · 지점 없이 물으면 '골라야 한다' · 정해 물으면 그 지점", async () => {
    enableOther();
    expect(await siteDirectory()).toMatchObject({ ok: true, sites: [{ tenantId: T, branchName: "인재원 침산" }, { tenantId: OTHER_T, branchName: "인재원 수성" }] });
    expect(await siteAvailability()).toEqual({ ok: false, reason: "choose" });
    expect(await siteAvailability(undefined, OTHER_T)).toMatchObject({ ok: true, tenantId: OTHER_T });
    expect(await siteAvailability(undefined, T)).toMatchObject({ ok: true, tenantId: T });
  });
  it("🔴 지점을 고르지 않은 조회·열기는 거절한다 — 옛 지점으로 떨어뜨리지 않는다 · 시도 기록도 학생 조회도 없다 · 고를 지점 목록을 함께 준다", async () => {
    enableOther();
    for (const tenant of [undefined, null, ""]) {
      const r = await lookIn(tenant);
      expect(r).toMatchObject({ ok: false, code: "branch" });
      expect(!r.ok && r.code === "branch" && r.branches.map((b) => b.id).sort()).toEqual([T, OTHER_T].sort());
      expect(JSON.stringify(r)).not.toMatch(/류|LT4|수성 A/);
    }
    expect(await openIn(undefined, "a".repeat(40))).toMatchObject({ ok: false, code: "branch" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
    expect(db.tables.homework_video_links).toHaveLength(0);
  });
  it("🔴 목록 밖 지점 번호·모양이 틀린 값·사이트를 안 쓰는 지점은 거절한다(지어낸 값으로 다른 지점을 열지 못한다)", async () => {
    enableOther();
    m.branches.push({ id: THIRD_T, name: "인재원 달서" }); // 공개 목록엔 있지만 저장 폴더가 없는 지점
    for (const tenant of ["12345678-1234-4234-8234-123456789012", "x", 5, {}, [T], ` ${T}`, THIRD_T]) {
      const r = await lookIn(tenant);
      expect(r, String(tenant)).toMatchObject({ ok: false, code: "branch" });
      // 꺼진 지점(달서)은 고를 지점 목록에도 없다
      expect(!r.ok && r.code === "branch" && r.branches.map((b) => b.name).sort()).toEqual(["인재원 수성", "인재원 침산"]);
    }
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
  });
  it("🔴 고른 지점 안에서만 학생을 찾는다 — 같은 이름·같은 뒷자리가 두 지점에 있어도 섞이지 않고, 숙제 지문도 지점마다 다르다", async () => {
    enableOther();
    const mine = await lookIn(T);
    expect(dates(mine)).toEqual([`${label("2026-10-01")}|LT4`, `${label("2026-09-29")}|LT4`]);
    const theirs = await lookIn(OTHER_T);
    expect(dates(theirs)).toEqual([`${label("2026-10-01")}|수성 A`]);
    const ids = (r: typeof mine) => (r.ok ? r.choices.map((c) => c.id) : []);
    expect(ids(mine).some((id) => ids(theirs).includes(id))).toBe(false);
    // 시도 기록은 고른 지점에만 남는다
    expect(db.tables.homework_video_site_attempts!.map((a) => a.tenant_id)).toEqual([T, OTHER_T]);
  });
  it("🔴 다른 지점에서 받은 숙제 지문으로는 열지 못한다 · 고른 지점의 링크는 그 지점 것으로만 만들어진다", async () => {
    enableOther();
    const theirs = await lookIn(OTHER_T);
    const choice = theirs.ok ? theirs.choices[0]!.id : "";
    expect(await openIn(T, choice)).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.homework_video_links).toHaveLength(0);
    const opened = await openIn(OTHER_T, choice);
    expect(opened.ok && opened.url).toMatch(/^\/v\/[A-Za-z0-9_-]{43}\?h=2026-10-01$/);
    expect(db.tables.homework_video_links).toHaveLength(1);
    expect(db.tables.homework_video_links![0]).toMatchObject({ tenant_id: OTHER_T, student_id: "s-other", class_id: C_OTHER, origin: "site" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: OTHER_T }), expect.anything());
  });
  it("횟수 제한은 고른 지점 안에서만 센다 — 한 지점의 한도가 다른 지점 학생을 막지 않는다", async () => {
    enableOther();
    for (let i = 0; i < SITE_LOOKUPS_PER_HOUR; i++) await lookIn(T);
    expect(await lookIn(T)).toMatchObject({ ok: false, code: "limit" });
    expect((await lookIn(OTHER_T)).ok).toBe(true);
  });
  it("공개 지점은 여럿이어도 사이트를 쓰는 지점이 하나면 고르지 않는다(지금까지와 같다) — 그 지점을 골라 보내도 된다", async () => {
    m.branches = [{ id: T, name: "인재원 침산" }, { id: OTHER_T, name: "인재원 수성" }];
    expect(await siteAvailability()).toMatchObject({ ok: true, tenantId: T });
    expect(dates(await lookIn(undefined))).toHaveLength(2);
    expect(dates(await lookIn(T))).toHaveLength(2);
    // 저장 폴더가 없는 지점을 고르면 거절 — 남은 한 지점만 목록에 온다
    const r = await lookIn(OTHER_T);
    expect(r).toMatchObject({ ok: false, code: "branch", branches: [{ id: T, name: "인재원 침산" }] });
  });
  it("🔴 저장 폴더 연결을 해제한 지점·ClassNote 기능을 끈 지점은 목록에서 빠진다(있었는지조차 모르게)", async () => {
    enableOther(false);
    expect(await siteDirectory()).toMatchObject({ ok: true, sites: [{ tenantId: T }] });
    expect(await siteAvailability(undefined, OTHER_T)).toEqual({ ok: false, reason: "none" });
    enableOther();
    m.settingsOf = { [OTHER_T]: { ...withEnglishOff(), modules: { disabled: ["classnote"] } } };
    const directory = await siteDirectory();
    expect(directory.ok && directory.sites.map((site) => site.tenantId)).toEqual([T]);
    expect(await lookIn(OTHER_T)).toMatchObject({ ok: false, code: "branch" });
  });
  it("🔴 판정하지 못한 지점(잠시 못 받음)이 있으면 고르지 않은 요청을 남은 지점으로 정하지 않는다 — 고른 지점은 그 지점만 보고 통과한다", async () => {
    enableOther();
    // 둘째 지점은 저장 폴더는 있지만 워커 기록이 아직 없다(잠시 못 받음) — 쓸 수 있는 지점은 침산 하나뿐이다
    db.tables.classnote_video_history = [{ tenant_id: T, center_id: 96575 }];
    expect(await siteDirectory()).toMatchObject({ ok: true, partial: true, sites: [{ tenantId: T }] });
    expect(await siteAvailability()).toEqual({ ok: false, reason: "choose" });
    // 고르지 않은 요청 — 그 지점 학생일 수 있으므로 침산에서 찾지 않는다(같은 이름·같은 뒷자리가 침산에 있다)
    expect(await lookIn(undefined)).toMatchObject({ ok: false, code: "unavailable" });
    expect(await openIn(undefined, "a".repeat(40))).toMatchObject({ ok: false, code: "unavailable" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
    // 침산을 골라 보낸 요청은 그대로 된다(다른 지점의 상태와 무관하다)
    expect(dates(await lookIn(T))).toHaveLength(2);
    // 못 받는 지점을 골라 보내면 그 지점으로도, 남은 지점으로도 가지 않는다 — 고를 수 있는 지점만 돌려준다
    const r = await lookIn(OTHER_T);
    expect(r).toMatchObject({ ok: false, code: "branch", branches: [{ id: T, name: "인재원 침산" }] });
    expect(JSON.stringify(r)).not.toMatch(/류|LT4/);
    // 판정하지 못한 지점이 없으면(저장 폴더가 아예 없는 지점) 종전대로 남은 한 지점이 곧 유일한 지점이다
    db.tables.homework_video_drive_settings = [];
    expect(await siteDirectory()).toMatchObject({ ok: true, partial: false, sites: [{ tenantId: T }] });
    expect(dates(await lookIn(undefined))).toHaveLength(2);
  });
  it("한 지점의 설정을 못 읽어도 다른 지점은 그대로 선다(고른 요청만) · 전부 못 읽으면 잠시 못 받음(없는 주소로 단정하지 않는다)", async () => {
    enableOther();
    const broken = new Proxy({}, { get() { throw new Error("boom"); } });
    m.settingsOf = { [OTHER_T]: broken };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const directory = await siteDirectory();
    expect(directory.ok && directory.sites.map((site) => site.tenantId)).toEqual([T]);
    expect(directory.ok && directory.partial).toBe(true);
    // 🔴 고르지 않은 요청은 남은 지점으로 정하지 않는다 — 조회 오류였으니 "잠시 후 다시"
    expect(await lookIn(undefined)).toMatchObject({ ok: false, code: "error" });
    expect(db.tables.homework_video_site_attempts).toHaveLength(0);
    // 침산을 골라 보낸 요청은 된다
    expect(dates(await lookIn(T))).toHaveLength(2);
    m.settingsOf = { [OTHER_T]: broken, [T]: broken };
    expect(await siteDirectory()).toEqual({ ok: false, reason: "unavailable" });
    // 공개 조회는 순간 오류를 "받을 수 없다"로 바꿔 말하지 않는다 — "잠시 후 다시"(지점을 골랐든 안 골랐든)
    for (const tenant of [undefined, T]) {
      const r = await lookIn(tenant);
      expect(r).toMatchObject({ ok: false, code: "error" });
      expect(!r.ok && r.error).toContain("잠시 후 다시");
    }
    // 실패한 조회는 시도로 남지 않는다 — 위에서 침산을 골라 성공한 조회 한 건뿐이다
    expect(db.tables.homework_video_site_attempts).toHaveLength(1);
    errors.mockRestore();
  });
  it("🔴 계정을 연결하지 않고 폴더만 정한 지점은 사이트를 쓰지 못한다 — 첫 지점의 기존 연결(env 자격)을 남의 지점이 쓰지 않는다", async () => {
    enableOther();
    // 둘째 지점의 연결을 지우고 폴더만 남긴다(예전 '공용 계정 + 폴더 분리' 모양).
    db.tables.homework_video_drive_connections = [];
    db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, enabled: true, root_folder_id: OTHER_ROOT, connection_id: null, version: "12121212-1212-4121-8121-121212121212" }];
    db.tables.homework_video_drive_roots = db.tables.homework_video_drive_roots!.map((row) => (row.root_folder_id === OTHER_ROOT ? { ...row, connection_id: null } : row));
    expect(await siteAvailability(undefined, OTHER_T)).toMatchObject({ ok: false });
    const directory = await siteDirectory();
    expect(directory.ok && directory.sites.map((site) => site.tenantId)).toEqual([T]);
    // 첫 지점은 그대로 받는다.
    expect(await siteAvailability(undefined, T)).toMatchObject({ ok: true, tenantId: T });
  });
  it("연결한 계정을 다시 연결해야 하는 지점은 '없는 지점'이 아니라 '잠시 못 받음' — 남은 지점으로 저절로 정하지 않는다", async () => {
    enableOther();
    db.tables.homework_video_drive_connections![0]!.status = "needs_reauth";
    expect(await siteAvailability(undefined, OTHER_T)).toEqual({ ok: false, reason: "unavailable" });
    expect(await siteDirectory()).toMatchObject({ ok: true, partial: true, sites: [{ tenantId: T }] });
    expect(await siteAvailability()).toEqual({ ok: false, reason: "choose" });
  });
});
