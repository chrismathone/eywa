import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "src/features/owner/server/actions.ts"), "utf8");

describe("기능 면 저장의 EiE 보호", () => {
  it("EiE를 실제로 끄는 요청에서만 살아 있거나 종강 전인 EiE 반을 다시 확인하고 저장을 거절한다", () => {
    expect(source).toContain('isModuleTurningOff(before, requested, "eie")');
    expect(source).toContain('.eq("english_track", "eie")');
    expect(source).toContain('is_active.eq.true,closed_at.is.null,closed_at.gte.${today}');
    expect(source).toContain("EiE 반 ${classCount}개를 먼저 '인재원 영어'로 바꾸거나 정리하세요");
  });

  it("조회 실패도 끄기 허용으로 바꾸지 않는다", () => {
    expect(source).toContain("EiE 반을 확인하지 못해 기능을 끄지 않았습니다");
    expect(source).toContain('logDbError(eieError, "owner.saveOwnerSection.eieClasses")');
  });
});
