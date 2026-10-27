import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMissingHelpBoard } from "./missing";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("도움말 게시판 배선", () => {
  it("0265a 마이그레이션이 있고 부분 유니크가 없다", () => {
    const sql = readMigration("0265a_help_board.sql");
    expect(sql).toContain("create table if not exists public.help_posts");
    expect(sql).toContain("create table if not exists public.help_answers");
    expect(sql).toContain("auth_tenant_id()");
    expect(sql).not.toMatch(/unique \([^)]+\) where/i);
    const code = sql.replace(/--[^\n]*/g, "");
    expect(code).not.toContain("auth_menu_access");
  });

  it("감사로그 키가 등록돼 있다", () => {
    const log = read("src/features/audit/server/log.ts");
    const describe_ = read("src/features/audit/describe.ts");
    for (const key of [
      "help_post_create",
      "help_post_update",
      "help_post_delete",
      "help_post_close",
      "help_answer_create",
    ]) {
      expect(log).toContain(`  ${key}:`);
      expect(describe_).toContain(`case "${key}":`);
    }
    expect(describe_).toContain('help_post: "도움말 질문"');
  });

  it("서버 액션이 같은 게이트를 다시 본다", () => {
    const src = read("src/features/help/board/server/actions.ts");
    expect(src).toContain("canAskHelpBoard");
    expect(src).toContain("canAnswerHelpBoard");
    expect(src).toContain("logAction");
    expect(src).not.toMatch(/\bcanAccess\(/);
    expect(src).not.toMatch(/\baccessLevel\(/);
  });

  it("표 부재를 구분한다", () => {
    expect(isMissingHelpBoard({ code: "PGRST205" })).toBe(true);
    expect(isMissingHelpBoard({ code: "42P01" })).toBe(true);
    expect(isMissingHelpBoard({ code: "42501", message: "permission" })).toBe(false);
  });
});
