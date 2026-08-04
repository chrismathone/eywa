import { describe, expect, it } from "vitest";
import {
  applySchoolPrefs,
  DEFAULT_SCHOOL_PREFS,
  parseSchoolStatsPrefs,
  type SchoolRow,
} from "./school-view-prefs";

const rows: SchoolRow[] = [
  { key: "칠성초", label: "대구칠성초등학교", kind: "초", total: 1207, counts: { enrolled: 71, withdrawn: 40, prospect: 2 } },
  { key: "칠성고", label: "칠성고등학교", kind: "고", total: 414, counts: { enrolled: 20, withdrawn: 5, prospect: 0 } },
  { key: "침산중", label: "침산중학교", kind: "중", total: 786, counts: { enrolled: 29, withdrawn: 60, prospect: 1 } },
  // 공시에 없는 학교 — 점유율을 만들 수 없다.
  { key: "마이스터고", label: "마이스터고", kind: null, total: null, counts: { enrolled: 1, withdrawn: 0, prospect: 0 } },
];

describe("parseSchoolStatsPrefs", () => {
  it("빈 값·모르는 값은 기본값으로 — 손장난으로 화면이 깨지지 않게", () => {
    expect(parseSchoolStatsPrefs(undefined)).toEqual(DEFAULT_SCHOOL_PREFS);
    expect(parseSchoolStatsPrefs({ basis: "해킹", sortBy: "zzz", sortDir: "옆으로" })).toEqual(
      DEFAULT_SCHOOL_PREFS,
    );
  });

  it("🔴 급을 전부 켜거나 전부 끄면 '전체'로 — 스스로를 빈 화면에 가두지 못하게", () => {
    expect(parseSchoolStatsPrefs({ kinds: [] }).kinds).toBeNull();
    expect(parseSchoolStatsPrefs({ kinds: ["초", "중", "고"] }).kinds).toBeNull();
    expect(parseSchoolStatsPrefs({ kinds: ["초", "고"] }).kinds).toEqual(["초", "고"]);
    expect(parseSchoolStatsPrefs({ kinds: ["초", "대학교"] }).kinds).toEqual(["초"]);
  });
});

describe("applySchoolPrefs", () => {
  it("기준을 바꾸면 세는 대상이 바뀐다 — 퇴원생 기준이면 침산중이 1위", () => {
    const byEnrolled = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, basis: "enrolled" });
    expect(byEnrolled[0].label).toBe("대구칠성초등학교");
    const byWithdrawn = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, basis: "withdrawn" });
    expect(byWithdrawn[0].label).toBe("침산중학교");
    expect(byWithdrawn[0].n).toBe(60);
  });

  it("전체 기준은 세 상태를 더한다", () => {
    const all = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, basis: "all" });
    expect(all.find((r) => r.key === "칠성초")!.n).toBe(113); // 71+40+2
  });

  it("그 기준으로 0명인 학교는 빠진다", () => {
    const p = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, basis: "prospect" });
    expect(p.map((r) => r.key)).toEqual(["칠성초", "침산중"]); // 칠성고·마이스터고는 0명
  });

  it("급 필터", () => {
    const only = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, kinds: ["초"] });
    expect(only.map((r) => r.key)).toEqual(["칠성초"]);
    // 급을 모르는 학교(마이스터고)는 어떤 급 필터에도 안 걸린다 — 아무 급에나 끼워 넣지 않는다.
    expect(applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, kinds: ["고"] }).map((r) => r.key)).toEqual([
      "칠성고",
    ]);
  });

  it("인원 정렬 — 오름/내림", () => {
    const desc = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, sortBy: "count", sortDir: "desc" });
    expect(desc.map((r) => r.n)).toEqual([71, 29, 20, 1]);
    const asc = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, sortBy: "count", sortDir: "asc" });
    expect(asc.map((r) => r.n)).toEqual([1, 20, 29, 71]);
  });

  it("점유율 정렬 — 인원 순서와 다르다(칠성고가 칠성초보다 높다)", () => {
    const desc = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, sortBy: "pct", sortDir: "desc" });
    // 칠성초 5.9% · 칠성고 4.8% · 침산중 3.7%
    expect(desc.slice(0, 3).map((r) => r.key)).toEqual(["칠성초", "칠성고", "침산중"]);
    expect(desc[0].pct).toBe(5.9);
  });

  it("🔴 전교생 미상은 **방향과 무관하게** 항상 끝 — 0%로 읽히면 안 된다", () => {
    const desc = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, sortBy: "pct", sortDir: "desc" });
    const asc = applySchoolPrefs(rows, { ...DEFAULT_SCHOOL_PREFS, sortBy: "pct", sortDir: "asc" });
    expect(desc.at(-1)!.key).toBe("마이스터고");
    expect(asc.at(-1)!.key).toBe("마이스터고");
    expect(desc.at(-1)!.pct).toBeNull();
  });
});
