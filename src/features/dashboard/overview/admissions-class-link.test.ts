import { describe, expect, it } from "vitest";
import {
  matchFirstClass,
  matchFirstClassSchedule,
  type FirstClassCandidate,
  type FirstClassSchedule,
} from "./admissions-class-link";

describe("first class timetable matching before enrollment", () => {
  const slot = (
    over: Partial<FirstClassSchedule> = {},
  ): FirstClassSchedule => ({
    classId: "math5",
    className: "초등M 초5 EL2T",
    subject: "math",
    dayOfWeek: "fri",
    startTime: "16:20:00",
    teacherName: "김윤하",
    validFrom: "2026-03-01",
    validTo: null,
    closedAt: null,
    ...over,
  });
  const entry = {
    title: "수학 첫 수업 김지유 칠성초5 (화, 수, 금 4:20 ~ 윤하T, 정화T)",
    startDate: "2026-09-11",
    startTime: "16:00",
  };
  const labels = { math: "수학", english: "영어" };
  it("일정의 과목·학년·수업 시간·강사가 모두 일치하는 반으로 연결한다", () => {
    expect(
      matchFirstClassSchedule(
        entry,
        [
          slot(),
          slot({
            classId: "math4",
            className: "초등M 초4 EL2S",
            teacherName: "남정화",
          }),
        ],
        labels,
      ),
    ).toEqual({ id: "math5", name: "초등M 초5 EL2T" });
  });
  it("오래된·종강·다른 요일·다른 강사·다른 학년의 반은 연결하지 않는다", () => {
    for (const candidate of [
      slot({ validTo: "2026-09-10" }),
      slot({ closedAt: "2026-09-10" }),
      slot({ dayOfWeek: "mon" }),
      slot({ teacherName: "김주현" }),
      slot({ className: "중등M 중1 EL2T" }),
    ])
      expect(matchFirstClassSchedule(entry, [candidate], labels)).toBeNull();
  });
  it("복수 후보와 단서가 부족한 일정은 링크를 만들지 않는다", () => {
    expect(
      matchFirstClassSchedule(
        entry,
        [slot(), slot({ classId: "another" })],
        labels,
      ),
    ).toBeNull();
    expect(
      matchFirstClassSchedule(
        { ...entry, title: "수학 첫수업 김지우 칠성초5" },
        [slot()],
        labels,
      ),
    ).toBeNull();
  });
});

const row = (over: Partial<FirstClassCandidate> = {}): FirstClassCandidate => ({
  studentId: "s1",
  studentName: "김지우",
  school: "칠성초",
  grade: "초5",
  classId: "c1",
  className: "초등M 초5 BS1J",
  subject: "math",
  startDate: "2026-09-11",
  endDate: null,
  onHold: false,
  isTransferred: false,
  ...over,
});
const event = {
  title: "수학 첫 수업 김지우 칠성초5 (화, 수, 금 4:20 ~ 윤하T, 정화T)",
  startDate: "2026-09-11",
};
const subjects = { math: "수학", english: "영어" };
describe("first class matching", () => {
  it("동명이인 접미사는 학교·학년·과목으로 한 학생이 확정될 때만 해석한다", () => {
    expect(
      matchFirstClass(
        event,
        [row({ studentName: "김지우A", school: "칠성" })],
        subjects,
      )?.id,
    ).toBe("c1");
    expect(
      matchFirstClass(
        event,
        [
          row({ subject: "english" }),
          row({ studentId: "s2", studentName: "김지우A", classId: "new" }),
        ],
        subjects,
      )?.id,
    ).toBe("new");
    expect(
      matchFirstClass(
        event,
        [row(), row({ studentId: "s2", studentName: "김지우A" })],
        subjects,
      ),
    ).toBeNull();
    expect(
      matchFirstClass(
        { ...event, title: "수학 첫 수업 김지우" },
        [row({ studentName: "김지우A" })],
        subjects,
      ),
    ).toBeNull();
  });
  it("학생·학교·과목으로 같은 이름과 동시수강을 구분한다", () => {
    expect(
      matchFirstClass(
        event,
        [
          row(),
          row({ studentId: "s2", school: "침산초", classId: "c2" }),
          row({ classId: "c3", subject: "english" }),
        ],
        subjects,
      ),
    ).toEqual({ id: "c1", name: "초등M 초5 BS1J", studentName: "김지우" });
  });
  it("학생으로 확정되면 그 원생의 정식 이름(접미사)을 함께 돌려주고, 반 이름으로만 확정되면 이름은 없다", () => {
    expect(
      matchFirstClass(event, [row({ studentName: "김지우A", school: "칠성" })], subjects)?.studentName,
    ).toBe("김지우A");
    const byClassName = matchFirstClass({ ...event, title: "초등M 초5 BS1J 첫 수업" }, [row()], subjects);
    expect(byClassName?.id).toBe("c1");
    expect(byClassName?.studentName).toBeUndefined();
  });
  it("접미사 뗀 이름으로 잡힌 반이 이미 다니던 반이면(일정일에 시작하지 않음) 반 링크는 그대로지만 이름은 바꾸지 않는다", () => {
    const already = matchFirstClass(event, [row({ studentName: "김지우A", school: "칠성", startDate: "2026-09-01" })], subjects);
    expect(already?.id).toBe("c1");
    expect(already?.studentName).toBeUndefined();
    const fullName = matchFirstClass({ ...event, title: "수학 첫 수업 김지우A 칠성초5" }, [row({ studentName: "김지우A", startDate: "2026-09-01" })], subjects);
    expect(fullName?.studentName).toBe("김지우A");
  });
  it("명칭이 같아도 반이 여러 개거나 학교가 다르면 추측하지 않는다", () => {
    expect(
      matchFirstClass(event, [row(), row({ classId: "c2" })], subjects),
    ).toBeNull();
    expect(
      matchFirstClass(event, [row({ school: "침산초" })], subjects),
    ).toBeNull();
    expect(
      matchFirstClass(
        { ...event, title: "수학 첫 수업 김지우" },
        [row(), row({ studentId: "s2", classId: "c2" })],
        subjects,
      ),
    ).toBeNull();
  });
  it("취소·레벨테스트·휴원·시작 전·이동 종료인 반을 연결하지 않는다", () => {
    for (const title of [
      "수학 레벨테스트 김지우 칠성초5",
      `취소 ${event.title}`,
    ])
      expect(
        matchFirstClass({ ...event, title }, [row()], subjects),
      ).toBeNull();
    for (const candidate of [
      row({ onHold: true }),
      row({ startDate: "2026-09-12" }),
      row({ endDate: "2026-09-11", isTransferred: true }),
    ])
      expect(matchFirstClass(event, [candidate], subjects)).toBeNull();
    expect(
      matchFirstClass(event, [row({ endDate: "2026-09-11" })], subjects)?.id,
    ).toBe("c1");
  });
  it("수업명이 직접 적혔거나 그날 새로 시작한 반 하나만 있는 경우 연결한다", () => {
    expect(
      matchFirstClass(
        { ...event, title: "초등M 초5 BS1J 첫 수업" },
        [row()],
        subjects,
      )?.id,
    ).toBe("c1");
    expect(
      matchFirstClass(
        event,
        [row(), row({ classId: "old", startDate: "2026-09-01" })],
        subjects,
      )?.id,
    ).toBe("c1");
  });
  it("다른 학생 이름의 일부 일치는 제외한다", () => {
    expect(
      matchFirstClass(
        { ...event, title: "수학 첫 수업 김지우현 칠성초5" },
        [row()],
        subjects,
      ),
    ).toBeNull();
  });
});
