// 출석부 시트 격자 좌표 모델 — 순수 함수(Vitest). 구 출석부(D:\attendance)의 시트 조작을 이식한 것.
//
// 좌표 공간: 행 = **(반·학생)** 조합, 열 = 날짜. 강사 전체 보기는 한 학생이 여러 반에 나오므로
// 행 키에 반이 반드시 들어간다(학생 id만 쓰면 같은 학생의 두 반이 한 행으로 뭉쳐 엉뚱한 칸이 채워진다).
//
// ⚠️ 키 구분자는 "|" — uuid·날짜에 없는 문자라 안전하다. 파싱은 **앞에서 두 번만** 자른다.

/** 행 키 = `classId|studentId`. */
export function rowKey(classId: string, studentId: string): string {
  return `${classId}|${studentId}`;
}

/** 셀 키 = `classId|studentId|YYYY-MM-DD`. */
export function cellKey(row: string, date: string): string {
  return `${row}|${date}`;
}

/** 행 키에서 반 id만 — 반 접기(그룹 토글)가 행을 반별로 가를 때 쓴다. */
export function classIdOfRow(row: string): string {
  const i = row.indexOf("|");
  return i < 0 ? row : row.slice(0, i);
}

export type ParsedCell = { classId: string; studentId: string; date: string; row: string };

/** 셀 키 → 구성요소. 형태가 어긋나면 null(호출부가 조용히 건너뛴다). */
export function parseCellKey(key: string): ParsedCell | null {
  const a = key.indexOf("|");
  if (a < 0) return null;
  const b = key.indexOf("|", a + 1);
  if (b < 0) return null;
  const classId = key.slice(0, a);
  const studentId = key.slice(a + 1, b);
  const date = key.slice(b + 1);
  if (!classId || !studentId || !date) return null;
  return { classId, studentId, date, row: `${classId}|${studentId}` };
}

/** 인덱스 이동 — 격자 밖으로 나가지 않게 양끝에서 멈춘다(시트와 동일: 끝에서 더 눌러도 순환하지 않음). */
export function clampIndex(len: number, cur: number, delta: number): number {
  if (len <= 0) return -1;
  return Math.max(0, Math.min(len - 1, cur + delta));
}

export type CellPos = { row: string; col: string };

/**
 * 현재 칸에서 (dx, dy)만큼 이동한 칸. 현재 칸이 목록에 없으면 null(월 변경 등으로 좌표가 사라진 경우).
 */
export function moveCell(
  rows: readonly string[],
  cols: readonly string[],
  cur: CellPos,
  dx: number,
  dy: number,
): CellPos | null {
  const r = rows.indexOf(cur.row);
  const c = cols.indexOf(cur.col);
  if (r < 0 || c < 0) return null;
  const nr = rows[clampIndex(rows.length, r, dy)];
  const nc = cols[clampIndex(cols.length, c, dx)];
  if (nr === undefined || nc === undefined) return null;
  return { row: nr, col: nc };
}

/**
 * anchor ↔ focus 사각형 안의 모든 셀 키. focus가 없으면 anchor 한 칸.
 * ⚠️ 좌표를 못 찾으면 **anchor 한 칸으로 축소**한다 — 빈 집합을 돌려주면 범위 채우기가 조용히 아무것도 안 한다.
 */
export function rectKeys(
  rows: readonly string[],
  cols: readonly string[],
  anchor: CellPos,
  focus: CellPos | null,
): Set<string> {
  const single = new Set([cellKey(anchor.row, anchor.col)]);
  if (!focus || (focus.row === anchor.row && focus.col === anchor.col)) return single;
  const rA = rows.indexOf(anchor.row);
  const rB = rows.indexOf(focus.row);
  const cA = cols.indexOf(anchor.col);
  const cB = cols.indexOf(focus.col);
  if (rA < 0 || rB < 0 || cA < 0 || cB < 0) return single;
  const out = new Set<string>();
  for (let r = Math.min(rA, rB); r <= Math.max(rA, rB); r++) {
    const rk = rows[r];
    if (rk === undefined) continue;
    for (let c = Math.min(cA, cB); c <= Math.max(cA, cB); c++) {
      const ck = cols[c];
      if (ck !== undefined) out.add(cellKey(rk, ck));
    }
  }
  return out;
}
