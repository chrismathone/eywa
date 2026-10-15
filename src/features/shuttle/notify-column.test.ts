import { describe, expect, it } from "vitest";
import { isMissingNotifyColumn } from "./notify-column";

describe("isMissingNotifyColumn — 0368c 전 DB 감지", () => {
  it("읽기(42703)·쓰기(PGRST204)에서 notify_parent 칸이 없을 때만 참", () => {
    expect(isMissingNotifyColumn({ code: "42703", message: "column shuttle_boardings.notify_parent does not exist" })).toBe(true);
    expect(isMissingNotifyColumn({ code: "PGRST204", message: "Could not find the 'notify_parent' column of 'shuttle_boardings' in the schema cache" })).toBe(true);
  });

  it("다른 칸·다른 오류·오류 없음은 거짓", () => {
    expect(isMissingNotifyColumn({ code: "42703", message: "column shuttle_boardings.memo does not exist" })).toBe(false);
    expect(isMissingNotifyColumn({ code: "42P01", message: "relation notify_parent does not exist" })).toBe(false);
    expect(isMissingNotifyColumn(null)).toBe(false);
  });
});
