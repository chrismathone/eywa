import { describe, expect, it } from "vitest";
import {
  alreadyListed,
  campusOf,
  colLetter,
  entryCells,
  findMonthTab,
  isSelfStudyClassName,
  mathWithdrawalsOn,
  monthTabKey,
  monthTabTitle,
  monthTitleText,
  nextRowOf,
  sheetDate,
  sheetLayoutOf,
  templateTabFor,
  tenureMonths,
} from "./withdrawal-sheet-model";

// 실제 시트(퇴원생 관리 차트)의 두 모양 — 9월 탭은 제목이 A1·머리 '학생명'이 A(병합), 8월 탭은 B1·B.
const SEPT = [
  ["2026.09월 학습종료퇴원", "", "", "", "", "", "", "", "", "", "", ""],
  ["학생명", "", "학교/학년", "반명", "과목", "담당선생님", "재원캠퍼스", "등록일", "최종퇴원일", "재원기간(개월)", "퇴원사유(대분류)", "퇴원사유(상세메모)"],
  ["1", "김윤혜", "침산중1", "중등M 개별 BS2F", "수학", "이성우", "고등관", "21.06.15", "26.09.01", "62개월", "기타", "…"],
  ["2", "김나윤", "종로초5", "초5 BS2C", "수학", "유형숙", "고등관", "26.08.31", "26.9.30", "1개월", "", ""],
  ["3", "", "", "", "", "", "", "", "", "", "", ""],
  ["4", "", "", "", "", "", "", "", "", "", "", ""],
];
const AUG = [
  ["", "2026.08월 학습종료퇴원"],
  ["", "학생명", "학교/학년", "반명", "과목", "담당선생님", "재원캠퍼스", "등록일", "최종퇴원일", "재원기간(개월)", "퇴원사유(대분류)", "퇴원사유(상세메모)"],
  ["1", "최영훈", "침산중2", "중등M 중2 BS3O 화금", "수학", "김윤하", "본원", "26.03.10", "26.08.31", "5개월"],
];

describe("sheetLayoutOf — 머리줄을 글자로 찾는다", () => {
  it("9월 탭(머리 '학생명'이 병합돼 A에 있어도 이름은 B)", () => {
    const l = sheetLayoutOf(SEPT)!;
    expect([l.headerRow, l.nameCol, l.schoolCol, l.classCol, l.subjectCol, l.teacherCol, l.enrolledCol, l.withdrawnCol, l.periodCol, l.lastCol])
      .toEqual([1, 1, 2, 3, 4, 5, 7, 8, 9, 11]);
  });
  it("8월 탭도 같은 칸", () => {
    const l = sheetLayoutOf(AUG)!;
    expect([l.nameCol, l.withdrawnCol, l.periodCol]).toEqual([1, 8, 9]);
  });
  it("머리줄이 없으면 null(모양이 바뀐 탭엔 안 쓴다)", () => {
    expect(sheetLayoutOf([["아무것도"], ["없음"]])).toBeNull();
  });
});

describe("날짜·기간", () => {
  it("시트 날짜 표기", () => {
    expect(sheetDate("2026-09-30")).toBe("26.09.30");
    expect(sheetDate(null)).toBe("");
  });
  it("재원기간 = 달력 달 차이, 최소 1 — 시트의 사람 기록과 맞춘다", () => {
    expect(tenureMonths("2026-02-20", "2026-09-30")).toBe("7개월");
    expect(tenureMonths("2023-11-24", "2026-09-30")).toBe("34개월");
    expect(tenureMonths("2024-06-07", "2026-09-30")).toBe("27개월");
    expect(tenureMonths("2026-08-31", "2026-09-30")).toBe("1개월");
    expect(tenureMonths("2026-09-02", "2026-09-30")).toBe("1개월");
    expect(tenureMonths(null, "2026-09-30")).toBe("");
  });
});

describe("탭", () => {
  const tabs = [
    { title: "26.9 퇴원", gid: 1 },
    { title: "26.8 퇴원", gid: 2 },
    { title: "25.12 퇴원", gid: 3 },
    { title: "퇴원대시보드", gid: 4 },
  ];
  it("퇴원일 → 그 달 탭 이름", () => {
    expect(monthTabTitle("2026-09-30")).toBe("26.9 퇴원");
    expect(monthTabTitle("2026-10-02")).toBe("26.10 퇴원");
    expect(monthTitleText("2026-10-02")).toBe("2026.10월 학습종료퇴원");
  });
  it("띄어쓰기가 달라도 같은 달 탭", () => {
    expect(monthTabKey("26.9퇴원")).toBe(2609);
    expect(findMonthTab(tabs, "2026-09-01")?.gid).toBe(1);
    expect(findMonthTab(tabs, "2026-10-01")).toBeNull();
    expect(monthTabKey("퇴원대시보드")).toBeNull();
  });
  it("새 탭의 본보기 = 그 달보다 앞선 가장 최근 달(대시보드는 아니다)", () => {
    expect(templateTabFor(tabs, "2026-10-01")?.gid).toBe(1);
    expect(templateTabFor(tabs, "2026-01-05")?.gid).toBe(3);
  });
});

describe("줄 고르기·중복", () => {
  const l = sheetLayoutOf(SEPT)!;
  const e = {
    name: "윤형준", schoolGrade: "성광중3", className: "고등M 고1 BS4F 화금", subject: "수학",
    teacher: "이성우", enrolledAt: "2025-07-22", withdrawnAt: "2026-09-30",
  };
  it("번호만 매겨 둔 첫 빈 줄(번호는 그대로)", () => {
    expect(nextRowOf(SEPT, l)).toEqual({ row: 5, number: null });
    expect(nextRowOf(SEPT, l, new Set([5]))).toEqual({ row: 6, number: null });
  });
  it("빈 줄이 없으면 맨 아래 다음 줄 + 번호 이어 매김", () => {
    expect(nextRowOf(AUG, sheetLayoutOf(AUG)!)).toEqual({ row: 4, number: "2" });
  });
  it("같은 학생·같은 퇴원일(표기 달라도)은 이미 있음", () => {
    expect(alreadyListed(SEPT, l, { ...e, name: "김나윤", className: "초5 BS2C" })).toBe(true);
    expect(alreadyListed(SEPT, l, e)).toBe(false);
  });
  it("쓸 칸 — 사유는 안 건드리고, 캠퍼스는 알 때만", () => {
    expect(l.campusCol).toBe(6);
    expect([...entryCells(l, { ...e, campus: "고등관" }, null).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const cells = entryCells(l, e, null);
    expect([...cells.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 7, 8, 9]);
    expect(cells.get(7)).toBe("25.07.22");
    expect(cells.get(9)).toBe("14개월");
    expect(colLetter(0) + colLetter(9) + colLetter(26)).toBe("AJAA");
  });
});

describe("mathWithdrawalsOn — 수학을 그만둔 수강만", () => {
  const f = (id: string, endDate: string | null, isMath = true, isTransferred = false) => ({ id, endDate, isMath, isTransferred });
  it("그날 끝난 수학 수강(반이동 제외)", () => {
    expect(mathWithdrawalsOn([f("a", "2026-09-30"), f("b", "2026-09-30", true, true), f("c", "2026-09-30", false)], "2026-09-30").map((x) => x.id))
      .toEqual(["a"]);
  });
  it("다른 수학 반이 아직 열려 있으면(반 하나만 정리) 퇴원이 아니다", () => {
    expect(mathWithdrawalsOn([f("a", "2026-09-30"), f("b", null)], "2026-09-30")).toEqual([]);
    expect(mathWithdrawalsOn([f("a", "2026-09-30"), f("b", "2026-10-31")], "2026-09-30")).toEqual([]);
  });
  it("영어는 계속 다녀도 '수학만 퇴원'은 적는다", () => {
    expect(mathWithdrawalsOn([f("a", "2026-09-30"), f("e", null, false)], "2026-09-30").map((x) => x.id)).toEqual(["a"]);
  });
  it("고른 수강만", () => {
    expect(mathWithdrawalsOn([f("a", "2026-09-30"), f("b", "2026-09-30")], "2026-09-30", new Set(["b"])).map((x) => x.id)).toEqual(["b"]);
  });
  it("JJ(자습실) 반은 적지 않는다 — 수업 반 하나만(원장 2026-10-08)", () => {
    const jj = { ...f("jj", "2026-10-06"), isSelfStudy: true };
    expect(mathWithdrawalsOn([f("bs", "2026-10-06"), jj], "2026-10-06").map((x) => x.id)).toEqual(["bs"]);
    // JJ만 남아 계속 다니면 퇴원이 아니다(판정은 그대로).
    expect(mathWithdrawalsOn([f("bs", "2026-10-06"), { ...f("jj", null), isSelfStudy: true }], "2026-10-06")).toEqual([]);
  });
});

describe("isSelfStudyClassName — JJ(자습실) 반 이름", () => {
  it("JJ 토큰", () => {
    for (const n of ["초등M 개별 JJ1F", "중등M 개별 JJ2L", "중등M 중2 JJPS", "중등M 중2 JJ3E (~26.09.30)", "JJ1A"]) {
      expect(isSelfStudyClassName(n)).toBe(true);
    }
  });
  it("수업 반·다른 글자는 아니다", () => {
    for (const n of ["초등M 개별 BS2G", "중등M 개별 BS3Q", "중등M 중2 PS", "AJJ반", "jj", "", null]) {
      expect(isSelfStudyClassName(n)).toBe(false);
    }
  });
});

describe("campusOf — 강의실 → 재원캠퍼스(원장 2026-10-07)", () => {
  it("본원이면 본원, 고수면 고등관", () => {
    expect(campusOf(["본원201", "본원203"])).toBe("본원");
    expect(campusOf(["고수801"])).toBe("고등관");
  });
  it("두 건물을 오가면 많이 쓴 쪽 · 모르는 건물은 이름 그대로 · 모르면 빈 칸", () => {
    expect(campusOf(["고수801", "본원205", "고수802"])).toBe("고등관");
    expect(campusOf(["바른602"])).toBe("바른");
    expect(campusOf([null, ""])).toBe("");
  });
});
