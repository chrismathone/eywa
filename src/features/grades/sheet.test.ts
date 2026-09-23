import { describe, expect, it } from "vitest";
import {
  AXIS_LABEL,
  REQUIRED_SCORE_HEADERS,
  SCORE_HEADER_LOOKAHEAD,
  SCORE_SHEET_COLUMNS,
  axisSheetRows,
  isBlankCells,
  mapHeaders,
  matchRosterRow,
  normalizeSheetDate,
  parseAxisSheetRows,
  parseScoreRow,
  scoreConflictErrors,
  scoreSheetTitle,
  type GradeSheetAxis,
  type RosterCandidate,
  type ScoreSheetKey,
  type ScoreSheetRow,
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

/** 시트 한 행(파싱 결과) 만들기 — 점수 외 칸은 기본으로 비워 둔다. */
const row = (p: Partial<ScoreSheetRow> & { rowNum: number; name: string }): ScoreSheetRow => ({
  school: "",
  grade: "",
  className: "",
  score: undefined,
  ...p,
});

const cand = (p: Partial<RosterCandidate> & { studentId: string; name: string }): RosterCandidate => ({
  school: null,
  grade: null,
  classId: `c-${p.studentId}`,
  className: "고등E_고2 심화",
  score: null,
  ...p,
});

describe("점수 칸 — 빈 칸과 0점은 다른 사실", () => {
  it("🔴 빈 칸은 undefined(건드리지 않음) · 0은 유효한 점수", () => {
    const blank = parseScoreRow({ name: "김서연", score: "" }, 5, 100);
    expect(blank.ok && blank.row.score).toBe(undefined);
    const zero = parseScoreRow({ name: "김서연", score: "0" }, 6, 100);
    expect(zero.ok && zero.row.score).toBe(0);
    // null로 접히면 저장 경로가 "지운다"로 읽어 일부만 채운 시트가 나머지를 지운다.
    expect(blank.ok && blank.row.score).not.toBeNull();
  });

  it("공백만 있는 칸도 빈 칸", () => {
    const r = parseScoreRow({ name: "김서연", score: "   " }, 7, 100);
    expect(r.ok && r.row.score).toBe(undefined);
  });

  it("매칭 키 넷을 그대로 실어 준다(대조는 matchRosterRow가 한다)", () => {
    const r = parseScoreRow(
      { name: " 박준우A ", school: "계성고", grade: "고1", className: "고등E_고1 특별 S", score: "88" },
      4,
      100,
    );
    expect(r.ok && r.row).toEqual({
      rowNum: 4,
      name: "박준우A",
      school: "계성고",
      grade: "고1",
      className: "고등E_고1 특별 S",
      score: 88,
    });
  });
});

describe("점수 검증", () => {
  it("만점을 넘으면 거절하고 행 번호를 앞에 적는다", () => {
    const r = parseScoreRow({ name: "김서연", score: "101" }, 12, 100);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("12행:");
    expect(!r.ok && r.error).toContain("만점 100");
  });

  it("만점이 80인 시트에선 85도 거절", () => {
    expect(parseScoreRow({ name: "김서연", score: "85" }, 3, 80).ok).toBe(false);
  });

  it("숫자가 아니거나 음수면 거절", () => {
    expect(parseScoreRow({ name: "김서연", score: "결석" }, 3, 100).ok).toBe(false);
    expect(parseScoreRow({ name: "김서연", score: "-1" }, 3, 100).ok).toBe(false);
  });

  it("소수 둘째 자리까지는 받고 셋째 자리는 거절(DB가 조용히 반올림하지 않게)", () => {
    const ok = parseScoreRow({ name: "김서연", score: "88.25" }, 3, 100);
    expect(ok.ok && ok.row.score).toBe(88.25);
    expect(parseScoreRow({ name: "김서연", score: "88.255" }, 3, 100).ok).toBe(false);
  });

  it("🔴 이름이 비면 거절 — 누구 성적인지 알 길이 없다", () => {
    const r = parseScoreRow({ name: "  ", score: "90" }, 3, 100);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("이름");
  });
});

describe("명단 대조 — 이름·학교·학년·반", () => {
  const roster = [
    cand({ studentId: "s1", name: "김지훈", school: "칠성고", grade: "고2", className: "고등E_고2 심화" }),
    cand({ studentId: "s2", name: "채민수", school: "칠성고", grade: "고2", className: "고등E_고2 심화" }),
    // 학교가 비어 있는 학생 — 화면에 `—`로 뜬다(실제로 있다).
    cand({ studentId: "s3", name: "김현준B", school: null, grade: "고2", className: "고등E_고2 심화" }),
  ];

  it("학생ID 없이 이름으로 찾는다", () => {
    const m = matchRosterRow(
      row({ rowNum: 4, name: "김지훈", school: "칠성고", grade: "고2", className: "고등E_고2 심화", score: 88 }),
      roster,
    );
    expect(m.ok && m.row.studentId).toBe("s1");
  });

  it("공백·대소문자는 접어서 본다", () => {
    const m = matchRosterRow(row({ rowNum: 4, name: " 김 지훈 ", className: "고등E_고2심화" }), roster);
    expect(m.ok && m.row.studentId).toBe("s1");
  });

  it("⚠️ 명단 쪽 칸이 비어 있으면 그 칸은 대조에서 뺀다(내려받은 시트가 그대로 붙게)", () => {
    const m = matchRosterRow(row({ rowNum: 5, name: "김현준B", school: "칠성고", grade: "고2" }), roster);
    expect(m.ok && m.row.studentId).toBe("s3");
  });

  it("명단에 없으면 오류 — 파일로 남의 성적을 밀어 넣지 못한다", () => {
    const m = matchRosterRow(row({ rowNum: 9, name: "없는학생", score: 90 }), roster);
    expect(m.ok).toBe(false);
    expect(!m.ok && m.error).toContain("9행:");
    expect(!m.ok && m.error).toContain("명단에 없는");
  });

  it("🔴 학교·학년·반까지 같은 동명이인은 오류 — 첫 번째를 조용히 고르지 않는다", () => {
    const twins = [
      cand({ studentId: "t1", name: "김지훈", school: "칠성고", grade: "고2", className: "고등E_고2 심화" }),
      cand({ studentId: "t2", name: "김지훈", school: "칠성고", grade: "고2", className: "고등E_고2 심화" }),
    ];
    const m = matchRosterRow(
      row({ rowNum: 7, name: "김지훈", school: "칠성고", grade: "고2", className: "고등E_고2 심화", score: 70 }),
      twins,
    );
    expect(m.ok).toBe(false);
    expect(!m.ok && m.error).toContain("어느 학생인지 알 수 없습니다");
  });

  it("같은 이름이라도 반이 다르면 반으로 갈린다(한 학생이 두 반인 경우도 각 반 줄에 붙는다)", () => {
    const two = [
      cand({ studentId: "s9", name: "이참결", className: "고등E_고2 심화" }),
      cand({ studentId: "s9", name: "이참결", className: "고등E_고2 정규 A", classId: "c-regular" }),
    ];
    const a = matchRosterRow(row({ rowNum: 4, name: "이참결", className: "고등E_고2 심화", score: 91 }), two);
    const b = matchRosterRow(row({ rowNum: 5, name: "이참결", className: "고등E_고2 정규 A", score: 91 }), two);
    expect(a.ok && a.row.classId).toBe("c-s9");
    expect(b.ok && b.row.classId).toBe("c-regular");
  });

  it("이름 뒤 구분자(A·B)는 다른 사람이다", () => {
    const m = matchRosterRow(row({ rowNum: 4, name: "김현준", className: "고등E_고2 심화" }), roster);
    expect(m.ok).toBe(false); // '김현준B'와 다른 이름
  });
});

describe("헤더 매핑 · 제목 줄", () => {
  it("라벨로도 키로도 찾는다 · 공백 무시", () => {
    const m = mapHeaders<ScoreSheetKey>(["이름", "학교", "학 년", "반", "점수"], SCORE_SHEET_COLUMNS);
    expect(m.get("name")).toBe(0);
    expect(m.get("grade")).toBe(2);
    expect(m.get("score")).toBe(4);
    const byKey = mapHeaders<ScoreSheetKey>(["name", "score"], SCORE_SHEET_COLUMNS);
    expect(byKey.get("score")).toBe(1);
  });

  it("🔴 제목 줄·빈 줄이 위에 있어도 열 머리 줄을 찾는다(고정 1행으로 읽으면 통째로 깨진다)", () => {
    // 빌더가 내는 모양 그대로: 1행 제목 · 2행 빈 줄 · 3행 열 머리.
    const grid = [
      [scoreSheetTitle(AXIS, { subjectLabel: "영어", slotLabel: "듣기평가", trackLabel: "EiE" })],
      [],
      SCORE_SHEET_COLUMNS.map((c) => c.header),
    ];
    let headerRow = 0;
    for (let r = 0; r < Math.min(SCORE_HEADER_LOOKAHEAD, grid.length); r++) {
      const m = mapHeaders<ScoreSheetKey>(grid[r] ?? [], SCORE_SHEET_COLUMNS);
      if (REQUIRED_SCORE_HEADERS.every((k) => m.has(k))) {
        headerRow = r + 1;
        break;
      }
    }
    expect(headerRow).toBe(3);
    // 제목 줄만으로는 열 머리로 오인되지 않는다.
    expect(mapHeaders<ScoreSheetKey>(grid[0] ?? [], SCORE_SHEET_COLUMNS).size).toBe(0);
  });

  it("제목 줄에는 학기·시험·만점·시험일이 사람 말로 적힌다", () => {
    const t = scoreSheetTitle(AXIS, { subjectLabel: "영어", slotLabel: "듣기평가", trackLabel: "EiE" });
    expect(t).toBe("2026년 2학기 · 영어 (EiE) · 듣기평가 · 만점 100 · 시험일 2026-09-22");
    // 트랙이 없는 과목은 괄호를 안 붙인다.
    expect(
      scoreSheetTitle({ ...AXIS, subject: "math", track: null, slot: "school" }, {
        subjectLabel: "수학",
        slotLabel: "내신",
        trackLabel: "",
      }),
    ).toContain("수학 · 내신");
  });

  it("모르는 서식이면 필수 열이 비어 형식 불일치로 잡힌다", () => {
    const m = mapHeaders<ScoreSheetKey>(["번호", "성명", "총점"], SCORE_SHEET_COLUMNS);
    const missing = REQUIRED_SCORE_HEADERS.filter((k) => !m.has(k));
    expect(missing).toEqual(["name", "score"]);
  });

  it("빈 행 판정", () => {
    expect(isBlankCells({ name: "", score: "  " })).toBe(true);
    expect(isBlankCells({ name: "", score: "0" })).toBe(false);
  });
});

describe("안내 시트 축 — 왕복", () => {
  it("내보낸 값을 그대로 다시 읽는다", () => {
    const parsed = parseAxisSheetRows(rowsOf());
    expect(parsed.ok && parsed.row).toEqual(AXIS);
  });

  it("영어가 아니면 트랙은 비워서 왕복(다른 과목엔 트랙이 없다)", () => {
    const math: GradeSheetAxis = { ...AXIS, subject: "math", track: null, slot: "school" };
    const parsed = parseAxisSheetRows(axisSheetRows(math, { subjectLabel: "수학", slotLabel: "내신", trackLabel: "" }));
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
    const parsed = parseAxisSheetRows(rowsOf({ ...AXIS, subject: "math", track: null }));
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
  it("🔴 같은 학생이 두 반이라 두 줄인 것은 정상(값이 같으면 통과)", () => {
    expect(
      scoreConflictErrors([
        { rowNum: 2, studentId: "s1", score: 88 },
        { rowNum: 9, studentId: "s1", score: 88 },
      ]),
    ).toEqual([]);
  });

  it("한쪽이 빈 칸이어도 다툼이 아니다", () => {
    expect(
      scoreConflictErrors([
        { rowNum: 2, studentId: "s1", score: 88 },
        { rowNum: 9, studentId: "s1", score: undefined },
      ]),
    ).toEqual([]);
  });

  it("다른 점수가 적혀 있으면 오류(어느 행이 맞는지 알 수 없다)", () => {
    const errs = scoreConflictErrors([
      { rowNum: 2, studentId: "s1", score: 88 },
      { rowNum: 9, studentId: "s1", score: 91 },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("2행 88점");
    expect(errs[0]).toContain("9행 91점");
  });

  it("다른 학생끼리는 같은 점수여도 무관(동명이인도 매칭 뒤엔 다른 id다)", () => {
    expect(
      scoreConflictErrors([
        { rowNum: 2, studentId: "s1", score: 88 },
        { rowNum: 3, studentId: "s2", score: 88 },
      ]),
    ).toEqual([]);
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
