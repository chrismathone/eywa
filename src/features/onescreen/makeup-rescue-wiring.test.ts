/**
 * **오늘 안 도는 반에 찍은 보강도 원스크린에 남는다** — 회귀 방지.
 *
 * 원장 제보 2026-09-05: *"오늘자 주준호를 추가하려고 하니까 허주연 선생님에게 새로고침할 때마다
 * 주준호가 사라짐."*
 *
 * 실측으로 드러난 조합(전부 정상 운영인데 겹치면 사라진다):
 *  ① 허주연 담당 반은 **월~금**만 돈다 → 토요일(9/5)엔 `todayIds`가 비어 `noClassesToday`.
 *  ② 그 토요일에 `중등M 개별 BS3Q`로 보강 출결 2건(주준호·최하림, 메모 '시험대비')을 찍었다.
 *  ③ 보강 행을 되살리는 5-c가 **`activeIds`(오늘의 반)만** 봐서 그 행들을 아예 안 읽었다.
 *  ④ 게다가 두 학생은 **BS3Q 수강생**이라 `makeupStudentIds`의 "수강생 제외"에도 걸린다
 *     (그 함수는 "수강생이면 정규 명단에 뜬다"를 전제하는데, 그 반이 안 도는 날엔 정규 명단이 없다).
 * → 저장은 됐는데 어느 경로로도 화면에 못 서는 **"안 보이는데 존재하는 데이터"**가 됐다.
 *
 * 2026-08-03에 같은 모양을 **보강 보고서**에 대해 이미 한 번 고쳤다(빈 화면으로 떨어뜨리지 않기).
 * 이번은 그 나머지 절반 — **출결**이다(강사는 학생이 오면 보고서보다 출결을 먼저 찍는다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src", "features", "onescreen", "server", "roster.ts"), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const code = codeOnly(src);

describe("보강 출결 되살리기", () => {
  it("🔴 그날 내 반의 보강 출결을 읽는다 — 스케줄·보고서와 같은 병렬 왕복에서", () => {
    expect(code).toContain("const [scheds, makeupReports, makeupAttRows] = await Promise.all([");
    expect(code).toMatch(/\.eq\("status", "makeup"\)/);
    // 반 축이다 — 내 담당 반 전체(allIds)를 본다(오늘의 반만 보면 이번 사고가 그대로 재발한다).
    const at = code.indexOf('.eq("status", "makeup")');
    expect(code.slice(Math.max(0, at - 400), at)).toContain("fetchInChunks<{ student_id: string; class_id: string }>(allIds");
  });

  it("🔴 빈 화면 판정이 보고서와 출결을 **둘 다** 센다", () => {
    // 보고서만 세면 "출결은 찍었지만 보고서는 아직"인 정상 상태에서 화면이 비어 버린다.
    expect(code).toContain("makeupReports.length === 0 && makeupAttRows.length === 0");
    expect(code).toContain(
      "if (noClassesToday && !showAll && makeupReports.length === 0 && makeupAttRows.length === 0)",
    );
  });

  it("🔴 되살리는 것은 **그 학생**뿐 — 반을 activeIds에 넣지 않는다(담당반 전체 폴백 금지)", () => {
    const at = code.indexOf("const activeIdSet = new Set(activeIds);");
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, at + 700);
    expect(body).toContain("if (activeIdSet.has(r.class_id)) continue;");
    expect(body).toContain("attMakeup.push({ studentId: r.student_id, classId: r.class_id });");
    // 반 이름·과목을 찾을 수 있게 맵에만 넣는다(조회 전용 — 명단을 넓히지 않는다).
    expect(body).toContain("classById.set(cls.id, cls)");
    // activeIds/activeClasses를 이 자리에서 늘리지 않는다.
    expect(body).not.toMatch(/activeIds\.push|activeClasses\.push/);
  });

  it("🔴 되살린 행엔 `makeupStudentIds`(수강생 제외)를 태우지 않는다", () => {
    // 주준호·최하림은 그 반 수강생이라 태우면 다시 사라진다 — 보강 기록 자체가 '왔다'는 증거다.
    const at = code.indexOf("const activeIdSet = new Set(activeIds);");
    const body = code.slice(at, at + 700);
    expect(body).not.toContain("makeupStudentIds");
  });

  it("같은 학생·같은 반이 두 번 들어오지 않는다", () => {
    const at = code.indexOf("const activeIdSet = new Set(activeIds);");
    const body = code.slice(at, at + 700);
    expect(body).toContain("rescueSeen");
  });

  it("되살린 학생이 학생정보 조회 대상에 든다 — 조회 전에 attMakeup에 실린다", () => {
    const iRescue = code.indexOf("const activeIdSet = new Set(activeIds);");
    const iIds = code.indexOf("const studentIds = [");
    expect(iRescue).toBeGreaterThan(-1);
    expect(iIds).toBeGreaterThan(iRescue); // 되살리기가 먼저
  });
});
