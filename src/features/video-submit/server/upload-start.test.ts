import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOMEWORK_VIDEO_MAX_BYTES } from "@/features/students/homework-video-limits";
import { addDays, kstToday } from "@/lib/date-kst";
import { _resetVideoHomeworkProbeForTest } from "@/features/video-homework/server/assignments";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, FILE, FOLDER, OTHER_T, ROOT, S, SESSION, T, TOKEN, fakeDrive, seedDb, settings } from "./test-fixture.test-util";

const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));

import { startLinkUpload } from "./upload-start";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoSubmitAvailabilityForTest } from "./availability";

const file = { name: "IMG_0001.MOV", size: 5_000_000, type: "video/quicktime" };
const req = async (over: Partial<Parameters<typeof startLinkUpload>[0]> = {}) =>
  (await startLinkUpload({ token: TOKEN, file, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr", ...over })).result;
let db: FakeDb;
let drive: ReturnType<typeof fakeDrive>;
/** 오늘(KST) 그 학생 × 반에 영상 숙제가 나갔다 — 올리기 사이트 링크는 고른 숙제가 있어야 올린다(2026-10-03). */
const TODAY = kstToday();
/** 숙제 없이 올리기의 전제 — 재원생이 지금 그 반을 다닌다(반이 살아 있다). */
const liveClass = (enrollment: Record<string, unknown> = {}) => {
  db.tables.students![0]!.status = "enrolled";
  db.tables.classes![0]!.is_active = true;
  (db.tables.enrollments ??= []).push({ id: `e-${(db.tables.enrollments ?? []).length}`, tenant_id: T, student_id: S, class_id: C,
    start_date: addDays(TODAY, -30), end_date: null, on_hold: false, is_transferred: false, ...enrollment });
};
const assignHomework = (date = TODAY, over: Record<string, unknown> = {}) =>
  db.tables.lesson_reports!.push({ id: `r-${date}-${db.tables.lesson_reports!.length}`, tenant_id: T, student_id: S, class_id: C, report_date: date, video_homework: true, ...over });

beforeEach(() => {
  db = seedDb();
  m.db = db;
  m.settings = settings();
  drive = fakeDrive();
  vi.stubGlobal("fetch", vi.fn(drive.impl));
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  _resetVideoDriveConfigForTest();
  _resetVideoSubmitAvailabilityForTest();
  _resetVideoHomeworkProbeForTest();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("업로드 시작 — 거절", () => {
  it("위조·모양이 다른 토큰은 Drive를 부르지 않는다", async () => {
    expect(await req({ token: "x".repeat(43) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await req({ token: "../../etc" })).toMatchObject({ ok: false, code: "invalid" });
    expect(drive.calls).toHaveLength(0);
  });
  it("끊긴 링크·만료된 링크", async () => {
    m.db = seedDb({ link: { revoked_at: new Date().toISOString() } });
    expect(await req()).toMatchObject({ ok: false, code: "invalid" });
    m.db = seedDb({ link: { expires_at: new Date(Date.now() - 1000).toISOString() } });
    expect(await req()).toMatchObject({ ok: false, code: "expired", error: "만료된 링크입니다." });
    expect(drive.calls).toHaveLength(0);
  });
  it("1GB 초과·영상 아님은 세션을 열지 않는다", async () => {
    expect(await req({ file: { ...file, size: HOMEWORK_VIDEO_MAX_BYTES + 1 } })).toMatchObject({ ok: false, code: "file" });
    expect(await req({ file: { name: "a.pdf", size: 10, type: "application/pdf" } })).toMatchObject({ ok: false, code: "file" });
    expect(drive.calls).toHaveLength(0);
  });
  it("다른 출처가 세션을 받아 가지 못한다", async () => {
    expect(await req({ origin: "https://evil.example" })).toMatchObject({ ok: false });
    expect(drive.calls).toHaveLength(0);
  });
  it("Drive 값이 다른 지점 것이면 쓸 수 없다(그 학원 Drive로 안 올린다)", async () => {
    vi.stubEnv("CLASSNOTE_VIDEO_TENANT_ID", OTHER_T);
    expect(await req()).toMatchObject({ ok: false, code: "unavailable" });
    expect(drive.calls).toHaveLength(0);
  });
  it("ClassNote 기능이 꺼진 학원·SQL 전 DB는 쓸 수 없다", async () => {
    m.settings = { ...settings(), modules: { disabled: ["classnote"] } };
    expect(await req()).toMatchObject({ ok: false, code: "unavailable" });
    m.settings = settings();
    db.dropTable("homework_video_link_uploads");
    expect(await req()).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("한 시간 10번을 넘기면 멈추고, 그때는 지난 업로드 대신 마무리(Drive 조회)도 하지 않는다", async () => {
    const now = new Date().toISOString();
    db.tables.homework_video_link_uploads = Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, tenant_id: T, link_id: "L1", status: "started", created_at: now }));
    const out = await startLinkUpload({ token: TOKEN, file, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr" });
    expect(out.result).toMatchObject({ ok: false, code: "limit" });
    expect(out.followUp).toBeNull();
  });
  it("🔴 사이트가 만든 링크는 그 학생 × 반의 사이트 링크를 합쳐 센다 — 링크를 새로 열어 횟수 제한을 늘리지 못한다", async () => {
    const now = new Date().toISOString();
    Object.assign(db.tables.homework_video_links![0]!, { origin: "site", created_at: now });
    // 같은 학생 × 반의 다른 사이트 링크 L2에 이미 10번 · 다른 학생의 사이트 링크 L9는 세지 않는다
    db.tables.homework_video_links!.push(
      { id: "L2", tenant_id: T, student_id: S, class_id: C, origin: "site", created_at: now, expires_at: "2099-01-01T00:00:00+09:00", revoked_at: null, token_hash: "x2" },
      { id: "L9", tenant_id: T, student_id: "other-student", class_id: C, origin: "site", created_at: now, expires_at: "2099-01-01T00:00:00+09:00", revoked_at: null, token_hash: "x9" },
    );
    db.tables.homework_video_link_uploads = Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, tenant_id: T, link_id: "L9", status: "started", created_at: now }));
    assignHomework();
    expect((await req({ homeworkDate: TODAY })).ok).toBe(true);
    db.tables.homework_video_link_uploads = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, tenant_id: T, link_id: "L2", status: "started", created_at: now }));
    expect(await req({ homeworkDate: TODAY })).toMatchObject({ ok: false, code: "limit" });
    // 보고서·원생 탭 링크는 종전대로 그 링크 하나만 센다
    Object.assign(db.tables.homework_video_links![0]!, { origin: "manual" });
    expect((await req()).ok).toBe(true);
  });
  it("동시에 몰려도 한도를 넘는 시작은 세션을 열지 못한다(넣은 뒤 다시 센다)", async () => {
    const now = new Date().toISOString();
    db.tables.homework_video_link_uploads = Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, tenant_id: T, link_id: "L1", status: "failed", created_at: now }));
    const results = await Promise.all(Array.from({ length: 6 }, () => req()));
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(2);
    expect(drive.calls.filter((c) => c.url.includes("uploadType=resumable")).length).toBeLessThanOrEqual(2);
  });
});

describe("업로드 시작 — 정상", () => {
  it("끝나지 않은 같은 파일 시도 4건은 재업로드를 막지 않는다", async () => {
    db.tables.homework_video_link_uploads = Array.from({ length: 4 }, (_, i) => ({ id: `unfinished-${i}`, tenant_id: T, link_id: "L1", status: "started", created_at: new Date().toISOString(), bytes: file.size }));
    expect((await req()).ok).toBe(true);
    expect(db.tables.homework_video_link_uploads).toHaveLength(5);
  });
  it("담임 폴더·미리 받은 번호·세션 주소 — 메타데이터는 서버가 정하고 크기를 못박는다", async () => {
    const result = await req();
    expect(result).toMatchObject({ ok: true, sessionUrl: SESSION });
    const upload = db.tables.homework_video_link_uploads![0]!;
    expect(upload).toMatchObject({ tenant_id: T, link_id: "L1", drive_file_id: FILE, drive_folder_id: FOLDER, bytes: 5_000_000, mime_type: "video/quicktime" });
    expect(String(upload.file_name)).toMatch(/^류태경_LT4_칠성초3_\d{4}-\d{2}-\d{2}\.mov$/);
    expect(upload.route).toMatchObject({ tenantId: T, studentId: S, classId: C, teacherId: expect.any(String), folderName: "이수진 선생님", reason: "제출 링크" });
    const start = drive.calls.find((c) => c.url.includes("uploadType=resumable"))!;
    const headers = start.init!.headers as Record<string, string>;
    expect(headers.Origin).toBe("https://www.aywa.co.kr");
    expect(headers["X-Upload-Content-Length"]).toBe("5000000");
    const body = JSON.parse(String(start.init!.body));
    expect(body).toMatchObject({ id: FILE, parents: [FOLDER], appProperties: { aywaSource: "link", aywaUpload: result.ok ? result.uploadId : "" } });
  });
  it("🔴 올리기 사이트 링크는 고른 숙제가 있어야 올린다 — 주소의 숙제일을 믿지 않고 그 학생 × 반에 실제로 나간 영상 숙제인지 확인한다", async () => {
    Object.assign(db.tables.homework_video_links![0]!, { origin: "site", created_at: new Date().toISOString() });
    assignHomework(TODAY);
    assignHomework(addDays(TODAY, -3), { video_homework: false }); // 그날은 영상 숙제가 없었다
    assignHomework(addDays(TODAY, -20)); // 오래전 숙제
    assignHomework(addDays(TODAY, -8)); // 숙제일 + 7일이 지났다(원장 "숙제날짜 기준 7일")
    assignHomework(addDays(TODAY, -1), { student_id: "other-student" }); // 다른 학생의 숙제
    assignHomework(addDays(TODAY, -2), { tenant_id: OTHER_T }); // 다른 지점
    for (const bad of ["", "2026-13-99", "어제", addDays(TODAY, -3), addDays(TODAY, -20), addDays(TODAY, -8), addDays(TODAY, -1), addDays(TODAY, -2), addDays(TODAY, 1), 20261003]) {
      const r = await req({ homeworkDate: bad, note: "메모가 있어도 숙제를 골랐으면 그 숙제가 맞아야 한다" });
      expect(r, String(bad)).toMatchObject({ ok: false, code: "invalid" });
      expect(!r.ok && r.error, String(bad)).toContain("숙제를 다시 골라 주세요");
    }
    // 숙제를 고르지 않았으면(숙제 없이 올리기) 메모가 있어야 한다(2026-10-13)
    for (const none of [undefined, null]) {
      const r = await req({ homeworkDate: none });
      expect(r, String(none)).toMatchObject({ ok: false, code: "file" });
      expect(!r.ok && r.error).toContain("메모");
    }
    expect(await req({ note: " 가 " })).toMatchObject({ ok: false, code: "file" });
    // 거절된 시작은 Drive 세션을 열지 않고 업로드 기록도 남기지 않는다
    expect(drive.calls.filter((c) => c.url.includes("uploadType=resumable"))).toHaveLength(0);
    expect(db.tables.homework_video_link_uploads).toHaveLength(0);
    expect((await req({ homeworkDate: TODAY })).ok).toBe(true);
    // 확인된 숙제일이 업로드 경로에 실린다 — 영상 줄로 그대로 넘어가 영상 제출 현황이 그 숙제 칸에 붙인다
    expect(db.tables.homework_video_link_uploads![0]!.route).toMatchObject({ classId: C, studentId: S, homeworkDate: TODAY });
  });
  it("숙제 없이 올리기(사이트 링크 · 메모 필수 · 하루 5개) — 메모는 다듬어 업로드 경로에 실린다 · 숙제일은 싣지 않는다", async () => {
    Object.assign(db.tables.homework_video_links![0]!, { origin: "site", created_at: new Date().toISOString() });
    liveClass();
    const fresh = () => { drive = fakeDrive(); vi.stubGlobal("fetch", vi.fn(drive.impl)); };
    expect((await req({ note: "  10월 6일\n숙제   3번 풀이 " })).ok).toBe(true);
    // 🔴 '숙제 없이 올린 영상' 표시(free)가 함께 실린다 — 없으면 게시일순 자동 짝이 남은 숙제를 채운다
    expect(db.tables.homework_video_link_uploads![0]!.route).toMatchObject({ classId: C, studentId: S, note: "10월 6일 숙제 3번 풀이", free: true });
    expect(db.tables.homework_video_link_uploads![0]!.route).not.toHaveProperty("homeworkDate");
    // 오늘 이미 5개를 시작했으면(거절된 것 빼고) 더 받지 않는다 — 숙제를 고른 업로드는 세지 않는다
    const row = db.tables.homework_video_link_uploads![0]!;
    row.drive_file_id = "f0"; // 가짜 Drive는 파일 번호가 하나다 — 다음 시작과 겹치지 않게
    db.tables.homework_video_link_uploads!.push(
      ...[1, 2, 3].map((i) => ({ ...row, id: `free-${i}`, drive_file_id: `f${i}` })),
      { ...row, id: "failed-1", drive_file_id: "ff", status: "failed" },
      { ...row, id: "hw-1", drive_file_id: "fh", route: { ...(row.route as object), homeworkDate: TODAY } },
    );
    fresh();
    const fifth = await req({ note: "다섯 번째" });
    expect(fifth, JSON.stringify(fifth)).toMatchObject({ ok: true });
    db.tables.homework_video_link_uploads!.at(-1)!.drive_file_id = "f5";
    fresh();
    const over = await req({ note: "여섯 번째" });
    expect(over).toMatchObject({ ok: false, code: "limit" });
    expect(!over.ok && over.error).toContain("하루 5개");
    // 숙제를 고른 업로드는 그 상한과 무관하다
    assignHomework(TODAY);
    fresh();
    expect((await req({ homeworkDate: TODAY })).ok).toBe(true);
  });
  it("숙제 없이 올리기는 지금 그 반을 다닐 때만 — 끝난 수강·휴원·퇴원·영상 숙제 대상 밖이면 Drive를 열지 않는다", async () => {
    Object.assign(db.tables.homework_video_links![0]!, { origin: "site", created_at: new Date().toISOString() });
    const ask = () => req({ note: "추가 연습 영상" });
    expect(await ask()).toMatchObject({ ok: false, code: "invalid" }); // 수강 기록이 없다
    liveClass({ end_date: addDays(TODAY, -1) });
    expect(await ask()).toMatchObject({ ok: false, code: "invalid" });
    db.tables.enrollments = [];
    liveClass({ on_hold: true });
    expect(await ask()).toMatchObject({ ok: false, code: "invalid" });
    db.tables.enrollments = [];
    liveClass();
    db.tables.students![0]!.status = "withdrawn";
    expect(await ask()).toMatchObject({ ok: false, code: "invalid" });
    db.tables.students![0]!.status = "enrolled";
    m.settings = { ...settings(), report: { videoHomeworkPolicy: { enabled: true, disabledSubjectKeys: ["math"], disabledSchoolLevels: [], disabledClassIds: [] } } };
    expect(await ask()).toMatchObject({ ok: false, code: "invalid" });
    expect(drive.calls.filter((c) => c.url.includes("uploadType=resumable"))).toHaveLength(0);
    expect(db.tables.homework_video_link_uploads ?? []).toHaveLength(0);
    m.settings = settings();
    expect(await ask()).toMatchObject({ ok: true });
  });
  it("🔴 영상 과제 값을 읽을 수 없으면(0308a 전·순간 오류) '숙제를 다시 고르라'가 아니라 잠시 못 받음 — 학생을 처음 화면으로 돌려보내지 않는다", async () => {
    Object.assign(db.tables.homework_video_links![0]!, { origin: "site", created_at: new Date().toISOString() });
    db.dropTable("lesson_reports");
    const r = await req({ homeworkDate: TODAY });
    expect(r).toMatchObject({ ok: false, code: "error" });
    expect(!r.ok && r.error).not.toContain("숙제를 다시 골라");
    expect(drive.calls.filter((c) => c.url.includes("uploadType=resumable"))).toHaveLength(0);
  });
  it("학생 상세에서 복사한 링크는 숙제일이 없어도 예전처럼 올린다 · 확인 안 되는 숙제일은 싣지 않는다(게시일순 규칙으로 센다)", async () => {
    // 가짜 Drive는 파일 번호가 하나라 경우마다 DB를 새로 깐다.
    const fresh = () => { db = seedDb(); m.db = db; };
    expect((await req()).ok).toBe(true);
    expect(db.tables.homework_video_link_uploads![0]!.route).not.toHaveProperty("homeworkDate");
    fresh();
    expect((await req({ homeworkDate: addDays(TODAY, -1) })).ok).toBe(true); // 숙제가 나간 날이 아니다
    expect(db.tables.homework_video_link_uploads![0]!.route).not.toHaveProperty("homeworkDate");
    fresh();
    assignHomework(addDays(TODAY, -1));
    expect((await req({ homeworkDate: addDays(TODAY, -1) })).ok).toBe(true);
    expect(db.tables.homework_video_link_uploads![0]!.route).toMatchObject({ homeworkDate: addDays(TODAY, -1) });
  });
  it("세션 응답에 접근 토큰·클라이언트 비밀이 실리지 않는다", async () => {
    const result = await req();
    expect(JSON.stringify(result)).not.toMatch(/access|secret|refresh/);
  });
});

describe("못 알린 지난 업로드 — 다시 시작할 때 서버가 대신 마무리", () => {
  it("2분 넘게 '시작됨'인 업로드가 Drive에 다 있으면 줄을 만들고 돌려준다", async () => {
    db.tables.homework_video_link_uploads = [{
      id: "55555555-5555-4555-8555-555555555555", tenant_id: T, link_id: "L1", drive_file_id: FILE, drive_folder_id: FOLDER, bytes: 77,
      status: "started", video_id: null, route: { rootId: ROOT, classId: C, studentId: S }, created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    }];
    drive = fakeDrive({ uploaded: {
      id: FILE, size: "77", md5Checksum: "0123456789abcdef0123456789abcdef", parents: [FOLDER], trashed: false,
      appProperties: { aywaSource: "link", aywaUpload: "55555555-5555-4555-8555-555555555555" },
    } });
    vi.stubGlobal("fetch", vi.fn(drive.impl));
    const { result, followUp } = await startLinkUpload({ token: TOKEN, file, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr" });
    expect(db.tables.student_homework_videos).toHaveLength(0); // 응답 전에는 하지 않는다(응답 뒤 after)
    expect(await followUp!()).toHaveLength(1);
    expect(db.tables.student_homework_videos).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(S); // 마무리 결과(학생·반)는 응답에 싣지 않는다
  });
  it("연결 해제 후 새 시작은 거절하지만 이미 올라간 소유 루트의 파일은 응답 뒤 마무리한다", async () => {
    const uploadId="55555555-5555-4555-8555-555555555555";
    db.tables.homework_video_drive_settings=[{tenant_id:T,enabled:false}];
    db.tables.homework_video_link_uploads=[{id:uploadId,tenant_id:T,link_id:"L1",drive_file_id:FILE,drive_folder_id:FOLDER,bytes:77,
      status:"started",video_id:null,route:{rootId:ROOT,classId:C,studentId:S},created_at:new Date(Date.now()-5*60_000).toISOString()}];
    drive=fakeDrive({uploaded:{id:FILE,size:"77",md5Checksum:"0123456789abcdef0123456789abcdef",parents:[FOLDER],trashed:false,
      appProperties:{aywaSource:"link",aywaUpload:uploadId}}});
    vi.stubGlobal("fetch",vi.fn(drive.impl));
    const out=await startLinkUpload({token:TOKEN,file,origin:"https://www.aywa.co.kr",host:"www.aywa.co.kr"});
    expect(out.result).toMatchObject({ok:false,code:"unavailable"});
    expect(await out.followUp!()).toHaveLength(1);
    expect(db.tables.student_homework_videos).toHaveLength(1);
    expect(drive.calls.some(c=>c.url.includes("uploadType=resumable"))).toBe(false);
  });
});
