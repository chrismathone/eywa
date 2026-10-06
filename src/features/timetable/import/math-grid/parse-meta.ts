// `_meta` 탭 읽기 — 시트로 보낼 때 익스포터가 함께 쓰는 기록(어느 칸에 어느 반·학생을 적었는지). 순수.
//
// 여기서는 **자리(행·열)는 버리고** 사람 식별자만 쓴다: "이 시트가 알고 있던 명단"(반 → 학생들)과
// "이 글자는 어느 학생인가"(글자 → 학생 id). 자리는 사람이 열을 끼우는 순간 어긋나서 믿을 수 없다.

import { splitStudentText } from "./grid-text";
import type { GridSection, MetaCell, ParsedMeta } from "./types";

export const META_TAB_NAME = "_meta";

/** 내보내기 기록이 없는 시트 — 탭 이름(내부 식별자) 대신 사람이 할 일을 말한다. */
export const NO_EXPORT_RECORD_MSG =
  "시트에 내보내기 기록이 없습니다. 시간표에서 시트로 한 번 보낸 뒤 고쳐 주세요.";

const SECTIONS: readonly string[] = ["active", "hold", "withdrawn"];

export function parseMeta(rows: string[][]): ParsedMeta {
  const cell = (r: number, c: number) => (rows[r]?.[c] ?? "").toString().trim();
  if (cell(0, 0) !== "__schema_version__") {
    throw new Error(NO_EXPORT_RECORD_MSG);
  }
  const mainTab = cell(1, 4);
  const headerRow = rows.findIndex((row) => (row?.[0] ?? "").toString().trim() === "kind");
  if (!mainTab || headerRow < 0) {
    throw new Error("시트의 내보내기 기록을 읽지 못했습니다. 시간표에서 시트로 다시 보낸 뒤 고쳐 주세요.");
  }

  const index: Record<string, number> = {};
  rows[headerRow]!.forEach((h, i) => {
    const key = (h ?? "").toString().trim();
    if (key) index[key] = i;
  });
  const get = (row: string[], key: string) => {
    const i = index[key];
    return i === undefined ? "" : (row[i] ?? "").toString().trim();
  };

  // 익스포터는 칸마다 「반 이름(위·아래면 두 줄) → 강의실 → 학생들」 순서로 적는다 → 반 이름 줄이 칸의 시작이다.
  const classNameById = new Map<string, string>();
  const cells: MetaCell[] = [];
  let current: MetaCell | null = null;
  let prevKind = "";
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const kind = get(row, "kind");
    if (kind === "class_name") {
      if (prevKind !== "class_name") cells.push((current = { primaryClassId: "", row: -1, col: -1, students: [] }));
      const id = get(row, "classId");
      const name = get(row, "classNameSnapshot");
      if (id && name && !classNameById.has(id)) classNameById.set(id, name);
    } else if (kind === "class_room") {
      if (current && !current.primaryClassId) {
        current.primaryClassId = get(row, "classId");
        // 강의실 줄은 늘 이름 윗줄의 두 줄 아래다(평일·주말 공통) — 위·아래로 나뉜 칸도 같은 기준으로 맞춘다.
        current.row = Number(get(row, "row")) - 3;
        current.col = Number(get(row, "startCol")) - 1;
      }
    } else if (kind === "student" && current) {
      const studentId = get(row, "studentId");
      const section = get(row, "section");
      if (!current.primaryClassId) current.primaryClassId = get(row, "sourceClassId");
      if (!studentId || !SECTIONS.includes(section)) continue;
      current.students.push({
        studentId,
        ...splitStudentText(get(row, "studentNameSnapshot")),
        section: section as GridSection,
      });
    }
    if (kind) prevKind = kind;
  }

  return { mainTab, referenceDate: cell(1, 3), classNameById, cells: cells.filter((c) => c.primaryClassId) };
}
