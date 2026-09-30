import { expect, it } from "vitest";
import { DOC_COL } from "./document-columns";
import { HIDE_WHEN_NARROW } from "./document-table";

it("좁은 표에서 숨기는 규칙은 행·머리·열이 다는 표식과 같은 이름을 가리킨다(오타 하나면 머리만 숨고 칸은 남는다)", () => {
  for (const key of ["type", "created", "uploader"] as const) {
    expect(HIDE_WHEN_NARROW[key]).toContain(`[&_.${DOC_COL[key]}]:hidden`);
  }
});
