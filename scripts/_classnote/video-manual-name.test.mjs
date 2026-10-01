// @vitest-environment node
import { describe, expect, it } from "vitest";
import { videoFilename } from "./video-filename.mjs";
import { decideManualVideo, isVideoFile, markDuplicate, matchKey, parseLooseDate, parseManualVideoName } from "./video-manual-name.mjs";

const today = "2026-10-01";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const student = (id, extra = {}) => ({ id, name: "류태경", school: "칠성초", grade: "3", status: "enrolled", ...extra });
const enroll = (studentId, classId, className, extra = {}) =>
  ({ student_id: studentId, class_id: classId, class_name: className, subject: "english", teacher_id: T1, start_date: "2026-03-01", end_date: null, ...extra });
const decide = (name, students, enrollments, folder = { teacherId: T1 }) =>
  decideManualVideo({ parsed: parseManualVideoName(name, { today }), students, enrollments, folder });

describe("직접 올린 영상 파일 이름 읽기", () => {
  it("자동 업로드 이름을 그대로 되읽는다(같은 양식)", () => {
    const name = videoFilename({ postedAt: "2026-09-30T04:36:00Z" },
      { studentId: S1, studentName: "류태경", classId: C1, className: "LT4", school: "칠성초", grade: "3" });
    expect(name).toBe("류태경_LT4_칠성초3_2026-09-30.mp4");
    expect(parseManualVideoName(name, { today })).toEqual({ ok: true, student: "류태경", className: "LT4", schoolGrade: "칠성초3", date: "2026-09-30" });
  });
  it("앞뒤 공백·전각 밑줄·확장자·날짜 모양·복사본 꼬리표·자모가 풀린 이름까지는 너그럽게", () => {
    for (const name of [" 류태경 ＿LT4＿칠성초3＿20260930.MOV", "류태경_LT4_칠성초3_2026.09.30.m4v", "류태경_LT4_칠성초3_2026. 9. 30.mp4",
      "류태경_LT4_칠성초3_2026-09-30 (1).mp4", "류태경_LT4_칠성초3_2026-09-30.mp4".normalize("NFD")])
      expect(parseManualVideoName(name, { today })).toMatchObject({ ok: true, student: "류태경", className: "LT4", date: "2026-09-30" });
  });
  it("반미정은 반 없음, 그 밖의 모양은 추측하지 않는다", () => {
    expect(parseManualVideoName("류태경_반미정_칠성초3_2026-09-30.mp4", { today })).toMatchObject({ ok: true, className: null });
    expect(parseManualVideoName("LT4 류태경.mp4", { today })).toMatchObject({ ok: false });
    expect(parseManualVideoName("류태경_LT4_칠성초3.mp4", { today })).toMatchObject({ ok: false });
    expect(parseManualVideoName("류태경_LT4_칠성초3_9월30일.mp4", { today })).toMatchObject({ ok: false, reason: expect.stringContaining("날짜") });
    expect(parseManualVideoName("류태경_LT4_칠성초3_2026-10-02.mp4", { today })).toMatchObject({ ok: false, reason: expect.stringContaining("오늘 이후") });
    expect(parseManualVideoName("미연결 (영어)류태경_반미정_학교학년미등록_2026-09-30.mp4", { today })).toMatchObject({ ok: false });
    expect(parseLooseDate("2026-02-30")).toBeNull();
    expect(matchKey(" 칠성초 3 ")).toBe(matchKey("칠성초3"));
  });
  it("영상 파일만 — Drive 바로가기는 이름이 .mp4여도 아니다", () => {
    expect(isVideoFile({ name: "a.mp4", mimeType: "video/mp4" })).toBe(true);
    expect(isVideoFile({ name: "a.MOV", mimeType: "application/octet-stream" })).toBe(true);
    expect(isVideoFile({ name: "a.mp4", mimeType: "application/vnd.google-apps.shortcut" })).toBe(false);
    expect(isVideoFile({ name: "a.jpg", mimeType: "image/jpeg" })).toBe(false);
  });
});

describe("직접 올린 영상 학생·반 판정", () => {
  it("이름·학교학년이 같은 한 명 + 그 날짜에 다닌 같은 이름의 반 하나 → 연결, 담임은 올린 폴더", () => {
    expect(decide("류태경_LT4_칠성초3_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4")], { teacherId: T2 }))
      .toMatchObject({ status: "uploaded", studentId: S1, classId: C1, subject: "english", teacherId: T2,
        reason: expect.stringContaining("반 담임과 다른 선생님 폴더") });
  });
  it("학교학년이 다르거나 학생이 없으면 확인 필요", () => {
    expect(decide("류태경_LT4_칠성초4_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4")])).toMatchObject({ status: "review", studentId: null });
    expect(decide("김없음_LT4_칠성초3_2026-09-30.mp4", [student(S1)], [])).toMatchObject({ status: "review" });
  });
  it("동명이인은 그 날짜 수강생 한 명으로만 좁힌다 — 둘 다 다니거나 아무도 안 다니면 확인 필요", () => {
    const both = [student(S1, { status: "withdrawn" }), student(S2)];
    const old = enroll(S1, C1, "LT4", { start_date: "2025-03-01", end_date: "2025-12-31" });
    const now = enroll(S2, C2, "LT4", { start_date: "2026-03-01" });
    expect(decide("류태경_LT4_칠성초3_2026-09-30.mp4", both, [old, now])).toMatchObject({ status: "uploaded", studentId: S2, classId: C2 });
    expect(decide("류태경_LT4_칠성초3_2025-06-01.mp4", both, [old, now])).toMatchObject({ status: "uploaded", studentId: S1, classId: C1 });
    expect(decide("류태경_반미정_칠성초3_2026-01-15.mp4", both, [old, now])).toMatchObject({ status: "review", reason: expect.stringContaining("여러 명") });
  });
  it("퇴원생은 그 날짜에 학원생이었을 때만 — 수강 기록, 또는 (기록이 지워졌어도) 등록일~퇴원일 안", () => {
    const gone = [student(S1, { status: "withdrawn" })];
    const old = [enroll(S1, C1, "LT4", { end_date: "2026-06-30" })];
    expect(decide("류태경_반미정_칠성초3_2026-05-01.mp4", gone, old)).toMatchObject({ status: "uploaded", classId: null });
    expect(decide("류태경_반미정_칠성초3_2026-09-01.mp4", gone, old)).toMatchObject({ status: "review" });
    const cleaned = [student(S1, { status: "withdrawn", enrolled_at: "2025-03-01", withdrawn_at: "2025-12-31" })];
    expect(decide("류태경_반미정_칠성초3_2025-11-13.mp4", cleaned, [])).toMatchObject({ status: "uploaded", studentId: S1 });
    expect(decide("류태경_반미정_칠성초3_2026-01-05.mp4", cleaned, [])).toMatchObject({ status: "review" });
    expect(decide("류태경_반미정_칠성초3_2025-02-01.mp4", cleaned, [])).toMatchObject({ status: "review" });
  });
  it("적은 반을 못 찾으면 반 없이 넣지 않는다 · 폐지 반 꼬리표는 떼고 비교 · 같은 이름 반이 둘이면 확인 필요", () => {
    expect(decide("류태경_LT5_칠성초3_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4")]))
      .toMatchObject({ status: "review", reason: expect.stringContaining("이 이름의 반을 다닌 기록") });
    // 그 날짜에 끝난 수강은 그 반이 아니다
    expect(decide("류태경_LT4_칠성초3_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4", { end_date: "2026-09-29" })]))
      .toMatchObject({ status: "review" });
    expect(decide("류태경_PJ2_칠성초3_2026-07-10.mp4", [student(S1)], [enroll(S1, C1, "PJ2 (~2026-07)", { end_date: "2026-07-31" })]))
      .toMatchObject({ status: "uploaded", classId: C1 });
    // 반이동으로 끝난 수강은 끝난 날부터 새 반(반열림 — 앱 isEnrollmentActiveOn과 같다)
    expect(decide("류태경_PJ2_칠성초3_2026-07-31.mp4", [student(S1)],
      [enroll(S1, C1, "PJ2 (~2026-07)", { end_date: "2026-07-31", is_transferred: true }), enroll(S1, C2, "PJ2", { start_date: "2026-07-31" })]))
      .toMatchObject({ status: "uploaded", classId: C2 });
    // 일반 종료일과 새 반 시작이 겹치는 날은 둘 다라 확인 필요
    expect(decide("류태경_PJ2_칠성초3_2026-07-31.mp4", [student(S1)],
      [enroll(S1, C1, "PJ2 (~2026-07)", { end_date: "2026-07-31" }), enroll(S1, C2, "PJ2", { start_date: "2026-07-31" })]))
      .toMatchObject({ status: "review", reason: expect.stringContaining("여러 개") });
    // 휴원 중인 수강·종강일이 지난 반은 그 반이 아니다
    expect(decide("류태경_LT4_칠성초3_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4", { on_hold: true })]))
      .toMatchObject({ status: "review", reason: expect.stringContaining("휴원 중") });
    expect(decide("류태경_LT4_칠성초3_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4", { closed_at: "2026-09-15" })])).toMatchObject({ status: "review" });
  });
  it("접미사만 다른 동명이인(김근우 ↔ 김근우A)이 그 날짜 학원생이면 이름만으로 고르지 않는다 — 반으로만 가른다", () => {
    const plain = student(S1);
    const suffixed = student(S2, { name: "류태경A" });
    const enrollments = [enroll(S1, C1, "LT4"), enroll(S2, C2, "RTT6")];
    expect(decide("류태경_반미정_칠성초3_2026-09-30.mp4", [plain, suffixed], enrollments))
      .toMatchObject({ status: "review", reason: expect.stringContaining("반까지") });
    expect(decide("류태경_LT4_칠성초3_2026-09-30.mp4", [plain, suffixed], enrollments)).toMatchObject({ status: "uploaded", studentId: S1, classId: C1 });
    expect(decide("류태경_RTT6_칠성초3_2026-09-30.mp4", [plain, suffixed], enrollments))
      .toMatchObject({ status: "review", reason: expect.stringContaining("접미사") });
    // 접미사까지 적으면 그 학생 · 접미사 붙은 학생만 있으면 이름이 다르다고 알린다
    expect(decide("류태경A_RTT6_칠성초3_2026-09-30.mp4", [plain, suffixed], enrollments)).toMatchObject({ status: "uploaded", studentId: S2 });
    expect(decide("류태경_반미정_칠성초3_2026-09-30.mp4", [suffixed], enrollments)).toMatchObject({ status: "review", reason: expect.stringContaining("접미사") });
    // 접미사 학생이 그 날짜에 학원생이 아니면(퇴원 뒤) 대조하지 않는다
    const left = student(S2, { name: "류태경A", status: "withdrawn", withdrawn_at: "2026-03-01" });
    expect(decide("류태경_반미정_칠성초3_2026-09-30.mp4", [plain, left], [enroll(S1, C1, "LT4")])).toMatchObject({ status: "uploaded", studentId: S1 });
  });
  it("반미정이면 학생만 · 담임 확인 필요·등록되지 않은 폴더면 담임 없음", () => {
    expect(decide("류태경_반미정_칠성초3_2026-09-30.mp4", [student(S1)], [], { teacherId: null }))
      .toMatchObject({ status: "uploaded", studentId: S1, classId: null, teacherId: null, subject: null });
    expect(decide("류태경_LT4_칠성초3_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4")], { teacherId: null, unregistered: true }))
      .toMatchObject({ status: "uploaded", teacherId: null, reason: expect.stringContaining("에이와가 만든 담임 폴더가 아니") });
  });
  it("같은 영상: 같은 학생이고 그 행이 반까지 정해졌거나 이 파일도 반을 모를 때만 세지 않는다", () => {
    const withClass = decide("류태경_LT4_칠성초3_2026-09-30.mp4", [student(S1)], [enroll(S1, C1, "LT4")]);
    const noClass = decide("류태경_반미정_칠성초3_2026-09-30.mp4", [student(S1)], []);
    expect(markDuplicate(withClass, [{ id: "cn", student_id: S1, class_id: C1 }]))
      .toMatchObject({ status: "review", studentId: null, classId: null, duplicateOf: "cn" });
    expect(markDuplicate(noClass, [{ id: "cn", student_id: S1, class_id: null }])).toMatchObject({ status: "review", duplicateOf: "cn" });
    // 반을 못 정한 ClassNote 수집분보다 이 파일이 더 안다 · 다른 학생(쌍둥이)의 같은 영상은 따로 센다
    expect(markDuplicate(withClass, [{ id: "cn", student_id: S1, class_id: null }])).toBe(withClass);
    expect(markDuplicate(withClass, [{ id: "twin", student_id: S2, class_id: C1 }])).toBe(withClass);
    expect(markDuplicate(withClass, [])).toBe(withClass);
  });
});
