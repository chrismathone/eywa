import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cellOf, type Counts, type MatrixRow } from "../../view-admin";
import { AdminMatrix } from "./admin-matrix";

const c = (total: number, done: number, due: number, ontime: number, late = 0): Counts => ({ total, done, due, ontime, late, lateDone: 0, expired: 0, over7: 0 });
const row = (id: string, w?: Counts): MatrixRow => ({ ownerId: id, name: id, cells: { attendance: cellOf(c(10, 10, 10, 10)) }, all: cellOf(c(10, 10, 10, 10)), withdrawal: w ? cellOf(w) : undefined });

describe("선생님 표 — 퇴원보고서 작성 참고 열", () => {
  it("🔴 열은 함수가 있을 때만 · 머리에 '참고' · 합계 줄은 그 열의 합(전체 칸에는 안 든다)", () => {
    const rows = [row("a", c(2, 2, 2, 1)), row("b")];
    const html = renderToStaticMarkup(<AdminMatrix rows={rows} total={null} withdrawal={() => undefined} onCell={() => undefined} />);
    expect(html).toContain(">퇴원보고서<");
    expect(html).toContain("참고");
    expect(renderToStaticMarkup(<AdminMatrix rows={rows} total={null} onCell={() => undefined} />)).not.toContain("퇴원보고서");
  });
});
