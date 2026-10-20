import { describe, expect, it } from "vitest";
import {
  PROGRAMS,
  parseProgram,
  programLabel,
  programOf,
  programSubjectsOf,
  subjectGroupOf,
} from "./program";

const SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "subject_1", label: "수학(심화)" },
  { key: "subject_2", label: "초등 수학" },
  { key: "subject_3", label: "영어 문법" },
  { key: "science", label: "과학" },
];

describe("programOf — 재원생 프로그램 단일 규칙", () => {
  it("영어 반: english_track이 eie면 EiE, 그 밖(injaewon·미분류·깨진 값)은 인재원 영어", () => {
    expect(programOf({ subject: "english", englishTrack: "eie" }, SUBJECTS)).toBe("eie");
    expect(programOf({ subject: "english", english_track: "eie" }, SUBJECTS)).toBe("eie");
    expect(programOf({ subject: "english", englishTrack: "injaewon" }, SUBJECTS)).toBe("injaewon");
    // 🔴 비대칭 — 미분류가 두 프로그램 모두에서 사라지지 않게 인재원 쪽으로 센다.
    expect(programOf({ subject: "english", englishTrack: null }, SUBJECTS)).toBe("injaewon");
    expect(programOf({ subject: "english" }, SUBJECTS)).toBe("injaewon");
    expect(programOf({ subject: "english", englishTrack: "weird" }, SUBJECTS)).toBe("injaewon");
  });

  it("수학 묶음 = math 키 + 학원설정 라벨에 '수학'이 **들어간** 과목(앞이 아니어도)", () => {
    expect(programOf({ subject: "math" }, SUBJECTS)).toBe("math");
    expect(programOf({ subject: "subject_1" }, SUBJECTS)).toBe("math");
    expect(programOf({ subject: "subject_2" }, SUBJECTS)).toBe("math"); // '초등 수학'
    expect(programOf({ subject: "math" }, [])).toBe("math");
  });

  it("영어 묶음 = english 키 + 라벨에 '영어'가 들어간 과목 — 그 안에서만 english_track으로 가른다", () => {
    expect(programOf({ subject: "subject_3" }, SUBJECTS)).toBe("injaewon");
    expect(programOf({ subject: "subject_3", englishTrack: "eie" }, SUBJECTS)).toBe("eie");
  });

  it("라벨에 수학·영어가 함께 있으면 수학", () => {
    expect(programOf({ subject: "subject_9" }, [{ key: "subject_9", label: "영어수학 통합" }])).toBe("math");
  });

  it("🔴 설정에 없는 키는 묶지 않는다 — 레거시 폴백(highmath)도 설정이 진실", () => {
    expect(programOf({ subject: "highmath" }, SUBJECTS)).toBeNull();
    expect(programOf({ subject: "subject_1" }, [])).toBeNull();
  });

  it("그 외 과목·과목 미상은 어느 프로그램도 아니다", () => {
    expect(programOf({ subject: "science" }, SUBJECTS)).toBeNull();
    expect(programOf({ subject: null }, SUBJECTS)).toBeNull();
    expect(programOf({ subject: undefined }, SUBJECTS)).toBeNull();
    expect(programOf({ subject: "  " }, SUBJECTS)).toBeNull();
  });

  it("english_track은 영어 묶음에서만 본다 — 다른 과목 반에 eie가 붙어도 무시", () => {
    expect(programOf({ subject: "math", englishTrack: "eie" }, SUBJECTS)).toBe("math");
    expect(programOf({ subject: "science", englishTrack: "eie" }, SUBJECTS)).toBeNull();
  });
});

describe("subjectGroupOf — programOf와 같은 묶음", () => {
  it("EiE·인재원 영어는 한 묶음(english), 수학·수학(심화)은 한 묶음(math)", () => {
    expect(subjectGroupOf("english", SUBJECTS)).toBe("english");
    expect(subjectGroupOf("subject_3", SUBJECTS)).toBe("english");
    expect(subjectGroupOf("math", SUBJECTS)).toBe("math");
    expect(subjectGroupOf("subject_1", SUBJECTS)).toBe("math");
  });
  it("그 밖은 과목 키 그대로, 비면 null", () => {
    expect(subjectGroupOf("science", SUBJECTS)).toBe("science");
    expect(subjectGroupOf(null, SUBJECTS)).toBeNull();
    expect(subjectGroupOf(" ", SUBJECTS)).toBeNull();
  });
});

describe("parseProgram · programLabel", () => {
  it("URL 값은 세 프로그램만 받는다", () => {
    expect(PROGRAMS.map(parseProgram)).toEqual(["eie", "injaewon", "math"]);
    expect(parseProgram("english")).toBeNull();
    expect(parseProgram(undefined)).toBeNull();
    expect(parseProgram("")).toBeNull();
  });

  it("라벨 = EiE / 인재원 영어 / 학원설정 math 라벨(raw 코드 노출 금지)", () => {
    expect(programLabel("eie", SUBJECTS)).toBe("EiE");
    expect(programLabel("injaewon", SUBJECTS)).toBe("인재원 영어");
    expect(programLabel("math", [{ key: "math", label: "수학 전체" }])).toBe("수학 전체");
    expect(programLabel("math", [])).toBe("수학");
  });

  it("클라에 내려온 key→라벨 표를 목록으로", () => {
    expect(programSubjectsOf({ math: "수학", english: "영어" })).toEqual([
      { key: "math", label: "수학" },
      { key: "english", label: "영어" },
    ]);
  });
});
