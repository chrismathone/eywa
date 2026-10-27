import { describe, expect, it } from "vitest";
import { monthlyParticipation, type ParticipationInput } from "./participation";
import { observedPositive } from "./positive";
type Fixture = { [K in keyof ParticipationInput]: ParticipationInput[K] extends readonly (infer T)[] ? T[] : ParticipationInput[K] };
const base = (): Fixture => ({ studentId: "s", month: "2026-09", today: "2026-10-22", allowLate: true,
  targets: [{ student_id: "s", class_id: "c", session_date: "2026-09-10" }],
  attendance: [{ id: "a", student_id: "s", class_id: "c", session_date: "2026-09-10", recorded_at: "2026-09-10T09:00:00Z", status: "present" }],
  assignments: [], videos: [], marks: [], grades: [], signals: [], ready: { attendance: true, video: true, grades: true, positive: true } });
describe("주간 출석·숙제별 제출과 월 단위 자동 활동", () => {
  it("최신 출결 정정과 지각 설정을 적용", () => {
    const input = base();
    expect(monthlyParticipation(input).raws.perfectWeeks).toBe(1);
    input.attendance.push({ ...input.attendance[0]!, id: "b", status: "late", recorded_at: "2026-09-10T10:00:00Z" });
    expect(monthlyParticipation(input).raws.perfectWeeks).toBe(1);
    expect(monthlyParticipation({ ...input, allowLate: false }).raws.perfectWeeks).toBe(0);
    input.attendance[1]!.status = "absent";
    expect(monthlyParticipation(input).raws.perfectWeeks).toBe(0);
  });
  it("대상 0·출결 미입력·보강만·진행 중인 주는 개근을 주지 않는다", () => {
    expect(monthlyParticipation({ ...base(), targets: [] }).raws.perfectWeeks).toBe(0);
    expect(monthlyParticipation({ ...base(), attendance: [] }).raws.perfectWeeks).toBe(0);
    const input = base(); input.attendance[0]!.status = "makeup";
    expect(monthlyParticipation(input).raws.perfectWeeks).toBe(0);
    expect(monthlyParticipation({ ...base(), today: "2026-09-13" }).raws.perfectWeeks).toBe(0);
    expect(monthlyParticipation({ ...base(), today: "2026-09-14" }).raws.perfectWeeks).toBe(1);
  });
  it("옛 하루 전체 출석은 교시 대상을 채우지만 일부 교시만 입력하면 개근이 아니다", () => {
    const input = base(); input.targets = ["16:00:00", "17:00:00"].map((slot_start) => ({ ...input.targets[0]!, slot_start }));
    expect(monthlyParticipation(input).raws.perfectWeeks).toBe(1);
    input.attendance.push({ ...input.attendance[0]!, id: "slot", slot_start: "16:00:00" });
    expect(monthlyParticipation(input).raws.perfectWeeks).toBe(0);
  });
  it("실제 영상 없는 수동 체크는 숙제 완료가 아니며 과제가 없는 달도 0", () => {
    const input = base();
    input.assignments.push({ classId: "c", studentId: "s", date: "2026-09-10" });
    input.marks.push({ classId: "c", studentId: "s", homeworkDate: "2026-09-10", checkDate: "2026-09-11", status: "submitted" });
    expect(monthlyParticipation(input).raws.videoAssignments).toBe(0);
    expect(monthlyParticipation(base()).raws.videoAssignments).toBe(0);
    input.videos.push({ id: "v", studentId: "s", classId: "c", postedAt: "2026-09-11T01:00:00Z", homeworkDate: "2026-09-10",
      playback: { preview: "video", thumbnail: "thumb", uploadedAt: null } });
    expect(monthlyParticipation(input).raws.videoAssignments).toBe(1);
  });
  it("응시와 긍정 글을 여러 건 기록해도 각 달 1회이며 취소·수정 글은 뺀다", () => {
    const input = base();
    input.grades = ["a", "b"].map((id) => ({ id, studentId: "s", day: "2026-09-20", kind: "monthly", subject: "math" }));
    input.signals = ["p1", "p2"].map((id) => ({ id, studentId: "s", day: "2026-09-10", source: "parent", observed: true, cancelled: false, sourceCurrent: true }));
    expect(monthlyParticipation(input).raws).toMatchObject({ examMonths: 1, parentPositiveMonths: 1 });
    input.signals[0]!.cancelled = true; input.signals[1]!.sourceCurrent = false;
    expect(monthlyParticipation(input).raws.parentPositiveMonths).toBe(0);
  });
  it("진행 중인 달에도 제출한 숙제마다 인정하며 미제출 숙제는 다른 제출 점수를 막지 않는다", () => {
    const input = { ...base(), today: "2026-09-20" };
    input.assignments = ["2026-09-10", "2026-09-14", "2026-09-17"].map(date => ({ classId: "c", studentId: "s", date }));
    input.videos = ["2026-09-10", "2026-09-14"].map((homeworkDate, i) => ({ id: `v${i}`, studentId: "s", classId: "c",
      postedAt: `${homeworkDate}T10:00:00Z`, homeworkDate, playback: { preview: "video", thumbnail: "thumb", uploadedAt: null } }));
    // Two files and a repeated assignment row still represent one homework.
    input.videos.push({ ...input.videos[0]!, id: "extra" });
    input.assignments.push({ ...input.assignments[0]! });
    expect(monthlyParticipation(input).raws.videoAssignments).toBe(2);
    input.videos[0]!.playback = null;
    expect(monthlyParticipation(input).raws.videoAssignments).toBe(2);
    input.videos[2]!.playback = null;
    expect(monthlyParticipation(input).raws.videoAssignments).toBe(1);
  });
  it("과제 없는 영상·다른 학생·옮겨 남긴 숙제는 인정하지 않는다", () => {
    const input = base();
    input.assignments = [{ classId: "c", studentId: "s", date: "2026-09-10", kept: true }, { classId: "c", studentId: "other", date: "2026-09-11" }];
    input.videos = [{ id: "v", studentId: "s", classId: "c", postedAt: "2026-09-11T10:00:00Z", homeworkDate: "2026-09-10",
      playback: { preview: "video", thumbnail: "thumb", uploadedAt: null } }];
    expect(monthlyParticipation(input).raws.videoAssignments).toBe(0);
    input.assignments = [];
    expect(monthlyParticipation(input).raws.videoAssignments).toBe(0);
  });
  it("기능/자료 없음은 미달성 0과 별도로 반환", () => {
    expect(monthlyParticipation({ ...base(), ready: { attendance: false, video: false, grades: false, positive: false } }).unavailable).toHaveLength(5);
  });
  it("AI 분류와 원문 인용을 함께 확인", () => {
    expect(observedPositive("집중하는 시간이 늘었어요", { classification: "observed", evidence: "집중하는 시간이 늘었어요" })).toBe(true);
    expect(observedPositive("최고예요", { classification: "unsupported_praise", evidence: "최고예요" })).toBe(false);
    expect(observedPositive("최고예요", { classification: "observed", evidence: "매일 스스로 공부했어요" })).toBe(false);
  });
});
