import { describe, expect, it } from "vitest";
import {
  buildTimetableSearchIndex,
  matchedClassIds,
  studentSearchFields,
  timetableSearchScope,
} from "./student-search";
import {
  emptySearchMessage,
  isSearchActive,
  matchesStudentSearch,
  normalizeSearchText,
} from "@/features/attendance/student-search";

const 이도윤 = { name: "이도윤B", school: "철성초", grade: "초3" };
const 김하늘 = { name: "김하늘", school: "경명여중", grade: "중2", englishName: "Sky" };

describe("검색 재료(필드) 선정", () => {
  it("이름·학교·학년 + 화면에 붙어 그려지는 압축 표기까지 본다", () => {
    const f = studentSearchFields(이도윤);
    expect(f).toContain("이도윤B");
    expect(f).toContain("철성초");
    // 셀에 "이도윤B/철성초3"으로 그려진다 — 친 그대로 걸려야 한다.
    expect(f).toContain("철성초3");
  });

  it("영문 이름도 본다 — hover 카드가 그리고, 영어과가 그 이름으로 부른다", () => {
    expect(matchesStudentSearch("sky", studentSearchFields(김하늘))).toBe(true);
  });

  it("🔴 판정은 출석부와 **같은 함수**를 쓴다 — 띄어쓰기·대소문자 규칙이 화면마다 갈리면 복불복이다", () => {
    expect(normalizeSearchText(" 김 하늘 ")).toBe("김하늘");
    expect(matchesStudentSearch(" 김 하늘 ", studentSearchFields(김하늘))).toBe(true);
    expect(matchesStudentSearch("KIM", studentSearchFields(김하늘))).toBe(false);
  });
});

describe("반 단위 색인", () => {
  const slots = [
    { classId: "c1", students: [이도윤, 김하늘] },
    // 같은 반의 다른 요일 슬롯 — 명단이 반복돼도 항목은 하나여야 한다(칸이 아니라 반이 단위).
    { classId: "c1", students: [이도윤, 김하늘] },
    { classId: "c2", students: [{ name: "박서준", school: "경명여중", grade: "중2" }] },
    // 강사뷰 비수업 블록(감독·준비·회의) — 반이 아니라 classId가 없다.
    { classId: null, students: [] },
  ];

  it("같은 반의 여러 슬롯을 한 항목으로 합친다", () => {
    const index = buildTimetableSearchIndex(slots);
    expect(index.map((c) => c.classId)).toEqual(["c1", "c2"]);
  });

  it("같은 값은 한 번만 담는다 — 명단마다 학교·학년이 반복된다", () => {
    const c1 = buildTimetableSearchIndex(slots).find((c) => c.classId === "c1")!;
    expect(c1.fields.filter((f) => f === "철성초")).toHaveLength(1);
  });

  it("반이 아닌 항목(비수업 블록)은 색인에 없다 — 수업 수가 부풀면 안 된다", () => {
    expect(buildTimetableSearchIndex(slots)).toHaveLength(2);
  });

  it("빈 값(null·빈 문자열)은 담지 않는다", () => {
    const index = buildTimetableSearchIndex([
      { classId: "c9", students: [{ name: "홍길동", school: null, grade: null }] },
    ]);
    expect(index[0]!.fields).toEqual(["홍길동"]);
  });
});

describe("걸리는 반 고르기", () => {
  const index = buildTimetableSearchIndex([
    { classId: "c1", students: [이도윤, 김하늘] },
    { classId: "c2", students: [{ name: "박서준", school: "대구중", grade: "중2" }] },
  ]);

  it("그 학생이 든 반만 걸린다", () => {
    expect([...matchedClassIds(index, "이도윤")]).toEqual(["c1"]);
    expect([...matchedClassIds(index, "박서준")]).toEqual(["c2"]);
  });

  it("학교·학년으로도 걸린다 — 같은 학교가 여러 반이면 여러 반이 남는다", () => {
    expect([...matchedClassIds(index, "중2")].sort()).toEqual(["c1", "c2"]);
  });

  it("🔴 검색어가 비면 **아무 반도 안 걸린다** — 걸린 반만 그리는 호출부가 전체를 지우면 안 되므로, 필터 여부는 isSearchActive로 따로 묻는다", () => {
    expect(matchedClassIds(index, "").size).toBe(0);
    expect(matchedClassIds(index, "   ").size).toBe(0);
    expect(isSearchActive("   ")).toBe(false);
  });

  it("아무도 없으면 빈 집합 — 화면은 이때 '왜 비었는지'를 말해야 한다", () => {
    expect(matchedClassIds(index, "없는이름").size).toBe(0);
  });
});

describe("0건 안내 범위", () => {
  it("주·과목·구분을 사람 말로 잇는다", () => {
    expect(timetableSearchScope(["이번 주", "수학", "특강"])).toBe("이번 주 수학 특강 시간표");
  });

  it("말할 게 없는 축(정규 구분 등)은 문장에서 빠진다", () => {
    expect(timetableSearchScope(["이번 주", "영어", null])).toBe("이번 주 영어 시간표");
    expect(timetableSearchScope(["2026년 8월 4주차", "수학", "  "])).toBe(
      "2026년 8월 4주차 수학 시간표",
    );
  });

  it("안내 문구는 출석부와 같은 함수로 만든다 — raw 코드·영문 enum이 새지 않는다", () => {
    const msg = emptySearchMessage(" 홍길동 ", timetableSearchScope(["이번 주", "수학", null]));
    expect(msg).toContain("홍길동");
    expect(msg).toContain("이번 주 수학 시간표");
    expect(msg).not.toMatch(/[a-z_]{4,}/);
  });
});
