import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { MENU_ACCESS } from "@/lib/permissions";

it("후속조치 DB 기본 권한이 실제 상담 메뉴와 일치한다", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/0377b_management_agent_access.sql"), "utf8");
  const json = sql.match(/\('(\{"master":"full".*?\})'::jsonb\)/)?.[1];
  expect(json).toBeDefined();
  expect(JSON.parse(json!)).toEqual(MENU_ACCESS.consultations);
});
