import { describe, it, expect } from "vitest";
import {
  fieldForHeader,
  normalizeStatus,
  normalizePhone,
  normalizeName,
  naturalKey,
  classifyRows,
  type ParsedRow,
} from "./student-import";

const row = (over: Partial<ParsedRow> & { name: string; rowNum: number }): ParsedRow => ({
  grade: null,
  school: null,
  status: "prospect",
  parentPhone: null,
  studentPhone: null,
  englishName: null,
  ...over,
});

describe("fieldForHeader", () => {
  it("export 헤더를 필드로 매핑(공백·괄호 무시)", () => {
    expect(fieldForHeader("이름")).toBe("name");
    expect(fieldForHeader(" 학년 ")).toBe("grade");
    expect(fieldForHeader("학교")).toBe("school");
    expect(fieldForHeader("상태")).toBe("status");
    expect(fieldForHeader("학부모 연락처")).toBe("parentPhone");
    expect(fieldForHeader("원생연락처")).toBe("studentPhone");
  });
  it("미인식 헤더는 null", () => {
    expect(fieldForHeader("수강 과목")).toBeNull();
    expect(fieldForHeader("등록일")).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("한글 라벨 → enum", () => {
    expect(normalizeStatus("재원")).toBe("enrolled");
    expect(normalizeStatus("휴원")).toBe("on_hold");
    expect(normalizeStatus("퇴원")).toBe("withdrawn");
    expect(normalizeStatus("상담완료")).toBe("consulted");
  });
  it("raw enum 통과, 빈값/미인식은 prospect", () => {
    expect(normalizeStatus("enrolled")).toBe("enrolled");
    expect(normalizeStatus("")).toBe("prospect");
    expect(normalizeStatus("아무거나")).toBe("prospect");
  });
});

describe("normalizePhone", () => {
  it("앞자리0 보정 + 하이픈", () => {
    expect(normalizePhone("1065317203")).toBe("010-6531-7203");
    expect(normalizePhone("010-1234-5678")).toBe("010-1234-5678");
    expect(normalizePhone("01012345678")).toBe("010-1234-5678");
  });
  it("빈값은 null", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("naturalKey / normalizeName", () => {
  it("이름 소문자+공백제거", () => {
    expect(normalizeName("김 민 재")).toBe("김민재");
    expect(normalizeName("Kim Minjae")).toBe("kimminjae");
  });
  it("키는 이름·학교·학년 결합", () => {
    expect(naturalKey("김민재", "한빛중", "중2")).toBe("김민재|한빛중|중2");
    expect(naturalKey("김 민재", "한빛중", "중2")).toBe(naturalKey("김민재", "한빛중", "중2"));
  });
});

describe("classifyRows", () => {
  it("기존 키와 일치하면 중복", () => {
    const existing = new Set([naturalKey("홍길동", "서울중", "중1")]);
    const { rows, summary } = classifyRows(
      [row({ rowNum: 2, name: "홍길동", school: "서울중", grade: "중1" })],
      existing,
    );
    expect(rows[0].kind).toBe("duplicate");
    expect(rows[0].reason).toBe("이미 등록된 학생");
    expect(summary.duplicate).toBe(1);
  });

  it("파일 내 중복은 두 번째부터 중복", () => {
    const { rows, summary } = classifyRows(
      [
        row({ rowNum: 2, name: "이서연", school: "달빛중", grade: "중3" }),
        row({ rowNum: 3, name: "이 서연", school: "달빛중", grade: "중3" }),
      ],
      new Set(),
    );
    expect(rows[0].kind).toBe("new");
    expect(rows[1].kind).toBe("duplicate");
    expect(rows[1].reason).toBe("파일 내 중복");
    expect(summary.new).toBe(1);
    expect(summary.duplicate).toBe(1);
  });

  it("이름 없으면 오류", () => {
    const { rows, summary } = classifyRows([row({ rowNum: 2, name: "  " })], new Set());
    expect(rows[0].kind).toBe("error");
    expect(summary.error).toBe(1);
  });

  it("신규는 등록 대상으로 집계", () => {
    const { summary } = classifyRows(
      [
        row({ rowNum: 2, name: "새학생1", school: "A중", grade: "중1" }),
        row({ rowNum: 3, name: "새학생2", school: "B중", grade: "중2" }),
      ],
      new Set(),
    );
    expect(summary.new).toBe(2);
    expect(summary.total).toBe(2);
  });
});
