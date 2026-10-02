import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, OTHER_T, S, T, seedDb, settings } from "./test-fixture.test-util";
import { hashSubmitToken } from "./token";

const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown, audit: vi.fn(), linkColumn: "ready" as "ready" | "missing" | "unknown" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));
vi.mock("@/features/audit/server/log", () => ({ logActionAs: m.audit }));
vi.mock("@/features/video-homework/server/assignments", () => ({ videoHomeworkColumnReady: async () => true }));
// 링크 넣기 칸(0328a) 유무 — 가짜 DB는 select 필드를 보지 않으므로 여기서 정한다.
vi.mock("./link-choice-db", () => ({ videoSubmitLinkColumn: async () => m.linkColumn }));

import { reportLineMode, reportVideoLinkToken } from "./report-link";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoSubmitAvailabilityForTest } from "./availability";

const R = "66666666-6666-4666-8666-666666666666";
let db: FakeDb;
const report = (over: Record<string, unknown> = {}) => ({
  id: R, tenant_id: T, student_id: S, class_id: C, subject: "math", report_date: "2026-10-01", video_homework: true, revoked_at: null,
  video_submit_link: true, share_token: "share-1", ...over,
});
function setup(over: Record<string, unknown> = {}, studentName = "류태경") {
  db = seedDb();
  db.tables.homework_video_links = [];
  db.tables.lesson_reports = [report(over)];
  db.tables.students![0]!.name = studentName;
  m.db = db;
}
beforeEach(() => {
  m.settings = settings();
  m.linkColumn = "ready";
  m.audit.mockReset();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  _resetVideoDriveConfigForTest();
  _resetVideoSubmitAvailabilityForTest();
});
afterEach(() => vi.unstubAllEnvs());

describe("보고서 글의 '영상 제출' 줄 — 앱이 정한다", () => {
  it("🔴 단계 값은 env가 무엇이든 꺼짐 — 보고서 글에 영상 제출 링크를 더는 붙이지 않는다(원장 2026-10-03)", async () => {
    expect(reportLineMode({})).toBe("off");
    expect(reportLineMode({ VIDEO_SUBMIT_REPORT_LINE: "yes" })).toBe("off");
    expect(reportLineMode({ VIDEO_SUBMIT_REPORT_LINE: " ON " })).toBe("off");
    expect(reportLineMode({ VIDEO_SUBMIT_REPORT_LINE: "test" })).toBe("off");
    // 발송 직전 판정의 기본값이 그 값이라, env를 켜 둔 채여도 링크를 만들지 않는다(DB도 안 본다)
    vi.stubEnv("VIDEO_SUBMIT_REPORT_LINE", "on");
    setup();
    expect(await reportVideoLinkToken(R)).toBeNull();
    expect(db.tables.homework_video_links).toHaveLength(0);
  });
  it("꺼짐이면 DB도 안 본다", async () => {
    setup();
    expect(await reportVideoLinkToken(R, "off")).toBeNull();
    expect(db.tables.homework_video_links).toHaveLength(0);
  });
  it("영상 과제 있음 + 검사 대상 → 보고서일 기준 7일 토큰(원문은 응답에만, DB엔 해시·보고서 번호)", async () => {
    setup();
    const token = await reportVideoLinkToken(R, "on");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.tables.homework_video_links).toHaveLength(1);
    expect(db.tables.homework_video_links![0]).toMatchObject({
      tenant_id: T, student_id: S, class_id: C, origin: "report", report_id: R,
      token_hash: hashSubmitToken(token!), expires_at: "2026-10-09T00:00:00+09:00",
      // 그 보고서의 공유 토큰 지문 — 회수·재발급되면 이 링크도 닫힌다(links.ts reportStillStands).
      report_share_hash: hashSubmitToken("share-1"),
    });
    expect(JSON.stringify(db.tables.homework_video_links)).not.toContain(token!);
    expect(m.audit).toHaveBeenCalledTimes(1);
  });
  it("강사가 '영상 첨부 링크 넣기'를 켜지 않은 보고서(끔·고른 적 없음)는 붙이지 않는다", async () => {
    for (const over of [{ video_submit_link: false }, { video_submit_link: null }]) {
      setup(over);
      expect(await reportVideoLinkToken(R, "on")).toBeNull();
      expect(db.tables.homework_video_links).toHaveLength(0);
    }
  });
  it("링크 넣기 칸이 아직 없으면(SQL 적용 전) 10-01 규칙 그대로 · 칸 유무를 못 물어봤으면 붙이지 않는다", async () => {
    m.linkColumn = "missing";
    setup({ video_submit_link: undefined });
    expect(await reportVideoLinkToken(R, "on")).not.toBeNull();
    m.linkColumn = "unknown";
    setup();
    expect(await reportVideoLinkToken(R, "on")).toBeNull();
    expect(db.tables.homework_video_links).toHaveLength(0);
  });
  it("영상 과제 없음·모름·영어·취소·반 없음·정책이 끈 반은 붙이지 않는다", async () => {
    for (const over of [{ video_homework: false }, { video_homework: null }, { subject: "english" }, { revoked_at: "2026-10-01T00:00:00Z" }, { class_id: null }]) {
      setup(over);
      expect(await reportVideoLinkToken(R, "on")).toBeNull();
    }
    setup();
    m.settings = { ...settings(), report: { videoHomeworkPolicy: { ...settings().report.videoHomeworkPolicy, disabledClassIds: [C] } } };
    expect(await reportVideoLinkToken(R, "on")).toBeNull();
    expect(db.tables.homework_video_links).toHaveLength(0);
  });
  it("시험 단계는 테스트 학생 '학원이'만", async () => {
    setup();
    expect(await reportVideoLinkToken(R, "test")).toBeNull();
    setup({}, "학원이");
    expect(await reportVideoLinkToken(R, "test")).not.toBeNull();
  });
  it("Drive 값이 다른 지점 것·기능 꺼짐이면 붙이지 않는다", async () => {
    setup();
    vi.stubEnv("CLASSNOTE_VIDEO_TENANT_ID", OTHER_T);
    expect(await reportVideoLinkToken(R, "on")).toBeNull();
    vi.stubEnv("CLASSNOTE_VIDEO_TENANT_ID", T);
    m.settings = { ...settings(), modules: { disabled: ["classnote"] } };
    expect(await reportVideoLinkToken(R, "on")).toBeNull();
  });
  it("반이 그 지점 것이 아니면(다른 지점 반 번호) 붙이지 않는다", async () => {
    setup();
    db.tables.classes![0]!.tenant_id = OTHER_T;
    expect(await reportVideoLinkToken(R, "on")).toBeNull();
  });
  it("모양이 다른 보고서 번호는 거른다", async () => {
    setup();
    expect(await reportVideoLinkToken("1 or 1=1", "on")).toBeNull();
    expect(await reportVideoLinkToken(undefined, "on")).toBeNull();
  });
});
