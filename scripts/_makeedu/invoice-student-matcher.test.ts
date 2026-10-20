import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { isMergedStudent as appIsMergedStudent, mergeNoteFor } from "../../src/features/students/status/merged";
const require_ = createRequire(import.meta.url);
type Student = { id: string; name: string; grade: string; makeedu_id?: string | null; notes?: string | null; status?: string };
const { isMergedStudent, invoiceStudentMatcher } = require_("./invoice-student-matcher.cjs") as {
  isMergedStudent: typeof appIsMergedStudent;
  invoiceStudentMatcher: (rows: Student[]) => (line: {name: string; grade: string; mkid?: string}) => string | null;
};
const keeper: Student = {id: "keeper", name: "이재윤", grade: "중1", makeedu_id: "13846", status: "enrolled"};
const mergee: Student = {...keeper, id: "mergee", makeedu_id: null, status: "withdrawn", notes: mergeNoteFor("keeper", "2026-07-07", null)};

describe("수납 학생 매칭 — 병합으로 흡수된 기록은 후보가 아니다", () => {
  it("이재윤 재현: 병합된 동명·동학년 기록이 있어도 현재 원생으로 유일 매칭한다", () => {
    expect(invoiceStudentMatcher([keeper, mergee])({name: "이재윤", grade: "중1"})).toBe("keeper");
  });
  it("퇴원 상태 자체로 제외하지 않는다 — 실제 퇴원생의 과거 수납도 매칭한다", () => {
    expect(invoiceStudentMatcher([{...keeper, status: "withdrawn"}])(keeper)).toBe("keeper");
  });
  it("실제 동명이인 두 명이면 재원·퇴원 상태와 무관하게 모호함을 유지한다", () => {
    expect(invoiceStudentMatcher([keeper, {...mergee, notes: null}])(keeper)).toBeNull();
  });
  it("고유 원생번호가 있으면 이름보다 우선한다", () => {
    expect(invoiceStudentMatcher([keeper, {...mergee, notes: null}])({...keeper, mkid: "13846"})).toBe("keeper");
  });
  it("병합된 원생번호가 명시되면 이름만으로 다른 학생에게 붙이지 않는다", () => {
    expect(invoiceStudentMatcher([keeper, {...mergee, makeedu_id: "old"}])({...keeper, mkid: "old"})).toBeNull();
  });
  it("병합 기록밖에 없으면 그 기록에 새 청구를 만들지 않는다", () => {
    expect(invoiceStudentMatcher([mergee])(keeper)).toBeNull();
  });
  it("일반 메모와 동명이인 접미사는 병합 표식으로 취급하지 않는다", () => {
    expect(invoiceStudentMatcher([{...keeper, name: "이재윤B", notes: "중복 병합: 확인 요망"}])({name: "이재윤B", grade: "중1"})).toBe("keeper");
  });
  it("병합 표식 판정은 앱의 퇴원관리와 동일하다", () => {
    for (const notes of [null, undefined, "", "중복 병합: 확인 요망", mergee.notes, `  \n${mergee.notes}`, `메모\n${mergee.notes}`, mergeNoteFor("keeper", "2026-07-07", "셔틀 이용")]) {
      expect(isMergedStudent(notes)).toBe(appIsMergedStudent(notes));
    }
  });
  it("학생 배열 순서가 바뀌어도 같은 후보를 고른다", () => {
    expect(invoiceStudentMatcher([mergee, keeper])(keeper)).toBe(invoiceStudentMatcher([keeper, mergee])(keeper));
  });
});
