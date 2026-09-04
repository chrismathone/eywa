import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("원스크린 빈 창 덮어쓰기 방지 배선", () => {
  it("저장 액션이 판정 함수를 거치고, ignore면 upsert 전에 돌아온다", () => {
    const src = read("features/onescreen/server/actions.ts");
    expect(src).toContain('from "../session-write"');
    const decide = src.indexOf("sessionSaveDecision(");
    const ignore = src.indexOf('=== "ignore"');
    const upsert = src.indexOf('.from("onescreen_daily_sessions")');
    const upsertWrite = src.indexOf(".upsert(", upsert + 1);
    expect(decide).toBeGreaterThan(-1);
    expect(ignore).toBeGreaterThan(decide);
    expect(upsertWrite).toBeGreaterThan(ignore);
    expect(src).toContain(".insert(payload)");
    expect(src).toContain("sessionContentFromRow(raced)");
  });

  it("로스터가 updated_at을 읽어 창 리비전을 내려준다", () => {
    const src = read("features/onescreen/server/roster.ts");
    expect(src).toMatch(/select\(\s*"student_id,[\s\S]*updated_at"/);
    expect(src).toContain("os.sessionUpdatedAt = sess.updated_at");
  });

  it("클라는 baseUpdatedAt을 보내고, skip이면 sessionUpdatedAt을 올리지 않는다", () => {
    const src = read("features/onescreen/components/onescreen-client.tsx");
    expect(src).toContain("baseUpdatedAt: s.sessionUpdatedAt");
    expect(src).toContain("applySessionSaveResult");
    const skipped = src.indexOf("if (res.skipped)");
    const bump = src.indexOf("sessionUpdatedAt: res.updatedAt");
    expect(skipped).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(skipped);
    const skipReturn = src.indexOf("return;", skipped);
    expect(skipReturn).toBeGreaterThan(skipped);
    expect(skipReturn).toBeLessThan(bump);
  });
});
