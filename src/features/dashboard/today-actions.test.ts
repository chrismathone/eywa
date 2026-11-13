import { describe, expect, it } from "vitest";
import {
  buildTodayActions,
  enrollmentAttendsOnDay,
  findMissingLessonReportPairs,
  absentClassKeysOf,
  judgeTodayLessonReports,
  isEnrollmentActiveOn,
  nameList,
  subjectBreakdownText,
  type TodayActionsRaw,
} from "./today-actions";

const EMPTY: TodayActionsRaw = {
  absentToday: [],
  unrecordedYesterday: [],
  yesterday: "2026-07-01",
  date: "2026-07-02",
  failedAnalysis: { meetings: 0, enrollment: 0, consultations: 0 },
  makeeduIssue: null,
  requestedTextbooks: 0,
  leavesPending: 0,
  leavesToday: [],
  unwrittenReportsToday: { count: 0, names: [], bySubject: [] },
  unassignedEnrolled: [],
  unassignedEnrolledTotal: 0,
  classnoteAttention: { failed: 0, tooOld: 0, humanHold: 0, stuck: 0 },
  unrecordedToday: [],
  dayArrivals: { starting: [], ending: [] },
  newIntakeToday: { count: 0, names: [] },
  newcomerOverdue: { count: 0, names: [] },
  scheduledTomorrow: null,
};

describe("오늘 사람 변동·접수·내일 예약 (운영실 검토 2026-09-09)", () => {
  it("사전 통보 결석은 숫자를 깎지 않고 note로만 가른다", () => {
    const items = buildTodayActions({
      ...EMPTY,
      absentToday: [
        { studentId: "s1", name: "김하늘", subject: "math", preNotified: false },
        { studentId: "s2", name: "박서준", subject: "math", preNotified: true },
      ],
    });
    const absent = items.find((item) => item.key === "absent");
    expect(absent?.count).toBe(2); // 🔴 깎지 않는다
    expect(absent?.note).toBe("연락 필요 1 · 사전 통보 1");
    // 미리보기는 연락해야 할 학생부터.
    expect(absent?.detail).toBe("김하늘");
  });

  it("전부 사전 통보면 '연락 필요 0'이라고 말한다(연락할 사람이 없다는 사실이 곧 정보다)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      absentToday: [{ studentId: "s1", name: "김하늘", subject: "math", preNotified: true }],
    });
    const absent = items.find((item) => item.key === "absent");
    expect(absent?.count).toBe(1);
    expect(absent?.note).toBe("연락 필요 0 · 사전 통보 1");
    // 연락 대상이 없으면 미리보기는 결석자 전체에서 뽑는다(빈 이름 금지).
    expect(absent?.detail).toBe("김하늘");
  });

  it("전부 무통보면 note를 달지 않는다(숫자만으로 전원이 연락 대상)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      absentToday: [{ studentId: "s1", name: "김하늘", subject: "math", preNotified: false }],
    });
    expect(items.find((item) => item.key === "absent")?.note).toBeNull();
  });

  it("오늘 첫 수업·마지막 수업은 학생 단위 항목이고 라벨에 '퇴원'을 쓰지 않는다", () => {
    const items = buildTodayActions({
      ...EMPTY,
      dayArrivals: {
        starting: [
          { studentId: "s1", name: "김하늘", kind: "first" },
          { studentId: "s4", name: "최민준", kind: "newSubject" },
        ],
        ending: [
          { studentId: "s2", name: "박서준" },
          { studentId: "s3", name: "이서연" },
        ],
      },
    });
    const start = items.find((item) => item.key === "arrivals-start");
    const end = items.find((item) => item.key === "arrivals-end");
    expect(start?.label).toBe("오늘 첫 수업");
    // 첫 수업 = 첫 등원 + 새 과목 — 운영실 KPI '오늘첫수업'·목록(first=)과 같은 숫자.
    expect(start?.count).toBe(2);
    expect(start?.note).toBe("첫 등원 1 · 처음 듣는 과목 1");
    // 기준일의 첫 수업 목록(운영실 KPI '오늘첫수업' ↗와 같은 목적지)
    expect(start?.href).toBe(
      "/students?first=2026-07-02&status=all&subject=all&grade=all&teacher=all&noenr=0&from=dashboard",
    );
    expect(end?.label).toBe("오늘 마지막 수업");
    expect(end?.label).not.toContain("퇴원");
    expect(end?.count).toBe(2);
    expect(end?.href).toBe("/students"); // 여럿이면 목록으로
  });

  it("첫 수업이 전부 첫 등원이면 note를 달지 않는다(갈라 적을 것이 없다)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      dayArrivals: { starting: [{ studentId: "s1", name: "김하늘", kind: "first" }], ending: [] },
    });
    expect(items.find((item) => item.key === "arrivals-start")?.note).toBeNull();
  });

  it("오늘 접수 건수는 미리보기 배열 길이가 아니라 총계를 쓴다", () => {
    const items = buildTodayActions({
      ...EMPTY,
      newIntakeToday: { count: 7, names: ["가", "나", "다"] },
    });
    const intake = items.find((item) => item.key === "intake-today");
    expect(intake?.count).toBe(7);
    expect(intake?.detail).toBe("가·나·다 외 4");
    expect(intake?.href).toBe("/enrollment?view=table&received=2026-07-02");
  });

  it("내일 시간표 예약은 건수 없는 상태 신호이고 갈래를 note로 적는다", () => {
    const items = buildTodayActions({
      ...EMPTY,
      scheduledTomorrow: { date: "2026-09-10", hasStructure: true, hasEnrollment: true },
    });
    const scheduled = items.find((item) => item.key === "scheduled-tomorrow");
    expect(scheduled?.count).toBeNull();
    expect(scheduled?.note).toBe("수업 배치 · 학생 반이동");
    expect(scheduled?.menuKey).toBe("timetable");
  });

  it("오늘 출석 미기록은 기준(종료된 교시)을 note로 밝히고 어제 것과 따로 선다", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unrecordedToday: [
        { classId: "c1", className: "초등M 개별 BS1B", subject: "math" },
        { classId: "c2", className: "LT6", subject: "english" },
      ],
      unrecordedYesterday: [{ classId: "c3", className: "KW3", subject: "english" }],
    });
    const today = items.find((item) => item.key === "unrecorded-today");
    const yesterday = items.find((item) => item.key === "unrecorded");
    expect(today?.label).toBe("오늘 출석 미기록");
    expect(today?.count).toBe(2);
    expect(today?.unit).toBe("개 반");
    // 🔑 헤더의 '처리 중 N/M'과 축이 달라 숫자가 갈릴 수 있다 — 기준을 화면에 적는다.
    expect(today?.note).toBe("종료된 교시 기준");
    expect(today?.href).toBe("/attendance/live");
    // 어제 것은 그대로 남는다(마감이 지난 것과 오늘 재촉은 다른 일).
    expect(yesterday?.label).toBe("어제 출석 미기록");
    expect(yesterday?.count).toBe(1);
  });

  it("오늘 미기록 미리보기는 과목별로 고르게 뽑는다(한 과목만 뜨지 않게, #84)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unrecordedToday: [
        { classId: "c1", className: "가반", subject: "math" },
        { classId: "c2", className: "나반", subject: "math" },
        { classId: "c3", className: "LT6", subject: "english" },
      ],
    });
    const today = items.find((item) => item.key === "unrecorded-today");
    expect(today?.detail).toContain("LT6");
    expect(today?.detail).toContain("외 1");
  });

  it("새 신호가 없으면 항목도 없다(빈 구역 금지)", () => {
    expect(buildTodayActions(EMPTY)).toEqual([]);
  });
});

describe("buildTodayActions", () => {
  it("모든 신호 0이면 빈 배열(패널이 '정상' 표시)", () => {
    expect(buildTodayActions(EMPTY)).toEqual([]);
  });

  it("결석 = danger + 명단 요약 + /attendance 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      absentToday: [
        { studentId: "1", name: "김민준", subject: "math", preNotified: false },
        { studentId: "2", name: "이서연", subject: "math", preNotified: false },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "absent",
      severity: "danger",
      count: 2,
      detail: "김민준·이서연",
      // 기준일의 결석 학생 목록 — 브리핑이면 어제 날짜가 실린다(raw.date).
      href: "/attendance/2026-07-02?status=absent",
      menuKey: "attendance",
    });
  });

  it("반 미배정 재원생 1명 = amber + 그 학생 창으로 직행", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unassignedEnrolled: [{ studentId: "s1", name: "학원이" }],
      unassignedEnrolledTotal: 1,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "unassigned-enrolled",
      severity: "amber",
      label: "반 미배정 재원생",
      count: 1,
      detail: "학원이",
      href: "/students/s1",
      menuKey: "students",
      requiredAccess: "write",
    });
  });

  it("반 미배정 재원생 여럿 = 학생목록 링크 + 명단 요약", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unassignedEnrolled: [
        { studentId: "s1", name: "김민준" },
        { studentId: "s2", name: "이서연" },
      ],
      unassignedEnrolledTotal: 2,
    });
    expect(items[0]).toMatchObject({ count: 2, detail: "김민준·이서연", href: "/students" });
  });

  // 🔴 회귀: 미리보기 배열이 RPC 상한(30)에서 잘려도 건수는 총계여야 한다.
  //    예전엔 배열 길이를 세어 실제 34명이 화면엔 영원히 "30"으로 굳었다(2026-07-31 실측).
  it("반 미배정 재원생 = 잘린 미리보기가 아니라 총계로 센다", () => {
    const preview = Array.from({ length: 30 }, (_, i) => ({ studentId: `s${i}`, name: `학생${i}` }));
    const items = buildTodayActions({ ...EMPTY, unassignedEnrolled: preview, unassignedEnrolledTotal: 34 });
    expect(items[0]).toMatchObject({ count: 34, unit: "명", href: "/students" });
    expect(items[0]!.detail).toBe("학생0·학생1·학생2 외 31");
  });

  // 원장 지시 2026-07-31 — "과목별로 분류해서 보고하는 게 더 스마트".
  describe("과목별 분해", () => {
    const label = (key: string) => ({ math: "수학", english: "영어" })[key] ?? key;

    it("라벨 리졸버가 없으면 분해를 비운다(과목 raw 키 노출 금지)", () => {
      const items = buildTodayActions({
        ...EMPTY,
        absentToday: [{ studentId: "1", name: "김민준", subject: "math", preNotified: false }],
      });
      expect(items[0]!.bySubject).toEqual([]);
    });

    it("결석·미기록·미작성을 설정 라벨로 분해하고 건수 desc로 정렬", () => {
      const items = buildTodayActions(
        {
          ...EMPTY,
          absentToday: [
            { studentId: "1", name: "김민준", subject: "math", preNotified: false },
            { studentId: "2", name: "이서연", subject: "english", preNotified: false },
            { studentId: "3", name: "박지호", subject: "math", preNotified: false },
          ],
          unrecordedYesterday: [
            { classId: "c1", className: "LS2a", subject: "english" },
            { classId: "c2", className: "중등E_중1", subject: "english" },
            { classId: "c3", className: "수학심화", subject: "math" },
          ],
          unwrittenReportsToday: {
            count: 185,
            names: ["이채은"],
            bySubject: [
              { subject: "math", count: 39 },
              { subject: "english", count: 147 },
            ],
          },
        },
        { subjectLabel: label },
      );
      const by = (key: string) => items.find((i) => i.key === key)!.bySubject;
      expect(by("absent")).toEqual([
        { label: "수학", count: 2 },
        { label: "영어", count: 1 },
      ]);
      expect(by("unrecorded")).toEqual([
        { label: "영어", count: 2 },
        { label: "수학", count: 1 },
      ]);
      // 학생×과목 쌍이라 합(186)이 학생 수(185)보다 클 수 있다 — 의도된 차이.
      expect(by("unwritten-reports")).toEqual([
        { label: "영어", count: 147 },
        { label: "수학", count: 39 },
      ]);
      expect(subjectBreakdownText(by("unwritten-reports"))).toBe("영어 147 · 수학 39");
    });

    it("과목 없는 행은 버리지 않고 '과목 미상'으로 묶는다(분해 합이 총계보다 작아지지 않게)", () => {
      const items = buildTodayActions(
        {
          ...EMPTY,
          absentToday: [
            { studentId: "1", name: "김민준", subject: "math", preNotified: false },
            { studentId: "2", name: "이서연", subject: null, preNotified: false },
          ],
        },
        { subjectLabel: label },
      );
      expect(items[0]!.bySubject).toEqual([
        { label: "과목 미상", count: 1 },
        { label: "수학", count: 1 },
      ]);
    });
  });

  it("미작성 보고서 = amber + 명단 요약 + 수업보고서 총괄 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unwrittenReportsToday: { count: 4, names: ["김민준", "이서연", "박지호", "최유진"], bySubject: [] },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "unwritten-reports",
      severity: "amber",
      count: 4,
      detail: "김민준·이서연·박지호 외 1",
      href: "/lesson-reports?tab=writing",
      menuKey: "lesson_reports",
    });
  });

  it("ClassNote 발송 주의 = amber + 합산 count + 한글 구분 note(raw 상태 키 없음)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      classnoteAttention: { failed: 2, tooOld: 1, humanHold: 3, stuck: 1 },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "classnote-attention",
      severity: "amber",
      count: 7,
      note: "발송 실패 2 · 기한 초과 1 · 확인 필요 3 · 멈춤 1",
      href: "/lesson-reports?tab=writing",
      menuKey: "lesson_reports",
      requiredAccess: "read",
    });
    expect(items[0].note).not.toMatch(/blocked_shared|name_conflict|too_old|failed/);
  });

  it("ClassNote 발송 주의는 0인 구분을 note에서 생략", () => {
    const items = buildTodayActions({
      ...EMPTY,
      classnoteAttention: { failed: 0, tooOld: 0, humanHold: 2, stuck: 0 },
    });
    expect(items[0]).toMatchObject({ count: 2, note: "확인 필요 2" });
  });

  it("어제 미기록은 어제 날짜의 일별 페이지로 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unrecordedYesterday: [{ classId: "c1", className: "MS2A", subject: "math" }],
    });
    expect(items[0].href).toBe("/attendance/2026-07-01");
    expect(items[0].severity).toBe("amber");
  });

  it("🔴 회귀 잠금: 어제 미기록 미리보기는 과목별로 고르게 뽑는다", () => {
    // 실데이터 모양 — 신호는 이름순(ICU 한국어)이라 한글 이름 반(수학)이 앞을 독점하고
    // 로마자 코드 반(영어)은 미기록이 아무리 많아도 뒤로 밀린다. 앞 2개를 그냥 자르면
    // 영어 담당자는 자기 반이 걸렸는지 대시보드에서 영영 알 수 없다(gotcha #84).
    const items = buildTodayActions({
      ...EMPTY,
      unrecordedYesterday: [
        { classId: "m1", className: "고등M 고1 BS4A", subject: "math" },
        { classId: "m2", className: "고등M 고2", subject: "math" },
        { classId: "m3", className: "중등M 중3", subject: "math" },
        { classId: "e1", className: "DP5", subject: "english" },
        { classId: "e2", className: "KW1", subject: "english" },
      ],
    });
    // 과목별 1개씩 + "외 N"은 전체(5) 기준.
    expect(items[0]).toMatchObject({ count: 5, detail: "고등M 고1 BS4A·DP5 외 3" });
  });

  it("어제 미기록이 한 과목뿐이면 그 과목에서 앞 2개(빈 자리 낭비 없음)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unrecordedYesterday: [
        { classId: "m1", className: "A반", subject: "math" },
        { classId: "m2", className: "B반", subject: "math" },
        { classId: "m3", className: "C반", subject: "math" },
      ],
    });
    expect(items[0]).toMatchObject({ detail: "A반·B반 외 1" });
  });

  it("분석 실패는 권한 도메인별 항목과 링크로 분리", () => {
    const items = buildTodayActions({
      ...EMPTY,
      failedAnalysis: { meetings: 1, enrollment: 3, consultations: 2 },
    });
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.key)).toEqual([
      "failed-analysis-enrollment",
      "failed-analysis-consultations",
      "failed-analysis-meetings",
    ]);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 1, href: "/meetings", menuKey: "meetings", requiredAccess: "write" }),
        expect.objectContaining({ count: 3, href: "/enrollment?view=kanban", menuKey: "enrollment", requiredAccess: "write" }),
        expect.objectContaining({ count: 2, href: "/consultations?list=1", menuKey: "consultations", requiredAccess: "write" }),
      ]),
    );
  });

  it("조회 실패는 0건 대신 해당 메뉴의 명시적 확인 불가 신호", () => {
    const items = buildTodayActions({
      ...EMPTY,
      sourceIssues: [
        {
          key: "attendance-today",
          label: "오늘 출결",
          href: "/attendance",
          menuKey: "attendance",
          requiredAccess: "read",
        },
      ],
    });
    expect(items).toEqual([
      expect.objectContaining({
        key: "source-issue-attendance-today",
        label: "오늘 출결 확인 불가",
        count: null,
        href: "/attendance",
        menuKey: "attendance",
        requiredAccess: "read",
      }),
    ]);
  });

  it("정렬: danger → amber → info, 같은 심각도는 건수 desc, 카운트 없는 신호는 뒤", () => {
    const items = buildTodayActions({
      ...EMPTY,
      absentToday: [{ studentId: "1", name: "a", subject: "math", preNotified: false }],
      requestedTextbooks: 9,
      makeeduIssue: { kind: "stale", detail: "30시간째 미동기" },
      leavesToday: [{ name: "박지훈" }],
    });
    expect(items.map((i) => i.key)).toEqual([
      "absent", // danger
      "textbooks", // amber 9
      "makeedu", // amber count null → 뒤
      "leaves-today", // info
    ]);
  });

  it("makeedu 이상은 note 그대로 + owner 연동 면 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      makeeduIssue: { kind: "error", detail: "students 실패" },
    });
    expect(items[0]).toMatchObject({ count: null, note: "students 실패", href: "/owner?tab=sheets&sub=makeedu" });
  });

  it("휴가: 승인 대기=amber, 오늘 휴가=info(명단)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      leavesPending: 1,
      leavesToday: [{ name: "김은정" }, { name: "박서연" }],
    });
    expect(items.map((i) => i.key)).toEqual(["leaves-pending", "leaves-today"]);
    expect(items[1].detail).toBe("김은정·박서연");
  });
});

describe("nameList", () => {
  it("max 초과분은 '외 N'으로 요약", () => {
    expect(nameList(["a", "b", "c", "d", "e"])).toBe("a·b·c 외 2");
    expect(nameList(["a", "b"])).toBe("a·b");
    expect(nameList(["a", "b", "c"], 2)).toBe("a·b 외 1");
  });
});

describe("수업보고서 작성 대상", () => {
  it("수강 시작·종료일 경계를 포함하고 대기 수강은 제외", () => {
    expect(isEnrollmentActiveOn({ startDate: "2026-07-16", endDate: "2026-07-16", onHold: false }, "2026-07-16")).toBe(true);
    expect(isEnrollmentActiveOn({ startDate: "2026-07-17", endDate: null, onHold: false }, "2026-07-16")).toBe(false);
    expect(isEnrollmentActiveOn({ startDate: "2026-07-01", endDate: "2026-07-15", onHold: false }, "2026-07-16")).toBe(false);
    expect(isEnrollmentActiveOn({ startDate: "2026-07-01", endDate: null, onHold: true }, "2026-07-16")).toBe(false);
  });

  it("반이동 전출의 종료일은 반열림, 일반 퇴원 종료일은 기존처럼 포함", () => {
    expect(
      isEnrollmentActiveOn(
        { startDate: "2026-07-01", endDate: "2026-07-16", onHold: false, isTransferred: true },
        "2026-07-15",
      ),
    ).toBe(true);
    expect(
      isEnrollmentActiveOn(
        { startDate: "2026-07-01", endDate: "2026-07-16", onHold: false, isTransferred: true },
        "2026-07-16",
      ),
    ).toBe(false);
    expect(
      isEnrollmentActiveOn(
        { startDate: "2026-07-01", endDate: "2026-07-16", onHold: false, isTransferred: false },
        "2026-07-16",
      ),
    ).toBe(true);
  });

  it("분리등원은 빈 배열이면 전 요일, 지정 배열이면 해당 요일만 대상", () => {
    expect(enrollmentAttendsOnDay([], "thu")).toBe(true);
    expect(enrollmentAttendsOnDay(null, "thu")).toBe(true);
    expect(enrollmentAttendsOnDay(["mon", "thu"], "thu")).toBe(true);
    expect(enrollmentAttendsOnDay(["mon", "thu"], "wed")).toBe(false);
  });

  it("학생 보고서 1건이 다른 과목까지 완료 처리하지 않는다", () => {
    const targets = [
      { studentId: "s1", classId: "math-a", subject: "math" },
      { studentId: "s1", classId: "english-a", subject: "english" },
    ];
    expect(findMissingLessonReportPairs(targets, new Set(), [{ studentId: "s1", subject: "math" }])).toEqual([
      { studentId: "s1", subject: "english" },
    ]);
    expect(
      findMissingLessonReportPairs(targets, new Set(), [
        { studentId: "s1", subject: "math" },
        { studentId: "s1", subject: "english" },
      ]),
    ).toEqual([]);
  });

  it("과목 없는 레거시 보고서는 해당 학생의 그날 과목을 완료로 간주해 거짓 미작성을 억제", () => {
    const targets = [
      { studentId: "s1", classId: "math-a", subject: "math" },
      { studentId: "s1", classId: "english-a", subject: "english" },
      { studentId: "s2", classId: "math-a", subject: "math" },
    ];
    expect(
      findMissingLessonReportPairs(targets, new Set(), [
        { studentId: "s1", subject: null },
        { studentId: "s2", subject: "math" },
      ]),
    ).toEqual([]);
    expect(findMissingLessonReportPairs(targets, new Set(), [{ studentId: "s1", subject: "" }])).toEqual([
      { studentId: "s2", subject: "math" },
    ]);
  });

  it("같은 과목 반이 전부 결석일 때만 작성 대상에서 제외", () => {
    const targets = [
      { studentId: "s1", classId: "math-a", subject: "math" },
      { studentId: "s1", classId: "math-b", subject: "math" },
    ];
    expect(findMissingLessonReportPairs(targets, new Set(["s1::math-a"]), [])).toEqual([
      { studentId: "s1", subject: "math" },
    ]);
    expect(findMissingLessonReportPairs(targets, new Set(["s1::math-a", "s1::math-b"]), [])).toEqual([]);
  });

  it("미리 쓴 보고서(covers_date=오늘)는 오늘 의무를 끝낸다 — 작성률 카드와 같은 규칙(점검 2026-09-28)", () => {
    const targets = [
      { studentId: "s1", classId: "math-a", subject: "math" },
      { studentId: "s2", classId: "math-a", subject: "math" },
    ];
    const r = judgeTodayLessonReports(
      targets,
      new Set(),
      [{ studentId: "s1", subject: "math", reportDate: "2026-09-20", coversDate: "2026-09-28" }],
      "2026-09-28",
    );
    expect(r.due.map((p) => p.studentId)).toEqual(["s2"]);
    expect(r.missing.map((p) => p.studentId)).toEqual(["s2"]);
  });

  it("다른 날 쓴 보고서(오늘을 지정하지 않음)는 오늘을 채우지 않는다", () => {
    const targets = [{ studentId: "s1", classId: "math-a", subject: "math" }];
    expect(
      findMissingLessonReportPairs(targets, new Set(), [{ studentId: "s1", subject: "math", reportDate: "2026-09-27" }], "2026-09-28"),
    ).toEqual([{ studentId: "s1", subject: "math" }]);
  });

  it("결석 반 = 최신 정정 기준 · 그 반 교시가 전부 결석일 때만", () => {
    const row = (id: string, slot: string, status: string, at: string) => ({
      id, student_id: "s1", class_id: "c1", session_date: "2026-09-28", slot_start: slot, recorded_at: at, status,
    });
    expect([...absentClassKeysOf([row("a", "16:00", "absent", "2026-09-28T07:00:00Z")])]).toEqual(["s1::c1"]);
    // 결석 → 출석으로 정정
    expect(absentClassKeysOf([row("a", "16:00", "absent", "2026-09-28T07:00:00Z"), row("b", "16:00", "present", "2026-09-28T08:00:00Z")]).size).toBe(0);
    // 두 교시 중 하나는 출석
    expect(absentClassKeysOf([row("a", "16:00", "absent", "2026-09-28T07:00:00Z"), row("b", "17:00", "present", "2026-09-28T07:00:00Z")]).size).toBe(0);
    // 공결도 결석 — 보고서 분모에서 빠진다(원장 2026-10-14 *"결석이 있으면 분모에서 빼야함"*)
    expect([...absentClassKeysOf([row("a", "16:00", "excused", "2026-09-28T07:00:00Z")])]).toEqual(["s1::c1"]);
    expect([...absentClassKeysOf([row("a", "16:00", "absent", "2026-09-28T07:00:00Z"), row("b", "17:00", "excused", "2026-09-28T07:00:00Z")])]).toEqual(["s1::c1"]);
    expect(absentClassKeysOf([row("a", "16:00", "excused", "2026-09-28T07:00:00Z"), row("b", "17:00", "late", "2026-09-28T07:00:00Z")]).size).toBe(0);
  });
});

describe("신규생 관리 기한 경과", () => {
  it("지연이 있으면 항목이 서고 이름 미리보기·기준 note가 붙는다", () => {
    const items = buildTodayActions({
      ...EMPTY,
      newcomerOverdue: { count: 4, names: ["김유하", "김나윤", "정윤헌", "이해율A"] },
    });
    const item = items.find((i) => i.key === "newcomer-overdue");
    expect(item).toBeDefined();
    expect(item!.count).toBe(4);
    expect(item!.unit).toBe("명");
    expect(item!.href).toBe("/newcomers?list=1");
    expect(item!.menuKey).toBe("newcomers");
    // 재촉 기준을 적어 둔다 — "무엇이 지연인지" 없이 숫자만 세우면 무슨 조치를 할지 알 수 없다.
    expect(item!.note).toContain("사전 콜");
  });

  it("0이면 항목 자체가 없다(빈 줄을 세우지 않는다)", () => {
    const items = buildTodayActions({ ...EMPTY, newcomerOverdue: { count: 0, names: [] } });
    expect(items.some((i) => i.key === "newcomer-overdue")).toBe(false);
  });
});
