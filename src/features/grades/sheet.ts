/**
 * 성적 엑셀 서식 규약 — 순수(빌더·서버 액션·Vitest가 함께 읽는다). 원장 2026-09-22:
 * *"현재 리스트에 맞는 시트 다운받으면 이름 반 뭐 나오고 거기 양식에 맞춰서 성적하고 기입 쭈루룩해서 업로드"*.
 *
 * 🔑 **내려받는 서식 = 올리는 서식**(같은 열·같은 라벨). 시트 두 장: 점수(`성적`) + 축/안내(`안내`).
 * 🔑 **파일이 스스로 축을 말한다** — 년도·학기·과목·트랙·시험·만점·시험일을 안내 시트에 적어 두고, 올릴 때
 *    **파일에 적힌 축**으로 반영한다. 화면에서 고른 축과 대조하지 않는다: 대조하면 1학기 시트를 2학기 화면에서
 *    올렸을 때 매번 거절당하거나(짜증) 조용히 엉뚱한 칸에 들어간다(사고). 대신 미리보기가 그 축을 한글로
 *    크게 보여 줘서 사람이 확인한다.
 * 🔑 축 값은 **키**(`english`·`midterm`)로 적고 사람이 읽는 라벨은 옆 칸(`설명`)에 따로 둔다 — 학원이 과목
 *    라벨을 바꿔도 지난 시트가 계속 읽힌다(라벨을 파싱 근거로 쓰면 그날 전부 깨진다).
 * 🔴 **빈 점수 칸 = 건드리지 않음**(원장 2026-09-22 선택 *"빈 칸은 그대로 두기"*). 그래서 파서는 빈 칸을
 *    `undefined`로 돌려주고 **`null`을 쓰지 않는다** — 저장 경로(`writeGradeCells`)에서 `null`은 "그 칸을
 *    지운다"는 뜻이라, 빈 칸을 null로 접으면 일부만 채운 시트 한 장이 나머지 성적을 전부 지운다.
 *    `0`은 유효한 점수다(빈 칸과 반드시 구분).
 * 🔑 **매칭 키 = 이름 + 학교 + 학년 + 반**(원장 2026-09-22 *"시트 보면 학생 ID는 받을 필요 없지 않음?
 *    이름 학교 학년 반 다 있는데?"*). 학생ID 열은 없앴다 — 사람이 읽을 수 없는 uuid라 시트가 지저분해지고,
 *    실수로 고치면 그 행이 조용히 사라진다. 🔴 대신 **후보가 둘 이상이면 그 행은 오류**다(첫 번째를 조용히
 *    고르면 남의 성적이 된다). ⚠️ 동명이인은 학원이 이름에 `박준우A`·`김현준B`처럼 접미사를 붙여 구분하므로
 *    그 글자를 떼지 말 것 — 그게 구분자다.
 * 🔑 **'성적' 시트 맨 윗줄에 축을 적는다**(원장 같은 날 *"1학기 중간인지 그런 게 시트에 없는데"*) — 성적 시트만
 *    봐도 무슨 시험인지 알 수 있게. 🔴 단 그 줄은 **사람용 표시**다: 기계가 읽는 축은 여전히 '안내' 시트이고
 *    (라벨은 학원설정을 따라 바뀐다), 그래서 파서는 제목 줄을 건너뛰고 **열 머리 줄을 찾아서** 읽는다.
 * ⚠️ 이 파일에 `import "server-only"`를 붙이지 말 것([[#61]]).
 *
 * 헬퍼(`mapHeaders`·`isBlankCells`·`duplicateKeyErrors`)는 재고 `inventory/excel-sheet.ts`와 같은 규약이지만
 * **베껴 둔다** — 그쪽을 import하면 분류·상태·자산코드 모듈이 통째로 딸려 온다(`cellText`도 이미 재고·학생·
 * 시간표 세 곳에 각자 있다. 공용화한다면 셋을 함께 옮길 일이지 성적만 얹을 자리가 아니다).
 */

import type { EnglishTrack } from "@/features/classes/english-track";
import { ENGLISH_SUBJECT_KEY } from "./subject-axis";
import { examSlotsFor, isExamSlot, type ExamSlotKey } from "./exam-slots";
import { TERM_LABEL, isTerm, termWindow, type Term } from "./term";
import { GRADE_MAX_SCORE_LIMIT } from "./types";

export const SCORE_SHEET_NAME = "성적";
export const AXIS_SHEET_NAME = "안내";

export type ScoreSheetKey = "name" | "school" | "grade" | "className" | "score";

/** 점수 시트 열 — 내려받기(header·width)와 올리기(key)가 **이 배열 하나**를 쓴다. */
export const SCORE_SHEET_COLUMNS: ReadonlyArray<{ key: ScoreSheetKey; header: string; width: number }> = [
  { key: "name", header: "이름", width: 14 },
  { key: "school", header: "학교", width: 18 },
  { key: "grade", header: "학년", width: 8 },
  { key: "className", header: "반", width: 20 },
  { key: "score", header: "점수", width: 10 },
];

/** 이 열들이 없으면 서식 불일치 — 화면이 파일 선택을 취소한다. */
export const REQUIRED_SCORE_HEADERS: ScoreSheetKey[] = ["name", "score"];

/**
 * 시트 줄 배치 — 1행 제목(축) · 2행 빈 줄 · 3행 열 머리 · 4행부터 데이터.
 * ⚠️ 파서는 이 숫자에 기대지 않고 **열 머리 줄을 찾는다**(사람이 위에 줄을 더 끼워 넣어도 살게).
 *    빌더만 이 상수를 쓴다.
 */
export const SCORE_TITLE_ROW = 1;
export const SCORE_HEADER_ROW = 3;
/** 열 머리를 찾을 때 훑는 범위 — 이 안에 없으면 서식 불일치로 본다. */
export const SCORE_HEADER_LOOKAHEAD = 10;

/** 안내 시트의 축 항목 이름(1열) — 내려받기·올리기가 같은 글자를 쓴다. */
export const AXIS_LABEL = {
  year: "년도",
  term: "학기",
  subject: "과목",
  track: "트랙",
  slot: "시험",
  maxScore: "만점",
  date: "시험일",
} as const;
export type AxisField = keyof typeof AXIS_LABEL;

/** 안내 시트가 말하는 축 한 벌. `classId`는 여기 없다 — 반은 학생마다 서버가 정한다(파일이 정하지 않는다). */
export type GradeSheetAxis = {
  year: number;
  term: Term;
  subject: string;
  /** 영어일 때만. 반을 고르는 필터일 뿐 성적 행에는 안 들어간다(subject-axis.ts). */
  track: EnglishTrack | null;
  slot: ExamSlotKey;
  maxScore: number;
  date: string;
};

export type Parsed<T> = { ok: true; row: T } | { ok: false; error: string };

/** 1행(헤더) 텍스트 → 키별 열 번호(0-based). 라벨 또는 키 이름 둘 다 받는다. */
export function mapHeaders<K extends string>(
  headers: ReadonlyArray<string>,
  columns: ReadonlyArray<{ key: K; header: string }>,
): Map<K, number> {
  const out = new Map<K, number>();
  headers.forEach((raw, idx) => {
    const h = String(raw ?? "").trim().replace(/\s+/g, "");
    if (!h) return;
    const col = columns.find((c) => c.header.replace(/\s+/g, "") === h || c.key === h);
    if (col && !out.has(col.key)) out.set(col.key, idx);
  });
  return out;
}

export function isBlankCells(cells: Record<string, string | undefined>): boolean {
  return Object.values(cells).every((v) => !String(v ?? "").trim());
}

/**
 * 같은 학생이 **서로 다른 점수**로 두 번 적혀 있으면 어느 행이 맞는지 알 수 없다 — 오류로 세운다.
 *
 * ⚠️ 키는 시트의 칸이 아니라 **매칭된 학생**(`matchRosterRow`가 돌려준 `studentId`)이다 — 이름 칸만 보면
 *    다른 반의 동명이인이 한 사람으로 뭉친다.
 * 🔴 "이름이 두 번 나오면 오류"가 아니다 — 한 학생이 두 반을 들으면(실측: 수학 학생 196명이 수강 348건)
 *    '반 전체' 시트에 그 학생이 **정상적으로 두 줄** 선다. 그걸 오류로 세우면 과목 전체 시트가 통째로
 *    못 쓰게 된다. 성적은 학생·과목·학기당 한 벌이라 값이 같으면(또는 한쪽이 빈 칸이면) 다툼이 없다.
 */
export type MatchedScore = { rowNum: number; studentId: string; score: number | undefined };

export function scoreConflictErrors(rows: ReadonlyArray<MatchedScore>): string[] {
  const byStudent = new Map<string, { rowNum: number; score: number }[]>();
  for (const r of rows) {
    if (r.score === undefined) continue; // 빈 칸은 아무것도 주장하지 않는다
    const arr = byStudent.get(r.studentId) ?? [];
    arr.push({ rowNum: r.rowNum, score: r.score });
    byStudent.set(r.studentId, arr);
  }
  const out: string[] = [];
  for (const hits of byStudent.values()) {
    const distinct = [...new Set(hits.map((h) => h.score))];
    if (distinct.length > 1) {
      out.push(
        `${hits[hits.length - 1]!.rowNum}행: 같은 학생에게 다른 점수가 적혀 있습니다(` +
          `${hits.map((h) => `${h.rowNum}행 ${h.score}점`).join(" · ")}) — 한 학기 한 시험의 성적은 하나입니다`,
      );
    }
  }
  return out;
}

const DATE_RE = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/;

/** `YYYY-MM-DD`/`YYYY.MM.DD`/`YYYYMMDD` → ISO. 모르는 모양이면 null. */
export function normalizeSheetDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * 안내 시트의 `항목 / 값` 줄들 → 축. 모르는 줄(안내 문구 등)은 그냥 무시한다.
 * 🔴 **모르는 값은 폴백하지 않는다** — `normalizeExamSlot`처럼 첫 칸으로 조용히 떨어뜨리면 듣기평가 시트가
 *    중간고사 칸에 들어간다. 축을 못 읽으면 통째로 거절하는 게 맞다(어디에 쓸지 모르는 상태).
 */
export function parseAxisSheetRows(
  rows: ReadonlyArray<{ label: string; value: string }>,
): Parsed<GradeSheetAxis> {
  const bad = (msg: string) => ({ ok: false as const, error: `${AXIS_SHEET_NAME} 시트: ${msg}` });
  const norm = (s: string) => String(s ?? "").trim().replace(/\s+/g, "");
  const pick = (field: AxisField): string => {
    const want = norm(AXIS_LABEL[field]);
    const hit = rows.find((r) => norm(r.label) === want || norm(r.label) === field);
    return String(hit?.value ?? "").trim();
  };

  const yearRaw = pick("year");
  const year = Number(yearRaw.replace(/[^\d]/g, ""));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return bad(`'${AXIS_LABEL.year}'을(를) 읽지 못했습니다 — 2000~2100 사이 숫자여야 합니다`);
  }

  const termNum = Number(pick("term").replace(/[^\d]/g, ""));
  if (!isTerm(termNum)) return bad(`'${AXIS_LABEL.term}'은(는) 1 또는 2여야 합니다`);
  const term: Term = termNum;

  const subject = pick("subject");
  if (!/^[a-z0-9_]{1,24}$/.test(subject)) {
    return bad(`'${AXIS_LABEL.subject}'을(를) 읽지 못했습니다 — 내려받은 서식의 값을 그대로 두세요`);
  }

  const trackRaw = norm(pick("track"));
  // 트랙은 영어에서만 뜻이 있다(다른 과목 반은 값이 없다). 모르는 글자는 비운 것으로 본다 —
  // 트랙은 **반을 고르는 필터**라 성적 행에 안 들어가고, 여기서 틀려도 엉뚱한 칸에 쓰이지 않는다.
  const track: EnglishTrack | null =
    subject !== ENGLISH_SUBJECT_KEY ? null : trackRaw === "eie" ? "eie" : trackRaw === "injaewon" ? "injaewon" : null;

  const slotRaw = norm(pick("slot"));
  const slots = examSlotsFor(subject);
  if (!isExamSlot(slotRaw) || !slots.includes(slotRaw)) {
    return bad(`'${AXIS_LABEL.slot}'을(를) 읽지 못했습니다 — 내려받은 서식의 값을 그대로 두세요`);
  }
  const slot: ExamSlotKey = slotRaw;

  const maxScore = Number(pick("maxScore"));
  // 상한은 화면(주소 해석)과 **같은 상수** — 갈리면 시트로만 들어온 큰 만점이 화면에선 100으로 보이고,
  // 그 화면을 저장하는 순간 멀쩡한 점수가 통째로 다시 쓰인다.
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > GRADE_MAX_SCORE_LIMIT) {
    return bad(`'${AXIS_LABEL.maxScore}'은(는) 0보다 크고 ${GRADE_MAX_SCORE_LIMIT} 이하인 숫자여야 합니다`);
  }

  const date = normalizeSheetDate(pick("date"));
  if (!date) return bad(`'${AXIS_LABEL.date}'이(가) 날짜가 아닙니다 (YYYY-MM-DD)`);
  // 🔴 시험일은 그 학기 안이어야 한다 — 밖이면 화면(학기 안으로 누른 날)과 값이 달라져, 저장된 칸이
  //    화면에선 늘 '바뀐 칸'으로 보이고 다음 저장 때 날짜가 조용히 덮어써진다.
  const win = termWindow(year, term);
  if (date < win.start || date > win.end) {
    return bad(`'${AXIS_LABEL.date}'이(가) ${year}년 ${TERM_LABEL[term]} 밖입니다 (${win.start}~${win.end})`);
  }

  return { ok: true, row: { year, term, subject, track, slot, maxScore, date } };
}

/**
 * 안내 시트에 적을 축 줄들 — **빌더가 쓰는 값과 파서가 읽는 값이 이 함수 하나**에서 나온다(왕복 보장).
 * `값`은 키(기계가 읽는다), `설명`은 사람이 읽는 라벨 — 라벨을 파싱 근거로 쓰지 않는다.
 */
export function axisSheetRows(
  axis: GradeSheetAxis,
  labels: { subjectLabel: string; slotLabel: string; trackLabel: string },
): { label: string; value: string; note: string }[] {
  return [
    { label: AXIS_LABEL.year, value: String(axis.year), note: `${axis.year}년` },
    { label: AXIS_LABEL.term, value: String(axis.term), note: TERM_LABEL[axis.term] },
    { label: AXIS_LABEL.subject, value: axis.subject, note: labels.subjectLabel },
    { label: AXIS_LABEL.track, value: axis.track ?? "", note: labels.trackLabel },
    { label: AXIS_LABEL.slot, value: axis.slot, note: labels.slotLabel },
    { label: AXIS_LABEL.maxScore, value: String(axis.maxScore), note: "" },
    { label: AXIS_LABEL.date, value: axis.date, note: "" },
  ];
}

export type ScoreSheetRow = {
  rowNum: number;
  /** 매칭 키 넷. 빈 문자열 = 그 칸을 안 적었다(대조에서 뺀다). */
  name: string;
  school: string;
  grade: string;
  className: string;
  /**
   * 🔴 **빈 칸은 `undefined`**(= 이 칸은 건드리지 않는다) — `null`을 쓰지 않는다. 저장 경로에서 null은
   *    "지운다"는 뜻이라, 일부만 채운 시트가 나머지 성적을 지우게 된다. `0`은 유효한 점수다.
   */
  score: number | undefined;
};

/** 점수 시트 한 행. 만점은 안내 시트가 준다(행마다 다를 수 없다). */
export function parseScoreRow(
  cells: Partial<Record<ScoreSheetKey, string>>,
  rowNum: number,
  maxScore: number,
): Parsed<ScoreSheetRow> {
  const at = (msg: string) => ({ ok: false as const, error: `${rowNum}행: ${msg}` });
  const text = (k: ScoreSheetKey) => String(cells[k] ?? "").trim();
  const name = text("name");
  // 이름이 없으면 누구 성적인지 알 길이 없다(나머지 셋은 좁히는 값일 뿐이다).
  if (!name) return at("이름이 비어 있습니다(학생을 찾는 칸이라 필수입니다)");
  const ident = { name, school: text("school"), grade: text("grade"), className: text("className") };

  const raw = text("score");
  if (!raw) return { ok: true, row: { rowNum, ...ident, score: undefined } };
  const score = Number(raw);
  if (!Number.isFinite(score)) return at(`점수 "${raw}"이(가) 숫자가 아닙니다`);
  if (score < 0) return at(`점수 "${raw}"이(가) 0보다 작습니다`);
  if (score > maxScore) return at(`점수 ${raw}이(가) 만점 ${maxScore}을(를) 넘습니다`);
  // numeric(6,2) — 소수 셋째 자리부터는 DB가 조용히 반올림한다. 조용한 변형보다 되돌려 보내는 게 낫다.
  if (Math.round(score * 100) !== score * 100) return at(`점수 "${raw}"은(는) 소수점 둘째 자리까지만 적을 수 있습니다`);
  return { ok: true, row: { rowNum, ...ident, score } };
}

/** 대조용 정규화 — 공백을 접고 대소문자를 무시한다(`Kim Seoyeon` ↔ `kimseoyeon`). */
const normIdent = (v: string | null | undefined) => String(v ?? "").trim().replace(/\s+/g, "").toLowerCase();

/** 명단 한 줄 중 매칭에 필요한 것만 — `GradeSheetRow`가 이 모양을 만족한다(그대로 넘기면 된다). */
export type RosterCandidate = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  classId: string;
  className: string;
  score: number | null;
};

/**
 * 시트 한 행 → 그 학기 명단의 학생 하나.
 *
 * 🔴 **좁혔는데도 둘이면 오류**다 — 첫 번째를 조용히 고르면 남의 성적이 된다.
 * ⚠️ 학교·학년·반은 **양쪽이 다 적혀 있을 때만** 비교한다: 명단 쪽이 비어 있는 학생이 실제로 있고
 *    (화면에 `—`로 뜬다), 그때 "같아야 한다"로 걸면 내려받은 시트를 그대로 올려도 안 붙는다.
 */
export function matchRosterRow(
  row: ScoreSheetRow,
  roster: ReadonlyArray<RosterCandidate>,
): Parsed<RosterCandidate> {
  const at = (msg: string) => ({ ok: false as const, error: `${row.rowNum}행: ${msg}` });
  const where = [row.name, row.school, row.grade, row.className].filter(Boolean).join(" · ");

  const sameName = roster.filter((c) => normIdent(c.name) === normIdent(row.name));
  if (sameName.length === 0) {
    return at(`이 학기 명단에 없는 학생입니다(${where}) — 이름·학교·학년·반을 내려받은 서식 그대로 두세요`);
  }
  // 적혀 있는 칸만 순서대로 좁힌다(하나로 좁혀지면 더 볼 필요가 없다).
  let hits = sameName;
  for (const [sheetValue, pick] of [
    [row.className, (c: RosterCandidate) => c.className],
    [row.school, (c: RosterCandidate) => c.school],
    [row.grade, (c: RosterCandidate) => c.grade],
  ] as const) {
    if (hits.length === 1) break;
    if (!sheetValue) continue;
    const narrowed = hits.filter((c) => {
      const mine = normIdent(pick(c));
      return !mine || mine === normIdent(sheetValue);
    });
    if (narrowed.length > 0) hits = narrowed;
  }
  if (hits.length > 1) {
    return at(`같은 이름이 둘이라 어느 학생인지 알 수 없습니다(${where} — 학교·학년·반까지 같습니다)`);
  }
  return { ok: true, row: hits[0]! };
}

/**
 * '성적' 시트 맨 윗줄에 적는 한 줄 — **사람이 읽는 표시**다(파싱 근거 아님).
 * 라벨은 학원설정에서 오므로 호출부가 넘긴다(하드코딩 금지).
 */
export function scoreSheetTitle(
  axis: GradeSheetAxis,
  labels: { subjectLabel: string; slotLabel: string; trackLabel: string },
): string {
  const subject = labels.trackLabel ? `${labels.subjectLabel} (${labels.trackLabel})` : labels.subjectLabel;
  return [
    `${axis.year}년 ${TERM_LABEL[axis.term]}`,
    subject,
    labels.slotLabel,
    `만점 ${axis.maxScore}`,
    `시험일 ${axis.date}`,
  ].join(" · ");
}
