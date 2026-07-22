import { describe, expect, it } from "vitest";
import { groupTextbookNoticeStudents, type TextbookNoticeOrderRow } from "./textbook-notice-group";

const ACCOUNT = { bank: "국민", holder: "인재원", number: "123-45" };
const row = (over: Partial<TextbookNoticeOrderRow>): TextbookNoticeOrderRow => ({
  studentId: "s1",
  studentName: "홍길동",
  bookName: "쎈 중2",
  bookDetail: null,
  price: 15000,
  requestDate: "2026-07-21",
  ...over,
});

const opts = (over: Partial<Parameters<typeof groupTextbookNoticeStudents>[1]> = {}) => ({
  ment: "안녕하세요. {학생} 교재 신청합니다.",
  account: ACCOUNT,
  subjectOf: () => "math",
  ...over,
});

describe("groupTextbookNoticeStudents", () => {
  it("같은 학생의 여러 요청은 한 글로 합친다(보드 중복 = 조용한 누락)", () => {
    const { students } = groupTextbookNoticeStudents(
      [row({ bookName: "쎈 중2" }), row({ bookName: "RPM 중2", price: 12000 })],
      opts(),
    );
    expect(students).toHaveLength(1);
    expect(students[0].individualBody).toContain("쎈 중2");
    expect(students[0].individualBody).toContain("RPM 중2");
  });

  it("멘트는 첫 덩이에만 — 같은 문장이 두 번 나오지 않는다", () => {
    const { students } = groupTextbookNoticeStudents([row({}), row({ bookName: "RPM" })], opts());
    const hits = students[0].individualBody.split("안녕하세요").length - 1;
    expect(hits).toBe(1);
  });

  it("학생 연결 없음·과목 없음은 제외 목록으로(조용히 사라지지 않게)", () => {
    const { students, skipped } = groupTextbookNoticeStudents(
      [row({ studentId: null, studentName: "김철수" }), row({ studentId: "s2", studentName: "이영희" })],
      opts({ subjectOf: (id) => (id === "s1" ? "math" : null) }),
    );
    expect(students).toEqual([]);
    expect(skipped).toEqual([
      { name: "김철수", reason: "no_student" },
      { name: "이영희", reason: "no_subject" },
    ]);
  });

  it("학생별 첨부는 그 학생에게만 실린다(남의 요청서 차단)", () => {
    const att = { path: "t1/report-attachments/a.png", name: "a.png", size: 1 };
    const { students } = groupTextbookNoticeStudents([row({}), row({ studentId: "s2", studentName: "이영희" })], {
      ...opts(),
      attachmentsOf: (id) => (id === "s1" ? [att] : undefined),
    });
    expect(students.find((s) => s.studentId === "s1")?.attachments).toEqual([att]);
    expect(students.find((s) => s.studentId === "s2")?.attachments).toEqual([]);
  });

  it("계좌·금액이 개별 본문에 들어간다(수정으로 본문만 지우면 안 되는 이유)", () => {
    const { students } = groupTextbookNoticeStudents([row({})], opts());
    expect(students[0].individualBody).toContain("15,000원");
    expect(students[0].individualBody).toContain("123-45");
  });
});
