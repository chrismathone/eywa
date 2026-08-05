import { describe, expect, it } from "vitest";
import {
  buildReportCommentInput,
  buildReportCommentPrompt,
  buildFactBlock,
  buildP1FactBlock,
  buildP2FactBlock,
  buildCommentP1Prompt,
  buildCommentP2Prompt,
  formatTestScore,
  applyTestScoreMode,
  type ReportCommentInput,
} from "./report-comment";
import type { OneScreenStudent, TestScore } from "./types";

// 모드 전환 순수 로직(0148a) — 적대검수가 잡은 2건(왕복 문항수 유실·척도경계 허위 delta) 방어.
describe("applyTestScoreMode", () => {
  const base: TestScore = { score: 18, max: 20, prevScore: 15, mode: "count" };

  it("개수→점수: 만점 100 고정 + 개수 문항수를 countMax에 기억 + 점수 재클램프", () => {
    const r = applyTestScoreMode(base, "score");
    expect(r.mode).toBe("score");
    expect(r.max).toBe(100);
    expect(r.countMax).toBe(20); // 복원용 기억
    expect(r.score).toBe(18); // 18 ≤ 100
  });

  it("점수→개수 왕복: **기억해둔 문항수(20)로 복원** — 100으로 굳지 않는다(핵심 버그)", () => {
    const toScore = applyTestScoreMode(base, "score"); // max=100, countMax=20
    const backToCount = applyTestScoreMode(toScore, "count");
    expect(backToCount.mode).toBe("count");
    expect(backToCount.max).toBe(20); // ← 복원됨(버그였으면 100)
  });

  it("점수 모드에서 점수>새 만점이면 클램프 — 개수(95/문항수5)에서 점수로 갈 때 max=100이라 유지, 반대는 클램프", () => {
    const big: TestScore = { score: 95, max: 100, prevScore: null, mode: "score", countMax: 5 };
    const toCount = applyTestScoreMode(big, "count"); // max=countMax=5
    expect(toCount.max).toBe(5);
    expect(toCount.score).toBe(5); // 95 → clamp 5
  });

  it("모드가 바뀌면 prevScore를 버린다 — 개수(18)와 점수(95)를 섞어 빼는 허위 증감 방지", () => {
    expect(applyTestScoreMode(base, "score").prevScore).toBeNull();
    expect(applyTestScoreMode({ ...base, mode: "score" }, "count").prevScore).toBeNull();
  });

  it("같은 모드로 재적용하면 prevScore 유지(불필요한 폐기 없음)", () => {
    expect(applyTestScoreMode(base, "count").prevScore).toBe(15);
  });
});

// 표기 모드(0148a) — 학부모 카드·AI 멘트가 공유하는 단일 표시 포맷.
describe("formatTestScore", () => {
  it("count 모드(기본) = 'N문제 중 M개'", () => {
    expect(formatTestScore(18, 20, "count")).toBe("20문제 중 18개");
    expect(formatTestScore(18, 20)).toBe("20문제 중 18개"); // mode 미지정 = count(기존 동작 보존)
  });

  it("score 모드 + 만점 100 = 'X점'", () => {
    expect(formatTestScore(95, 100, "score")).toBe("95점");
    expect(formatTestScore(100, 100, "score")).toBe("100점");
    expect(formatTestScore(0, 100, "score")).toBe("0점");
  });

  it("score 모드 + 만점≠100 = 'X/만점점'(정보 손실 방지)", () => {
    expect(formatTestScore(45, 50, "score")).toBe("45/50점");
  });

  it("같은 (score,max)라도 모드로 뜻이 갈린다 — 100점 vs 100문제 중 1개 뒤바뀜 방지", () => {
    // 인재원 사건: 100점을 넣으려다 개수(100문제 중 1개)로 저장되던 것 — 모드가 표기를 확정한다.
    expect(formatTestScore(100, 100, "score")).toBe("100점");
    expect(formatTestScore(1, 100, "count")).toBe("100문제 중 1개");
  });
});

function student(overrides: Partial<OneScreenStudent> = {}): OneScreenStudent {
  return {
    id: "s1",
    name: "김민승",
    grade: "초3",
    tag: "월A",
    attendance: "출석",
    subjects: [{ name: "수학(상)", prev: "일차함수", today: "이차함수" }],
    tests: {
      daily: { score: 16, max: 20, prevScore: 14 },
      check: { score: 18, max: 20, prevScore: null },
    },
    attitude: "좋음",
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
    ...overrides,
  };
}

describe("buildReportCommentInput", () => {
  it("진도·테스트(증감 포함)·태도·과제를 매핑한다", () => {
    const input = buildReportCommentInput(student(), 0);
    expect(input.studentName).toBe("김민승");
    expect(input.subject).toBe("수학(상)");
    expect(input.progress).toBe("이차함수");
    expect(input.dailyTest).toBe("20문제 중 16개 (지난 회차 대비 ▲2)");
    expect(input.checkTest).toBe("20문제 중 18개"); // prev 없으면 증감 미부기
    expect(input.attitude).toBe("좋음");
    expect(input.homework).toBe("완료");
  });

  it("미입력 점수·과제(—)는 빈 문자열", () => {
    const input = buildReportCommentInput(
      student({
        tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
        attitude: null,
        homework: "—",
      }),
      0,
    );
    expect(input.dailyTest).toBe("");
    expect(input.checkTest).toBe("");
    expect(input.attitude).toBe("");
    expect(input.homework).toBe("");
  });
});

describe("buildReportCommentPrompt", () => {
  // [예시](few-shot)와 [반드시] 가이드에도 "[입력]" 문구가 있으므로, 헤더("[입력]\n") 뒤 ~ "[출력]" 앞의
  // 실제 주입 섹션만 잘라 검사한다.
  const inputSection = (prompt: string) => prompt.split("[입력]\n")[1]?.split("\n\n[출력]")[0] ?? "";

  it("채워진 사실만 [입력]에 넣고 JSON 출력 계약을 담는다", () => {
    const prompt = buildReportCommentPrompt(buildReportCommentInput(student(), 0));
    const sec = inputSection(prompt);
    expect(sec).toContain("오늘 진도: 수학(상) 이차함수");
    expect(sec).toContain("일일테스트: 20문제 중 16개 (지난 회차 대비 ▲2)");
    expect(sec).toContain("수업 태도: 좋음");
    expect(sec).toContain("과제: 완료");
    expect(prompt).toContain("JSON"); // Upstage JSON mode 필수 토큰
    expect(prompt).toContain('{"comment"');
  });

  it("빈 항목은 [입력] 섹션에서 침묵(라인 미포함)", () => {
    const prompt = buildReportCommentPrompt(
      buildReportCommentInput(
        student({
          tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
          attitude: null,
          homework: "—",
        }),
        0,
      ),
    );
    const sec = inputSection(prompt);
    expect(sec).toContain("오늘 진도: 수학(상) 이차함수"); // 진도는 남아있음
    expect(sec).not.toContain("일일테스트");
    expect(sec).not.toContain("확인테스트");
    expect(sec).not.toContain("수업 태도");
    expect(sec).not.toContain("과제");
  });
});

describe("공지 모드 B — P1/P2 + 특이사항 (4c)", () => {
  const full: ReportCommentInput = {
    studentName: "김민승",
    subject: "수학(상)",
    progress: "이차함수",
    dailyTest: "20문제 중 16개",
    checkTest: "",
    attitude: "좋음",
    homework: "완료",
    homeworkToday: "",
    textbook: "개념원리 중2-1",
    specialNote: "개념 어려워함",
  };

  it("buildReportCommentInput이 교재·특이사항을 매핑한다", () => {
    const input = buildReportCommentInput(
      {
        id: "s1",
        name: "김민승",
        grade: "초3",
        tag: "월A",
        attendance: "출석",
        subjects: [{ name: "수학(상)", prev: "일차함수", today: "이차함수", textbook: "개념원리 중2-1" }],
        tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
        attitude: "좋음",
        homework: "완료",
        note: "조퇴함",
        progressConfirmed: false,
        reportDraft: "",
        reportSent: false,
      },
      0,
    );
    expect(input.textbook).toBe("개념원리 중2-1");
    expect(input.specialNote).toBe("조퇴함");
  });

  it("모드 A 사실 블록에 특이사항이 포함된다", () => {
    expect(buildFactBlock(full)).toContain("특이사항: 개념 어려워함");
  });

  it("P1 = 교재·진도·과제(태도 값 제외)", () => {
    const p1 = buildCommentP1Prompt(full)!;
    expect(p1).toContain("교재: 개념원리 중2-1");
    expect(p1).toContain("진도: 수학(상) 이차함수");
    expect(p1).toContain("과제: 완료");
    expect(p1).not.toContain("태도: 좋음");
    expect(p1).toContain('{"comment"');
  });

  it("P2 = 태도·특이사항(교재 값 제외)", () => {
    const p2 = buildCommentP2Prompt(full)!;
    expect(p2).toContain("태도: 좋음");
    expect(p2).toContain("특이사항: 개념 어려워함");
    expect(p2).not.toContain("교재:");
  });

  it("해당 문단 사실이 전무하면 null(문단 생략)", () => {
    const empty: ReportCommentInput = {
      studentName: "",
      subject: "",
      progress: "",
      dailyTest: "",
      checkTest: "",
      attitude: "",
      homework: "",
      homeworkToday: "",
      textbook: "",
      specialNote: "",
    };
    expect(buildCommentP1Prompt(empty)).toBeNull();
    expect(buildCommentP2Prompt(empty)).toBeNull();
  });
});

describe("오늘 과제(homeworkToday, 0096a)", () => {
  it("buildReportCommentInput이 과목별 homeworkToday를 매핑한다", () => {
    const input = buildReportCommentInput(
      student({
        subjects: [{ name: "수학(상)", prev: "일차함수", today: "이차함수", homeworkToday: "개념편 p10~16" }],
      }),
      0,
    );
    expect(input.homeworkToday).toBe("개념편 p10~16");
  });

  it("모드 A 사실 블록에 '오늘 과제'가 별도 라인으로 들어간다(수행 상태 '과제'와 공존)", () => {
    const input = buildReportCommentInput(
      student({
        subjects: [{ name: "수학(상)", prev: "일차함수", today: "이차함수", homeworkToday: "워크북 P32까지" }],
      }),
      0,
    );
    const facts = buildFactBlock(input);
    expect(facts).toContain("과제: 완료");
    expect(facts).toContain("오늘 과제: 워크북 P32까지");
  });

  it("P1의 '과제'는 오늘 과제 우선, 미입력이면 수행 상태 폴백", () => {
    const withToday: ReportCommentInput = {
      studentName: "김민승",
      subject: "수학(상)",
      progress: "이차함수",
      dailyTest: "",
      checkTest: "",
      attitude: "",
      homework: "완료",
      homeworkToday: "워크북 P32까지",
      textbook: "개념원리 중2-1",
      specialNote: "",
    };
    expect(buildCommentP1Prompt(withToday)).toContain("과제: 워크북 P32까지");
    expect(buildCommentP1Prompt({ ...withToday, homeworkToday: "" })).toContain("과제: 완료");
  });
});

describe("반 공통 서술 classContext (G6)", () => {
  const base: ReportCommentInput = {
    studentName: "김민승",
    subject: "수학(상)",
    progress: "이차함수",
    dailyTest: "",
    checkTest: "",
    attitude: "좋음",
    homework: "",
    homeworkToday: "",
    textbook: "개념원리",
    specialNote: "",
  };
  it("모드 A: fact 블록에 가드 문구와 함께 동봉(모순 시 학생 정보 우선)", () => {
    const facts = buildFactBlock({ ...base, classContext: "2단원 심화, 대체로 이해도 좋았다" });
    expect(facts).toContain("반 공통 수업 맥락");
    expect(facts).toContain("학생 정보를 우선");
    expect(facts).toContain("2단원 심화");
  });
  it("빈 값·공백·미지정이면 기존 fact 블록과 완전 동일(기존 동작 불변)", () => {
    const plain = buildFactBlock(base);
    expect(buildFactBlock({ ...base, classContext: "" })).toBe(plain);
    expect(buildFactBlock({ ...base, classContext: "   " })).toBe(plain);
    expect(plain).not.toContain("반 공통");
  });
  it("모드 B: P1(수업 내용)에만 들어가고 P2(태도·특이사항)에는 안 샌다", () => {
    const withCtx = { ...base, specialNote: "조퇴함", classContext: "오늘 반 전체 복습 위주" };
    expect(buildCommentP1Prompt(withCtx)).toContain("반 공통 수업 맥락");
    expect(buildCommentP2Prompt(withCtx)).not.toContain("반 공통");
  });
});

describe("classContext 앵커 — 개별 사실 없이 반 서술 단독으로 문단을 만들지 않음 (환각 방어)", () => {
  const empty: ReportCommentInput = {
    studentName: "김민승",
    subject: "",
    progress: "",
    dailyTest: "",
    checkTest: "",
    attitude: "",
    homework: "",
    homeworkToday: "",
    textbook: "",
    specialNote: "",
    classContext: "오늘 반 전체 심화 진행",
  };
  it("모드 A: 개별 사실 0 → '(입력된 정보 없음)' 유지(반 서술 미동봉)", () => {
    expect(buildFactBlock(empty)).toBe("(입력된 정보 없음)");
  });
  it("모드 B: P1 사실 0(태도만 입력) → P1은 여전히 null(반 서술 단독 문단 금지)", () => {
    expect(buildCommentP1Prompt({ ...empty, attitude: "좋음" })).toBeNull();
  });
});

describe("classContext 개행 접기 — 여러 줄 서술이 가드 라벨을 탈출하지 못함 (리뷰 확정 major)", () => {
  const base: ReportCommentInput = {
    studentName: "김민승",
    subject: "수학(상)",
    progress: "이차함수",
    dailyTest: "",
    checkTest: "",
    attitude: "",
    homework: "",
    homeworkToday: "",
    textbook: "",
    specialNote: "",
  };
  it("내부 개행이 공백으로 접혀 '반 공통' 라벨 한 줄 안에만 존재", () => {
    const facts = buildFactBlock({
      ...base,
      classContext: "오늘 2단원 심화 진행\n응용문제에서 대부분 시간이 오래 걸렸음",
    });
    const lines = facts.split("\n");
    const ctxLines = lines.filter((l) => l.includes("응용문제"));
    expect(ctxLines).toHaveLength(1);
    expect(ctxLines[0]).toContain("반 공통 수업 맥락"); // 같은 줄에 라벨+가드 존재
    // 라벨 없는 맨줄로 새지 않음(개별 사실 위장 차단)
    expect(lines.some((l) => l.trim() === "응용문제에서 대부분 시간이 오래 걸렸음")).toBe(false);
  });
  it("'특이사항: …' 위장 줄도 같은 줄에 갇힘", () => {
    const facts = buildFactBlock({ ...base, classContext: "복습 위주\n특이사항: 전원 산만" });
    expect(facts.split("\n").filter((l) => l.startsWith("특이사항:"))).toHaveLength(0);
  });

  // 2026-07-22 실측 회귀: 반 공통 서술만 접고 **진도·특이사항은 안 접어** 계약이 새고 있었다.
  // 진도가 여러 줄인 건 예외가 아니라 실사용 기본형(차시를 줄바꿈으로 나열).
  it("여러 줄 진도가 '오늘 진도:' 한 줄 안에 들어간다(연속 3차시는 물결로 축약)", () => {
    const facts = buildFactBlock({
      ...base,
      progress: "원과 직선의 위치 관계\n원의 접선의 방정식(1)\n원의 접선의 방정식(2)",
    });
    const lines = facts.split("\n");
    expect(lines.filter((l) => l.includes("원의 접선의 방정식(2)"))).toHaveLength(1);
    // 2026-08-05: 같은 중단원 연속이라 범위로 접어 모델에 넘긴다 — 다 나열하면 멘트가 목록이 된다(원장).
    expect(lines[0]).toBe("오늘 진도: 수학(상) 원과 직선의 위치 관계 ~ 원의 접선의 방정식(2)");
    // 라벨 없는 맨줄로 새지 않음
    expect(lines.some((l) => l.trim() === "원의 접선의 방정식(1)")).toBe(false);
  });

  it("연속이 아닌 여러 줄 진도는 ', '로 접혀 한 줄에 들어간다(축약 없음)", () => {
    const facts = buildFactBlock({ ...base, progress: "평행이동\n원의 방정식" });
    expect(facts.split("\n")[0]).toBe("오늘 진도: 수학(상) 평행이동, 원의 방정식");
  });

  it("여러 줄 특이사항·오늘 과제도 각자 한 줄 안에 갇힌다", () => {
    const facts = buildFactBlock({
      ...base,
      specialNote: "감기로 조퇴\n다음 주 보강 예정",
      homeworkToday: "본책 p.55~69\n워크북 ~49",
    });
    const lines = facts.split("\n");
    expect(lines).toContain("특이사항: 감기로 조퇴, 다음 주 보강 예정");
    expect(lines).toContain("오늘 과제: 본책 p.55~69, 워크북 ~49");
    expect(lines.some((l) => l.trim() === "다음 주 보강 예정")).toBe(false);
  });

  it("P1/P2 사실 블록도 같은 규약으로 접힌다", () => {
    const p1 = buildP1FactBlock({ ...base, progress: "원주각\n원주각의 활용" });
    expect(p1).toContain("진도: 수학(상) 원주각, 원주각의 활용");
    const p2 = buildP2FactBlock({ ...base, attitude: "좋음", specialNote: "조퇴\n사유 미기재" });
    expect(p2?.split("\n").some((l) => l.trim() === "사유 미기재")).toBe(false);
  });
});

// 2026-07-22 실측: fact 라벨의 괄호 설명이 학부모 문장에 그대로 베껴졌다(40건 중 8건
// "이전 진도 범위 일일테스트에서 …"). 설명은 데이터가 아니라 프롬프트 지침이 담는다.
describe("fact 라벨에 괄호 설명 금지 — 모델이 값과 함께 베낀다", () => {
  const base: ReportCommentInput = {
    studentName: "김민승",
    subject: "수학",
    progress: "이차방정식",
    dailyTest: "10문제 중 5개",
    checkTest: "10문제 중 8개",
    attitude: "",
    homework: "",
    homeworkToday: "",
    textbook: "",
    specialNote: "",
  };
  it("테스트 라벨은 시험 이름만", () => {
    const facts = buildFactBlock(base);
    expect(facts).toContain("일일테스트: 10문제 중 5개");
    expect(facts).toContain("확인테스트: 10문제 중 8개");
    expect(facts).not.toContain("이전 진도 범위");
    expect(facts).not.toContain("오늘 진도 범위");
  });
  it("두 시험의 의미는 프롬프트 지침이 설명한다(설명 자체는 옮겨 적지 말라는 규칙 포함)", () => {
    const p = buildReportCommentPrompt(base);
    expect(p).toContain("'일일테스트'는 지난 회차 진도를");
    expect(p).toContain("이 설명 자체를 문장에 옮겨 적지 말고");
  });
});

// ── 진도가 중단된 날 — '진도' 라벨로 주면 모델이 나가지도 않은 진도를 문장에 만든다(progress-status.ts) ──
describe("월말평가 사실 라벨", () => {
  const base = {
    studentName: "김담희",
    subject: "수학",
    progress: "월말평가",
    dailyTest: "",
    checkTest: "",
    attitude: "",
    homework: "",
    homeworkToday: "",
    textbook: "",
    specialNote: "",
  };

  it("모드 A — '오늘 진도' 대신 '오늘 수업'으로 라벨링", () => {
    const block = buildFactBlock(base);
    expect(block).toContain("오늘 수업: 수학 월말평가");
    expect(block).not.toContain("오늘 진도:");
  });

  it("모드 B P1 — '진도' 대신 '오늘 수업'", () => {
    const block = buildP1FactBlock(base);
    expect(block).toContain("오늘 수업: 수학 월말평가");
    expect(block).not.toContain("진도: 수학 월말평가");
  });

  it("값에는 괄호 설명을 붙이지 않는다(모델이 통째로 베껴 학부모 문장에 넣는다)", () => {
    expect(buildFactBlock(base)).not.toContain("(");
  });

  it("일반 진도는 라벨이 그대로 '오늘 진도'", () => {
    const block = buildFactBlock({ ...base, progress: "1. 다항식의 연산" });
    expect(block).toContain("오늘 진도: 수학 1. 다항식의 연산");
  });
});
