import { describe, it, expect } from "vitest";
import {
  buildGridRows,
  buildRowRenderMeta,
  isReportEligible,
  effectiveClassnoteStatus,
  isAlreadySent,
  isRowActionable,
  planBulkApply,
  planPrevFill,
  planBulkPrevFill,
  planPrevComments,
  rowInClass,
  summarizeSendGaps,
  type BulkTarget,
} from "./grid";
import type { OneScreenStudent, PrevReport } from "./types";

function stu(id: string, subjects: { name: string; today?: string }[]): OneScreenStudent {
  return {
    id,
    name: id,
    grade: "중1",
    tag: "중1",
    attendance: "출석",
    subjects: subjects.map((s) => ({ name: s.name, prev: "", today: s.today ?? "" })),
    tests: {
      daily: { score: null, max: 20, prevScore: null },
      check: { score: null, max: 20, prevScore: null },
    },
    attitude: null,
    homework: "",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  };
}

describe("buildGridRows", () => {
  it("학생×과목으로 평탄화하고 과목 순서를 보존한다", () => {
    const rows = buildGridRows([
      stu("a", [{ name: "수학" }]),
      stu("b", [{ name: "수학" }, { name: "영어" }]),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a::수학", "b::수학", "b::영어"]);
    expect(rows[1]!.subjectIndex).toBe(0);
    expect(rows[2]!.subjectIndex).toBe(1);
  });

  it("과목 없는 학생은 행을 만들지 않는다", () => {
    expect(buildGridRows([stu("a", [])])).toHaveLength(0);
  });
});

describe("rowInClass", () => {
  const sub = (className: string | null) => ({ name: "수학", prev: "", today: "", className });
  it("전체(null)면 항상 통과", () => {
    expect(rowInClass(sub("A반"), null)).toBe(true);
    expect(rowInClass(sub(null), null)).toBe(true);
  });
  it("특정 반이면 그 반 소속 행만(타 반 혼입 차단)", () => {
    expect(rowInClass(sub("A반"), "A반")).toBe(true);
    expect(rowInClass(sub("B반"), "A반")).toBe(false);
  });
  it("반 모호(className=null)는 어느 필터에서도 통과(같은 과목 두 반)", () => {
    expect(rowInClass(sub(null), "A반")).toBe(true);
  });
});

describe("isRowActionable", () => {
  const sub = (over: Partial<Parameters<typeof isRowActionable>[0]> = {}) => ({
    name: "수학",
    prev: "",
    today: "1-1-1 받아올림",
    ...over,
  });

  it("진도 없으면 어떤 액션도 불가(공통 필수)", () => {
    expect(isRowActionable(sub({ today: "" }), "save")).toBe(false);
    expect(isRowActionable(sub({ today: "" }), "send")).toBe(false);
  });

  it("결석 행 — save는 포함(기록 보존), send/autowrite는 제외", () => {
    const absent = sub({ attendanceRaw: "absent" });
    expect(isRowActionable(absent, "save")).toBe(true);
    expect(isRowActionable(absent, "send")).toBe(false);
    expect(isRowActionable(absent, "autowrite")).toBe(false);
  });

  it("조퇴(early_leave)·지각·기록없음은 발송 유지", () => {
    expect(isRowActionable(sub({ attendanceRaw: "early_leave" }), "send")).toBe(true);
    expect(isRowActionable(sub({ attendanceRaw: "late" }), "send")).toBe(true);
    expect(isRowActionable(sub({}), "send")).toBe(true);
  });

  // 2026-07-22 원장 지시로 강화: 발송 완료 = **수정도 금지**(예전엔 save만 열려 있었다).
  // ClassNote는 게시글 수정·삭제가 없어, 기록만 바꾸면 학부모가 받은 것과 사실이 갈라진다.
  it("이미 발송된 행 — save·send·autowrite 전부 금지", () => {
    const sent = sub({ classnoteStatus: "success" });
    expect(isRowActionable(sent, "send")).toBe(false);
    expect(isRowActionable(sent, "save")).toBe(false);
    expect(isRowActionable(sent, "autowrite")).toBe(false);
  });

  it("아직 학부모에게 안 간 상태(failed·too_old·queued 등)는 발송·수정 모두 가능해야 한다", () => {
    for (const st of ["queued", "processing", "failed", "too_old", "name_conflict", undefined]) {
      expect(isRowActionable(sub({ classnoteStatus: st }), "send")).toBe(true);
      expect(isRowActionable(sub({ classnoteStatus: st }), "save")).toBe(true);
    }
  });

  it("statusOverride(화면 state)가 로스터 스냅샷을 이긴다 — 방금 보낸 행을 다시 집지 않는다", () => {
    // 로스터엔 미발송으로 실려 있지만 세션 중 발송이 끝난 행.
    expect(isRowActionable(sub({}), "send", "success")).toBe(false);
    expect(isRowActionable(sub({}), "save", "success")).toBe(false);
    // 반대로 override가 비면(null) 로스터 값으로 판단한다.
    expect(isRowActionable(sub({ classnoteStatus: "success" }), "send", null)).toBe(false);
  });

  it("결석이 발송완료보다 먼저 걸린다(두 사유가 겹쳐도 발송은 어차피 불가)", () => {
    expect(isRowActionable(sub({ attendanceRaw: "absent", classnoteStatus: "success" }), "send")).toBe(false);
  });
});

describe("isAlreadySent", () => {
  it("게시 완료(success)만 참", () => {
    expect(isAlreadySent("success")).toBe(true);
    expect(isAlreadySent("queued")).toBe(false);
    expect(isAlreadySent("failed")).toBe(false);
    expect(isAlreadySent(null)).toBe(false);
    expect(isAlreadySent(undefined)).toBe(false);
  });

  it("서버 결과 코드 already_sent가 새어 들어와도 게이트는 닫힌 채로 유지된다", () => {
    expect(isAlreadySent("already_sent")).toBe(true);
  });
});

describe("summarizeSendGaps", () => {
  it("고유 학생 수 기준으로 태도·테스트 미입력을 센다(과목 행 중복 아님)", () => {
    const a = stu("a", [{ name: "수학", today: "x" }, { name: "영어", today: "y" }]); // 태도·테스트 둘 다 미입력
    const b = stu("b", [{ name: "수학", today: "x" }]);
    b.attitude = "좋음";
    b.tests.daily.score = 18;
    b.tests.check.score = 19;
    const rows = buildGridRows([a, b]);
    expect(summarizeSendGaps(rows, { dailyEnabled: true, checkEnabled: true })).toEqual({
      missingAttitude: 1, // a 1명(행 2개여도 1명)
      missingTest: 1,
    });
  });

  it("비활성 테스트는 미입력으로 치지 않는다", () => {
    const a = stu("a", [{ name: "수학", today: "x" }]);
    a.attitude = "좋음";
    a.tests.daily.score = 18; // check는 null이지만 checkEnabled=false
    const rows = buildGridRows([a]);
    expect(summarizeSendGaps(rows, { dailyEnabled: true, checkEnabled: false })).toEqual({
      missingAttitude: 0,
      missingTest: 0,
    });
  });
});

describe("buildRowRenderMeta", () => {
  it("다과목 학생은 첫 행만 firstOfStudent, studentRow는 학생 묶음 순번(밀집)", () => {
    const rows = buildGridRows([
      stu("a", [{ name: "수학" }]),
      stu("b", [{ name: "수학" }, { name: "영어" }]),
      stu("c", [{ name: "수학" }]),
    ]);
    expect(buildRowRenderMeta(rows)).toEqual([
      { firstOfStudent: true, studentRow: 0 },
      { firstOfStudent: true, studentRow: 1 },
      { firstOfStudent: false, studentRow: 1 }, // b의 두 번째 과목 행 — 점수 nav 미부착 대상
      { firstOfStudent: true, studentRow: 2 },
    ]);
  });

  it("표시 순서 기준이라 재배열(순서 모드)된 목록에도 정합", () => {
    const [a, b] = buildGridRows([stu("a", [{ name: "수학" }]), stu("b", [{ name: "수학" }])]);
    expect(buildRowRenderMeta([b!, a!])).toEqual([
      { firstOfStudent: true, studentRow: 0 },
      { firstOfStudent: true, studentRow: 1 },
    ]);
  });
});

describe("isReportEligible", () => {
  it("오늘 진도가 있으면 true, 비었으면 false", () => {
    expect(isReportEligible({ name: "수학", prev: "", today: "1-1-1 받아올림" })).toBe(true);
    expect(isReportEligible({ name: "수학", prev: "", today: "   " })).toBe(false);
    expect(isReportEligible({ name: "수학", prev: "", today: "" })).toBe(false);
  });
});

function target(over: Partial<BulkTarget> = {}): BulkTarget {
  return {
    studentId: "a",
    subjectName: "수학",
    attitude: null,
    homework: "",
    textbook: "",
    homeworkToday: "",
    ...over,
  };
}

describe("planBulkApply", () => {
  it("빈(미지정·공백) patch 필드는 적용하지 않는다 — 값 지우기 아님", () => {
    expect(planBulkApply([target()], {}, false)).toEqual([]);
    expect(planBulkApply([target()], { textbook: "  " }, false)).toEqual([]);
  });

  it("채워진 필드만 대상 행 전체에 적용한다(기본=덮어쓰기)", () => {
    const plan = planBulkApply(
      [target({ textbook: "기존 교재" }), target({ studentId: "b" })],
      { textbook: "쎈 중2-1", homeworkToday: "p10~16" },
      false,
    );
    expect(plan).toEqual([
      { studentId: "a", subjectName: "수학", set: { textbook: "쎈 중2-1", homeworkToday: "p10~16" } },
      { studentId: "b", subjectName: "수학", set: { textbook: "쎈 중2-1", homeworkToday: "p10~16" } },
    ]);
  });

  it("onlyEmpty면 이미 값 있는 칸은 건너뛴다", () => {
    const plan = planBulkApply(
      [target({ attitude: "좋음", textbook: "기존" }), target({ studentId: "b" })],
      { attitude: "아주 좋음", textbook: "쎈" },
      true,
    );
    expect(plan).toEqual([
      { studentId: "b", subjectName: "수학", set: { attitude: "아주 좋음", textbook: "쎈" } },
    ]);
  });

  it("태도·과제(학생 단위)는 같은 학생의 두 번째 행부터 중복 적용하지 않는다", () => {
    const plan = planBulkApply(
      [target({ subjectName: "수학" }), target({ subjectName: "영어" })],
      { attitude: "좋음", homeworkToday: "복습" },
      false,
    );
    expect(plan).toEqual([
      { studentId: "a", subjectName: "수학", set: { attitude: "좋음", homeworkToday: "복습" } },
      { studentId: "a", subjectName: "영어", set: { homeworkToday: "복습" } },
    ]);
  });
});

const ATTITUDES = ["아주 좋음", "좋음", "보통", "산만함", "피곤함"] as const;
const HOMEWORKS = ["완료", "일부 미흡", "미제출"] as const;

function prevReport(over: Partial<PrevReport> = {}): PrevReport {
  return {
    date: "2026-07-13",
    progress: "1-1-1 받아올림",
    textbook: "쎈",
    homeworkToday: "p10~16",
    homeworkScore: "완료",
    attitude: "좋음",
    examInfo: "일일 18/20",
    note: "학부모 발송 본문",
    ...over,
  };
}

describe("planPrevFill", () => {
  it("빈 칸만 채운다 — 이미 입력된 칸은 유지", () => {
    const fill = planPrevFill({
      prev: prevReport(),
      current: { today: "이미 입력", attitude: null, homework: "미제출", homeworkToday: "" },
      attitudes: ATTITUDES,
      homeworks: HOMEWORKS,
    });
    expect(fill).toEqual({ attitude: "좋음", homeworkToday: "p10~16" });
  });

  it("이전 값이 없거나(prev 없음) 전부 입력돼 있으면 빈 계획", () => {
    expect(
      planPrevFill({
        prev: undefined,
        current: { today: "", attitude: null, homework: "", homeworkToday: "" },
        attitudes: ATTITUDES,
        homeworks: HOMEWORKS,
      }),
    ).toEqual({});
    expect(
      planPrevFill({
        prev: prevReport(),
        current: { today: "x", attitude: "보통", homework: "완료", homeworkToday: "y" },
        attitudes: ATTITUDES,
        homeworks: HOMEWORKS,
      }),
    ).toEqual({});
  });

  it("현 선택지에 없는 옛 태도·과제 값은 스킵한다", () => {
    const fill = planPrevFill({
      prev: prevReport({ attitude: "옛선택지", homeworkScore: "90%" }),
      current: { today: "", attitude: null, homework: "", homeworkToday: "x" },
      attitudes: ATTITUDES,
      homeworks: HOMEWORKS,
    });
    expect(fill).toEqual({ today: "1-1-1 받아올림" });
  });

  it("특이사항(note=발송 본문)은 어떤 경우에도 계획에 포함되지 않는다", () => {
    const fill = planPrevFill({
      prev: prevReport(),
      current: { today: "", attitude: null, homework: "", homeworkToday: "" },
      attitudes: ATTITUDES,
      homeworks: HOMEWORKS,
    });
    expect(Object.keys(fill)).not.toContain("note");
    expect(fill).toEqual({
      today: "1-1-1 받아올림",
      attitude: "좋음",
      homework: "완료",
      homeworkToday: "p10~16",
    });
  });
});

describe("planBulkPrevFill", () => {
  const row = (
    studentId: string,
    subjectName: string,
    subjectIndex: number,
    prev: PrevReport | undefined,
    current: Partial<{ today: string; attitude: string | null; homework: string; homeworkToday: string }> = {},
  ) => ({
    studentId,
    subjectName,
    subjectIndex,
    prev,
    current: { today: "", attitude: null, homework: "", homeworkToday: "", ...current },
  });

  it("단일 과목 학생은 planPrevFill과 같은 결과", () => {
    const plan = planBulkPrevFill([row("a", "수학", 0, prevReport())], ATTITUDES, HOMEWORKS);
    expect(plan).toEqual([
      {
        studentId: "a",
        subjectName: "수학",
        subjectIndex: 0,
        set: { today: "1-1-1 받아올림", attitude: "좋음", homework: "완료", homeworkToday: "p10~16" },
      },
    ]);
  });

  it("다과목 학생 — 학생 단위(태도·과제)는 **첫 과목 행**만, 둘째 과목이 덮어쓰지 않는다", () => {
    const plan = planBulkPrevFill(
      [
        row("a", "수학", 0, prevReport({ attitude: "좋음", homeworkScore: "완료", progress: "수학진도" })),
        row("a", "영어", 1, prevReport({ attitude: "산만함", homeworkScore: "미제출", progress: "영어진도" })),
      ],
      ATTITUDES,
      HOMEWORKS,
    );
    expect(plan[0]!.set.attitude).toBe("좋음");
    expect(plan[0]!.set.homework).toBe("완료");
    expect(plan[1]!.set.attitude).toBeUndefined();
    expect(plan[1]!.set.homework).toBeUndefined();
    // 과목 단위(진도·오늘 과제)는 과목마다 그대로 채운다.
    expect(plan[0]!.set.today).toBe("수학진도");
    expect(plan[1]!.set.today).toBe("영어진도");
  });

  it("학생이 달라지면 dedup이 서로 간섭하지 않는다", () => {
    const plan = planBulkPrevFill(
      [row("a", "수학", 0, prevReport({ attitude: "좋음" })), row("b", "수학", 0, prevReport({ attitude: "보통" }))],
      ATTITUDES,
      HOMEWORKS,
    );
    expect(plan[0]!.set.attitude).toBe("좋음");
    expect(plan[1]!.set.attitude).toBe("보통");
  });

  it("채울 게 없는 행은 계획에서 빠진다(행 수 = 실제 채운 행 수)", () => {
    const plan = planBulkPrevFill(
      [
        row("a", "수학", 0, undefined), // 이전 회차 없음
        row("b", "수학", 0, prevReport(), { today: "입력됨", attitude: "좋음", homework: "완료", homeworkToday: "p1" }),
        row("c", "수학", 0, prevReport()),
      ],
      ATTITUDES,
      HOMEWORKS,
    );
    expect(plan.map((p) => p.studentId)).toEqual(["c"]);
  });

  it("현 학원 선택지에 없는 옛 태도·과제 값은 채우지 않는다(planPrevFill 규약 승계)", () => {
    const plan = planBulkPrevFill(
      [row("a", "수학", 0, prevReport({ attitude: "폐기된태도", homeworkScore: "폐기된과제" }))],
      ATTITUDES,
      HOMEWORKS,
    );
    expect(plan[0]!.set.attitude).toBeUndefined();
    expect(plan[0]!.set.homework).toBeUndefined();
    expect(plan[0]!.set.today).toBe("1-1-1 받아올림");
  });
});

describe("planPrevComments", () => {
  const row = (studentId: string, subjectName: string, prevNote: string | null | undefined, currentDraft = "") => ({
    studentId,
    subjectName,
    prevNote,
    currentDraft,
  });

  it("초안이 빈 행만 — 직전 멘트를 그대로 옮긴다", () => {
    expect(planPrevComments([row("a", "수학", "지난 시간 잘했습니다.")])).toEqual([
      { studentId: "a", subjectName: "수학", comment: "지난 시간 잘했습니다." },
    ]);
  });

  it("이미 쓴 초안은 절대 덮지 않는다(빈 칸만 = 버튼 계약)", () => {
    expect(planPrevComments([row("a", "수학", "직전 멘트", "강사가 쓴 오늘 멘트")])).toEqual([]);
  });

  it("공백만 있는 초안은 빈 칸으로 본다", () => {
    expect(planPrevComments([row("a", "수학", "직전 멘트", "   \n ")])).toHaveLength(1);
  });

  it("직전 멘트가 없거나(null/undefined) 공백뿐이면 대상 아님", () => {
    expect(planPrevComments([row("a", "수학", null), row("b", "수학", undefined), row("c", "수학", "  ")])).toEqual([]);
  });

  it("과목별로 각각 — 다과목 학생은 과목마다 자기 직전 멘트", () => {
    const plan = planPrevComments([row("a", "수학", "수학 멘트"), row("a", "영어", "영어 멘트")]);
    expect(plan.map((p) => p.comment)).toEqual(["수학 멘트", "영어 멘트"]);
  });
});

// 🔴 재발급·첨부변경은 상태를 **명시적으로 해제**(null)한다. `?? 스냅샷`으로 읽으면 로스터가 실어 온
// 옛 "success"가 되살아나, 수정·재발송 잠금의 **유일한 탈출구가 새로고침 전까지 죽는다**(적대 검수 확정).
describe("effectiveClassnoteStatus", () => {
  it("명시적 해제(null)는 스냅샷을 이긴다 — 재발급 직후 잠금이 풀려야 한다", () => {
    expect(effectiveClassnoteStatus(null, "success")).toBeNull();
    expect(isRowActionable({ name: "수학", prev: "", today: "x", classnoteStatus: "success" }, "send", null)).toBe(
      false,
    );
    // 화면 state가 null이면 실효 상태도 null → 잠기지 않는다.
    expect(isAlreadySent(effectiveClassnoteStatus(null, "success"))).toBe(false);
  });

  it("아직 모름(undefined)이면 스냅샷을 쓴다", () => {
    expect(effectiveClassnoteStatus(undefined, "success")).toBe("success");
    expect(isAlreadySent(effectiveClassnoteStatus(undefined, "success"))).toBe(true);
  });

  it("화면 state에 값이 있으면 그것이 이긴다", () => {
    expect(effectiveClassnoteStatus("queued", "success")).toBe("queued");
  });
});
