import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classnoteModuleOn, classnoteSendOn } from "./classnote-gate";

/**
 * 기능 스위치 "꺼지면 흔적 없이"(원장 2026-09-30 *"스위치가 꺼져있을때 이 기능이 있었는지조차 모르게"*) 가드.
 * 🔴 ClassNote 모듈을 끈 학원에 옛 발송 스위치(`report.classnoteSendEnabled`)가 켜진 채 남아 있어도 한 건도 나가면 안 된다 —
 *    그래서 발송 경로는 원시 설정값이 아니라 `classnoteSendOn`(모듈 ∧ 스위치)만 읽는다.
 */
const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("classnoteSendOn", () => {
  it("모듈과 발송 스위치가 둘 다 켜져야 보낸다", () => {
    expect(classnoteSendOn({ modules: { disabled: [] }, report: { classnoteSendEnabled: true } })).toBe(true);
    expect(classnoteSendOn({ modules: { disabled: ["classnote"] }, report: { classnoteSendEnabled: true } })).toBe(false);
    expect(classnoteSendOn({ modules: { disabled: [] }, report: { classnoteSendEnabled: false } })).toBe(false);
    expect(classnoteModuleOn({ modules: { disabled: ["eie"] } })).toBe(true);
  });
});

describe("꺼진 기능 가드", () => {
  it("발송 스위치 원시값(settings.report.classnoteSendEnabled)을 읽는 곳은 게이트 한 곳뿐", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((f) => !f.endsWith(path.join("owner", "classnote-gate.ts")))
      .filter((f) => /settings\.report\.classnoteSendEnabled/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("워커는 ClassNote 모듈이 꺼지면 발송도 폴링도 하지 않는다", () => {
    const core = readFileSync(path.join(ROOT, "scripts/_classnote/classnote-core.mjs"), "utf8");
    const send = core.slice(core.indexOf("export async function isClassnoteSendEnabled"));
    expect(send.slice(0, send.indexOf("\n}\n"))).toMatch(/isClassnoteModuleEnabled\(sql, tenant\)/);
    expect(core).toMatch(/isRawModuleEnabled\(row, "classnote"\)/);
    const watch = readFileSync(path.join(ROOT, "scripts/_classnote/watch-classnote-queue.mjs"), "utf8");
    expect(watch).toMatch(/if \(!\(await isClassnoteModuleEnabled\(db\(\), tenant\)\)\)/);
  });

  it("꺼진 모듈의 주소는 기능 이름 없이 404(안내 화면을 두지 않는다)", () => {
    const req = readFileSync(path.join(ROOT, "src/lib/auth/require-access.ts"), "utf8");
    expect(req).not.toMatch(/\/unavailable/);
    expect(req).toMatch(/notFound\(\)/);
    const boundary = readFileSync(path.join(ROOT, "src/components/module-boundary.tsx"), "utf8");
    expect(boundary).toMatch(/notFound\(\)/);
  });

  it("급여·시트·makeedu 서버 게이트가 모듈을 본다", () => {
    const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
    expect(read("src/features/payroll/server/payslip-gate.ts")).toMatch(/"payroll"/);
    expect(read("src/features/payroll/server/salary-access.ts")).toMatch(/"payroll"/);
    expect(read("src/features/attendance/server/salary-rates.ts")).toMatch(/"payroll"/);
    expect(read("src/features/integrations/server/sheet-access.ts")).toMatch(/"google_sheets"/);
    expect(read("src/features/integrations/server/makeedu-sync.ts")).toMatch(/"makeedu"/);
    expect(read("src/app/api/cron/sheets-sync/route.ts")).toMatch(/"sheet_sync"/);
    expect(read("src/features/newcomers/server/consult-link.ts")).toMatch(/"newcomers"/);
  });

  it("업무 완성도와 운영실은 실제 발송만 발송 의무·발송 줄로 세고, 영어 직접 작성 집계는 모듈 판정을 유지한다", () => {
    const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
    const sync = read("src/features/duties/server/sync.ts");
    expect(sync).toContain("const classnoteSending = classnoteSendOn(settings)");
    expect(sync).toContain("classnoteSendOn: classnoteSending");
    expect(sync).toMatch(/void_reason: "send_disabled"[\s\S]*?\.eq\("kind", "report_send"\)[\s\S]*?\.eq\("status", "open"\)/);
    const work = read("src/features/dashboard/overview/teacher-work-server.ts");
    expect(work).toContain("const deliveryShown = classnoteSendOn(settings)");
    expect(work).toMatch(/english && classnoteModuleOn\(settings\) \? "classnote"/);
  });
}, 60_000);
