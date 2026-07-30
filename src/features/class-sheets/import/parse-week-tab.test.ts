import { describe, expect, it } from "vitest";
import {
  detectDayColumns,
  disambiguatePm,
  expandVerticalMerges,
  parseTimeCell,
  parseGoalPanelLabel,
  parseWeekTab,
  splitMarkCells,
  splitTeacherCell,
  to24h,
} from "./parse-week-tab";
import { isWeekTabTitle, parseWeekTabTitle } from "./week-title";

/**
 * 실측 시트(2026-07-30 인재원 영어 28문서)의 격자를 축약한 픽스처.
 * `offset`으로 요일 블록 시작 컬럼을 밀어 **컬럼 배치가 문서마다 다른 실제 상황**을 재현한다.
 */
function fixture(offset: number): string[][] {
  const W = 40 + offset;
  const row = () => Array.from({ length: W }, () => "");
  const rows: string[][] = [];
  const put = (ri: number, ci: number, v: string) => {
    while (rows.length <= ri) rows.push(row());
    rows[ri]![ci] = v;
  };
  const mon = offset; // 월 요일열
  const wed = offset + 16;
  // 헤더행
  for (const [c, d] of [
    [mon, "월"],
    [wed, "수"],
  ] as [number, string][]) {
    put(0, c, d);
    put(0, c + 1, "시기");
    put(0, c + 2, "구분");
    put(0, c + 3, "교재 / 내신교과서");
    put(0, c + 4, "페이지");
    put(0, c + 5, "진도");
    put(0, c + 6, "과제");
  }
  // 1교시 블록 — 계획(평시 2줄 + 내신 1줄)
  put(1, mon - 1, "1교시");
  put(1, mon, "Elsa\n(담임)\n\n303호");
  put(1, mon + 1, "평시");
  put(1, mon + 2, "Vocab");
  put(1, mon + 3, "능률 VOCA 중등 고난도");
  put(1, mon + 4, "11-13");
  put(1, mon + 5, "외우고 시험");
  put(1, mon + 6, "12-14");
  put(2, mon + 1, "평시");
  put(2, mon + 2, "Grammar");
  put(2, mon + 3, "그래머인사이드LV3");
  put(3, mon + 1, "내신");
  put(3, mon + 2, "Reading");
  put(3, mon + 3, "월말평가");
  // 영역만 고른 빈 줄(placeholder) — 버려야 한다
  put(4, mon + 1, "평시");
  put(4, mon + 2, "Speaking");
  // 로스터
  put(5, mon - 1, "02:20\n~\n03:00");
  put(5, mon, "류지훈(Jay)");
  put(5, mon + 1, "TRUE");
  put(5, mon + 2, "침산초6");
  put(5, mon + 3, "완");
  put(6, mon, "홍채민(Elena)");
  put(6, mon + 1, "FALSE");
  put(6, mon + 2, "달산초6");
  put(6, mon + 4, "STARTING 1 (레벨1_중1)");
  // 수요일 2교시(다른 시각)
  put(1, wed - 1, "1교시");
  put(1, wed, "Hannah\n(부담임)\n\n605호");
  put(1, wed + 1, "평시");
  put(1, wed + 2, "Listening");
  put(1, wed + 5, "듣기 3회");
  put(5, wed - 1, "9:00\n~\n12:00");
  put(5, wed, "류지훈(Jay)");
  put(5, wed + 1, "TRUE");
  put(5, wed + 2, "침산초6");
  // 좌측 목표 패널
  put(1, 1, "담임\n월간계획");
  put(1, 2, "Vocab");
  put(1, 3, "능률 VOCA 중등 고난도");
  put(1, 4, " 20강");
  put(2, 2, "Reading");
  put(2, 3, "해커스 리딩스마트3");
  put(2, 4, "책 마무리");
  put(3, 1, "부담임\n주간계획");
  put(3, 2, "Writing");
  put(3, 3, "쓰작2 서술형");
  // 헤더 반복행(교재명/목표 진도) — 목표로 세면 안 된다
  put(4, 3, "교재명");
  put(4, 4, "목표 진도");
  return rows;
}

describe("detectDayColumns — 컬럼 하드코딩 금지의 근거", () => {
  it("🔴 요일 블록 시작 컬럼이 문서마다 달라도 찾아낸다(실측 배치 10종)", () => {
    for (const offset of [6, 7, 8]) {
      const cols = detectDayColumns(fixture(offset));
      expect(cols.mon).toBe(offset);
      expect(cols.wed).toBe(offset + 16);
    }
  });

  it("'시기'가 옆에 없는 요일 글자는 요일열이 아니다(본문에 '월'이 있어도 오인 금지)", () => {
    expect(detectDayColumns([["월", "메모"], ["화", ""]])).toEqual({});
  });
});

describe("parseWeekTab", () => {
  const p = parseWeekTab(fixture(7));

  it("계획행 — 의미 있는 줄만 담고 placeholder(영역만)는 버린다", () => {
    expect(p.planLines).toHaveLength(4);
    expect(p.planLines.some((l) => l.skillLabel === "Speaking")).toBe(false);
    const first = p.planLines[0]!;
    expect(first).toMatchObject({
      day: "mon",
      termMode: "regular",
      skillLabel: "Vocab",
      textbook: "능률 VOCA 중등 고난도",
      pageRange: "11-13",
      progress: "외우고 시험",
      homework: "12-14",
    });
  });

  it("시기 = 평시/내신 → regular/exam", () => {
    expect(p.planLines.find((l) => l.skillLabel === "Reading" && l.day === "mon")?.termMode).toBe("exam");
  });

  it("교시 블록 — 강사·강의실·시각을 함께 읽는다", () => {
    const mon = p.slots.find((s) => s.slotKey === "mon|1교시")!;
    expect(mon).toMatchObject({ teacherLabel: "Elsa (담임)", roomLabel: "303호", start24: "14:20", end24: "15:00" });
    const wed = p.slots.find((s) => s.slotKey === "wed|1교시")!;
    // 🔴 토요일 9:00 수업이 실재하므로 8~12시는 오후로 밀지 않는다
    expect(wed).toMatchObject({ teacherLabel: "Hannah (부담임)", roomLabel: "605호", start24: "09:00" });
  });

  it("로스터 — 학생명/학교/출석체크/상태/개인노트", () => {
    const mon = p.marks.filter((m) => m.day === "mon");
    expect(mon).toHaveLength(2);
    expect(mon[0]).toMatchObject({ studentLabel: "류지훈(Jay)", school: "침산초6", present: true, status: "완", note: null });
    expect(mon[1]).toMatchObject({ studentLabel: "홍채민(Elena)", present: false, status: null, note: "STARTING 1 (레벨1_중1)" });
  });

  it("목표 패널 — 담임/부담임 × 월간/주간, 헤더행은 제외", () => {
    expect(p.goals).toHaveLength(3);
    expect(p.goals[0]).toMatchObject({ role: "homeroom", scope: "month", skillLabel: "Vocab", targetProgress: "20강" });
    expect(p.goals[2]).toMatchObject({ role: "assistant", scope: "week", skillLabel: "Writing", targetProgress: null });
  });
});

describe("to24h — 12시간 표기 해석", () => {
  it("1~7시는 오후, 8~12시는 그대로", () => {
    expect(to24h(2, 20)).toBe("14:20");
    expect(to24h(7, 10)).toBe("19:10");
    expect(to24h(9, 0)).toBe("09:00");
    expect(to24h(12, 0)).toBe("12:00");
    expect(to24h(14, 20)).toBe("14:20");
  });
});

describe("disambiguatePm — 저녁 8~10시 교시를 오전으로 읽지 않는다", () => {
  it("🔴 앞 교시(19:20)보다 이른 08:20은 밤 20:20이다 — eywa에 20:20 슬롯이 있는데도 매칭 실패했던 원인", () => {
    expect(disambiguatePm("08:20", "19:20")).toBe("20:20");
    expect(disambiguatePm("09:10", "20:20")).toBe("21:10");
  });
  it("첫 교시(기준 없음)는 그대로 — 토요일 오전 9시 수업이 실재한다", () => {
    expect(disambiguatePm("09:00", null)).toBe("09:00");
  });
  it("이미 앞 교시보다 늦으면 손대지 않는다", () => {
    expect(disambiguatePm("12:00", "09:00")).toBe("12:00");
    expect(disambiguatePm("20:20", "19:20")).toBe("20:20");
  });
  it("12시는 옮기지 않는다(24시가 된다)", () => {
    expect(disambiguatePm("12:00", "19:20")).toBe("12:00");
  });
});

describe("expandVerticalMerges — 병합을 펼치지 않으면 이어지는 줄이 사라진다", () => {
  it("🔴 세로 병합 아래 행에 앵커 값을 채운다 — `시기`·`구분`이 병합이라 안 펼치면 2·3번째 계획 줄이 파싱조차 안 된다", () => {
    const rows = [
      ["평시", "Vocab", "능률 VOCA"],
      ["", "", "그래머인사이드"],
      ["", "", "수능딥독"],
    ];
    const merged = expandVerticalMerges(rows, [
      { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 },
      { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 },
    ]);
    expect(merged.map((r) => r[0])).toEqual(["평시", "평시", "평시"]);
    expect(merged.map((r) => r[1])).toEqual(["Vocab", "Vocab", "Vocab"]);
    // 원본은 건드리지 않는다
    expect(rows[1]![0]).toBe("");
  });

  it("🔴 가로 병합은 펼치지 않는다 — 헤더 요일 라벨이 옆칸을 덮으면 요일 컬럼 탐지가 무너진다", () => {
    const rows = [["월", "시기", "구분"]];
    const merged = expandVerticalMerges(rows, [
      { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 },
    ]);
    expect(merged[0]).toEqual(["월", "시기", "구분"]);
    expect(detectDayColumns(merged).mon).toBe(0);
  });

  it("이미 값이 있는 칸은 덮지 않는다(로스터 TRUE/FALSE 보호)", () => {
    const rows = [["평시"], ["TRUE"], [""]];
    const merged = expandVerticalMerges(rows, [
      { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 },
    ]);
    expect(merged.map((r) => r[0])).toEqual(["평시", "TRUE", "평시"]);
  });
});

describe("parseTimeCell — 쪼개진 시각 칸(실측)", () => {
  it("온전한 범위", () => {
    expect(parseTimeCell("02:20\n~\n03:00")).toEqual({ start: "14:20", end: "15:00" });
  });
  it("🔴 강사가 한 범위를 두 교시 칸에 나눠 써 시작만/종료만 남은 칸이 실재한다", () => {
    expect(parseTimeCell("04:00\n~")).toEqual({ start: "16:00", end: null });
    // `~`가 앞서면 그 숫자는 종료다 — 시작으로 읽으면 한 시간씩 밀린다
    expect(parseTimeCell("~\n05:00")).toEqual({ start: null, end: "17:00" });
  });
  it("시각이 없으면 null", () => {
    expect(parseTimeCell("1교시")).toBeNull();
    expect(parseTimeCell("")).toBeNull();
  });
});

describe("splitTeacherCell / splitMarkCells / parseGoalPanelLabel", () => {
  it("강사 셀에서 강의실을 분리", () => {
    expect(splitTeacherCell("Florence\n(Native)\n\n303호")).toEqual({ teacher: "Florence (Native)", room: "303호" });
    expect(splitTeacherCell("JJ")).toEqual({ teacher: "JJ", room: null });
    expect(splitTeacherCell("")).toEqual({ teacher: null, room: null });
  });

  it("상태 어휘와 자유 기록을 나눈다", () => {
    expect(splitMarkCells(["완", "", "", ""])).toEqual({ status: "완", note: null });
    expect(splitMarkCells(["", "p12-14", "숙제 밀림", ""])).toEqual({ status: null, note: "p12-14 숙제 밀림" });
    expect(splitMarkCells(["결석", "보강 예정", "", ""])).toEqual({ status: "결석", note: "보강 예정" });
  });

  it("패널 라벨", () => {
    expect(parseGoalPanelLabel("담임\n월간계획")).toEqual({ role: "homeroom", scope: "month" });
    expect(parseGoalPanelLabel("부담임\n주간계획")).toEqual({ role: "assistant", scope: "week" });
    expect(parseGoalPanelLabel("교재명")).toBeNull();
  });
});

describe("parseWeekTabTitle — 실측 제목 변형", () => {
  it("표준형", () => {
    expect(parseWeekTabTitle("7/27-31 출석부/수업계획서", 2026)).toMatchObject({ monday: "2026-07-27", ambiguous: false });
    expect(parseWeekTabTitle("8/3-7 출석부/수업계획서", 2026)).toMatchObject({ monday: "2026-08-03" });
    expect(parseWeekTabTitle("7/27-31출석부/수업계획서", 2026)).toMatchObject({ monday: "2026-07-27" });
    expect(parseWeekTabTitle("7/20-24 출석부/수업계획서의 사본", 2026)).toMatchObject({ monday: "2026-07-20" });
    expect(parseWeekTabTitle("7/27-7/31 출석부/수업계획서", 2026)).toMatchObject({ monday: "2026-07-27" });
  });

  it("🔴 시작이 일요일인 제목('7/26-31')은 끝 날짜로 역산해야 한 주 앞으로 안 밀린다", () => {
    const r = parseWeekTabTitle("7/26-31 출석부/수업계획서", 2026);
    expect(r).toMatchObject({ ok: true, monday: "2026-07-27", ambiguous: true });
  });

  it("연말에 걸친 주는 끝 연도를 +1", () => {
    expect(parseWeekTabTitle("12/28-1/1 출석부", 2026)).toMatchObject({ monday: "2026-12-28", endDate: "2027-01-01" });
  });

  it("날짜가 없거나 실존하지 않으면 실패", () => {
    expect(parseWeekTabTitle("데이터", 2026).ok).toBe(false);
    expect(parseWeekTabTitle("2/30-31 출석부", 2026).ok).toBe(false);
  });

  it("주차 탭 판정", () => {
    expect(isWeekTabTitle("7/27-31 출석부/수업계획서")).toBe(true);
    expect(isWeekTabTitle("데이터")).toBe(false);
    expect(isWeekTabTitle("실결제_25.08")).toBe(false);
  });
});
