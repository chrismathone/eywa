import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  seedsOnColdStart,
  buildEnrollmentFollowupEvents,
  enrollmentFollowupBody,
  enrollmentFollowupTitle,
  absenceDigestBody,
  absenceTier,
  buildAbsenceEvents,
  buildFollowupEvents,
  buildGradeDropEvents,
  buildOutstandingEvents,
  buildProgressAnomalyEvents,
  groupProgressAnomalyByStudent,
  progressAnomalyLink,
  progressAnomalyStudentBody,
  buildUnsentReportEvents,
  unsentReportDigestBody,
  UNSENT_REPORT_WINDOW_DAYS,
  outstandingDigestBody,
  outstandingTier,
  followupBody,
  gradeDropDigestBody,
  groupEventsByTeacher,
  NOTIFICATION_EVENTS_RETENTION_DAYS,
  pruneCutoffs,
  READ_NOTIFICATIONS_RETENTION_DAYS,
  summarizeNames,
  weekKey,
  type AbsenceEvent,
  type GradeRow,
} from "./events-core";

describe("absenceTier", () => {
  it("마일스톤 미달·경계·상위 tier", () => {
    expect(absenceTier(2)).toBe(null);
    expect(absenceTier(3)).toBe(3);
    expect(absenceTier(4)).toBe(3); // 3→4는 같은 tier(재알림 없음)
    expect(absenceTier(5)).toBe(5);
    expect(absenceTier(9)).toBe(5);
    expect(absenceTier(10)).toBe(10);
    expect(absenceTier(99)).toBe(10);
  });
});

describe("buildAbsenceEvents", () => {
  it("tier 도달자만 이벤트로, bucket=tier 문자열", () => {
    const events = buildAbsenceEvents([
      { studentId: "s1", studentName: "김보민", absences: 3 },
      { studentId: "s2", studentName: "박지율", absences: 4 }, // tier 3
      { studentId: "s3", studentName: "정호", absences: 5 }, // tier 5
      { studentId: "s4", studentName: "이유", absences: 2 }, // 미달 제외
    ]);
    expect(events).toEqual([
      { subjectKey: "s1", bucket: "3", studentName: "김보민", absences: 3, tier: 3 },
      { subjectKey: "s2", bucket: "3", studentName: "박지율", absences: 4, tier: 3 },
      { subjectKey: "s3", bucket: "5", studentName: "정호", absences: 5, tier: 5 },
    ]);
  });

  it("같은 학생이 tier를 넘으면 다른 bucket(승격 시에만 새 이벤트)", () => {
    expect(buildAbsenceEvents([{ studentId: "s1", studentName: "A", absences: 4 }])[0].bucket).toBe("3");
    expect(buildAbsenceEvents([{ studentId: "s1", studentName: "A", absences: 6 }])[0].bucket).toBe("5");
  });
});

describe("weekKey", () => {
  it("같은 주(월~일)는 같은 키(그 주 월요일), 다음 주는 다른 키", () => {
    // 2026-07-17=금 → 그 주 월요일 2026-07-13
    expect(weekKey("2026-07-17")).toBe("2026-07-13");
    expect(weekKey("2026-07-13")).toBe("2026-07-13"); // 월
    expect(weekKey("2026-07-19")).toBe("2026-07-13"); // 일
    expect(weekKey("2026-07-20")).toBe("2026-07-20"); // 다음 주 월
  });
});

describe("buildFollowupEvents", () => {
  const WK = "2026-07-13";
  it("today=due, overdue=overdue만 이벤트(soon/later/done 제외), overdue엔 주 성분", () => {
    const events = buildFollowupEvents(
      [
        { consultationId: "c1", studentName: "김", followUpDate: "2026-07-17", counselorId: "u1", urgency: "today" },
        { consultationId: "c2", studentName: "이", followUpDate: "2026-07-10", counselorId: null, urgency: "overdue" },
        { consultationId: "c3", studentName: "박", followUpDate: "2026-07-19", counselorId: "u2", urgency: "soon" },
        { consultationId: "c4", studentName: "최", followUpDate: "2026-07-30", counselorId: "u3", urgency: "later" },
      ],
      WK,
    );
    expect(events).toEqual([
      { subjectKey: "c1", bucket: "2026-07-17:due", studentName: "김", followUpDate: "2026-07-17", stage: "due", counselorId: "u1" },
      { subjectKey: "c2", bucket: "2026-07-10:overdue:2026-07-13", studentName: "이", followUpDate: "2026-07-10", stage: "overdue", counselorId: null },
    ]);
  });

  it("due는 1회(주 무관), overdue는 주가 바뀌면 새 bucket(주간 재알림)", () => {
    const c = { consultationId: "c1", studentName: "김", followUpDate: "2026-07-10", counselorId: "u1" };
    // due는 주 성분 없음 → 같은 bucket
    expect(buildFollowupEvents([{ ...c, followUpDate: "2026-07-17", urgency: "today" }], "2026-07-13")[0].bucket).toBe("2026-07-17:due");
    expect(buildFollowupEvents([{ ...c, followUpDate: "2026-07-17", urgency: "today" }], "2026-07-20")[0].bucket).toBe("2026-07-17:due");
    // overdue는 주마다 새 bucket → 매주 1회 재촉
    expect(buildFollowupEvents([{ ...c, urgency: "overdue" }], "2026-07-13")[0].bucket).toBe("2026-07-10:overdue:2026-07-13");
    expect(buildFollowupEvents([{ ...c, urgency: "overdue" }], "2026-07-20")[0].bucket).toBe("2026-07-10:overdue:2026-07-20");
  });
});

describe("buildGradeDropEvents (성적 급락)", () => {
  const g = (
    studentId: string,
    name: string,
    subject: string,
    gradeId: string,
    takenOn: string,
    pct: number | null,
  ): GradeRow => ({ studentId, studentName: name, subject, subjectLabel: subject === "math" ? "수학" : "영어", gradeId, takenOn, pct });

  it("같은 과목 최신 vs 직전 ≥15점 하락만 이벤트, bucket=과목:최신gradeId", () => {
    const events = buildGradeDropEvents([
      g("s1", "김", "math", "gA", "2026-06-01", 90),
      g("s1", "김", "math", "gB", "2026-07-01", 70), // 20점 하락 → 이벤트
      g("s2", "이", "math", "gC", "2026-06-01", 80),
      g("s2", "이", "math", "gD", "2026-07-01", 72), // 8점 하락 → 임계 미달 제외
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subjectKey: "s1", bucket: "math:gB", studentName: "김", drop: 20, latestPct: 70 });
  });

  it("과목이 다르면 섞어 비교하지 않는다(수학↓·영어는 별개)", () => {
    const events = buildGradeDropEvents([
      g("s1", "김", "math", "gA", "2026-06-01", 90),
      g("s1", "김", "english", "gB", "2026-07-01", 60), // 다른 과목 — math 90과 비교 안 함
    ]);
    expect(events).toEqual([]); // 각 과목 1건씩뿐이라 비교 불가
  });

  it("직전 점수 없으면(과목 1건) 제외, 상승은 제외, pct null 제외", () => {
    expect(buildGradeDropEvents([g("s1", "김", "math", "gA", "2026-07-01", 50)])).toEqual([]);
    expect(
      buildGradeDropEvents([
        g("s1", "김", "math", "gA", "2026-06-01", 60),
        g("s1", "김", "math", "gB", "2026-07-01", 85), // 상승
      ]),
    ).toEqual([]);
    expect(
      buildGradeDropEvents([
        g("s1", "김", "math", "gA", "2026-06-01", 90),
        g("s1", "김", "math", "gB", "2026-07-01", null), // 계산 불가
      ]),
    ).toEqual([]);
  });

  it("본문 — 1명 과목·하락폭, 여러명 집계", () => {
    expect(gradeDropDigestBody([])).toBe(null);
    const one = gradeDropDigestBody([{ subjectKey: "s1", bucket: "b", studentName: "김보민", subjectLabel: "수학", drop: 18, latestPct: 62 }]);
    expect(one).toContain("김보민 학생 수학 성적이 18점 하락");
    expect(one).toContain("현재 62점");
  });
});

describe("buildOutstandingEvents (미수 임계)", () => {
  it("tier 도달자만, bucket=tier 문자열", () => {
    const events = buildOutstandingEvents([
      { studentId: "s1", studentName: "김", amount: 250_000 }, // 미달 제외
      { studentId: "s2", studentName: "이", amount: 300_000 }, // tier 300k
      { studentId: "s3", studentName: "박", amount: 620_000 }, // tier 500k
      { studentId: "s4", studentName: "최", amount: 1_500_000 }, // tier 1M
    ]);
    expect(events).toEqual([
      { subjectKey: "s2", bucket: "300000", studentName: "이", amount: 300_000, tier: 300_000 },
      { subjectKey: "s3", bucket: "500000", studentName: "박", amount: 620_000, tier: 500_000 },
      { subjectKey: "s4", bucket: "1000000", studentName: "최", amount: 1_500_000, tier: 1_000_000 },
    ]);
  });

  it("outstandingTier 경계", () => {
    expect(outstandingTier(299_999)).toBe(null);
    expect(outstandingTier(300_000)).toBe(300_000);
    expect(outstandingTier(499_999)).toBe(300_000);
    expect(outstandingTier(1_000_000)).toBe(1_000_000);
  });

  it("본문 — 1명은 만원 압축 금액, 여러명은 집계", () => {
    expect(outstandingDigestBody([])).toBe(null);
    expect(
      outstandingDigestBody([{ subjectKey: "s1", bucket: "500000", studentName: "이유하", amount: 620_000, tier: 500_000 }]),
    ).toBe("이유하 학생의 미수금이 62만원에 이릅니다.");
    const many = outstandingDigestBody([
      { subjectKey: "s1", bucket: "300000", studentName: "김", amount: 300_000, tier: 300_000 },
      { subjectKey: "s2", bucket: "1000000", studentName: "이", amount: 1_200_000, tier: 1_000_000 },
    ]);
    expect(many).toContain("김·이");
    expect(many).toContain("100만원 이상");
  });

  // 🔴 회귀 잠금 — 2026-07-20에 "권하윤·장윤진·허다빈 외 256명의 미수금이 100만원 이상입니다"가
  // 실제로 발송됐고 259명 중 244명(94%)은 100만원 미만이었다. 명단 전원에게 **참인 문장**만 쓴다.
  it("여러명 — 최고 tier를 전원에게 단정하지 않는다(하한을 말하고 상위는 건수로)", () => {
    const body = outstandingDigestBody([
      { subjectKey: "s1", bucket: "300000", studentName: "김", amount: 310_000, tier: 300_000 },
      { subjectKey: "s2", bucket: "300000", studentName: "박", amount: 320_000, tier: 300_000 },
      { subjectKey: "s3", bucket: "1000000", studentName: "이", amount: 1_200_000, tier: 1_000_000 },
    ]);
    // 주 문장의 기준은 **최저** tier여야 한다(전원에게 참).
    expect(body).toContain("3명의 미수금이 30만원 이상입니다.");
    // 상위 구간은 "몇 명인지"까지 밝힌다 — 전원 단정 금지.
    expect(body).toContain("(100만원 이상 1명)");
    expect(body).not.toMatch(/^[^(]*100만원 이상입니다/);
  });

  it("여러명 — tier가 모두 같으면 괄호 보충을 붙이지 않는다", () => {
    const body = outstandingDigestBody([
      { subjectKey: "s1", bucket: "300000", studentName: "김", amount: 310_000, tier: 300_000 },
      { subjectKey: "s2", bucket: "300000", studentName: "박", amount: 320_000, tier: 300_000 },
    ]);
    expect(body).toBe("김·박 2명의 미수금이 30만원 이상입니다.");
  });
});

describe("groupEventsByTeacher (v2 제네릭)", () => {
  const ev = (studentId: string, name: string, tier: number): AbsenceEvent => ({
    subjectKey: studentId,
    bucket: String(tier),
    studentName: name,
    absences: tier,
    tier,
  });

  it("강사는 자기 학생 이벤트만, 다중 반 학생은 여러 강사에게", () => {
    const events = [ev("s1", "김보민", 3), ev("s2", "박지율", 5), ev("s3", "정호", 3)];
    const map = new Map<string, string[]>([
      ["s1", ["t1"]], // 김보민 → 강사 t1
      ["s2", ["t1", "t2"]], // 박지율 → t1·t2 두 반
      ["s3", ["t2"]], // 정호 → t2
    ]);
    const byTeacher = groupEventsByTeacher(events, map);
    expect(byTeacher.get("t1")?.map((e) => e.studentName)).toEqual(["김보민", "박지율"]);
    expect(byTeacher.get("t2")?.map((e) => e.studentName)).toEqual(["박지율", "정호"]);
  });

  it("담당 강사 없는 학생은 아무에게도 안 감(맵에 없으면 스킵)", () => {
    const byTeacher = groupEventsByTeacher([ev("s9", "무담당", 3)], new Map());
    expect(byTeacher.size).toBe(0);
  });
});

describe("본문 문구", () => {
  it("결석 집계 — 1명/여러명", () => {
    expect(absenceDigestBody([])).toBe(null);
    expect(absenceDigestBody([{ subjectKey: "s1", bucket: "3", studentName: "김보민", absences: 3, tier: 3 }])).toContain(
      "김보민 학생 · 최근 14일 결석 3회",
    );
    const many = absenceDigestBody([
      { subjectKey: "s1", bucket: "3", studentName: "김보민", absences: 3, tier: 3 },
      { subjectKey: "s2", bucket: "5", studentName: "박지율", absences: 5, tier: 5 },
    ]);
    expect(many).toContain("김보민·박지율");
    expect(many).toContain("5회 이상");
  });

  it("후속조치 — due는 '오늘 마감 예정', overdue는 '기한 지남'", () => {
    expect(followupBody({ subjectKey: "c1", bucket: "b", studentName: "김", followUpDate: "2026-07-17", stage: "due", counselorId: null })).toContain("오늘(2026-07-17) 마감 예정");
    expect(followupBody({ subjectKey: "c1", bucket: "b", studentName: "김", followUpDate: "2026-07-10", stage: "overdue", counselorId: null })).toContain("기한(2026-07-10)을 지났습니다");
  });
});

describe("summarizeNames", () => {
  it("max 초과분은 '외 N명'", () => {
    expect(summarizeNames(["a", "b", "c", "d", "e"])).toBe("a·b·c 외 2명");
    expect(summarizeNames(["a", "b"])).toBe("a·b");
  });
});

describe("미발송 보고서 이벤트", () => {
  const row = (reportId: string, studentId: string, studentName: string, reportDate: string) => ({
    reportId,
    studentId,
    studentName,
    subjectLabel: "수학",
    reportDate,
  });

  it("보고서당 1건 — subjectKey=보고서 id, bucket 고정('unsent')", () => {
    const events = buildUnsentReportEvents([row("r1", "s1", "김민준", "2026-07-15")]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subjectKey: "r1", bucket: "unsent", studentId: "s1" });
  });

  it("날짜 오름차순(오래된 것 먼저) — 동일 날짜는 id로 안정 정렬", () => {
    const events = buildUnsentReportEvents([
      row("r2", "s2", "이서연", "2026-07-16"),
      row("r1", "s1", "김민준", "2026-07-14"),
      row("r3", "s3", "박지호", "2026-07-14"),
    ]);
    expect(events.map((e) => e.subjectKey)).toEqual(["r1", "r3", "r2"]);
  });

  it("⚠️ subjectKey는 학생이 아니라 보고서 — 담당 강사 그룹핑은 studentIdOf 추출자 필수", () => {
    const events = buildUnsentReportEvents([row("r1", "s1", "김민준", "2026-07-15")]);
    const teachers = new Map([["s1", ["t1"]]]);
    // 추출자 없이 부르면(기본=subjectKey=보고서 id) 무매치 → 강사 0명(회귀 방지용 명시 검증)
    expect(groupEventsByTeacher(events, teachers).size).toBe(0);
    const grouped = groupEventsByTeacher(events, teachers, (e) => e.studentId);
    expect([...grouped.keys()]).toEqual(["t1"]);
    expect(grouped.get("t1")).toHaveLength(1);
  });

  it("본문 — 1건은 학생·날짜·과목, 여러 건은 이름 집계 + 건수(학생 중복 제거)", () => {
    const one = unsentReportDigestBody(buildUnsentReportEvents([row("r1", "s1", "김민준", "2026-07-15")]));
    expect(one).toContain("김민준");
    expect(one).toContain("2026-07-15");
    expect(one).toContain("수학");

    const many = unsentReportDigestBody(
      buildUnsentReportEvents([
        row("r1", "s1", "김민준", "2026-07-14"),
        row("r2", "s1", "김민준", "2026-07-15"), // 같은 학생 2건 → 이름은 1번만
        row("r3", "s2", "이서연", "2026-07-16"),
      ]),
    );
    expect(many).toContain("김민준·이서연");
    expect(many).toContain("3건");
    expect(many).toContain("2026-07-14"); // 가장 오래된 건 기준
    expect(many).not.toContain("김민준·김민준");
  });

  it("빈 배열은 null(발송 스킵)", () => {
    expect(unsentReportDigestBody([])).toBeNull();
    expect(buildUnsentReportEvents([])).toEqual([]);
  });

  it("재촉 창 상수 고정(회귀 방지)", () => {
    expect(UNSENT_REPORT_WINDOW_DAYS).toBe(7);
  });
});

describe("pruneCutoffs (정리 정책)", () => {
  const now = Date.parse("2026-07-17T00:00:00Z");
  it("이벤트=180일 전, 읽은 알림=90일 전 컷오프(이벤트가 더 오래 보존)", () => {
    const { eventsBefore, readNotificationsBefore } = pruneCutoffs(now);
    expect(eventsBefore).toBe("2026-01-18T00:00:00.000Z");
    expect(readNotificationsBefore).toBe("2026-04-18T00:00:00.000Z");
    expect(Date.parse(eventsBefore)).toBeLessThan(Date.parse(readNotificationsBefore));
  });
  it("상수 값 고정(회귀 방지)", () => {
    expect(NOTIFICATION_EVENTS_RETENTION_DAYS).toBe(180);
    expect(READ_NOTIFICATIONS_RETENTION_DAYS).toBe(90);
  });
});

describe("buildProgressAnomalyEvents / 학생별 진도 이상 알림 (G2)", () => {
  const row = (p: Partial<import("./events-core").ProgressAnomalyRow>) => ({
    studentId: "s1",
    studentName: "김민수",
    eventId: "e1",
    eventType: "jump_error",
    ...p,
  });
  it("bucket = pe:{eventId} — 이벤트 1건=전이 1회(앵커일 아님)", () => {
    const [ev] = buildProgressAnomalyEvents([row({})]);
    expect(ev).toMatchObject({ subjectKey: "s1", studentId: "s1", bucket: "pe:e1", label: "진도 점프" });
  });
  it("overlap_error 라벨 = 선행·현행 겹침(진도 탭과 동일 표현)", () => {
    const [ev] = buildProgressAnomalyEvents([row({ eventType: "overlap_error", eventId: "e2" })]);
    expect(ev.bucket).toBe("pe:e2");
    expect(ev.label).toBe("선행·현행 겹침");
  });
  it("regression 등 미대상 유형은 제외(이중 방어 — 쿼리 필터와 짝)", () => {
    expect(buildProgressAnomalyEvents([row({ eventType: "regression" })])).toEqual([]);
    expect(buildProgressAnomalyEvents([row({ eventType: "forward" })])).toEqual([]);
  });
  it("학생별로 쪼갠다 — 알림 link가 1개뿐이라 묶으면 '어디서 확인'을 표현 못 함", () => {
    const groups = groupProgressAnomalyByStudent(
      buildProgressAnomalyEvents([
        row({}),
        row({ eventId: "e2", eventType: "overlap_error" }),
        row({ studentId: "s2", studentName: "이서연", eventId: "e3" }),
      ]),
    );
    expect(groups.map((g) => g.studentId)).toEqual(["s1", "s2"]); // 입력 순 유지(같은 배치=같은 순서)
    expect(groups[0].events).toHaveLength(2); // 한 학생의 여러 이벤트는 한 건으로
    expect(groups[1].events).toHaveLength(1);
    expect(groupProgressAnomalyByStudent([])).toEqual([]);
  });
  it("본문 — '수학' 명시(타과목 오인 방지) + 유형은 괄호로(조사 '진도 점프이(가)' 어색함 회피)", () => {
    const one = progressAnomalyStudentBody("김민수", buildProgressAnomalyEvents([row({})]));
    expect(one).toContain("김민수");
    expect(one).toContain("수학");
    expect(one).toContain("(진도 점프)");
    expect(one).not.toContain("이(가)");
    expect(progressAnomalyStudentBody("김민수", [])).toBeNull();
  });
  it("본문 — 같은 학생의 유형이 여러 개면 중복 없이 나열", () => {
    const body = progressAnomalyStudentBody(
      "김민수",
      buildProgressAnomalyEvents([row({}), row({ eventId: "e2" }), row({ eventId: "e3", eventType: "overlap_error" })]),
    );
    expect(body).toContain("(진도 점프, 선행·현행 겹침)");
  });
  it("링크 = 학생 상세 진도 탭(이상 감지가 실제로 보이는 화면)", () => {
    expect(progressAnomalyLink("s1")).toBe("/students/s1?tab=progress");
  });
});

describe("신규 콜&상담 후속 조치 알림(원장 2026-10-22)", () => {
  const row = (followUpDate: string) => ({ consultationId: "c1", prospectName: "김가나", followUpDate, consultantId: "u1", content: null });
  it("하루 전 · 당일 · 지나면(주 단위 재촉) — 그 뒤 날짜는 아직", () => {
    const today = "2026-10-22";
    const events = buildEnrollmentFollowupEvents([row("2026-10-23"), row("2026-10-22"), row("2026-10-20"), row("2026-10-24")], today, "2026-10-19");
    expect(events.map((e) => [e.stage, e.bucket])).toEqual([
      ["soon", "2026-10-23:soon"],
      ["due", "2026-10-22:due"],
      ["overdue", "2026-10-20:overdue:2026-10-19"],
    ]);
  });
  it("본문은 날짜를 'M월 D일'로 · 메모는 앞 40자", () => {
    const [soon] = buildEnrollmentFollowupEvents([{ ...row("2026-10-23"), content: "가".repeat(45) }], "2026-10-22", "2026-10-19");
    expect(enrollmentFollowupTitle("soon")).toBe("내일 콜&상담 후속 조치");
    expect(enrollmentFollowupBody(soon!)).toBe(`김가나 다음 상담이 내일(10월 23일)입니다 · 메모: ${"가".repeat(40)}…`);
    const [late] = buildEnrollmentFollowupEvents([row("2026-10-01")], "2026-10-22", "2026-10-19");
    expect(enrollmentFollowupBody(late!)).toContain("지났습니다");
  });
});

describe("콜드스타트 시드 — 신규 콜&상담 후속 조치만 첫 알림도 보낸다(2026-10-23)", () => {
  it("다른 알림 종류는 종전대로 첫 실행을 시드로만 남긴다", () => {
    for (const type of ["absence_alert", "followup_due", "grade_drop", "outstanding_alert", "unsent_report", "progress_anomaly", "send_deadline"]) {
      expect(seedsOnColdStart(type)).toBe(true);
    }
  });
  it("신규 콜&상담 후속 조치는 시드하지 않는다 — 빈 실행이 기록을 안 남겨 첫 실제 다음 상담 알림이 빠지던 구멍", () => {
    expect(seedsOnColdStart("enrollment_followup")).toBe(false);
  });
  it("감지 쪽이 이 정책을 지난다 — 콜드스타트 판정 한 곳(isColdStart)이 먼저 묻는다", () => {
    const src = readFileSync("src/features/notifications/server/events.ts", "utf8");
    const body = src.slice(src.indexOf("async function isColdStart("));
    expect(body.slice(0, 300)).toContain("if (!seedsOnColdStart(eventType)) return false;");
    expect(src).toContain('const cold = await isColdStart(admin, tenantId, "enrollment_followup");');
  });
});
