/**
 * 일괄 입력의 추가 칸(2026-10-02, 원장 *"일괄 입력에 지금 없는거 추가"*) — 특이사항 · 일일/확인 테스트 · 영상 과제 · 영상 첨부 링크.
 * 계획은 `planBulkApply`(grid.ts) 한 곳이 만든다 — 여기는 새 칸의 규칙만 잠근다(옛 칸은 grid.test.ts).
 */
import { describe, expect, it } from "vitest";
import { planBulkApply, type BulkTarget } from "./grid";

function target(over: Partial<BulkTarget> = {}): BulkTarget {
  return {
    studentId: "a", subjectName: "수학", subjectIndex: 0, subjectKey: "math",
    today: "", attitude: null, homework: "", textbook: "", homeworkToday: "",
    ...over,
  };
}
const setOf = (targets: BulkTarget[], patch: Parameters<typeof planBulkApply>[1], onlyEmpty = false) =>
  planBulkApply(targets, patch, onlyEmpty).map((p) => p.set);

describe("특이사항", () => {
  it("채운 값만 · 행마다(같은 학생의 둘째 행에도) · '빈 칸만'이면 적힌 행은 건너뛴다", () => {
    expect(setOf([target()], { note: "  " })).toEqual([]);
    expect(setOf([target(), target({ subjectName: "수학 · 특강" })], { note: "단원평가" })).toEqual([{ note: "단원평가" }, { note: "단원평가" }]);
    expect(setOf([target({ note: "조퇴" }), target({ studentId: "b" })], { note: "단원평가" }, true)).toEqual([{ note: "단원평가" }]);
  });
});

describe("일일·확인 테스트", () => {
  it("맞은 개수는 그 행의 문항수를 넘지 않는다 — 문항수를 함께 바꾸면 그 값 기준", () => {
    expect(setOf([target({ dailyMax: 5 })], { dailyScore: 9 })).toEqual([{ dailyScore: 5 }]);
    expect(setOf([target({ dailyMax: 5 })], { dailyScore: 9, dailyMax: 10 })).toEqual([{ dailyMax: 10, dailyScore: 9 }]);
    expect(setOf([target({ checkMax: 20 })], { checkScore: 18 })).toEqual([{ checkScore: 18 }]);
  });
  it("숫자가 아니거나 음수·문항수 0은 적용하지 않는다", () => {
    expect(setOf([target({ dailyMax: 5 })], { dailyScore: Number.NaN })).toEqual([]);
    expect(setOf([target({ dailyMax: 5 })], { dailyScore: -1 })).toEqual([]);
    expect(setOf([target({ dailyMax: 5 })], { dailyMax: 0 })).toEqual([]);
    expect(setOf([target({ dailyMax: 5 })], { dailyScore: 0 })).toEqual([{ dailyScore: 0 }]); // 0개 맞음은 값이다
  });
  it("'빈 칸만'은 점수가 빈 행에만 — 점수가 찬 행의 문항수를 바꾸지 않는다(그 점수가 깎인다)", () => {
    const plan = setOf([target({ dailyScore: 4, dailyMax: 5 }), target({ studentId: "b", dailyScore: null, dailyMax: 5 })], { dailyScore: 3, dailyMax: 3 }, true);
    expect(plan).toEqual([{ dailyMax: 3, dailyScore: 3 }]);
  });
});

describe("영상 과제 · 영상 첨부 링크 넣기", () => {
  const videoRow = (over: Partial<BulkTarget> = {}) => target({ videoOk: true, linkOk: true, ...over });
  it("토글이 없는 행(정책이 끈 반·반 없음)엔 넣지 않는다", () => {
    expect(setOf([target(), videoRow({ studentId: "b" })], { videoHomework: true })).toEqual([{ videoHomework: true }]);
  });
  it("링크는 영상 과제가 켜진(이번에 켜는 것 포함) 행에만 켠다", () => {
    expect(setOf([videoRow()], { videoHomework: true, videoSubmitLink: true })).toEqual([{ videoHomework: true, videoSubmitLink: true }]);
    // 과제가 꺼져 있고 이번에 켜지도 않으면 링크만 켜지지 않는다
    expect(setOf([videoRow({ videoHomework: false })], { videoSubmitLink: true })).toEqual([]);
    expect(setOf([videoRow({ videoHomework: true })], { videoSubmitLink: true })).toEqual([{ videoSubmitLink: true }]);
  });
  it("링크를 고를 수 없는 행(줄이 꺼진 단계·영어)엔 과제만 들어간다", () => {
    expect(setOf([videoRow({ linkOk: false })], { videoHomework: true, videoSubmitLink: true })).toEqual([{ videoHomework: true }]);
  });
  it("과제를 '없음'으로 바꾸는 행은 켜져 있던 링크도 끈다(행 토글과 같은 규칙)", () => {
    expect(setOf([videoRow({ videoHomework: true, videoSubmitLink: true })], { videoHomework: false })).toEqual([{ videoHomework: false, videoSubmitLink: false }]);
    expect(setOf([videoRow({ videoHomework: true })], { videoHomework: false })).toEqual([{ videoHomework: false }]);
  });
  it("'빈 칸만'은 고른 적 없는 행에만 — 강사가 '없음'으로 둔 행을 '있음'으로 뒤집지 않는다", () => {
    const plan = setOf([videoRow({ videoHomework: false }), videoRow({ studentId: "b" })], { videoHomework: true, videoSubmitLink: true }, true);
    expect(plan).toEqual([{ videoHomework: true, videoSubmitLink: true }]);
  });
  it("잠긴 행(발송 완료·결석)엔 아무것도 넣지 않는다", () => {
    expect(setOf([videoRow({ locked: true })], { videoHomework: true, videoSubmitLink: true, note: "메모", dailyScore: 3 })).toEqual([]);
  });
});
