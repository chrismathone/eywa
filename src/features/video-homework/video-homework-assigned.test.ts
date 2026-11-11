/**
 * '오늘 영상 과제 있음/없음'(0308a, 원장 2026-09-30) — 판정 한 벌 + 핫패스·배선 가드.
 *
 * 🔴 #95: `video_homework`는 원장이 SQL을 돌리기 전에도 앱이 살아 있어야 한다 — 원스크린 로스터(강사 전원 핫패스)
 *    select에 넣으면 적용 전 배포에서 전원 화면이 400으로 죽는다. 그래서 로스터는 이 컬럼을 모르고,
 *    `server/assignments.ts`가 probe 뒤 따로 읽는다(실패 = 빈 지도 = 예전처럼 검사 칸이 뜬다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignmentKey, assignmentOf, hidesNextCheck } from "./assignment";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "../onescreen/components/onescreen-screen-source.test-util";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("영상 과제 판정(assignment.ts)", () => {
  const map = {
    [assignmentKey("s1", "2026-09-26", "c1")]: true,
    [assignmentKey("s1", "2026-09-29", "c1")]: false,
    [assignmentKey("s2", "2026-09-29", "c1")]: true,
  };
  it("없음(false)일 때만 다음 검사를 숨긴다 — 모름은 숨기지 않는다", () => {
    expect(hidesNextCheck(map, "s1", "2026-09-29", "c1")).toBe(true);
    expect(hidesNextCheck(map, "s1", "2026-09-26", "c1")).toBe(false);
    expect(hidesNextCheck(map, "s3", "2026-09-29", "c1")).toBe(false); // 모름
    expect(hidesNextCheck(map, "s1", null, "c1")).toBe(false); // 지난 수업 날짜 모름
    expect(hidesNextCheck({}, "s1", "2026-09-29", "c1")).toBe(false); // 컬럼 미적용 = 빈 지도
  });
  it("반이 다르면 다른 수업이다", () => {
    expect(assignmentOf(map, "s1", "2026-09-29", "c2")).toBeNull();
  });
});

describe("핫패스 가드 — 로스터는 video_homework를 모른다", () => {
  it("roster.ts 코드에 video_homework 컬럼 이름이 없다", () => {
    const code = stripComments(read("src", "features", "onescreen", "server", "roster.ts"));
    expect(code.includes("video_homework"), "로스터 select에 넣으면 0308a 적용 전 배포에서 강사 전원 원스크린이 죽는다").toBe(false);
  });
  it("원스크린 조회는 probe 뒤 · 실패·미적용은 null(모름) — 빈 지도(값 없음)와 구별한다", () => {
    const code = stripComments(read("src", "features", "video-homework", "server", "assignments.ts"));
    const body = code.slice(code.indexOf("export async function getVideoHomeworkAssignments"), code.indexOf("export async function getAssignedVideoHomework"));
    expect(body).toMatch(/videoHomeworkColumnReady\(db\)\)\) return null/);
    expect(body).toMatch(/catch \(e\)[\s\S]*return null;/);
    // 핫패스 — 60일 창이 아니라 필요한 날짜만
    expect(body).toContain('.in("report_date", days)');
  });
  it("원스크린 페이지 — 정책이 꺼져 있으면 읽지 않고, 못 읽은 세션은 공급자에 known=false", () => {
    const code = read("src", "app", "(shell)", "onescreen", "page.tsx");
    expect(code).toMatch(/videoHwPolicy\.enabled \? getVideoHomeworkAssignments/);
    expect(code).toContain("assignmentsKnown={loadedAssignments !== null}");
  });
  it("🔴 손대지 않은 행은 false로 보내지 않는다 — 값이 있을 때만 · 못 읽은 세션은 아예 안 보낸다", () => {
    const code = stripComments(readOnescreenScreen());
    expect(code).toMatch(/videoHwSaveOk && typeof su\?\.videoHomework === "boolean"/);
    expect(code).not.toMatch(/videoHomework: !!su\.videoHomework/);
  });
  it("저장은 컬럼 probe가 참이고 값이 있을 때만 싣는다", () => {
    const code = stripComments(read("src", "features", "onescreen", "server", "actions.ts"));
    // 작성 선생님이 아닌 저장은 값을 두고 적지 않는다(keptVideoHw, 2026-10-03 report-owner.ts).
    expect(code).toMatch(/videoHwReady && typeof input\.videoHomework === "boolean" && !keptVideoHw \? \{ video_homework: input\.videoHomework \}/);
  });
});

describe("배선 — 저장만 하고 아무도 안 읽는 값이 아니다", () => {
  it("다음 수업 검사가 '없음'을 읽고 숨는다(이미 찍은 검사는 남긴다)", () => {
    const code = read("src", "features", "video-homework", "components", "video-homework-provider.tsx");
    expect(code).toMatch(/!mark && hidesNextCheck\(assignments, studentId, homeworkDate, classId\)/);
  });
  it("원스크린 페이지가 과제 값을 읽어 공급자에 넘긴다", () => {
    const code = read("src", "app", "(shell)", "onescreen", "page.tsx");
    expect(code).toContain("getVideoHomeworkAssignments(");
    expect(code).toContain("assignments={videoHomeworkAssignments}");
  });
  it("표·카드 모두 토글이 있고, 옛 '보강' 켜고 끄기는 없다", () => {
    const grid = read("src", "features", "onescreen", "components", "grid-row.tsx");
    const card = read("src", "features", "onescreen", "components", "report-card.tsx");
    expect(grid).toContain("<VideoHomeworkToggle");
    expect(card).toContain("<VideoHomeworkToggle");
    expect(grid).not.toMatch(/type="checkbox"[\s\S]{0,120}checked=\{!!subject\.makeup\}/);
    expect(card).not.toContain("aria-pressed={!!subject.makeup}");
  });
});
