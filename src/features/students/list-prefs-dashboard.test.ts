/**
 * D1 — 운영실 ↗로 들어온 원생목록(`from=dashboard`)은 **들어온 그 화면에서만** 보기 설정 저장을 건너뛰고,
 * 사용자가 필터를 바꾸면 **바꾼 축만** 저장한다(운영실이 적은 '전체'가 저장값을 덮지 않는다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_PREF_PARAMS,
  dashboardExitParams,
  sameStudentListPrefs,
  studentListPrefsFromUrl,
  type StudentListPrefs,
} from "./list-prefs";

const SAVED: StudentListPrefs = {
  subject: "math",
  grade: "중1",
  teacher: "t1",
  field: "all",
  sort: "name",
  noenr: true,
};
const LANDING = "status=enrolled&subject=all&grade=all&teacher=all&noenr=0&from=dashboard";

/** FilterSelect가 하는 일 그대로: 값을 넣고 clearParams를 지운다(page 리셋 포함). */
function change(query: string, param: string, value: string): Record<string, string> {
  const params = new URLSearchParams(query);
  params.set(param, value);
  for (const key of dashboardExitParams(params.get("from") === "dashboard", param)) params.delete(key);
  params.delete("page");
  return Object.fromEntries(params);
}

describe("D1 — 운영실에서 온 원생목록의 보기 설정 저장", () => {
  it("들어온 화면(from=dashboard)의 명시값을 그대로 저장하면 저장값이 통째로 '전체'가 된다 — 그래서 그 렌더는 저장하지 않는다", () => {
    const landing = Object.fromEntries(new URLSearchParams(LANDING));
    const current = studentListPrefsFromUrl(landing, SAVED);
    expect(current).toMatchObject({ subject: "all", grade: "all", teacher: "all", noenr: false });
    const page = readFileSync(join(process.cwd(), "src/app/(shell)/students/page.tsx"), "utf8");
    expect(page).toMatch(/prefsLoaded && !fromDashboard/);
  });

  it("🔑 들어온 뒤 학년 하나를 바꾸면 from·다른 운영실 축이 빠지고, 저장 비교는 **학년만** 다르다", () => {
    const next = change(LANDING, "grade", "중2");
    expect(next).toEqual({ status: "enrolled", grade: "중2" });
    const current = studentListPrefsFromUrl(next, SAVED);
    expect(current).toEqual({ ...SAVED, grade: "중2" });
    expect(sameStudentListPrefs(current, SAVED)).toBe(false);
  });

  it("운영실 축이 아닌 필터(정렬·상태)를 바꿔도 운영실 축은 저장값으로 돌아간다", () => {
    const sorted = change(LANDING, "sort", "recent");
    expect(studentListPrefsFromUrl(sorted, SAVED)).toEqual({ ...SAVED, sort: "recent" });
    const status = change(LANDING, "status", "on_hold");
    expect(studentListPrefsFromUrl(status, SAVED)).toEqual(SAVED); // 상태는 저장 축이 아니다 → 저장할 것 없음
  });

  it("운영실에서 온 화면이 아니면 아무것도 안 지운다 — 종전 RememberPrefs 동작 그대로", () => {
    expect(dashboardExitParams(false, "grade")).toEqual([]);
    const next = change("grade=중1&subject=all", "teacher", "t2");
    expect(next).toEqual({ grade: "중1", subject: "all", teacher: "t2" });
  });

  it("운영실 링크가 적는 축 목록 = 지우는 축 목록(두 벌이 갈리면 저장값이 덮인다)", () => {
    const links = readFileSync(join(process.cwd(), "src/features/dashboard/overview/kpi-links.ts"), "utf8");
    const axes = /const STUDENT_AXES = "([^"]+)"/.exec(links)?.[1] ?? "";
    const linked = [...new URLSearchParams(axes).keys()].filter((key) => key !== "from");
    expect(linked.sort()).toEqual([...DASHBOARD_PREF_PARAMS].sort());
  });
});
