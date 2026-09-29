import { describe, expect, it } from "vitest";
import { readSheetGrid } from "./rows";
import {
  colLetter,
  duplicateKeyIssues,
  issueText,
  mapHeaders,
  parseDate,
  parseInteger,
  parsePhone,
  parseTime,
  parseWeekday,
  parseYesNo,
  type ImportIssue,
  type SheetSpec,
} from "./spec";

describe("값 해석", () => {
  it("날짜 — 흔한 모양은 받고, 없는 날짜는 거절", () => {
    expect(parseDate("2026-09-01")).toBe("2026-09-01");
    expect(parseDate("2026.9.1")).toBe("2026-09-01");
    expect(parseDate("20260901")).toBe("2026-09-01");
    expect(parseDate("2026년 9월 1일")).toBe("2026-09-01");
    expect(parseDate("26-09-01")).toBe("2026-09-01");
    expect(parseDate("")).toBeNull();
    expect(parseDate("-")).toBeNull();
    expect(parseDate("2026-02-30")).toBeUndefined();
    expect(parseDate("다음주")).toBeUndefined();
  });
  it("시각 — 오후·엑셀 소수·930", () => {
    expect(parseTime("14:30")).toBe("14:30");
    expect(parseTime("9:00:00")).toBe("09:00");
    expect(parseTime("오후 2:30")).toBe("14:30");
    expect(parseTime("0.375")).toBe("09:00");
    expect(parseTime("25:00")).toBeUndefined();
  });
  it("전화 — 엑셀이 앞 0을 잃은 휴대폰도", () => {
    expect(parsePhone("01012345678")).toBe("010-1234-5678");
    expect(parsePhone("1012345678")).toBe("010-1234-5678");
    expect(parsePhone("02-123-4567")).toBe("02-123-4567");
    expect(parsePhone("053 123 4567")).toBe("053-123-4567");
    expect(parsePhone("123")).toBeUndefined();
  });
  it("정수·예/아니오·요일", () => {
    expect(parseInteger("1,200,000원")).toBe(1200000);
    expect(parseInteger("12.5")).toBeUndefined();
    expect(parseYesNo("예")).toBe(true);
    expect(parseYesNo("X")).toBe(false);
    expect(parseYesNo("글쎄")).toBeUndefined();
    expect(parseWeekday("수요일")).toBe(3);
    expect(parseWeekday("Mon")).toBe(1);
    expect(parseWeekday("월화")).toBeUndefined();
  });
  it("열 글자", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
  });
});

type K = "name" | "school" | "birth";
const SPEC: SheetSpec<K> = {
  name: "원생",
  columns: [
    { key: "name", header: "이름", required: true, aliases: ["성명"] },
    { key: "school", header: "학교" },
    { key: "birth", header: "생년월일" },
  ],
};

describe("시트 읽기 — 오류는 위치로", () => {
  it("제목 끝의 *·공백·별칭을 알아본다(열 순서 자유)", () => {
    const m = mapHeaders(["학 교", "성명*", "생년월일"], SPEC.columns);
    expect(m.get("name")).toBe(1);
    expect(m.get("school")).toBe(0);
  });
  it("필수 열이 없으면 몇 행 제목이 무엇이었는지까지 말한다", () => {
    const issues: ImportIssue[] = [];
    const r = readSheetGrid(SPEC, [["학교", "생일"], ["칠성중", "2012-01-01"]], issues);
    expect(r).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.row).toBe(1);
    expect(issues[0]!.message).toContain("'이름'");
    expect(issues[0]!.message).toContain("학교, 생일");
  });
  it("제목 줄 위에 안내 줄이 있어도 찾는다 · 칸 오류는 행·열 글자·제목·값으로", () => {
    const issues: ImportIssue[] = [];
    const r = readSheetGrid(SPEC, [["원생 명단(9월)"], [], ["이름", "학교", "생년월일"], ["김하늘", "칠성중", "2012-02-30"], ["", "", ""], ["", "대구중", ""]], issues)!;
    expect(r.headerRow).toBe(3);
    expect(r.rows.map((x) => x.rowNum)).toEqual([4, 6]);
    const [a, b] = r.rows;
    a!.date("birth");
    b!.text("name", { required: true });
    expect(issues).toEqual([
      { sheet: "원생", row: 4, col: "C", header: "생년월일", value: "2012-02-30", message: expect.stringContaining("날짜") },
      { sheet: "원생", row: 6, col: "A", header: "이름", value: null, message: expect.stringContaining("필수") },
    ]);
    expect(issueText(issues[0]!)).toMatch(/^'원생' 시트 4행 C열\(생년월일\) · 값 "2012-02-30" — /);
  });
  it("파일 안 중복 키는 둘째 행을 가리킨다", () => {
    const out = duplicateKeyIssues("원생", [{ rowNum: 2, k: "a" }, { rowNum: 5, k: "a" }], (r) => r.k, "원생");
    expect(out).toHaveLength(1);
    expect(out[0]!.row).toBe(5);
    expect(out[0]!.message).toContain("2행");
  });
});
