/**
 * **테스트 학생은 운영 집계에 들어가지 않는다.**
 *
 * 2026-09-01 원장 지시로 ClassNote 발송 시험용 학생 '학원이'(`students.is_test`)를 **모든 선생님이
 * 자기 화면에서 테스트할 수 있도록** 반 15개(수학 9·영어 6)에 배정했다. 그 순간부터 '미작성 보고서'
 * 신호가 요일에 따라 **매일 2~5명을 더 세게 된다** — 진짜 미작성(수학 30여 명) 안에 가짜가 섞이는 것이라
 * 숫자도 명단도 거짓이 된다.
 *
 * 리포의 다른 집계는 이미 같은 축으로 뺀다(report-admin 작성률·todays-math·failed-notify-sweep). 여기만
 * 빠져 있었다. 배정을 끝내도(수강 종료) 이 규칙은 남겨야 한다 — 다음 테스트 때 같은 일이 반복된다.
 *
 * ⚠️ 이건 **집계**에서만 빼는 것이다. 선생님 화면의 명단(원스크린·ECS·출석부)에는 그대로 보여야
 * 테스트가 된다 — 거기까지 빼면 배정한 의미가 없어진다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const signals = strip(read("src", "features", "dashboard", "server", "action-signals.ts"));

describe("미작성 보고서 신호는 테스트 학생을 세지 않는다", () => {
  it("is_test 학생 id를 모아 대상에서 뺀다", () => {
    expect(signals).toMatch(/is_test["'\s,)]*[\s\S]{0,20}true/);
    expect(signals).toContain("testStudentIds");
    expect(signals).toMatch(/\.filter\(\(row\) => !testStudentIds\.has\(row\.student_id\)\)/);
  });

  it("그 조회는 fail-open이다 — 실패해도 신호를 죽이지 않는다", () => {
    // throw하면 테스트 학생 명단 한 번 못 읽었다고 그날 '미작성'이 통째로 사라진다.
    expect(signals).toMatch(/fetchAllPaged<\{ id: string \}>\([\s\S]{0,400}?\.catch\(/);
  });

  it("전건 조회는 페이징을 거친다(B2 — 무페이징 select 금지)", () => {
    expect(signals).toMatch(/fetchAllPaged<\{ id: string \}>\([\s\S]{0,300}?is_test[\s\S]{0,160}?\.range\(/);
  });

  it("cron(admin) 경로에서도 테넌트로 좁힌다 — admin은 RLS 우회다", () => {
    expect(signals).toMatch(/scopeTenant\(supabase\.from\("students"\)\.select\("id"\)\.eq\("is_test", true\), db\)/);
  });

  it("수강 조회와 함께 병렬로 돈다(B4 — 직렬 워터폴 금지)", () => {
    expect(signals).toMatch(/const \[enrollmentRows, testStudentRows\] = await Promise\.all\(/);
  });
});

describe("이미 같은 축을 쓰던 곳들이 그대로다", () => {
  const cases: [string, string[]][] = [
    ["작성률(report-admin)", ["src", "features", "report-admin", "server", "queries.ts"]],
    ["오늘의 수학(연동)", ["src", "features", "integrations", "todays-math", "service.ts"]],
    ["발송 실패 알림", ["src", "features", "notifications", "server", "failed-notify-sweep.ts"]],
    ["보드 명단", ["src", "features", "report-admin", "server", "board-roster-queries.ts"]],
  ];
  for (const [label, path] of cases) {
    it(`${label}은 여전히 is_test를 본다`, () => {
      expect(strip(read(...path))).toContain("is_test");
    });
  }
});
