import { describe, expect, it } from "vitest";
import {
  MP_ALL_COLUMNS,
  MP_BASE_COLUMNS,
  MP_COLUMN_LABEL,
  mpActiveDates,
  mpCellKey,
  mpCellMapOf,
  mpColumnsForDow,
  mpDayIsOff,
  mpDocTitle,
  mpHasBody,
  mpLevelFullName,
  mpOffOverrideOf,
  mpOffToggleValue,
  mpSessionLine,
  readMpOffOverride,
  type MpCell,
} from "./month-plan";

const cell = (planDate: string, colKind: MpCell["colKind"], body = ""): MpCell => ({
  planDate,
  colKind,
  body,
});

describe("열 구성 — 저장하지 않고 ebook 칸의 존재에서 파생한다", () => {
  // 실측(원본 시트 LE1 Sep 2026): 화요일만 4열(e-book 있음), 목·금은 3열.
  const dates = ["2026-09-01", "2026-09-03", "2026-09-04", "2026-09-08"];
  const cells = [cell("2026-09-01", "ebook", "Book Report"), cell("2026-09-03", "in_class", "SB 6-8")];

  it("그 요일에 ebook 칸이 있으면 4열", () => {
    expect(mpColumnsForDow("tue", dates, cells)).toEqual([...MP_ALL_COLUMNS]);
  });

  it("없으면 기본 3열", () => {
    expect(mpColumnsForDow("thu", dates, cells)).toEqual([...MP_BASE_COLUMNS]);
    expect(mpColumnsForDow("fri", dates, cells)).toEqual([...MP_BASE_COLUMNS]);
  });

  it("🔴 내용이 아니라 **행의 존재**로 판정한다(빈 칸이 열을 세운다)", () => {
    expect(mpColumnsForDow("tue", dates, [cell("2026-09-08", "ebook", "")])).toEqual([...MP_ALL_COLUMNS]);
  });

  it("⚠️ 다른 달의 칸은 이 달 열을 세우지 않는다(달 범위 밖은 무시)", () => {
    expect(mpColumnsForDow("tue", dates, [cell("2026-08-04", "ebook", "x")])).toEqual([...MP_BASE_COLUMNS]);
  });

  it("열 순서는 원본 시트 그대로(e-book이 Test 앞)", () => {
    expect(MP_ALL_COLUMNS.map((k) => MP_COLUMN_LABEL[k])).toEqual(["In-class", "Homework", "e-book", "Test"]);
  });
});

describe("칸 맵 — 공백만이면 '적은 내용 없음'", () => {
  const map = mpCellMapOf([cell("2026-09-01", "in_class", " SB 6-8 "), cell("2026-09-01", "test", "   ")]);

  it("키 표기는 저장 키와 같다", () => {
    expect(mpCellKey("2026-09-01", "in_class")).toBe("2026-09-01|in_class");
    expect(map["2026-09-01|in_class"]).toBe(" SB 6-8 ");
  });

  it("공백만 적힌 칸은 비어 있는 것으로 본다", () => {
    expect(mpHasBody(map, "2026-09-01", "in_class")).toBe(true);
    expect(mpHasBody(map, "2026-09-01", "test")).toBe(false);
    expect(mpHasBody(map, "2026-09-01", "homework")).toBe(false);
  });
});

describe("휴강 — 학원설정 휴일이 기본, 반별 명시 예외가 이긴다", () => {
  // 2026-09-25 = 추석(원장이 2026-09-01에 2027년까지 등록).
  const holidays = { "2026-09-25": "추석" };

  it("설정에 있는 날은 기본 휴강", () => {
    expect(mpDayIsOff("2026-09-25", holidays, "auto")).toBe(true);
    expect(mpDayIsOff("2026-09-24", holidays, "auto")).toBe(false);
  });

  it("🔴 법정공휴일이어도 강사가 켜면 수업한다(2026-08-17 대체공휴일에 출결 21행)", () => {
    expect(mpDayIsOff("2026-09-25", holidays, "open")).toBe(false);
  });

  it("설정에 없는 날도 강사가 끌 수 있다", () => {
    expect(mpDayIsOff("2026-09-24", holidays, "off")).toBe(true);
  });

  it("저장값이 깨지면 자동 판정으로 떨어진다", () => {
    expect(readMpOffOverride("nonsense")).toBe("auto");
    expect(readMpOffOverride(null)).toBe("auto");
    expect(readMpOffOverride(" open ")).toBe("open");
    expect(mpOffOverrideOf(mpCellMapOf([cell("2026-09-25", "off", "open")]), "2026-09-25")).toBe("open");
    expect(mpOffOverrideOf({}, "2026-09-25")).toBe("auto");
  });

  it("🔑 자동 판정과 같아지면 행을 지운다(설정을 고쳐도 그 반만 옛 판정에 묶이지 않게)", () => {
    expect(mpOffToggleValue("2026-09-25", holidays, true)).toBeNull(); // 이미 휴일 → 예외 불요
    expect(mpOffToggleValue("2026-09-25", holidays, false)).toBe("open");
    expect(mpOffToggleValue("2026-09-24", holidays, false)).toBeNull();
    expect(mpOffToggleValue("2026-09-24", holidays, true)).toBe("off");
  });
});

describe("mpActiveDates — 배정이 있고 휴강이 아닌 날", () => {
  it("수업이 없는 날과 휴강일을 함께 뺀다", () => {
    const dates = ["2026-09-01", "2026-09-02", "2026-09-25"];
    const hasClass = (d: string) => d !== "2026-09-02";
    const isOff = (d: string) => d === "2026-09-25";
    expect(mpActiveDates(dates, hasClass, isOff)).toEqual(["2026-09-01"]);
  });
});

describe("mpDocTitle — 문서 제목은 시트 표기(영문 월)", () => {
  it("약자를 풀네임으로 편 뒤 영문 월을 붙인다", () => {
    expect(mpDocTitle("LE1", "2026-09")).toBe("Let's Express 1 (September 2026)");
    expect(mpDocTitle("PL3", "2026-08")).toBe("Pre Let's 3 (August 2026)");
    expect(mpDocTitle("PL1a", "2026-01")).toBe("Pre Let's 1a (January 2026)");
    expect(mpDocTitle("LE1", "2026-12")).toBe("Let's Express 1 (December 2026)");
  });

  it("달 모양이 아니면 이름만 — 달을 지어내지 않는다", () => {
    expect(mpDocTitle("LE1", "")).toBe("Let's Express 1");
    expect(mpDocTitle("LE1", "2026-9")).toBe("Let's Express 1");
    expect(mpDocTitle("LE1", "2026-13")).toBe("Let's Express 1");
    expect(mpDocTitle("LE1", "2026-00")).toBe("Let's Express 1");
  });

  it("EiE 레벨 10종 — 청구 항목·원장 확인으로 채운 사전", () => {
    // 출처: 청구 `[EiE]` 태그(실데이터) + 원장 직접 확인(JP·PJ).
    expect(mpLevelFullName("RTT5")).toBe("Ready To Talk 5");
    expect(mpLevelFullName("MEC1-5")).toBe("Middle School English Course 1-5");
    expect(mpLevelFullName("KW3")).toBe("Kopi Wang 3");
    expect(mpLevelFullName("LS4a")).toBe("Let's Speak 4a");
    expect(mpLevelFullName("LT6")).toBe("Let's Talk 6");
    expect(mpLevelFullName("JP1")).toBe("Junior Plus 1");
    expect(mpLevelFullName("PJ2")).toBe("Pre Junior 2");
    expect(mpLevelFullName("DP6")).toBe("Dr.Phonics 6");
    // 숫자 없이 약자만이면 이름만.
    expect(mpLevelFullName("LE")).toBe("Let's Express");
  });

  it("🔴 사전에 없는 약자는 반 이름 그대로 — 지어내지 않는다", () => {
    // 원장 2026-09-01 *"풀네임 모르면 질문할것"* — 없는 이름을 만들어 학부모 문서에 내보내지 않는다.
    expect(mpLevelFullName("ZZ9")).toBe("ZZ9");
    expect(mpDocTitle("ZZ9", "2026-09")).toBe("ZZ9 (September 2026)");
    expect(mpLevelFullName("중등E_중1")).toBe("중등E_중1");
    expect(mpLevelFullName("")).toBe("");
  });
});

describe("mpSessionLine — 꼬리말 세션 줄(시트 표기 그대로)", () => {
  it("하트로 감싸고 **연도를 넣지 않는다**", () => {
    expect(mpSessionLine("2026-09", "9월 1일 ~ 9월 30일")).toBe("❤ 9월 세션 : 9월 1일 ~ 9월 30일 ❤");
  });

  it("기간을 못 구하면 빈 문자열 — 그 줄을 통째로 생략한다", () => {
    expect(mpSessionLine("2026-09", "")).toBe("");
    expect(mpSessionLine("2026-09", "   ")).toBe("");
  });

  it("달이 모양이 아니면 만들지 않는다", () => {
    expect(mpSessionLine("", "9월 1일 ~ 9월 30일")).toBe("");
    expect(mpSessionLine("2026-13", "9월 1일 ~ 9월 30일")).toBe("");
  });
});
