import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, OTHER_T, S, T, seedDb, settings } from "./test-fixture.test-util";

const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown, site: null as unknown, homeworkReady: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));
vi.mock("@/features/video-homework/server/assignments", () => ({ videoHomeworkColumnReady: async () => m.homeworkReady }));
// 올리기 사이트를 쓸 수 있나(Drive·SQL·지점) — 사이트 판정 자체는 site.test.ts가 본다.
vi.mock("./site", () => ({ siteAvailability: async () => m.site }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-10-02" }));

import { reportLineMode, reportSiteLine } from "./report-link";

const R = "66666666-6666-4666-8666-666666666666";
let db: FakeDb;
const report = (over: Record<string, unknown> = {}) => ({
  id: R, tenant_id: T, student_id: S, class_id: C, subject: "math", report_date: "2026-10-01", video_homework: true, revoked_at: null,
  video_submit_link: null, share_token: "share-1", ...over,
});
function setup(over: Record<string, unknown> = {}) {
  db = seedDb();
  db.tables.homework_video_links = [];
  db.tables.lesson_reports = [report(over)];
  m.db = db;
}
beforeEach(() => {
  m.settings = settings();
  m.site = { ok: true, tenantId: T };
  m.homeworkReady = true;
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe("보고서 글의 '영상첨부' 줄 = 올리기 사이트 주소 안내(원장 2026-10-03 \"영상숙제 체크하더라도 /v 링크를 안내\")", () => {
  it("영상 과제 있음 + 검사 대상 반 + 사이트를 쓸 수 있는 지점 → 붙인다 · 학생마다 링크는 만들지 않는다", async () => {
    setup();
    expect(await reportSiteLine(R)).toBe(true);
    expect(db.tables.homework_video_links).toHaveLength(0);
  });
  it("강사가 행마다 켜던 '영상 첨부 링크 넣기'는 거뒀다 — 그 값과 상관없이 영상 과제 있음이면 붙인다", async () => {
    for (const over of [{ video_submit_link: false }, { video_submit_link: null }, { video_submit_link: true }]) {
      setup(over);
      expect(await reportSiteLine(R)).toBe(true);
    }
  });
  it("숙제 기한(보고서일 + 7일)이 지난 보고서엔 붙이지 않는다 — 기한 지난 지정 발송·재발송(들어가도 그 숙제는 없다)", async () => {
    setup({ report_date: "2026-09-25" }); // 오늘 10/2 — 9/25 숙제는 10/2까지
    expect(await reportSiteLine(R)).toBe(true);
    setup({ report_date: "2026-09-24" });
    expect(await reportSiteLine(R)).toBe(false);
  });
  it("영상 과제 없음·모름·영어·취소·반 없음·정책이 끈 반은 붙이지 않는다", async () => {
    for (const over of [{ video_homework: false }, { video_homework: null }, { subject: "english" }, { revoked_at: "2026-10-01T00:00:00Z" }, { class_id: null }]) {
      setup(over);
      expect(await reportSiteLine(R), JSON.stringify(over)).toBe(false);
    }
    setup();
    m.settings = { ...settings(), report: { videoHomeworkPolicy: { ...settings().report.videoHomeworkPolicy, disabledClassIds: [C] } } };
    expect(await reportSiteLine(R)).toBe(false);
  });
  it("🔴 올리기 사이트를 못 쓰는 지점(Drive·SQL·기능 꺼짐) · 다른 지점의 사이트면 붙이지 않는다 — 없는 주소를 안내하지 않는다", async () => {
    setup();
    m.site = { ok: false, reason: "unavailable" };
    expect(await reportSiteLine(R)).toBe(false);
    m.site = { ok: true, tenantId: OTHER_T };
    expect(await reportSiteLine(R)).toBe(false);
  });
  it("반이 그 지점 것이 아니면 · 영상 과제 칸을 못 읽으면 · 모양이 다른 보고서 번호면 붙이지 않는다", async () => {
    setup();
    db.tables.classes![0]!.tenant_id = OTHER_T;
    expect(await reportSiteLine(R)).toBe(false);
    setup();
    m.homeworkReady = false;
    expect(await reportSiteLine(R)).toBe(false);
    m.homeworkReady = true;
    expect(await reportSiteLine("1 or 1=1")).toBe(false);
    expect(await reportSiteLine(undefined)).toBe(false);
  });
  it("🔴 학생마다 링크(토큰)를 만드는 길은 올리기 사이트 하나뿐이다 — 보고서 줄·학생 상세는 링크를 만들지 않는다", () => {
    const root = path.resolve(__dirname, "../../../..");
    const callers = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : callers(full);
      return /\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test") && /mintSubmitLink\(/.test(fs.readFileSync(full, "utf8")) ? [full] : [];
    });
    expect(callers(path.join(root, "src")).map((f) => path.relative(root, f).replaceAll("\\", "/")).sort())
      .toEqual(["src/features/video-submit/server/links.ts", "src/features/video-submit/server/site.ts"]);
  });
  it("원스크린의 '영상 첨부 링크 넣기' 토글은 그대로 숨는다 — 단계 값은 env가 무엇이든 꺼짐", () => {
    for (const raw of [undefined, "on", " ON ", "test", "yes"]) expect(reportLineMode({ VIDEO_SUBMIT_REPORT_LINE: raw })).toBe("off");
  });
});
