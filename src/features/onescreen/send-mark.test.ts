import { describe, expect, it } from "vitest";
import { buildSendMark, lessonEndsByClass } from "./send-mark";
import type { Subject } from "./types";

const subject: Subject = { name: "Math morning", classId: "am", prev: "", today: "" };
const base = {
  subjects: [subject], delivery: true, label: "Sent", date: "2026-10-03", now: "2026-10-03T12:00",
  lessons: [{ id: "am", endTime: "12:00" }, { id: "pm", endTime: "17:00" }],
};

describe("수업별 발송·종료 표시", () => {
  it("저장만 된 보고서와 대기·실패는 발송으로 세지 않는다", () => {
    for (const status of [null, "queued", "processing", "failed", "recalled"]) {
      expect(buildSendMark({ ...base, reports: { [subject.name]: { sent: true, classnoteStatus: status } } }))
        .toMatchObject({ sent: 0, total: 1, overdue: 1 });
    }
  });
  it("발송 성공은 수업 종료 여부와 무관하게 완료다", () => {
    expect(buildSendMark({ ...base, reports: { [subject.name]: { classnoteStatus: "success" } } }))
      .toMatchObject({ sent: 1, overdue: 0 });
  });
  it("회수로 명시 해제한 상태는 옛 성공 스냅샷으로 되살리지 않는다", () => {
    expect(buildSendMark({ ...base, subjects: [{ ...subject, classnoteStatus: "success" }], reports: { [subject.name]: { classnoteStatus: null } } }).sent).toBe(0);
  });
  it("오전 수업은 12시, 오후 수업은 17시부터 미발송을 경고한다", () => {
    const pm = { ...subject, name: "Afternoon", classId: "pm" };
    expect(buildSendMark({ ...base, now: "2026-10-03T11:59" }).overdue).toBe(0);
    expect(buildSendMark(base).overdue).toBe(1);
    expect(buildSendMark({ ...base, subjects: [pm] }).overdue).toBe(0);
    expect(buildSendMark({ ...base, subjects: [pm], now: "2026-10-03T17:00" }).overdue).toBe(1);
  });
  it("결석·보고서 제외 수업은 분모와 미발송 경고에서 빠진다", () => {
    expect(buildSendMark({ ...base, subjects: [{ ...subject, attendanceRaw: "absent" }, { ...subject, reportOptout: true }] }))
      .toMatchObject({ total: 0, overdue: 0 });
  });
  it("종료 시각 미상은 오늘 경고하지 않고 지난 날짜는 미발송으로 표시한다", () => {
    expect(buildSendMark({ ...base, lessons: [] }).overdue).toBe(0);
    expect(buildSendMark({ ...base, lessons: [], date: "2026-10-02" }).overdue).toBe(1);
    expect(buildSendMark({ ...base, date: "2026-10-04" }).overdue).toBe(0);
    expect(buildSendMark({ ...base, now: null }).overdue).toBe(0);
  });
  it("전체 담당반에서 시간표 없는 날은 경고하지 않는다", () => {
    expect(buildSendMark({ ...base, lessons: [], date: "2026-10-02", showingAll: true }).overdue).toBe(0);
  });
  it("보강은 배정한 수업 종료 시각을 따른다", () => {
    expect(buildSendMark({ ...base, subjects: [{ ...subject, classId: null, makeup: true, makeupClassId: "pm" }] }).overdue).toBe(0);
  });
  it("발송이 꺼진 학원은 저장 기준을 유지하고 미발송 경고하지 않는다", () => {
    expect(buildSendMark({ ...base, delivery: false }).overdue).toBe(0);
    expect(buildSendMark({ ...base, delivery: false, reports: { [subject.name]: { sent: true } } }).sent).toBe(1);
  });
  it("같은 반 3교시 중 마지막 종료 시각을 사용한다", () => {
    expect(lessonEndsByClass(["10:00:00", "12:00:00", "11:00:00"].map(end_time => ({ class_id: "am", end_time }))).get("am")).toBe("12:00");
    expect(lessonEndsByClass([{ class_id: "am", end_time: null }, { class_id: "am", end_time: "10:00" }]).get("am")).toBeNull();
  });
});
