import { describe, expect, it } from "vitest";
import { makeupCaseHref, makeupListBack, makeupListFilter, makeupListHref, makeupRecordBack } from "./list-navigation";

const id = "00000000-0000-4000-8000-000000000001";
describe("보강 화면 이동 조건", () => {
  it("상세 왕복 뒤 목록의 조회 조건과 페이지를 유지한다", () => {
    const filter = { tab: "closed", flag: "recon_open", q: "동명 학생", owner_id: id, student_id: id, page: "3" };
    const href = makeupCaseHref(id, filter);
    const back = new URL(href, "https://local.test").searchParams.get("back");
    expect(makeupListBack(back)).toBe(makeupListHref(filter));
    expect(makeupListHref(filter, { owner_id: "", page: "1" })).toContain("student_id=");
  });
  it("외부 주소·앱 경로·중첩 이동 주소를 반환 대상으로 쓰지 않는다", () => {
    for (const value of ["https://evil.test/?tab=closed&flag=recon_open", "//evil.test?tab=closed", "/attendance?tab=closed", "javascript:alert(1)", "tab=closed\n", "return=https://evil.test", "unknown=value"])
      expect(makeupListBack(value)).toBe("/makeups");
    expect(makeupListBack("tab=closed&return=https://evil.test")).toBe("/makeups?tab=closed");
    expect(makeupListFilter({ q: "x".repeat(101), page: ["1", "2"], embed: "1" })).toEqual({});
  });
  it("보고서에서 돌아올 수 있는 곳은 보강 상세만이다", () => {
    expect(makeupRecordBack(`/makeups/${id}`)).toBe(`/makeups/${id}`);
    for (const value of [`/makeups/${id}?return=/login`, `/makeups/${id}/..`, "https://evil.test", "/makeups"])
      expect(makeupRecordBack(value)).toBeNull();
  });
});
