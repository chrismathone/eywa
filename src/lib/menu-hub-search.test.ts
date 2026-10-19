import { describe, expect, it } from "vitest";

import { HUB_GROUPS, SUPPORT_GROUPS, hubSearchEntries, matchHubSearch, type HubSearchEntry } from "./menu-hub";

const entry = (label: string, group: string, extra = ""): HubSearchEntry => ({
  dest: { menuKey: "students", href: `/x/${label}`, label, icon: "users" },
  group,
  keywords: `${label} ${group} ${extra}`.toLowerCase(),
});

describe("메뉴 검색 — 사이드바와 검색 팰릿이 같은 매칭", () => {
  it("빈 검색어는 아무것도 안 낸다", () => {
    expect(matchHubSearch([entry("학생목록", "학생")], "  ")).toEqual([]);
  });

  it("띄어쓰기를 무시한다 — '학생 목록'으로 '학생목록'을, 그 반대도", () => {
    const list = [entry("학생목록", "학생"), entry("수업 목록", "수업")];
    expect(matchHubSearch(list, "학생 목록").map((e) => e.dest.label)).toEqual(["학생목록"]);
    expect(matchHubSearch(list, "수업목록").map((e) => e.dest.label)).toEqual(["수업 목록"]);
  });

  it("라벨이 검색어로 시작 → 라벨에 포함 → 업무군·별칭으로만 걸림 순서", () => {
    const list = [entry("셔틀", "학원운영", "출석"), entry("월별 출석부", "수업"), entry("출석부", "수업")];
    expect(matchHubSearch(list, "출석").map((e) => e.dest.label)).toEqual(["출석부", "월별 출석부", "셔틀"]);
  });

  it("🔴 메뉴 판에 선 버튼은 전부 제 이름으로 찾힌다(원장 계정 기준)", () => {
    const entries = hubSearchEntries({ systemRole: "master", isMaster: true, isGenericTenant: false });
    const visible = new Set(entries.map((e) => e.dest.href));
    const lost = [...HUB_GROUPS, ...SUPPORT_GROUPS]
      .flatMap((g) => g.items)
      .filter((d) => visible.has(d.href))
      .filter((d) => !matchHubSearch(entries, d.label).some((e) => e.dest.href === d.href))
      .map((d) => d.href);
    expect(entries.length).toBeGreaterThan(20);
    expect(lost).toEqual([]);
  });
});
