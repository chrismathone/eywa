import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, boardSearchParams, boardStats, filterBoardRows, parseBoardFilters, priorityTasks, withCheckPatches } from "./board-model";
import { TEST_TODAY, testRow, testView } from "./board-fixtures.test-support";
import { ONBOARDING_ITEMS, dueDateOf, progressOf, statusOf } from "./onboarding-items";
import { careCellMatches, parseCareCellParam } from "./care-cells";

const labels = (key: string) => ({ math: "수학", english: "영어" })[key] ?? key;
describe("신규생 보드: 기존 조회·판정 결과 보존", () => {
  const { subjectRows: rows } = testView();
  it("기존 상단 집계식과 동일한 수치이며 학생·행·업무를 구분한다", () => {
    const old = rows.map(row => progressOf(row, row.checks, TEST_TODAY));
    const dueTotal = old.reduce((n, p) => n + p.dueTotal, 0), doneCount = old.reduce((n, p) => n + p.doneCount, 0);
    expect(boardStats(rows, TEST_TODAY)).toMatchObject({ students: 3, rows: 4, openStudents: 3,
      overdue: old.reduce((n, p) => n + p.overdue, 0), dueSoon: old.reduce((n, p) => n + p.dueSoon, 0), dueTotal, doneCount, rate: dueTotal ? Math.round(doneCount / dueTotal * 100) : 100,
    });
  });
  it("학생 ID와 과목을 유지하며 동명이인도 별개로 검색·정렬한다", () => {
    expect(filterBoardRows(rows, { ...EMPTY_FILTERS, query: "테스트가A", sort: "name" }, TEST_TODAY, labels).map(r => r.rowKey)).toEqual(["student-a|math", "student-a|english", "student-b|math"]);
    expect(filterBoardRows(rows, { ...EMPTY_FILTERS, query: "별빛 초5", subject: "math", bucket: "d30", status: "overdue" }, TEST_TODAY, labels).map(r => r.studentId)).toEqual(["student-b"]);
    expect(filterBoardRows(rows, { ...EMPTY_FILTERS, subject: "english", bucket: "d30" }, TEST_TODAY, labels)).toEqual([]);
    expect(filterBoardRows(rows, EMPTY_FILTERS, TEST_TODAY, labels)).toEqual(rows);
  });
  it("기존 운영실 업무 링크가 같은 조건으로 필터링한다", () => {
    for (const key of ["pre_call", "no_first_class"]) {
      expect(filterBoardRows(rows, { ...EMPTY_FILTERS, item: key }, TEST_TODAY, labels)).toEqual(rows.filter(row => careCellMatches(parseCareCellParam(key)!, row, TEST_TODAY)));
    }
  });
  it("필수 지연·오늘·3일 이내만 우선 업무이며 예정일별로 정렬된다", () => {
    const tasks = priorityTasks(rows, TEST_TODAY);
    expect(tasks.length).toBe(boardStats(rows, TEST_TODAY).overdue + boardStats(rows, TEST_TODAY).dueSoon);
    expect(tasks.map(t => t.due)).toEqual(tasks.map(t => t.due).sort());
    expect(new Set(tasks.map(t => t.key)).size).toBe(tasks.length);
    for (const task of tasks) {
      expect(task.item.optional).not.toBe(true);
      expect(task.due).toBe(dueDateOf(task.item, task.row));
      expect(task.status).toBe(statusOf(task.item, task.row, task.row.checks[task.item.key], TEST_TODAY));
    }
  });
  it("완료 취소와 선택 업무 체크가 다른 학생·과목으로 번지지 않는다", () => {
    const patched = withCheckPatches(rows, { "student-a|math|pre_call": TEST_TODAY }, TEST_TODAY);
    expect(patched[0].progress.doneCount).toBe(1);
    expect(patched[1].checks.pre_call).toBeUndefined();
    expect(patched[2].checks.pre_call).toBeUndefined();
    const optional = withCheckPatches(rows, { "student-a|math|month2_call": TEST_TODAY }, TEST_TODAY);
    expect(boardStats(optional, TEST_TODAY)).toEqual(boardStats(rows, TEST_TODAY));
    expect(boardStats(withCheckPatches(patched, { "student-a|math|pre_call": null }, TEST_TODAY), TEST_TODAY)).toEqual(boardStats(rows, TEST_TODAY));
    expect(rows[0].checks.pre_call).toBeUndefined();
  });
  it("기준일 이전·미정·완료를 혼동하지 않고 날짜 경계를 보존한다", () => {
    const row = testRow({ enrolledOn: "2026-06-18", firstClassOn: null });
    const tasks = priorityTasks([row], TEST_TODAY);
    expect(tasks.map(t => t.item.key)).toEqual(["month3_call"]);
    expect(tasks[0].daysLeft).toBe(0);
    expect(boardStats([row], TEST_TODAY)).toMatchObject({ waived: 2, dueSoon: 1, overdue: 0 });
    const pre = ONBOARDING_ITEMS[0];
    for (const [date, expected] of [["2026-09-09", "waived"], ["2026-09-10", "overdue"], ["2026-09-17", "due"], ["2026-09-20", "due"], ["2026-09-21", "upcoming"]] as const) expect(statusOf(pre, testRow({ firstClassOn: date }), null, TEST_TODAY)).toBe(expected);
  });
  it("기존 only/item 링크·창 파라미터를 보존하고 잘못된 값은 기본값으로 처리한다", () => {
    const filters = parseBoardFilters(new URLSearchParams("only=open&bucket=d30&item=pre_call&embed=1"));
    expect(filters).toMatchObject({ status: "open", bucket: "d30", item: "pre_call" });
    expect(boardSearchParams({ ...filters, query: "가온" }, new URLSearchParams("embed=1")).get("embed")).toBe("1");
    expect(parseBoardFilters(new URLSearchParams("status=fake&bucket=d365&sort=bad&item=bad"))).toEqual(EMPTY_FILTERS);
  });
});
