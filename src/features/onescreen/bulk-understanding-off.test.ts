import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planBulkApply, type BulkTarget } from "./grid";
import { bulkUnderstandingLessons } from "./math-report-pilot";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

// 원장 2026-10-27 *"이해도를 상세에서 몇개 선택 빼기 하고 학생별 상세에서 각각 변하게"* · *"보강학생 … 안내하고 버튼도"*.
const row = (over: Partial<BulkTarget> = {}): BulkTarget =>
  ({
    studentId: "s1",
    subjectName: "수학",
    subjectIndex: 0,
    subjectKey: "math",
    today: "1-1-1 일차부등식\n1-1-2 연립방정식",
    understandingOk: true,
    attitude: null,
    homework: "",
    textbook: "",
    homeworkToday: "",
    ...over,
  }) as BulkTarget;

describe("일괄 입력 — 이해도에서 뺄 소단원", () => {
  it("그 행 진도에 있는 소단원만 · 새 수학 보고서 행에만", () => {
    const res = planBulkApply(
      [row(), row({ studentId: "s2", today: "1-1-2 연립방정식" }), row({ studentId: "e", understandingOk: false })],
      { understandingOff: ["1-1-1 일차부등식"] },
      false,
    );
    expect(res).toEqual([{ studentId: "s1", subjectName: "수학", subjectIndex: 0, set: { understandingOff: ["1-1-1 일차부등식"] } }]);
  });
  it("같은 차례에 바꾼 진도 기준 · '빈 칸만'이어도 뺀다(점수를 덮지 않는다)", () => {
    const [p] = planBulkApply([row({ today: "" })], { today: "2-1-1 함수", understandingOff: ["2-1-1 함수"] }, true, "math");
    expect(p!.set).toEqual({ today: "2-1-1 함수", understandingOff: ["2-1-1 함수"] });
    const [q] = planBulkApply([row({ understandingStored: true })], { understanding: 4, understandingOff: ["1-1-2 연립방정식"] }, true);
    expect(q!.set).toEqual({ understandingOff: ["1-1-2 연립방정식"] });
  });
  it("후보 = 대상 행 소단원(행 수) + 이번에 넣을 진도", () => {
    expect(bulkUnderstandingLessons(["1-1-1 가\n1-1-2 나", "1-1-2 나"], { today: "1-1-3 다", rows: 3 })).toEqual([
      { lesson: "1-1-1 가", title: "가", count: 1 },
      { lesson: "1-1-2 나", title: "나", count: 2 },
      { lesson: "1-1-3 다", title: "다", count: 3 },
    ]);
  });
});

describe("배선", () => {
  const read = (...p: string[]) => readFileSync(resolve(__dirname, ...p), "utf8");
  it("표 행의 '소단원별' 창 = 카드와 같은 setter · 일괄 적용이 뺄 소단원을 넣는다", () => {
    const client = readOnescreenScreen();
    expect(client).toContain("onUnderstandingScore: setUnderstandingScoreFor");
    expect(client).toContain("onUnderstandingToggle: toggleUnderstandingFor");
    expect(client).toContain("p.set.understandingOff ?? []");
    expect(read("components", "grid-row.tsx")).toContain("<UnderstandingPopover");
  });
  it("보강 학생 이전 진도 — 표 위 버튼 + 일괄 가져오기 안내", () => {
    const client = readOnescreenScreen();
    expect(client).toContain("makeupPrev: (() =>");
    expect(client).toContain('tf("os.c.makeupPrevPending"');
    expect(read("components", "grid-toolbar.tsx")).toContain("actions.makeupPrev.onLoad");
  });
});
