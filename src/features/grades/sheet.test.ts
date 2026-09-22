import { describe, expect, it } from "vitest";
import {
  AXIS_LABEL,
  REQUIRED_SCORE_HEADERS,
  SCORE_SHEET_COLUMNS,
  axisSheetRows,
  isBlankCells,
  mapHeaders,
  normalizeSheetDate,
  parseAxisSheetRows,
  parseScoreRow,
  scoreConflictErrors,
  type GradeSheetAxis,
  type ScoreSheetKey,
} from "./sheet";

const AXIS: GradeSheetAxis = {
  year: 2026,
  term: 2,
  subject: "english",
  track: "eie",
  slot: "listening",
  maxScore: 100,
  date: "2026-09-22",
};

const rowsOf = (axis: GradeSheetAxis = AXIS) =>
  axisSheetRows(axis, { subjectLabel: "영어", slotLabel: "듣기평가", trackLabel: "EiE" });

describe("점수 칸 — 빈 칸과 0점은 다른 사실", () => {
  it("🔴 빈 칸은 undefined(건드리지 않음) · 0은 유효한 점수", () => {
    const blank = parseScoreRow({ studentId: "11111111-1111-4111-8111-111111111111", score: "" }, 5, 100);
    expect(blank.ok && blank.row.score).toBe(undefined);
    const zero = parseScoreRow({ studentId: "11111111-1111-4111-8111-111111111111", score: "0" }, 6, 100);
    expect(zero.ok && zero.row.score).toBe(0);
    // null로 접히면 저장 경로가 "지운다"로 읽어 일부만 채운 시트가 나머지를 지운다.
    expect(blank.ok && blank.row.score).not.toBeNull();
  });

  it("공백만 있는 칸도 빈 칸", () => {
    const r = parseScoreRow({ studentId: "11111111-1111-4111-8111-111111111111", score: "   " }, 7, 100);
    expect(r.ok && r.row.score).toBe(undefined);
  });
});

describe("점수 검증", () => {
  const sid = "22222222-2222-4222-8222-222222222222";

  it("만점을 넘으면 거절하고 행 번호를 앞에 적는다", () => {
    const r = parseScoreRow({ studentId: sid, score: "101" }, 12, 100);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("12행:");
    expect(!r.ok && r.error).toContain("만점 100");
  });

  it("만점이 80인 시트에선 85도 거절", () => {
    const r = parseScoreRow({ studentId: sid, score: "85" }, 3, 80);
    expect(r.ok).toBe(false);
  });

  it("숫자가 아니거나 음수면 거절", () => {
    expect(parseScoreRow({ studentId: sid, score: "결석" }, 3, 100).ok).toBe(false);
    expect(parseScoreRow({ studentId: sid, score: "-1" }, 3, 100).ok).toBe(false);
  });

  it("소수 둘째 자리까지는 받고 셋째 자리는 거절(DB가 조용히 반올림하지 않게)", () => {
    const ok = parseScoreRow({ studentId: sid, score: "88.25" }, 3, 100);
    expect(ok.ok && ok.row.score).toBe(88.25);
    expect(parseScoreRow({ studentId: sid, score: "88.255" }, 3, 100).ok).toBe(false);
  });

  it("학생ID가 비었거나 모양이 아니면 거절(이 열을 고친 파일)", () => {
    expect(parseScoreRow({ studentId: "", score: "90" }, 3, 100).ok).toBe(false);
    expect(parseScoreRow({ studentId: "김서연", score: "90" }, 3, 100).ok).toBe(false);
  });
});

describe("헤더 매핑", () => {
  it("라벨로도 키로도 찾는다 · 공백 무시", () => {
    const m = mapHeaders<ScoreSheetKey>(["학생 ID", "이름", "학교", "학년", "반", "점수"], SCORE_SHEET_COLUMNS);
    expect(m.get("studentId")).toBe(0);
    expect(m.get("score")).toBe(5);
    const byKey = mapHeaders<ScoreSheetKey>(["studentId", "score"], SCORE_SHEET_COLUMNS);
    expect(byKey.get("score")).toBe(1);
  });

  it("모르는 서식이면 필수 열이 비어 형식 불일치로 잡힌다", () => {
    const m = mapHeaders<ScoreSheetKey>(["번호", "성명", "총점"], SCORE_SHEET_COLUMNS);
    const missing = REQUIRED_SCORE_HEADERS.filter((k) => !m.has(k));
    expect(missing).toEqual(["studentId", "score"]);
  });

  it("빈 행 판정", () => {
    expect(isBlankCells({ studentId: "", score: "  " })).toBe(true);
    expect(isBlankCells({ studentId: "", score: "0" })).toBe(false);
  });
});

describe("안내 시트 축 — 왕복", () => {
  it("내보낸 값을 그대로 다시 읽는다", () => {
    const parsed = parseAxisSheetRows(rowsOf());
    expect(parsed.ok && parsed.row).toEqual(AXIS);
  });

  it("영어가 아니면 트랙은 비워서 왕복(다른 과목엔 트랙이 없다)", () => {
    const math: GradeSheetAxis = { ...AXIS, subject: "math", track: null, slot: "midterm" };
    const parsed = parseAxisSheetRows(axisSheetRows(math, { subjectLabel: "수학", slotLabel: "중간고사", trackLabel: "" }));
    expect(parsed.ok && parsed.row).toEqual(math);
  });

  it("안내 문구 줄이 섞여 있어도 축만 읽는다", () => {
    const withNoise = [
      { label: "· 점수만 채워서 올리세요", value: "" },
      ...rowsOf(),
      { label: "· 빈 칸은 그대로 둡니다", value: "" },
    ];
    const parsed = parseAxisSheetRows(withNoise);
    expect(parsed.ok && parsed.row.slot).toBe("listening");
  });

  it("🔴 그 과목에 없는 시험 칸은 폴백하지 않고 거절한다", () => {
    // 수학엔 듣기평가가 없다 — 조용히 중간고사로 떨어지면 엉뚱한 칸에 성적이 들어간다.
    const rows = rowsOf({ ...AXIS, subject: "math", track: null });
    const parsed = parseAxisSheetRows(rows);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toContain(AXIS_LABEL.slot);
  });

  it("축을 못 읽으면 통째로 거절 — 년도·학기·만점·시험일", () => {
    const patch = (label: string, value: string) => rowsOf().map((r) => (r.label === label ? { ...r, value } : r));
    expect(parseAxisSheetRows(patch(AXIS_LABEL.year, "")).ok).toBe(false);
    expect(parseAxisSheetRows(patch(AXIS_LABEL.term, "3")).ok).toBe(false);
    expect(parseAxisSheetRows(patch(AXIS_LABEL.maxScore, "0")).ok).toBe(false);
    expect(parseAxisSheetRows(patch(AXIS_LABEL.date, "언젠가")).ok).toBe(false);
  });

  it("사람이 '2026년'처럼 적어도 년도는 읽는다", () => {
    const rows = rowsOf().map((r) => (r.label === AXIS_LABEL.year ? { ...r, value: "2026년" } : r));
    const parsed = parseAxisSheetRows(rows);
    expect(parsed.ok && parsed.row.year).toBe(2026);
  });
});

describe("파일 안 중복 — 값이 다툴 때만 오류", () => {
  const sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("🔴 같은 학생이 두 반이라 두 줄인 것은 정상(값이 같으면 통과)", () => {
    const errs = scoreConflictErrors([
      { rowNum: 2, studentId: sid, score: 88 },
      { rowNum: 9, studentId: sid, score: 88 },
    ]);
    expect(errs).toEqual([]);
  });

  it("한쪽이 빈 칸이어도 다툼이 아니다", () => {
    const errs = scoreConflictErrors([
      { rowNum: 2, studentId: sid, score: 88 },
      { rowNum: 9, studentId: sid, score: undefined },
    ]);
    expect(errs).toEqual([]);
  });

  it("다른 점수가 적혀 있으면 오류(어느 행이 맞는지 알 수 없다)", () => {
    const errs = scoreConflictErrors([
      { rowNum: 2, studentId: sid, score: 88 },
      { rowNum: 9, studentId: sid, score: 91 },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("2행 88점");
    expect(errs[0]).toContain("9행 91점");
  });

  it("다른 학생끼리는 같은 점수여도 무관", () => {
    const errs = scoreConflictErrors([
      { rowNum: 2, studentId: sid, score: 88 },
      { rowNum: 3, studentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", score: 88 },
    ]);
    expect(errs).toEqual([]);
  });
});

describe("날짜 정규화", () => {
  it("여러 모양을 ISO로, 모르는 값은 null", () => {
    expect(normalizeSheetDate("2026-09-22")).toBe("2026-09-22");
    expect(normalizeSheetDate("2026.9.2")).toBe("2026-09-02");
    expect(normalizeSheetDate("20260922")).toBe("2026-09-22");
    expect(normalizeSheetDate("")).toBeNull();
    expect(normalizeSheetDate("2026-13-40")).toBeNull();
  });
});
