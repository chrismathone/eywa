/**
 * '영상 첨부 링크 넣기'(0328a, 원장 2026-10-02) — 고를 수 있는 행 판정 + 핫패스·배선 가드.
 *
 * 🔴 #95: `video_submit_link`도 SQL 적용 전에 앱이 살아 있어야 한다 — 원스크린 로스터(전원 핫패스) select에 넣지 않고,
 *    `server/link-choice-db.ts`가 칸 유무를 물은 뒤 따로 읽는다(없음·실패 = 토글 없음 · 값 안 보냄).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_HOMEWORK_POLICY } from "@/features/video-homework/policy";
import { REPORT_VIDEO_LINK_RETIRED, reportLineMode, submitLinkChoosable, submitLinkModeAllows } from "./link-choice";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const row = { classId: "c1", subjectKey: "math", grade: "중1", studentName: "김민준" };

describe("🔴 보고서 글의 영상 제출 링크는 더는 붙이지 않는다(원장 2026-10-03) — env가 무엇이든 꺼짐", () => {
  it("단계 값이 늘 'off'라 토글·일괄 입력 칸·발송 직전 링크 만들기가 함께 사라진다 · '영상 과제 있음/없음'은 이 스위치와 무관하다", () => {
    expect(REPORT_VIDEO_LINK_RETIRED).toBe(true);
    for (const env of [{}, { VIDEO_SUBMIT_REPORT_LINE: "on" }, { VIDEO_SUBMIT_REPORT_LINE: "test" }, { VIDEO_SUBMIT_REPORT_LINE: " ON " }])
      expect(reportLineMode(env)).toBe("off");
    expect(submitLinkChoosable(reportLineMode({ VIDEO_SUBMIT_REPORT_LINE: "on" }), DEFAULT_VIDEO_HOMEWORK_POLICY, row)).toBe(false);
    // 서버(발송 직전)와 원스크린 로더가 같은 값을 읽는다 — 따로 env를 읽는 곳이 없다
    for (const f of [["src", "features", "video-submit", "server", "report-link.ts"], ["src", "features", "video-submit", "server", "link-choice-db.ts"]])
      expect(stripComments(read(...f))).not.toContain("VIDEO_SUBMIT_REPORT_LINE");
    // 영상 과제 토글은 이 스위치를 보지 않는다
    expect(stripComments(read("src", "features", "video-homework", "components", "video-homework-toggle.tsx"))).not.toMatch(/reportLineMode|submitLinkMode|REPORT_VIDEO_LINK_RETIRED/);
  });
});

describe("고를 수 있는 행 — 토글·일괄 입력·저장이 같은 판정", () => {
  it("줄이 꺼진 단계면 어느 행도 못 고른다 · 시험 단계는 '학원이'만", () => {
    expect(reportLineMode({})).toBe("off");
    expect(submitLinkChoosable("off", DEFAULT_VIDEO_HOMEWORK_POLICY, row)).toBe(false);
    expect(submitLinkChoosable("test", DEFAULT_VIDEO_HOMEWORK_POLICY, row)).toBe(false);
    expect(submitLinkChoosable("test", DEFAULT_VIDEO_HOMEWORK_POLICY, { ...row, studentName: " 학원이 " })).toBe(true);
    expect(submitLinkChoosable("on", DEFAULT_VIDEO_HOMEWORK_POLICY, row)).toBe(true);
    expect(submitLinkModeAllows("on", null)).toBe(true);
  });
  it("발송 직전 판정이 붙이지 않는 행엔 토글도 없다 — 영어·반 없음·정책이 끈 반·공급자 밖", () => {
    expect(submitLinkChoosable("on", DEFAULT_VIDEO_HOMEWORK_POLICY, { ...row, subjectKey: "english" })).toBe(false);
    expect(submitLinkChoosable("on", DEFAULT_VIDEO_HOMEWORK_POLICY, { ...row, classId: null })).toBe(false);
    expect(submitLinkChoosable("on", { ...DEFAULT_VIDEO_HOMEWORK_POLICY, disabledClassIds: ["c1"] }, row)).toBe(false);
    expect(submitLinkChoosable("on", { ...DEFAULT_VIDEO_HOMEWORK_POLICY, enabled: false }, row)).toBe(false);
    expect(submitLinkChoosable("on", null, row)).toBe(false);
    // 과목 키가 없는 행은 수학으로 본다(진도 칸·영상 과제 토글과 같은 규약)
    expect(submitLinkChoosable("on", DEFAULT_VIDEO_HOMEWORK_POLICY, { ...row, subjectKey: undefined })).toBe(true);
  });
});

describe("핫패스 가드 — 로스터는 video_submit_link를 모른다", () => {
  it("roster.ts 코드에 그 칸 이름이 없다", () => {
    const code = stripComments(read("src", "features", "onescreen", "server", "roster.ts"));
    expect(code.includes("video_submit_link"), "로스터 select에 넣으면 0328a 적용 전 배포에서 강사 전원 원스크린이 죽는다").toBe(false);
  });
  it("원스크린 조회는 칸이 확인된 뒤에만 · 어떤 실패도 off(토글 없음)", () => {
    const code = stripComments(read("src", "features", "video-submit", "server", "link-choice-db.ts"));
    const body = code.slice(code.indexOf("export async function getSubmitLinkUi"));
    expect(body).toMatch(/videoSubmitLinkColumn\(db\)\) !== "ready"\) return OFF/);
    expect(body).toMatch(/catch \(e\)[\s\S]*return OFF;/);
    expect(body).toContain('.eq("report_date", date)');
  });
  it("🔴 보고서 글의 영상 줄은 이제 행마다 고른 값(video_submit_link)을 보지 않는다 — 영상 과제 있음이면 올리기 사이트 안내(원장 2026-10-03)", () => {
    const code = stripComments(read("src", "features", "video-submit", "server", "report-link.ts"));
    expect(code).not.toContain("video_submit_link");
    expect(code).toContain('submitLink: "no_column"');
  });
  it("원스크린 페이지 — 영상 숙제가 꺼진 학원은 읽지 않고, 공급자에 단계를 넘긴다", () => {
    const code = read("src", "app", "(shell)", "onescreen", "page.tsx");
    expect(code).toMatch(/videoHwPolicy\.enabled\s*\? getSubmitLinkUi/);
    expect(code).toContain("submitLinkMode={submitLinkUi.mode}");
  });
});

describe("배선 — 화면에서 고른 값이 저장되고, 발송 직전 판정이 그 값을 읽는다", () => {
  it("🔴 손대지 않은 행은 보내지 않는다 — 값이 있고 그 행에서 고를 수 있을 때만", () => {
    // 세션 입력 조립은 session-input.ts로 옮겼다(P3-O) — 금지 패턴은 두 파일 모두에서 본다.
    const code = stripComments(read("src", "features", "onescreen", "components", "onescreen-client.tsx") + "\n" + read("src", "features", "onescreen", "session-input.ts"));
    // 다른 선생님이 처음 쓴 줄도 싣지 않는다(2026-10-03, video-homework/report-owner.ts).
    expect(code).toMatch(/videoHwSaveOk && typeof su\?\.videoSubmitLink === "boolean" && !videoHwByOther\(student\.id, su\?\.classId\) &&\s*submitLinkChoosable\(/);
    expect(code).not.toMatch(/videoSubmitLink: !!su\.videoSubmitLink/);
  });
  it("저장은 칸이 확인됐고 값이 있을 때만 싣는다", () => {
    const code = stripComments(read("src", "features", "onescreen", "server", "actions.ts"));
    // 작성 선생님이 아니라 영상 과제 값을 두는 저장(keptVideoHw)은 링크 선택도 적지 않는다.
    expect(code).toMatch(/videoLinkReady && typeof input\.videoSubmitLink === "boolean" && !keptVideoHw \? \{ video_submit_link: input\.videoSubmitLink \}/);
  });
  it("표·카드 모두 토글이 있다 — '영상 과제'를 켠 행에서만 뜬다", () => {
    const grid = read("src", "features", "onescreen", "components", "grid-row.tsx");
    const card = read("src", "features", "onescreen", "components", "report-card.tsx");
    for (const code of [grid, card]) {
      expect(code).toContain("<VideoSubmitLinkToggle");
      expect(code).toContain("shown={!!subject.videoHomework}");
      expect(code).toContain("checked={!!subject.videoSubmitLink}");
    }
  });
  it("🔴 일괄 검사가 이미 찍힌 검사를 바꾸면 적용 전에 확인을 받는다(미제출은 제출일까지 지운다)", () => {
    const code = stripComments(read("src", "features", "onescreen", "components", "bulk-apply.tsx"));
    expect(code).toMatch(/videoCheckPlan\.overwrite > 0\) \{\s*warns\.push\(/);
    const grid = stripComments(read("src", "features", "onescreen", "components", "onescreen-grid.tsx"));
    expect(grid).toContain("overwrite: countCheckOverwrites(targets, videoHwStore)");
  });
  it("날짜를 옮기면 검사 기록 공급자도 새로 선다(옛 날짜 기록으로 일괄 검사가 건너뛰지 않게)", () => {
    const code = read("src", "app", "(shell)", "onescreen", "page.tsx");
    expect(code).toContain("<VideoHomeworkProvider key={roster.date}");
  });
  it("발송 직전 판정은 한 함수(reportGetsVideoLink)로 — 영상 과제·반·영어·취소·학원 설정이 같은 규칙", () => {
    const code = stripComments(read("src", "features", "video-submit", "server", "report-link.ts"));
    expect(code).toContain("const eligible = reportGetsVideoLink({");
    // 🔴 지점을 넘겨 묻는다 — 지점 없이 물으면 지점이 여럿일 때 줄이 통째로 빠진다
    expect(code).toContain("siteAvailability(db, tenantId)");
    expect(code).not.toContain("siteAvailability(db)");
  });
});
