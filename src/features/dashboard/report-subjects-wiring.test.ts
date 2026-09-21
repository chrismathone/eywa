/**
 * **영어 보고서는 운영실이 세지 않는다** — 구조 가드(원장 2026-08-29 *"영어보고서는 운영실에서 제외"*).
 *
 * 순수 규칙이 맞아도 신호가 그 규칙을 안 지나가면 소용없다. 실측(2026-08-29): 최근 30일
 * `lesson_reports` 1,666건이 전부 수학이고 영어는 0건 — 8/28 하루만 봐도 영어 140명·0건이라
 * 영어를 세면 진짜 미작성(수학 32명)이 그 안에 묻힌다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const signals = strip(read("src", "features", "dashboard", "server", "action-signals.ts"));
const rule = strip(read("src", "features", "dashboard", "report-subjects.ts"));

describe("미작성 보고서 신호가 과목 축을 지난다", () => {
  it("대상 반을 고를 때 isReportTrackedSubject를 통과시킨다", () => {
    expect(signals).toMatch(/if \(!isReportTrackedSubject\(klass\.subject, trackedSubjects\)\) continue;/);
  });

  it("축은 학원설정 report.classnoteSubjects다(코드에 과목명을 박지 않는다)", () => {
    expect(signals).toMatch(/st\.report\.classnoteSubjects \?\? null/);
    // 🔴 'english'를 코드에 박으면 영어를 aywa로 옮길 때 이 파일을 고쳐야 한다 — 설정으로만 정한다.
    expect(rule).not.toContain('"english"');
    expect(signals).not.toMatch(/isReportTrackedSubject\([^)]*"english"/);
  });

  it("🔴 설정 조회 실패가 신호를 죽이지 않는다(fail-soft → 전부 세기)", () => {
    expect(signals).toMatch(/classnoteSubjects[\s\S]{0,80}\.catch\(\(\) => null\)/);
    expect(rule).toMatch(/if \(tracked\.length === 0\) return true;/);
  });

  it("cron(세션 없음) 경로도 테넌트를 명시해 읽는다", () => {
    expect(signals).toMatch(/db \? getTenantSettingsByTenantId\(db\.tenantId\) : getTenantSettings\(\)/);
  });

  it("신호가 꺼져 있으면 설정을 읽지 않는다(불필요한 왕복 0)", () => {
    expect(signals).toMatch(/enabled\("lessonReports"\)\s*\n?\s*\?\s*await/);
  });
});
