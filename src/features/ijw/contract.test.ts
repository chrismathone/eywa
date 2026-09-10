import { describe, expect, it } from "vitest";
import {
  IJW_FAIL_TEXT,
  IJW_SCHEMAS,
  examTypeLabel,
  failKindOfStatus,
  formatElapsed,
  formatStudyTime,
  ijwFailMessage,
  summarizeScores,
} from "./contract";

// 설명서(EYWA-API.md v1)의 예시 응답을 그대로 옮겼다 — 모양이 바뀌면 여기서 먼저 깨진다.
const EXAM_RESULT = {
  v: 1,
  student: { id: "jdw", name: "jdw", className: "테스터 그룹" },
  deck: { id: "cmtgzul3b0000uv18nt1vn1v7", name: "[시험] 테스트 시험", examType: "regular" },
  submittedAt: "2026-08-31T10:51:22.169Z",
  elapsedMs: 5543,
  total: 20,
  correct: 11,
  score: 55,
  classAvg: null,
  overallAvg: null,
  byPos: [{ pos: "명", label: "명사", correct: 5, total: 11 }],
  wrong: [{ prompt: "[명] 구내식당", answer: "cafeteria", typed: "wrongword" }],
};

const SUMMARY_ROW = {
  ijwId: "학생1",
  name: "학생1",
  className: "A반",
  answers: 0,
  correct: 0,
  accuracy: 0,
  studyMs: 0,
  activeDays: 0,
  newWords: 0,
  longTermWords: 0,
  seenWords: 24,
};

describe("IJW_SCHEMAS", () => {
  it("시험 결과지 예시를 읽는다", () => {
    const r = IJW_SCHEMAS.examResult.safeParse(EXAM_RESULT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.score).toBe(55);
      expect(r.data.classAvg).toBeNull();
      expect(r.data.wrong[0]!.answer).toBe("cafeteria");
    }
  });

  it("버전이 1이 아니면 읽지 않는다", () => {
    expect(IJW_SCHEMAS.examResult.safeParse({ ...EXAM_RESULT, v: 2 }).success).toBe(false);
  });

  it("학생별 기간 요약 예시를 읽는다", () => {
    const r = IJW_SCHEMAS.studySummary.safeParse({
      v: 1,
      studyBasis: "학습일 = KST 03:00 경계",
      from: "2026-08-11",
      to: "2026-09-09",
      students: [SUMMARY_ROW],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.students[0]!.seenWords).toBe(24);
  });

  it("시험별 요약 — 빈 목록도 정상", () => {
    expect(IJW_SCHEMAS.examSummary.safeParse({ v: 1, examBasis: "KST", exams: [] }).success).toBe(true);
  });

  it("숫자 칸이 문자열 숫자로 와도 숫자로 읽는다", () => {
    const r = IJW_SCHEMAS.studentExams.safeParse({
      v: 1,
      exams: [{ attemptId: "a", deckId: "d", deck: "x", examType: "regular", submittedAt: "", total: "20", correct: "11", score: 55 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exams[0]!.total).toBe(20);
  });

  it("🔴 필수 숫자 칸이 빠지거나 숫자가 아니면 **실패**한다(0으로 채워 그럴듯하게 그리지 않게)", () => {
    const missing = { ...SUMMARY_ROW } as Record<string, unknown>;
    delete missing.studyMs; // 인재원이 칸 이름을 바꾼 상황
    expect(IJW_SCHEMAS.studySummary.safeParse({ v: 1, from: "", to: "", students: [missing] }).success).toBe(false);
    expect(
      IJW_SCHEMAS.studentExams.safeParse({
        v: 1,
        exams: [{ attemptId: "a", deckId: "d", deck: "x", examType: "regular", submittedAt: "", total: 20, correct: "x", score: 1 }],
      }).success,
    ).toBe(false);
  });

  it("평균이 없으면 null은 받지만, 칸이 빠지면 실패", () => {
    const row = { deckId: "d", name: "n", examType: "regular", takers: 0, avg: null, max: null, min: null, lastSubmittedAt: "" };
    expect(IJW_SCHEMAS.examSummary.safeParse({ v: 1, exams: [row] }).success).toBe(true);
    const noAvg: Record<string, unknown> = { ...row };
    delete noAvg.avg;
    expect(IJW_SCHEMAS.examSummary.safeParse({ v: 1, exams: [noAvg] }).success).toBe(false);
  });
});

describe("표기 도우미", () => {
  it("평시·내신 · 모르는 값은 기타", () => {
    expect(examTypeLabel("regular")).toBe("평시");
    expect(examTypeLabel("exam")).toBe("내신");
    expect(examTypeLabel("quiz")).toBe("기타");
    expect(examTypeLabel("")).toBe("기타");
  });

  it("걸린 시간 — 3시간이 넘으면 —", () => {
    expect(formatElapsed(5543)).toBe("6초");
    expect(formatElapsed(125_000)).toBe("2분 5초");
    expect(formatElapsed(428641655)).toBe("—");
  });

  it("학습 시간", () => {
    expect(formatStudyTime(0)).toBe("0분");
    expect(formatStudyTime(18800)).toBe("1분 미만");
    expect(formatStudyTime(95 * 60000)).toBe("1시간 35분");
  });

  it("🔑 점수 요약은 인재원과 같은 반올림(설명서 6번 예시 85·80·55 → 평균 73)", () => {
    expect(summarizeScores([85, 80, 55])).toEqual({ count: 3, avg: 73, max: 85, min: 55 });
    expect(summarizeScores([])).toEqual({ count: 0, avg: null, max: null, min: null });
  });
});

describe("실패 종류와 문장", () => {
  it("상태 코드 → 실패 종류", () => {
    expect(failKindOfStatus(401)).toBe("unauthorized");
    expect(failKindOfStatus(404)).toBe("not_found");
    expect(failKindOfStatus(400)).toBe("bad_request");
    expect(failKindOfStatus(500)).toBe("server");
  });

  it("🔴 503은 인재원이 '키 미설정'이라고 할 때만 인재원 쪽 설정 문제로 본다", () => {
    expect(failKindOfStatus(503, "연동 키 미설정")).toBe("remote_not_configured");
    expect(failKindOfStatus(503, "")).toBe("server");
    // eywa 쪽 설정 없음과 문장이 달라야 어느 쪽을 고칠지 안다.
    expect(IJW_FAIL_TEXT.remote_not_configured).not.toBe(IJW_FAIL_TEXT.not_configured);
  });

  it("400은 인재원이 적어 준 한국어 문장을 그대로, 영문 원문은 화면에 내지 않는다", () => {
    expect(ijwFailMessage("bad_request", "기간은 1년을 넘을 수 없습니다")).toBe("기간은 1년을 넘을 수 없습니다");
    expect(ijwFailMessage("bad_request", "invalid range")).toBe(IJW_FAIL_TEXT.bad_request);
    expect(ijwFailMessage("server", "기간은 1년을 넘을 수 없습니다")).toBe(IJW_FAIL_TEXT.server);
  });
});
