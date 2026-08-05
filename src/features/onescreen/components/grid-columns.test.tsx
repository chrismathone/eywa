import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrevRow } from "./prev-row";
import type { Subject } from "../types";

afterEach(cleanup);

/**
 * 표 모드 열 정렬 잠금 — 머리글(`<col>`/`<th>`)과 **참고행**의 칸 수가 같아야 한다.
 *
 * 🔴 왜 필요한가: 이 표는 `table-fixed` + colgroup이라 각 행이 **위치로만** 열을 맞춘다. 열을 하나
 *    추가하면서 참고행(PrevRow)에 빈 칸을 안 넣으면, 타입도 테스트도 안 깨진 채 그 행만 통째로 한 칸씩
 *    왼쪽으로 밀린다 — 진도 자리에 태도가, 태도 자리에 과제가 보인다. 화면을 직접 보지 않으면 못 잡는다.
 *    (2026-08-05 '타임' 전용 열 신설 때 실제로 발생할 뻔했다. 같은 계열 함정: 교실뷰 timelineColumnCells.)
 */
const GRID_SRC = readFileSync(
  join(process.cwd(), "src/features/onescreen/components/onescreen-grid.tsx"),
  "utf8",
);

/** thead의 `<th` 개수 — 조건부(`{config.dailyEnabled ? <th…}`)도 포함해 '둘 다 켠' 최대 열 수를 센다. */
function headerColumnCount(): number {
  const thead = GRID_SRC.slice(GRID_SRC.indexOf("<thead>"), GRID_SRC.indexOf("</thead>"));
  return (thead.match(/<th\b/g) ?? []).length;
}

/** colgroup의 `<col` 개수 — 헤더와 1:1이어야 한다(하나만 늘리면 폭이 통째로 어긋난다). */
function colCount(): number {
  const cg = GRID_SRC.slice(GRID_SRC.indexOf("<colgroup>"), GRID_SRC.indexOf("</colgroup>"));
  return (cg.match(/<col\b/g) ?? []).length;
}

const subject = {
  name: "수학",
  prev: "",
  today: "",
  prevReport: {
    date: "2026-08-04",
    progress: "1-1-1 수의 크기",
    examInfo: "80점",
    attitude: "성실",
    homeworkScore: "90%",
    textbook: "개념원리",
    homeworkToday: "",
    note: "",
  },
} as unknown as Subject;

describe("표 모드 열 정렬", () => {
  it("colgroup과 thead의 열 수가 같다", () => {
    expect(colCount()).toBe(headerColumnCount());
  });

  it("참고행(PrevRow)이 채우는 칸 수 = 머리글 열 수 (일일·확인 둘 다 켬)", () => {
    const { container } = render(
      <table>
        <tbody>
          <PrevRow subject={subject} dailyEnabled checkEnabled />
        </tbody>
      </table>,
    );
    const tds = [...container.querySelectorAll("td")];
    const span = tds.reduce((n, td) => n + (Number(td.getAttribute("colSpan") ?? td.colSpan) || 1), 0);
    expect(span).toBe(headerColumnCount());
  });

  it("일일·확인을 끄면 그만큼만 줄어든다(참고행이 그 두 칸을 colSpan으로 묶는다)", () => {
    const { container } = render(
      <table>
        <tbody>
          <PrevRow subject={subject} dailyEnabled={false} checkEnabled={false} />
        </tbody>
      </table>,
    );
    const tds = [...container.querySelectorAll("td")];
    const span = tds.reduce((n, td) => n + (Number(td.getAttribute("colSpan") ?? td.colSpan) || 1), 0);
    expect(span).toBe(headerColumnCount() - 2);
  });
});
