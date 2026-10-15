/**
 * 강사별 업무 현황의 새 행(원장 2026-10-15) — 학부모 미확인 · 출결 미입력 · 원생상담 · 오늘 미작성.
 * 판정은 다른 화면이 쓰는 함수 그대로라(같은 원본) 여기서는 그 함수들과 열(강사 × 과목) 배분을 잠근다.
 */
import { describe, expect, it } from "vitest";
import { judgeUnreadReport, UNREAD_MATCHABLE_OR, SENT_STATUS_SUCCESS } from "@/features/report-admin/unread-filter";
import { judgeClassAttendanceDay, type UnrecordedEnrollment } from "../unrecorded-attendance";
import { teacherWork, withTeacherWorkExtras, type WorkClass } from "./teacher-work";
import { counselPeriodLabel, pickCounselMonth } from "./counsel-period";

const NOW = Date.parse("2026-10-15T03:00:00Z");
const cutoff = NOW - 48 * 3_600_000;
const sent = (over: Partial<Parameters<typeof judgeUnreadReport>[0]> = {}) => ({
  classnote_status: "success", classnote_read_at: null, classnote_sent_at: "2026-10-10T01:00:00+00:00", edutrix_share_token: null, source: null, ...over,
});

describe("학부모 미확인 — 보고서 목록 '안읽음' 필터의 순수 함수 짝", () => {
  it("발송 성공 + 매칭 가능 + 유예 지남 + 읽음 없음만 미확인", () => {
    expect(judgeUnreadReport(sent(), cutoff)).toEqual({ judgeable: true, unread: true });
    expect(judgeUnreadReport(sent({ classnote_read_at: "2026-10-11T00:00:00Z" }), cutoff)).toEqual({ judgeable: true, unread: false });
  });
  it("발송 실패·유예 안 지남·발송 시각 없음은 판정 대상이 아니다", () => {
    expect(judgeUnreadReport(sent({ classnote_status: "failed" }), cutoff).judgeable).toBe(false);
    expect(judgeUnreadReport(sent({ classnote_sent_at: "2026-10-14T20:00:00+00:00" }), cutoff).judgeable).toBe(false);
    expect(judgeUnreadReport(sent({ classnote_sent_at: null }), cutoff).judgeable).toBe(false);
  });
  it("🔴 매칭 키 없는 옛 이관분(edutrix_import)은 '안 읽음'이 아니다 — PostgREST 절과 같은 셋", () => {
    expect(judgeUnreadReport(sent({ source: "edutrix_import" }), cutoff).judgeable).toBe(false);
    expect(judgeUnreadReport(sent({ source: "edutrix_import", edutrix_share_token: "t" }), cutoff).judgeable).toBe(true);
    expect(judgeUnreadReport(sent({ source: "aywa" }), cutoff).judgeable).toBe(true);
    // 절이 바뀌면 함수도 바꿀 것 — 두 벌이 갈리면 목록과 운영실 숫자가 조용히 다르다.
    expect(UNREAD_MATCHABLE_OR).toBe("edutrix_share_token.not.is.null,source.is.null,source.neq.edutrix_import");
    expect(SENT_STATUS_SUCCESS).toBe("success");
  });
  it("시각은 모양이 달라도 시각으로 비교한다(+00:00 · Z)", () => {
    expect(judgeUnreadReport(sent({ classnote_sent_at: "2026-10-13T02:59:00Z" }), cutoff).judgeable).toBe(true);
    expect(judgeUnreadReport(sent({ classnote_sent_at: "2026-10-13T11:59:00+09:00" }), cutoff).judgeable).toBe(true);
    expect(judgeUnreadReport(sent({ classnote_sent_at: "2026-10-13T12:01:00+09:00" }), cutoff).judgeable).toBe(false);
  });
});

describe("출결 미입력 — 운영실 '어제 출결 미입력' 신호와 같은 판정", () => {
  const e = (student_id: string, over: Partial<UnrecordedEnrollment> = {}): UnrecordedEnrollment => ({ student_id, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null, ...over });
  it("명단 중 한 명이라도 기록이 없으면 미입력", () => {
    expect(judgeClassAttendanceDay({ enrollments: [e("a"), e("b")], recorded: new Set(["a"]), date: "2026-10-14", dayKey: "tue" })).toEqual({ expected: 2, unrecorded: true });
    expect(judgeClassAttendanceDay({ enrollments: [e("a"), e("b")], recorded: new Set(["a", "b"]), date: "2026-10-14", dayKey: "tue" })).toEqual({ expected: 2, unrecorded: false });
  });
  it("휴원·끝난 수강·그날 안 오는 요일·시작일 없는 수강·빼는 학생은 명단에 없다", () => {
    const rows = [e("hold", { on_hold: true }), e("ended", { end_date: "2026-10-01" }), e("mon", { attendance_days: ["mon"] }), e("nostart", { start_date: null }), e("test")];
    expect(judgeClassAttendanceDay({ enrollments: rows, recorded: new Set(), date: "2026-10-14", dayKey: "tue", excluded: new Set(["test"]) })).toEqual({ expected: 0, unrecorded: false });
  });
});

describe("열(강사 × 과목) 배분", () => {
  const classes: WorkClass[] = [
    { id: "c1", name: "중2A", teacherId: "t1", teacherName: "가", subject: "math", reportSource: "lesson" },
    { id: "c2", name: "중2B", teacherId: "t1", teacherName: "가", subject: "math", reportSource: "lesson" },
    { id: "e1", name: "E1", teacherId: "t1", teacherName: "가", subject: "english", reportSource: "classnote" },
  ];
  const range = { reportFrom: "2026-10-09", videoFrom: "2026-09-16", to: "2026-10-15" };

  it("오늘 미작성 = 오늘 의무 중 안 쓴 것만 · 지난 날 미작성은 세지 않는다", () => {
    const work = teacherWork(classes, [], [], range, [
      { classId: "c1", studentId: "s1", date: "2026-10-15", written: false, status: null },
      { classId: "c1", studentId: "s2", date: "2026-10-15", written: true, status: "success" },
      { classId: "c2", studentId: "s3", date: "2026-10-14", written: false, status: null },
    ]);
    const math = work.rows.find((r) => r.subject === "math")!;
    expect(math.todayUnwritten).toBe(1);
    expect(math.reportTarget - math.reports).toBe(2);
  });

  it("반의 판정이 그 반 담임 열로 모이고, 원생상담은 강사 단위라 두 과목 열에 같은 값", () => {
    const work = withTeacherWorkExtras(teacherWork(classes, [], [], range, []), {
      unread: [{ classId: "c1", judgeable: true, unread: true }, { classId: "c2", judgeable: true, unread: false }, { classId: "c1", judgeable: false, unread: false }],
      attendance: [
        { classId: "c1", teacherId: "t1", subject: "math", unrecorded: true },
        { classId: "e1", teacherId: "t1", subject: "english", unrecorded: false },
        // 보고서 미발송 반(표의 열에 없는 반) — 같은 담임·과목 열에 붙는다(운영실 신호와 같은 반 범위).
        { classId: "optout", teacherId: "t1", subject: "math", unrecorded: true },
        // 열이 아예 없는 담임의 반은 놓을 자리가 없다.
        { classId: "gone", teacherId: "t9", subject: "math", unrecorded: true },
      ],
      counsel: new Map([["t1", 42.5]]),
      attendanceFrom: "2026-10-08", attendanceTo: "2026-10-14", unreadFrom: "2026-09-16", counselAsOf: "2026-10-14", counselMonth: "2026-10",
      deliveryShown: true, counselShown: true,
    });
    const math = work.rows.find((r) => r.subject === "math")!;
    const english = work.rows.find((r) => r.subject === "english")!;
    expect([math.unread, math.unreadJudged]).toEqual([1, 2]);
    expect([math.attendanceUnrecorded, math.attendanceDays]).toEqual([2, 2]);
    expect([english.attendanceUnrecorded, english.attendanceDays]).toEqual([0, 1]);
    expect([math.counselRate, english.counselRate]).toEqual([42.5, 42.5]);
    expect([work.counselAsOf, work.counselMonth]).toEqual(["2026-10-14", "2026-10"]);
    expect([work.deliveryShown, work.counselShown]).toEqual([true, true]);
  });

  it("🔴 직원 평가가 꺼진 지점(counselShown false)엔 저장값이 남아 있어도 원생상담을 싣지 않는다", () => {
    const work = withTeacherWorkExtras(teacherWork(classes, [], [], range, []), {
      unread: [], attendance: [], counsel: new Map([["t1", 42.5]]), attendanceFrom: "", attendanceTo: "", unreadFrom: "", counselAsOf: "2026-10-14", counselMonth: "2026-10",
      deliveryShown: false, counselShown: false,
    });
    expect(work.rows.every((r) => r.counselRate === null)).toBe(true);
    expect([work.counselAsOf, work.counselMonth, work.deliveryShown, work.counselShown]).toEqual([null, null, false, false]);
  });

  it("회수한 보고서는 '안 나간 것'이 아니다 — recalled로 따로 센다", () => {
    const work = teacherWork(classes, [], [], range, [
      { classId: "c1", studentId: "s1", date: "2026-10-14", written: true, status: "recalled" },
      { classId: "c1", studentId: "s2", date: "2026-10-14", written: true, status: null },
      { classId: "c1", studentId: "s3", date: "2026-10-14", written: true, status: "failed" },
    ]);
    const math = work.rows.find((r) => r.subject === "math")!;
    expect([math.reports, math.sent, math.recalled, math.failed, math.pending]).toEqual([3, 0, 1, 1, 1]);
    expect(math.reports - math.sent - math.recalled).toBe(2);
  });

  it("담임이 없는 열·저장값이 없는 강사는 원생상담 '—'(null)", () => {
    const work = withTeacherWorkExtras(teacherWork([{ ...classes[0], teacherId: null, teacherName: "담당 미지정" }], [], [], range, []), {
      unread: [], attendance: [], counsel: new Map([["t1", 10]]), attendanceFrom: "", attendanceTo: "", unreadFrom: "", counselAsOf: null, counselMonth: null,
      deliveryShown: true, counselShown: true,
    });
    expect(work.rows[0].counselRate).toBeNull();
  });
});

describe("원생상담 달 — 1일엔 이번 달 줄이 없어 지난달 값을 그 달 이름으로", () => {
  const row = (teacher_id: string, month: string, counsel: number | null) => ({ teacher_id, month, counsel });
  it("이번 달 줄이 하나라도 있으면 이번 달만 쓴다(강사마다 달을 섞지 않는다)", () => {
    const picked = pickCounselMonth([row("t1", "2026-10", 12), row("t1", "2026-09", 80), row("t2", "2026-09", 70)], "2026-10");
    expect(picked.month).toBe("2026-10");
    expect(picked.rows.map((r) => r.teacher_id)).toEqual(["t1"]);
  });
  it("이번 달 줄이 없으면(1일) 지난달 줄 · 둘 다 없으면 null", () => {
    const picked = pickCounselMonth([row("t1", "2026-09", 80), row("t2", "2026-09", 70)], "2026-10");
    expect([picked.month, picked.rows.length]).toEqual(["2026-09", 2]);
    expect(pickCounselMonth([], "2026-10")).toEqual({ month: null, rows: [] });
  });
  it("🔴 다음 달 줄(시계가 어긋난 저장)은 지난달로 고르지 않는다", () => {
    expect(pickCounselMonth([row("t1", "2026-11", 5)], "2026-10")).toEqual({ month: null, rows: [] });
  });
  it("기간 이름 = 이번 달이면 '이번 달', 아니면 그 달 · 해가 바뀌어도 달 숫자", () => {
    expect(counselPeriodLabel("2026-10", "2026-10-15")).toBe("이번 달");
    expect(counselPeriodLabel("2026-09", "2026-10-01")).toBe("9월");
    expect(counselPeriodLabel("2026-12", "2027-01-01")).toBe("12월");
    expect(counselPeriodLabel(null, "2026-10-01")).toBe("이번 달");
  });
  it("지난달 값이 열에 실리고 그 달이 함께 간다", () => {
    const classes: WorkClass[] = [{ id: "c1", name: "중2A", teacherId: "t1", teacherName: "가", subject: "math", reportSource: "lesson" }];
    const picked = pickCounselMonth([row("t1", "2026-09", 64)], "2026-10");
    const work = withTeacherWorkExtras(teacherWork(classes, [], [], { reportFrom: "2026-09-25", videoFrom: "2026-09-02", to: "2026-10-01" }, []), {
      unread: [], attendance: [], counsel: new Map(picked.rows.map((r) => [r.teacher_id, r.counsel] as const)),
      attendanceFrom: "", attendanceTo: "", unreadFrom: "", counselAsOf: "2026-09-30", counselMonth: picked.month,
      deliveryShown: true, counselShown: true,
    });
    expect([work.rows[0].counselRate, work.counselMonth, counselPeriodLabel(work.counselMonth, work.to)]).toEqual([64, "2026-09", "9월"]);
  });
});
