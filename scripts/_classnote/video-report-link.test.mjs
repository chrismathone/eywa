import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commentedReportToken, loadCommentedReport, pickCommentedReport, readCommentedReportToken } from "./video-report-link.mjs";

const TOKEN = "0f8fad5b-d9cb-469f-a165-70867728950e";
const report = (over = {}) => ({ student_id: "student", class_id: "class-a", video_homework: true, report_date: "2026-10-06", ...over });

/**
 * 원장 2026-10-06: *"해당 숙제 보고서 고유의 링크 주소가 있는 보고서에 영상을 업로드하면 무조건 체킹가능하지."*
 * 댓글이 달린 글의 본문에서 보고서 주소를 읽고, DB로 "이 학생의 영상 과제 보고서"임을 확인한 것만 그 숙제에 묶는다.
 */
describe("보고서 글의 공유 주소 → 토큰", () => {
  it("발송 글 본문의 `/r/{토큰}`을 읽는다(도메인 무관 · 두 줄짜리 글 포함)", () => {
    expect(commentedReportToken({ content: `https://www.aywa.co.kr/r/${TOKEN}` })).toBe(TOKEN);
    expect(commentedReportToken({ content: `보고서 : https://www.aywa.co.kr/r/${TOKEN.toUpperCase()}\n영상첨부 : https://www.aywa.co.kr/v` })).toBe(TOKEN);
  });
  it("보고서 글이 아니면 null — 학부모 글 · 공지 · 옛 edutrix 링크 · 지워진 글", () => {
    for (const post of [null, undefined, {}, { content: "내일 결석합니다" }, { content: "https://www.aywa.co.kr/v" },
      { content: `https://edutrix.vercel.app/share/${TOKEN}` }, { content: "https://www.aywa.co.kr/r/not-a-token" }])
      expect(commentedReportToken(post)).toBeNull();
  });
});

describe("토큰의 보고서 → 묶을 숙제(DB로 확인한 줄만)", () => {
  it("이 학생의 '영상 과제 있음' 보고서면 그 반 · 그 수업일", () => {
    expect(pickCommentedReport([report()], "student")).toEqual({ classId: "class-a", homeworkDate: "2026-10-06" });
  });
  it("🔴 묶지 않는다 — 다른 학생의 보고서 · 영상 과제 없음/모름 · 반 없는 보고서 · 줄이 없거나 둘 · 날짜 모양이 아님", () => {
    const cases = [
      [[report()], "someone-else"],
      [[report({ video_homework: false })], "student"],
      [[report({ video_homework: null })], "student"],
      [[report({ class_id: null })], "student"],
      [[], "student"],
      [[report(), report()], "student"],
      [[report({ report_date: new Date("2026-10-06") })], "student"],
      [[report()], null],
    ];
    for (const [rows, studentId] of cases) expect(pickCommentedReport(rows, studentId)).toBeNull();
  });
});

describe("조회 — 댓글 영상 + 토큰이 있을 때만 DB를 묻는다", () => {
  const sqlOf = (rows) => vi.fn(async () => rows);
  it("댓글 영상이 아니거나 토큰·학생이 없으면 조회하지 않는다(예전 판정 그대로)", async () => {
    const sql = sqlOf([report()]);
    for (const [video, studentId] of [
      [{ commentId: null, reportToken: TOKEN }, "student"], // 새 글로 올린 영상
      [{ commentId: "9", reportToken: null }, "student"], // 보고서 글이 아니다
      [{ commentId: "9", reportToken: "'; drop table x; --" }, "student"],
      [{ commentId: "9", reportToken: TOKEN }, null], // 학생을 못 정했다
    ]) expect(await loadCommentedReport(sql, "tenant", video, studentId)).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
  it("지점과 토큰으로 좁혀 한 번 묻고, 줄 판정은 순수 함수가 한다", async () => {
    const sql = sqlOf([report()]);
    expect(await loadCommentedReport(sql, "tenant", { commentId: "9", reportToken: TOKEN.toUpperCase() }, "student"))
      .toEqual({ classId: "class-a", homeworkDate: "2026-10-06" });
    expect(sql).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sql.mock.calls[0];
    expect(strings.join("?")).toMatch(/from lesson_reports where tenant_id = \? and share_token = \? limit 2/);
    expect(values).toEqual(["tenant", TOKEN]);
    // 다른 학생의 보고서면 묶지 않는다
    expect(await loadCommentedReport(sqlOf([report({ student_id: "other" })]), "tenant", { commentId: "9", reportToken: TOKEN }, "student")).toBeNull();
  });
  it("DB 오류는 삼키지 않는다 — 작업이 실패로 남아 다음 주기에 다시 한다", async () => {
    const sql = vi.fn(async () => { throw new Error("db down"); });
    await expect(loadCommentedReport(sql, "tenant", { commentId: "9", reportToken: TOKEN }, "student")).rejects.toThrow("db down");
  });
});

describe("댓글이 달린 글 읽기 — 못 읽으면 던지지 않고 알린다(다시 할지는 워커가 정한다)", () => {
  // page.evaluate 대역: 넘겨받은 함수를 그대로 돌린다(브라우저 안에서 도는 fetch 코드까지 실행된다).
  const page = { evaluate: (fn, arg) => fn(arg) };
  const respond = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  afterEach(() => vi.unstubAllGlobals());

  it("보고서 글이면 토큰 · 보고서 글이 아니거나 없는 글(404)이면 토큰 없음 — 둘 다 '읽었다'", async () => {
    const fetchMock = vi.fn(async () => respond(200, { content: `보고서 : https://www.aywa.co.kr/r/${TOKEN}` }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await readCommentedReportToken(page, "56")).toEqual({ token: TOKEN, unread: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/reports/56/");
    expect(init.signal).toBeInstanceOf(AbortSignal); // 🔴 시간 제한 — 없으면 응답 없는 조회가 영상 워커 전체를 세운다
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { content: "내일 결석합니다" })));
    expect(await readCommentedReportToken(page, "56")).toEqual({ token: null, unread: false });
    vi.stubGlobal("fetch", vi.fn(async () => respond(404, null)));
    expect(await readCommentedReportToken(page, "56")).toEqual({ token: null, unread: false });
  });
  it("못 읽으면(그 밖의 응답 · 끊김) 한 번 더 해 보고, 그래도 안 되면 `unread` — 던지지 않는다", async () => {
    const broken = vi.fn(async () => respond(502, null));
    vi.stubGlobal("fetch", broken);
    expect(await readCommentedReportToken(page, "56")).toEqual({ token: null, unread: true });
    expect(broken).toHaveBeenCalledTimes(2);
    const blip = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(respond(200, { content: `https://www.aywa.co.kr/r/${TOKEN}` }));
    vi.stubGlobal("fetch", blip);
    expect(await readCommentedReportToken(page, "56")).toEqual({ token: TOKEN, unread: false });
  });
  it("🔴 페이지가 닫혀서 난 오류는 삼키지 않는다 — 작업 전체가 다음 주기에 다시 돈다(연결 없이 보관되지 않게)", async () => {
    const evaluate = vi.fn(async () => { throw new Error("Target page, context or browser has been closed"); });
    await expect(readCommentedReportToken({ evaluate, isClosed: () => true }, "56")).rejects.toThrow("has been closed");
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});

describe("배선 — 전송 직전 재조회가 댓글이 달린 글의 토큰을 싣고, 판정이 그 보고서를 받는다", () => {
  const flat = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\s+/g, " ");
  it("댓글 영상만, 같은 댓글이 아직 있는 것을 확인한 뒤에 달린 글을 읽는다 — 새 글 영상·숙제가 정해진 작업은 읽지 않는다", () => {
    const feed = flat("./classnote-feed-core.mjs");
    const read = "const report = video.commentId && readReport ? await readCommentedReportToken(page, video.postId) : { token: null, unread: false };";
    expect(feed).toContain(read);
    expect(feed).toContain("return { ...video, sources: fresh.sources, reportToken: report.token, reportUnread: report.unread };");
    // 지워진 댓글의 영상에는 글 조회를 쓰지 않는다 — 같은 영상 확인(던진다)이 글 조회보다 앞이다.
    const body = feed.slice(feed.indexOf("export async function reloadArchivedVideo("));
    expect(body.indexOf("원글·댓글에서 같은 영상을 찾지 못했습니다.")).toBeGreaterThan(0);
    expect(body.indexOf("원글·댓글에서 같은 영상을 찾지 못했습니다.")).toBeLessThan(body.indexOf(read));
    // 재시도·보관 판정은 워커에 있다(실행 테스트 = video-worker.test.mjs).
    expect(flat("./video-worker.mjs")).toContain("reloadArchivedVideo(browser, job.payload, { readReport: !(pinned && job.route?.homeworkDate) })");
  });
  it("판정은 학생이 하나로 정해졌을 때만 보고서를 묻는다", () => {
    const route = flat("./video-teacher-route.mjs");
    expect(route).toContain("const report = studentIds.length === 1 ? await loadCommentedReport(sql, tenantId, video, studentIds[0]) : null;");
    expect(route).toContain("return chooseVideoTeacher({ video, tenantId, studentIds, boardClassIds, classes, student, report, homeworkClassIds });");
  });
});
