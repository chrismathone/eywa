import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contributionReady, loadContributionSettings, tableMissing } from "./store";
import { DEFAULT_CONFIG } from "../model/config";
function database(error: { code: string; message: string } | null, data: unknown = null) {
  const q = { select: () => q, eq: () => q, limit: async () => ({ error, data }), maybeSingle: async () => ({ error, data }) };
  return { from: () => q } as unknown as SupabaseClient;
}
it("아직 마이그레이션 전이면 계산 준비 상태와 기본 설정", async () => {
  const db = database({ code: "PGRST205", message: "table missing" });
  expect(await contributionReady(db, "t")).toBe(false);
  expect(await loadContributionSettings(db, "t")).toMatchObject({ config: DEFAULT_CONFIG, missing: true, historyReady: false });
});
it("네트워크·권한 오류를 자료 없음이나 0으로 삼키지 않는다", async () => {
  const error = { code: "42501", message: "permission denied" }, db = database(error);
  expect(tableMissing(error)).toBe(false);
  await expect(contributionReady(db, "t")).rejects.toThrow(); await expect(loadContributionSettings(db, "t")).rejects.toThrow();
});
it("처음 만들어진 빈 설정 행은 확정 기본 배점을 사용", async () => {
  expect(await loadContributionSettings(database(null, { config: {}, revision: 0 }), "t")).toMatchObject({ config: DEFAULT_CONFIG, missing: false });
});
