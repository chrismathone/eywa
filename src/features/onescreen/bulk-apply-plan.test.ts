import { describe, expect, it } from "vitest";
import { bulkApplyTargetOf, echoAttendanceUnits, type BulkTargetCtx } from "./bulk-apply-plan";
import type { GridRow } from "./grid";
import type { OneScreenStudent, Subject } from "./types";

const subject = (over: Partial<Subject> = {}) =>
  ({ name: "수학", subjectKey: "math", classId: "c1", today: "1-1", attitude: "좋음", homework: "100%", ...over }) as Subject;
const rowOf = (su: Subject): GridRow =>
  ({
    student: {
      id: "s1",
      name: "학생",
      grade: "중1",
      subjects: [su],
      tests: { daily: { score: null, max: 20 }, check: { score: null, max: 10 } },
      attitude: null,
      homework: "",
    } as unknown as OneScreenStudent,
    subject: su,
    subjectIndex: 0,
    key: "s1::수학",
  }) as GridRow;

const CTX: BulkTargetCtx = {
  videoHwSaveOk: false,
  videoHwPolicy: null,
  videoHwByOther: () => false,
  videoDueReady: false,
  submitLinkMode: "off" as never,
  readonlyView: false,
  liveClassnoteStatus: () => undefined,
};

describe("bulkApplyTargetOf", () => {
  it("지금 행 값으로 대상 한 줄을 만든다(과목키 없으면 math)", () => {
    const t = bulkApplyTargetOf(rowOf(subject({ subjectKey: undefined })), CTX);
    expect(t).toMatchObject({ studentId: "s1", subjectName: "수학", subjectIndex: 0, subjectKey: "math", today: "1-1", attitude: "좋음", homework: "100%", locked: false });
  });
  it("영상 정책이 없거나 저장값을 못 읽은 세션이면 영상 칸을 열지 않는다", () => {
    const t = bulkApplyTargetOf(rowOf(subject()), CTX);
    expect(t.videoOk).toBe(false);
    expect(t.dueOk).toBe(false);
    expect(t.linkOk).toBe(false);
  });
  it("🔴 열람 전용·발송 완료 행은 잠근다 — 화면 state의 최신 상태가 로스터를 이긴다", () => {
    expect(bulkApplyTargetOf(rowOf(subject()), { ...CTX, readonlyView: true }).locked).toBe(true);
    expect(bulkApplyTargetOf(rowOf(subject()), { ...CTX, liveClassnoteStatus: () => "success" }).locked).toBe(true);
  });
});

describe("echoAttendanceUnits", () => {
  it("안 고름 = undefined(서버 자동 시수) · 1·숫자 아님 = null · 쉼표 소수 허용", () => {
    expect(echoAttendanceUnits("")).toBeUndefined();
    expect(echoAttendanceUnits("1")).toBeNull();
    expect(echoAttendanceUnits("x")).toBeNull();
    expect(echoAttendanceUnits("1,5")).toBe(1.5);
    expect(echoAttendanceUnits("2")).toBe(2);
  });
});
