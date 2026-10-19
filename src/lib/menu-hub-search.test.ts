import { describe, expect, it } from "vitest";

import { HUB_GROUPS, SUPPORT_GROUPS, groupHubSearch, hubSearchEntries, matchHubSearch, type HubSearchEntry } from "./menu-hub";

const entry = (label: string, group: string, extra = ""): HubSearchEntry => ({
  dest: { menuKey: "students", href: `/x/${label}`, label, icon: "users" },
  group,
  groupId: group,
  groupIcon: "users",
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

describe("메뉴 지도 — 업무군별 묶음", () => {
  const list = [entry("수업목록", "수업"), entry("시간표", "수업"), entry("원생목록", "원생"), entry("출석부", "수업")];

  it("검색어가 없으면 전부를 업무군 순서대로 묶는다", () => {
    const { groups, flat } = groupHubSearch(list, "");
    expect(groups.map((g) => [g.label, g.items.map((e) => e.dest.label)])).toEqual([
      ["수업", ["수업목록", "시간표", "출석부"]],
      ["원생", ["원생목록"]],
    ]);
    expect(flat.map((e) => e.dest.label)).toEqual(["수업목록", "시간표", "출석부", "원생목록"]);
  });

  it("검색 중엔 가장 잘 맞는 메뉴의 업무군이 앞 · 키보드 순서 = 그린 순서", () => {
    const { groups, flat } = groupHubSearch(list, "목록");
    // 업무군 이름 '원생'·'수업'으로는 안 걸리고 라벨로만 걸린다 — 둘 다 '포함'이라 원래 차례(수업 먼저).
    expect(groups.map((g) => g.label)).toEqual(["수업", "원생"]);
    expect(flat.map((e) => e.dest.label)).toEqual(["수업목록", "원생목록"]);
    expect(groupHubSearch(list, "원생").groups[0]!.label).toBe("원생");
  });
});
