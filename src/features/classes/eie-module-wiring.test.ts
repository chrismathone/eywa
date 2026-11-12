import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("EiE가 꺼진 지점의 EiE 반 쓰기 차단 배선", () => {
  const actions = read("src", "features", "classes", "server", "actions.ts");
  const cutover = read("scripts", "_english_sync", "master-cutover.mts");

  it("반 생성·수정과 폐지 해제·재개강이 같은 판정을 쓰고 수정은 기존 구분을 서버에서 읽는다", () => {
    expect(actions.match(/eieTrackWriteError\(/g)).toHaveLength(3);
    expect(actions.match(/isModuleEnabled\(settings\.modules\.disabled, "eie"\)/g)).toHaveLength(3);
    expect(actions).toContain('select("class_name, subject, teacher_id, classroom_id, is_special, report_optout, english_track")');
    expect(actions).toContain("before?.english_track === \"eie\"");
    expect(actions.match(/classRestoreCheck\(/g)).toHaveLength(3);
  });

  it("마스터 컷오버도 프리셋을 앱과 같이 푼 뒤 :eie 적용 전에 중단한다", () => {
    expect(cutover).toContain("resolveSettings(stored?.data ?? null");
    expect(cutover).toContain('eieTrackWriteError(isModuleEnabled(settings.modules.disabled, "eie"), "eie")');
    expect(cutover.indexOf("if (requestedEieNames.length > 0)")).toBeLessThan(cutover.indexOf("for (const { name, track } of newClassSpecs)"));
  });
});
