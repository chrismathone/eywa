import { describe, expect, it } from "vitest";
import { chooseVideoTeacher } from "../../../scripts/_classnote/video-teacher-route.mjs";
import { DEFAULT_VIDEO_HOMEWORK_POLICY } from "@/features/video-homework/policy";
import { linkVideoFilename, linkVideoRoute, reportGetsVideoLink, teacherFolderKey, type VideoClassRow } from "./route";

const tenantId = "11111111-1111-4111-8111-111111111111";
const teacherId = "22222222-2222-4222-8222-222222222222";
const student = { id: "33333333-3333-4333-8333-333333333333", name: "류태경", school: "칠성초", grade: "초3" };
const klass: VideoClassRow = {
  class_id: "44444444-4444-4444-8444-444444444444", class_name: "LT4", subject: "math",
  teacher_id: teacherId, teacher_name: " 이수진 ", teacher_status: "active", same_name_count: 1,
};

/** 워커가 "게시 반 하나"로 고른 결과 — 링크와 같은 입력이다(반이 정해져 있다). */
// 워커 함수의 `student = null` 기본값 때문에 JS 추론 타입이 null이다 — 실제로는 학생 한 명을 받는다.
type WorkerInput = Parameters<typeof chooseVideoTeacher>[0];
const worker = (row: VideoClassRow) => chooseVideoTeacher({
  video: {}, tenantId, studentIds: [student.id], boardClassIds: [row.class_id], classes: [row],
  student: { name: student.name, school: student.school, grade: student.grade },
} as unknown as WorkerInput);
const withoutReason = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== "reason" && key !== "rootId"));

describe("담임 폴더 판정 — 워커 chooseVideoTeacher와 한 벌", () => {
  const cases: [string, VideoClassRow][] = [
    ["지금 담임", klass],
    ["동명 담임은 번호 앞 8자리를 붙인다", { ...klass, same_name_count: 2 }],
    ["담임 없음", { ...klass, teacher_id: null, teacher_name: null, teacher_status: null }],
    ["퇴사한 담임", { ...klass, teacher_status: "inactive" }],
    ["이름이 빈 담임", { ...klass, teacher_name: "  " }],
    ["반 이름 없음", { ...klass, class_name: null }],
  ];
  for (const [label, row] of cases) {
    it(label, () => {
      const mine = linkVideoRoute({ tenantId, rootId: "root", student, klass: row });
      expect(withoutReason(mine)).toEqual(withoutReason(worker(row)));
      expect(mine.reason.startsWith("제출 링크")).toBe(true);
      expect(mine.rootId).toBe("root");
    });
  }
  it("폴더 열쇠는 워커 등록부와 같은 모양", () => {
    const route = linkVideoRoute({ tenantId, rootId: "root", student, klass });
    expect(teacherFolderKey(route, "96575")).toBe(`${tenantId}:96575:${teacherId}`);
    expect(teacherFolderKey({ tenantId, teacherId: null }, "96575")).toBe(`${tenantId}:96575:unassigned`);
  });
});

describe("파일 이름 — 워커 videoFilename 그대로 + 원본 확장자", () => {
  const route = linkVideoRoute({ tenantId, rootId: "root", student, klass });
  it("올리기 시작한 한국 날짜", () => {
    expect(linkVideoFilename(route, new Date("2026-09-29T23:30:00Z"), ".mov")).toBe("류태경_LT4_칠성초3_2026-09-30.mov");
    expect(linkVideoFilename(route, new Date("2026-09-30T01:00:00Z"), ".mp4")).toBe("류태경_LT4_칠성초3_2026-09-30.mp4");
  });
  it("이상한 확장자는 mp4로", () => {
    expect(linkVideoFilename(route, new Date("2026-09-30T01:00:00Z"), ".m/v")).toBe("류태경_LT4_칠성초3_2026-09-30.mp4");
  });
});

describe("수업보고서 '영상 제출' 줄 — 한 함수", () => {
  const base = {
    videoHomework: true, submitLink: true as boolean | null | "no_column", reportSubject: "math", revoked: false,
    classId: klass.class_id, classSubject: "math", grade: "중1", policy: DEFAULT_VIDEO_HOMEWORK_POLICY,
  };
  it("강사가 '영상 첨부 링크 넣기'를 켠 보고서만 — 끔·고른 적 없음은 붙이지 않는다(0328a)", () => {
    expect(reportGetsVideoLink({ ...base, submitLink: true })).toBe(true);
    expect(reportGetsVideoLink({ ...base, submitLink: false })).toBe(false);
    expect(reportGetsVideoLink({ ...base, submitLink: null })).toBe(false);
    // 링크를 켰어도 영상 과제가 없으면 붙이지 않는다.
    expect(reportGetsVideoLink({ ...base, submitLink: true, videoHomework: false })).toBe(false);
  });
  it("그 칸이 아직 없으면(SQL 적용 전) 10-01 규칙 그대로 — 영상 과제 있음이면 붙인다", () => {
    expect(reportGetsVideoLink({ ...base, submitLink: "no_column" })).toBe(true);
    expect(reportGetsVideoLink({ ...base, submitLink: "no_column", videoHomework: null })).toBe(false);
  });
  it("영상 과제 있음 + 검사 대상 반일 때만", () => {
    expect(reportGetsVideoLink(base)).toBe(true);
    expect(reportGetsVideoLink({ ...base, videoHomework: null })).toBe(false);
    expect(reportGetsVideoLink({ ...base, videoHomework: false })).toBe(false);
    expect(reportGetsVideoLink({ ...base, revoked: true })).toBe(false);
    expect(reportGetsVideoLink({ ...base, classId: null })).toBe(false);
    expect(reportGetsVideoLink({ ...base, reportSubject: "english", classSubject: "english" })).toBe(false);
    expect(reportGetsVideoLink({ ...base, policy: { ...DEFAULT_VIDEO_HOMEWORK_POLICY, enabled: false } })).toBe(false);
    expect(reportGetsVideoLink({ ...base, policy: { ...DEFAULT_VIDEO_HOMEWORK_POLICY, disabledClassIds: [klass.class_id] } })).toBe(false);
    expect(reportGetsVideoLink({ ...base, policy: { ...DEFAULT_VIDEO_HOMEWORK_POLICY, disabledSubjectKeys: ["math"] } })).toBe(false);
  });
});
