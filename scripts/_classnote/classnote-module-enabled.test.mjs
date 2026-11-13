import { describe, expect, it } from "vitest";
import { isClassnoteModuleEnabled } from "./classnote-core.mjs";

function database(rows) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return rows;
  };
  return { sql, calls };
}

describe("연동 PC의 ClassNote 모듈 판정 질의", () => {
  it("설정 문서 전체가 아니라 preset과 modules만 읽는다", async () => {
    const db = database([{ preset: "generic", modules: { disabled: [] } }]);

    await expect(isClassnoteModuleEnabled(db.sql, "tenant-a")).resolves.toBe(true);
    expect(db.calls).toEqual([{
      query: "select data->'preset' as preset, data->'modules' as modules from tenant_settings where tenant_id=?",
      values: ["tenant-a"],
    }]);
  });

  it.each([
    ["행 없음", [], true],
    ["preset 없음", [{ preset: null, modules: null }], true],
    ["disabled 배열 없음", [{ preset: "generic", modules: {} }], false],
    ["known 없음", [{ preset: "generic", modules: { disabled: [] } }], true],
    ["명시적으로 끔", [{ preset: "generic", modules: { disabled: ["classnote"] } }], false],
  ])("%s 판정이 종전 규칙을 유지한다", async (_label, rows, expected) => {
    await expect(isClassnoteModuleEnabled(database(rows).sql, "tenant-a")).resolves.toBe(expected);
  });
});
