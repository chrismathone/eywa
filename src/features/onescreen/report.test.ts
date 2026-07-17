import { describe, it, expect } from "vitest";
import {
  pct,
  delta,
  studentStatus,
  isStudentDone,
  buildReport,
  buildSubjectReport,
} from "./report";
import type { OneScreenStudent } from "./types";

function makeStudent(overrides: Partial<OneScreenStudent> = {}): OneScreenStudent {
  return {
    id: "t1",
    name: "테스트",
    grade: "중2",
    tag: "A반",
    attendance: "출석",
    subjects: [{ name: "영어 독해", prev: "Unit 1", today: "Unit 2" }],
    tests: {
      daily: { score: null, max: 20, prevScore: null },
      check: { score: null, max: 20, prevScore: null },
    },
    attitude: null,
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
    ...overrides,
  };
}

describe("pct", () => {
  it("정답/만점을 백분율로 반올림", () => {
    expect(pct(18, 20)).toBe(90);
    expect(pct(0, 20)).toBe(0);
    expect(pct(1, 3)).toBe(33);
  });
  it("만점이 0이면 0", () => {
    expect(pct(5, 0)).toBe(0);
  });
});

describe("delta", () => {
  it("이번 − 직전 점수", () => {
    expect(delta(18, 16)).toBe(2);
    expect(delta(14, 15)).toBe(-1);
    expect(delta(16, 16)).toBe(0);
  });
  it("하나라도 null이면 비교 불가(null)", () => {
    expect(delta(null, 5)).toBeNull();
    expect(delta(5, null)).toBeNull();
    expect(delta(null, null)).toBeNull();
  });
});

describe("studentStatus", () => {
  it("진도: 확정 여부", () => {
    expect(studentStatus(makeStudent()).prog).toBe("todo");
    expect(studentStatus(makeStudent({ progressConfirmed: true })).prog).toBe("ok");
  });
  it("테스트: 둘 다=ok, 하나=warn, 없음=todo", () => {
    const both = makeStudent({
      tests: { daily: { score: 10, max: 20, prevScore: null }, check: { score: 10, max: 20, prevScore: null } },
    });
    const one = makeStudent({
      tests: { daily: { score: 10, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
    });
    expect(studentStatus(both).test).toBe("ok");
    expect(studentStatus(one).test).toBe("warn");
    expect(studentStatus(makeStudent()).test).toBe("todo");
  });
  it("비활성 테스트는 요구하지 않는다 — 둘 다 off면 항목 없음=ok(카운트 0 고정 방지 #25)", () => {
    // 둘 다 off = 요구 0 → ok(입력 무관)
    expect(studentStatus(makeStudent(), { dailyEnabled: false, checkEnabled: false }).test).toBe("ok");
    // daily만 on: 일일 입력하면 ok(확인 off라 미요구)
    const dailyOnly = makeStudent({
      tests: { daily: { score: 10, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
    });
    expect(studentStatus(dailyOnly, { dailyEnabled: true, checkEnabled: false }).test).toBe("ok");
    // daily on·미입력 + check off → 요구 미충족 → todo
    expect(studentStatus(makeStudent(), { dailyEnabled: true, checkEnabled: false }).test).toBe("todo");
  });
  it("보고서: 발송=ok, 초안=warn, 공백=todo", () => {
    expect(studentStatus(makeStudent({ reportSent: true })).rep).toBe("ok");
    expect(studentStatus(makeStudent({ reportDraft: "내용" })).rep).toBe("warn");
    expect(studentStatus(makeStudent({ reportDraft: "   " })).rep).toBe("todo");
  });
});

describe("isStudentDone", () => {
  it("진·테·보 모두 ok여야 완료", () => {
    const done = makeStudent({
      progressConfirmed: true,
      reportSent: true,
      tests: { daily: { score: 10, max: 20, prevScore: null }, check: { score: 10, max: 20, prevScore: null } },
    });
    expect(isStudentDone(done)).toBe(true);
    expect(isStudentDone(makeStudent({ progressConfirmed: true }))).toBe(false);
  });
});

describe("buildReport", () => {
  it("이름과 오늘 진도를 포함", () => {
    const r = buildReport(makeStudent({ name: "김서연" }));
    expect(r).toContain("김서연 학생");
    expect(r).toContain("영어 독해 Unit 2");
  });

  it("평균 90 이상 → 안정적 성취 마무리", () => {
    const r = buildReport(
      makeStudent({
        tests: { daily: { score: 18, max: 20, prevScore: 16 }, check: { score: 19, max: 20, prevScore: 17 } },
      }),
    );
    expect(r).toContain("안정적인 성취");
  });

  it("평균 70~89 → 꾸준히 마무리", () => {
    const r = buildReport(
      makeStudent({
        tests: { daily: { score: 16, max: 20, prevScore: null }, check: { score: 15, max: 20, prevScore: null } },
      }),
    );
    expect(r).toContain("꾸준히 잘 따라오고");
  });

  it("평균 70 미만 → 복습 필요 마무리", () => {
    const r = buildReport(
      makeStudent({
        tests: { daily: { score: 11, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
      }),
    );
    expect(r).toContain("복습이 필요");
  });

  it("점수 미입력이면 테스트 문장·마무리 없음", () => {
    const r = buildReport(makeStudent());
    expect(r).not.toContain("결과를 받았습니다");
    expect(r).not.toContain("성취");
    expect(r).not.toContain("복습");
  });

  it("태도가 있으면 태도·과제 문장 포함", () => {
    const r = buildReport(makeStudent({ attitude: "아주 좋음", homework: "완료" }));
    expect(r).toContain("수업 태도는 '아주 좋음'");
    expect(r).toContain("과제는 완료");
  });

  it("태도만 있고 과제 미입력이면 과제 문구 생략", () => {
    const r = buildReport(makeStudent({ attitude: "보통", homework: "" }));
    expect(r).toContain("수업 태도는 '보통'입니다");
    expect(r).not.toContain("과제는");
  });

  it("과제만 있고 태도 없으면 과제 문장 단독 포함", () => {
    const r = buildReport(makeStudent({ attitude: null, homework: "완료" }));
    expect(r).toContain("과제는 완료 상태입니다");
    expect(r).not.toContain("수업 태도");
  });

  it('과제 "—"는 미입력으로 취급(문구 생략)', () => {
    const r = buildReport(makeStudent({ attitude: "좋음", homework: "—" }));
    expect(r).not.toContain("과제는");
  });

  it("직전 회차 대비 증감 꼬리표", () => {
    const up = buildReport(
      makeStudent({
        tests: { daily: { score: 18, max: 20, prevScore: 16 }, check: { score: null, max: 20, prevScore: null } },
      }),
    );
    expect(up).toContain("지난 회차 대비 ▲2점");

    const same = buildReport(
      makeStudent({
        tests: { daily: { score: 16, max: 20, prevScore: 16 }, check: { score: null, max: 20, prevScore: null } },
      }),
    );
    expect(same).toContain("지난 회차와 동일");
  });
});

describe("buildSubjectReport (과목별)", () => {
  const st = makeStudent({
    name: "윤서아",
    subjects: [
      { name: "국어 문학", prev: "현대시 4강", today: "현대시 5강" },
      { name: "영어 어법", prev: "분사구문", today: "가정법" },
    ],
    tests: {
      daily: { score: 16, max: 20, prevScore: 16 },
      check: { score: 18, max: 20, prevScore: 15 },
    },
  });

  it("0번 과목(국어)만 언급 — 영어 안 섞임", () => {
    const r = buildSubjectReport(st, 0);
    expect(r).toContain("국어 문학 현대시 5강");
    expect(r).not.toContain("영어 어법");
    expect(r).not.toContain("가정법");
  });

  it("1번 과목(영어)만 언급 — 국어 안 섞임", () => {
    const r = buildSubjectReport(st, 1);
    expect(r).toContain("영어 어법 가정법");
    expect(r).not.toContain("국어 문학");
    expect(r).not.toContain("현대시");
  });

  it("범위 밖 인덱스는 합본으로 폴백", () => {
    const r = buildSubjectReport(st, 9);
    expect(r).toContain("국어 문학");
    expect(r).toContain("영어 어법");
  });
});
