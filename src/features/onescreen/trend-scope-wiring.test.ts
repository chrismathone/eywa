import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 학습 추세 배선 가드(원장 2026-10-15 권민서A 클레임 — 수요일 반 추세가 화·금 반 시험을 인용했다).
 * 순수 규칙은 trend-comment.test.ts가 잠근다. 여기는 **그 규칙이 실제 경로에 걸려 있는지**를 소스로 본다 —
 * 한 경로라도 빠지면 추세 문장과 학부모 그래프가 서로 다른 반의 시험을 말한다.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

describe("학습 추세 — 시험은 그 반 기록만(배선)", () => {
  const history = read("features", "onescreen", "server", "score-history.ts");
  it("추세 문장·그래프 두 조회가 반(보강 반 포함)을 읽고 keepExamOfClass를 거친다", () => {
    expect(history.match(/class_id, makeup_class_id/g)?.length).toBe(2);
    expect(history.match(/keepExamOfClass\(rows,/g)?.length).toBe(2);
  });
  it("그래프는 거른 뒤에 자른다(시험만 있던 다른 반 행이 빈 칸으로 7칸을 먹지 않게)", () => {
    expect(history).toMatch(/limit\(opts\.classId \? limit \* 3 : limit\)/);
    expect(history).toMatch(/\.slice\(0, limit\)/);
  });
});

describe("학습 추세 — 생성 경로", () => {
  const actions = read("features", "onescreen", "server", "actions.ts");
  it("오늘 날짜를 넘기고, 생성 뒤 금지 표현 검사에 걸리면 싣지 않고 화면에 알린다", () => {
    expect(actions).toContain("buildTrendInput(history, { today: anchorDate })");
    // 검사는 미리보기와 같은 공용 함수(ment-assembly.ts `readMentResponse`, 2026-10-16) — 운영이 그 결과로 추세를 버린다
    expect(actions).toContain("readMentResponse(data, mode, trendInput");
    expect(read("features", "onescreen", "ment-assembly.ts")).toContain("findTrendViolations(rawTrend)");
    expect(actions).toContain("trendDropped: true");
  });
  it("반을 모르는 화면은 저장과 같은 규칙으로 반을 정한다(resolveReportClassId)", () => {
    expect(actions).toContain("resolveReportClassId(supabase, {");
    const compose = read("app", "(shell)", "lesson-reports", "_components", "compose-face.tsx");
    expect(compose).toContain("resolveClass: { teacherName:");
    // 오늘 시험은 저장 표기("일일 4/5")로 — 화면 문장 표기를 넘기면 이력과 만점 묶음이 갈린다.
    expect(compose).toContain("todayExamInfo: examInfoStr()");
    expect(compose).toContain("res.trendDropped");
  });
  it("원스크린은 버린 추세를 화면에서도 비운다(예전 초안이 그대로 나가지 않게)", () => {
    // 자동작성은 use-auto-write.ts로, 그 한 행 코어는 batch D에서 use-report-draft-generation.ts로 옮겼다(P3-O) — 화면과 합쳐 읽는다.
    const client = [
      read("features", "onescreen", "components", "onescreen-client.tsx"),
      read("features", "onescreen", "components", "use-auto-write.ts"),
      read("features", "onescreen", "components", "use-report-draft-generation.ts"),
    ].join("\n");
    // 2026-10-16: 자동작성 추세 스냅샷(trendAutoDraft)도 함께 비운다 — '달라진 것 없음'이면 칸이 스냅샷 그대로일 때만 비우는 데 쓴다.
    expect(client).toMatch(/res\.ok && res\.trendDropped\s*\?\s*\{ trendDraft: "", trendAutoDraft: "" \}/);
  });
});
