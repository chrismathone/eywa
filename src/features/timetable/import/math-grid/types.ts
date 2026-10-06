// 수학 시간표 격자 탭(시트로 보낸 그 모양)을 되읽는 타입. 순수 — 클라·서버 공용(server-only 금지).
//
// 왜 '수강편집' 탭으로 충분하지 않은가(원장 2026-10-06): 그 탭은 숨겨져 있고, 사람은 눈에 보이는 격자에서
// 열을 끼우고 반 블록을 새로 만든다. 격자를 못 읽으면 "가져올 변경이 없습니다"가 되어 고친 것이 통째로 무시된다.
//
// 읽는 방식: 칸의 **자리(행·열 번호)를 믿지 않는다**. 열은 머리 행의 강사·요일로, 행은 교시 라벨로 뜻을 정한다
// — 사람이 열을 하나 끼우면 그 오른쪽 자리 번호가 전부 밀리기 때문이다(실측: 내보낸 기록과 48칸이 어긋났다).

import type { SheetGridMerge } from "../structure/types";

export interface MathGridInput {
  /** [행][열] 0-based 글자(빈 칸 = ""). 병합 칸은 왼쪽 위 칸에만 글자가 있다. */
  cells: string[][];
  /** 0-based, 끝 미포함(Sheets 원형). */
  merges: SheetGridMerge[];
}

/** 요일 열 하나의 뜻 — 머리 행(강사·요일)에서 읽는다. */
export interface GridColumn {
  col: number;
  teacher: string;
  /** 월·화·수·목·금·토·일 */
  day: string;
  /** 주말 구역(둘째 '교시' 열의 오른쪽) — 행 배치 규칙이 평일과 다르다. */
  weekend: boolean;
}

/** 교시 블록(평일 1교시 = 24행). 행 범위는 양끝 포함. */
export interface GridBlock {
  start: number;
  end: number;
  /** N교시의 N(1~4). */
  gid: number;
}

export type GridSection = "active" | "hold" | "withdrawn";

export interface GridStudentCell {
  /** 합반 접두(`[2] `)를 뗀 글자 — "추윤서/6옥산초" */
  text: string;
  /** 합반 접두 번호. 접두가 없으면 0. */
  classIdx: number;
  /** 이 글자가 덮는 요일(병합이면 여럿). */
  days: string[];
  section: GridSection;
  row: number;
  col: number;
}

/** 칸에 든 반 하나 — 합반이면 한 칸에 여럿이고, 순서가 학생 접두 번호(`[1]`·`[2]`)다. */
export interface GridCellClass {
  name: string;
  /** 레거시 교시 id("2-1"·"2-2") — 익스포터와 같은 축. */
  periodIds: string[];
  /**
   * 이름이 병합 없이 **윗줄에만** 적혔다. 익스포터가 그린 칸이면 "앞 시간만"이라는 뜻이지만, 사람이 새 칸에
   * 손으로 적은 이름도 같은 모양이 된다 — 새 반이면 교시 전체로 읽는다(판정은 delta.ts).
   */
  loneTop?: boolean;
}

export interface GridClassCell {
  classes: GridCellClass[];
  room: string;
  teacher: string;
  days: string[];
  weekend: boolean;
  students: GridStudentCell[];
  /** 칸의 왼쪽 위 자리(0-based, 이름 윗줄·첫 열) — 안내 문구와 기록 속 칸 짝짓기에 쓴다. */
  row: number;
  col: number;
}

export interface ParsedMathGrid {
  columns: GridColumn[];
  blocks: GridBlock[];
  cells: GridClassCell[];
  /**
   * 교시 블록 줄에 적힌 글자 **전부**(읽지 못한 열·인원 줄 포함) — "빠진 줄 알았던 학생이 사실은 못 읽은 자리에
   * 적혀 있다"를 가려내는 데만 쓴다. 반 칸으로 읽힌 것만 보면 옮겨 적은 학생이 '빠짐'으로 남는다.
   */
  written: { row: number; col: number; text: string }[];
  warnings: string[];
}

/** `_meta` 탭(시트로 보낼 때 함께 쓰는 기록)의 학생 한 줄 — "시트가 알고 있던 명단"의 근거. */
export interface MetaStudent {
  studentId: string;
  /** 합반 접두를 뗀 글자. */
  text: string;
  classIdx: number;
  section: GridSection;
}

/** 기록 속 반 칸 하나 — 익스포터가 칸을 그린 순서대로 적으므로 줄 순서에서 칸 묶음을 되찾는다. */
export interface MetaCell {
  /** 그 칸의 대표 반(합반이면 첫 반). 둘째 반 이상의 id는 기록에 없다. */
  primaryClassId: string;
  /**
   * 내보낼 때 그 칸이 있던 자리(0-based, 이름 윗줄·첫 열). 🔴 좌표로 칸을 찾는 데 쓰지 말 것 — 열을 끼우면 밀린다.
   * 같은 반이 한 교시 줄에 여러 칸일 때 **왼쪽부터 몇 번째인지**를 가리는 데만 쓴다(순서는 열을 끼워도 유지된다).
   */
  row: number;
  col: number;
  /** 내보낼 때 그 칸에 적은 강의실 글자(합반이면 "A / B"). */
  room: string;
  students: MetaStudent[];
}

export interface ParsedMeta {
  /** 격자 본 탭 이름 — "수학 2026년 10월 5일 주" */
  mainTab: string;
  referenceDate: string;
  /** 대표 반 id → 내보낼 때의 이름. */
  classNameById: Map<string, string>;
  cells: MetaCell[];
}

export interface DeltaStudent {
  /** 시트가 알던 학생이면 id, 처음 보는 글자면 null(서버가 학생 명부에서 찾는다). */
  studentId: string | null;
  text: string;
}

export interface DeltaClassRef {
  /** null = 아직 없는 반(새 반). */
  classId: string | null;
  name: string;
}

/** 격자에 놓인 자리 하나 — 새 반·새로 놓인 반의 배치 근거. */
export interface DeltaSlot {
  teacher: string;
  days: string[];
  periodIds: string[];
  weekend: boolean;
  room: string;
}

/** 읽기는 했지만 시트로는 반영하지 않는 것 — 무엇을, 왜. 화면의 '적용하지 않는 것' 목록이 된다. */
export interface DeltaIgnored {
  what: string;
  why: string;
}

export interface GridDelta {
  /** 수업목록에 없는 이름으로 놓인 반. */
  newClasses: { name: string; slots: DeltaSlot[]; students: DeltaStudent[] }[];
  /** 수업목록엔 있는데 내보낸 격자엔 없던 반(배치가 새로 생긴 것). */
  placedClasses: { classId: string; name: string; slots: DeltaSlot[] }[];
  /**
   * `days` = 옮겨 간 반에서 그 학생이 적힌 요일. **그 반의 모든 요일이면 빈 배열**(= 전 요일 등원),
   * 일부 요일 열에만 적었으면 그 요일들(분리등원).
   * `toHold` = 옮겨 간(추가된) 칸에서 전부 대기 구역에 적혔다. `wasHeld` = 원래 반에서 전부 대기 구역이었다.
   */
  moves: { student: DeltaStudent; from: DeltaClassRef; to: DeltaClassRef; days: string[]; toHold?: boolean; wasHeld?: boolean }[];
  adds: { student: DeltaStudent; to: DeltaClassRef; days: string[]; toHold?: boolean }[];
  removes: { student: DeltaStudent; from: DeltaClassRef }[];
  /**
   * 격자에 서 있는 기존 반들의 자리 — 수업목록의 배치와 견줘 "시간·강사를 바꿨는가"를 본다.
   * `roomWas` = 내보낼 때 그 반 칸에 적혀 있던 강의실(합반 칸 제외). 강의실은 **시트끼리** 견준다 — 수업목록과 견주면
   * 시트를 보낸 뒤 앱에서 강의실을 바꾼 반이 전부 "시트에서 바꿨다"로 뜬다(실측 3건).
   */
  classSlots: { classId: string; name: string; slots: DeltaSlot[]; roomWas: string[] }[];
  ignored: DeltaIgnored[];
  /** 읽은 방식에 대한 알림(예: 교시 전체로 읽음). */
  notes: string[];
  /** 못 읽은 것 — 적용에서 빠진다. */
  warnings: string[];
  stats: { classCells: number; students: number };
}
