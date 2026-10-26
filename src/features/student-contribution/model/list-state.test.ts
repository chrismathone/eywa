import { expect, it } from "vitest";
import { contributionListHref, contributionStudentHref, listStateQuery, readListState } from "./list-state";

it("목록의 모든 조건과 페이지를 상세를 거쳐 복구한다", () => {
  const state = readListState("status=all&q=김+학생&grade=초5&subject=math&sort=recent&page=3&size=20");
  const detail = new URL(contributionStudentHref("student-1", state), "https://test.local");
  const back = new URL(contributionListHref(detail.searchParams.get("list")), detail.origin);
  expect(readListState(back.search.slice(1))).toEqual(state);
});
it("새 메뉴는 재원생 기본값이며 잘못된 페이지와 외부 주소는 복귀 경로가 되지 않는다", () => {
  expect(contributionListHref("https://outside.test/?page=-2&size=1000&redirect=//outside.test")).toBe("/student-contribution");
  expect(contributionListHref(null)).toBe("/student-contribution");
  expect(listStateQuery(readListState("status=invalid&page=NaN&sort=invalid"))).toBe("");
  expect(readListState("page=1.5").page).toBe(1);
});
