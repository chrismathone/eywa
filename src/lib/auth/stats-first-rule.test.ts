import { describe, expect, it } from "vitest";
import { cameFromSamePage, isBareEntry, STATS_FIRST_ROLES, withListMark } from "./stats-first-rule";

describe("관리자·원장 통계 먼저", () => {
  it("원장·관리자만 — 매니저·강사는 목록 그대로", () => {
    expect(STATS_FIRST_ROLES).toEqual(["master", "admin"]);
  });

  it("메뉴로 그냥 연 주소만 통계로 — 창 표식은 무시, 필터·탭·목록 표식이 있으면 목록", () => {
    expect(isBareEntry({})).toBe(true);
    expect(isBareEntry({ embed: "1" })).toBe(true);
    expect(isBareEntry({ tab: "list" })).toBe(false);
    expect(isBareEntry({ list: "1", embed: "1" })).toBe(false);
    expect(isBareEntry({ q: undefined })).toBe(true);
  });

  it("'목록으로' 주소에 목록 표식 — 기존 값·해시 보존", () => {
    expect(withListMark("/students")).toBe("/students?list=1");
    expect(withListMark("/lesson-reports?tab=list")).toBe("/lesson-reports?tab=list&list=1");
    expect(withListMark("/consultations?cat=a#x")).toBe("/consultations?cat=a&list=1#x");
    expect(isBareEntry({ list: "1" })).toBe(false);
  });
});

describe("같은 목록 안에서 온 요청", () => {
  it("referer 경로가 목록과 같으면 목록 안 이동 — 다른 화면·없음·깨진 값은 메뉴로 연 것", () => {
    expect(cameFromSamePage("https://www.aywa.co.kr/students?status=all", "/students")).toBe(true);
    expect(cameFromSamePage("https://www.aywa.co.kr/students/stats", "/students")).toBe(false);
    expect(cameFromSamePage("https://www.aywa.co.kr/dashboard", "/students")).toBe(false);
    expect(cameFromSamePage(null, "/students")).toBe(false);
    expect(cameFromSamePage("not a url", "/students")).toBe(false);
  });
});
