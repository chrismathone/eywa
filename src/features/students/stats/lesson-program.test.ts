import { describe, expect, it } from "vitest";
import { isEieLesson, lessonProgramClassifier, teacherTokens, wordTokens } from "./lesson-program";

const SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "science", label: "과학" },
  { key: "korean", label: "국어" },
];
const names = (...rows: [string, number][]) => rows.map(([name, weight]) => ({ name, weight }));

describe("lessonProgramClassifier — 수업명 → 프로그램(지난 기록)", () => {
  it("① EiE 표시 · ② 과목 이름 · ③ 학년 머리글(M·E)과 과목 낱말", () => {
    const cls = lessonProgramClassifier([], SUBJECTS);
    expect(cls("[EiE] ROOKIES&LEADERS 44,000")).toBe("eie");
    expect(cls("[EIE] Pre Junior 6")).toBe("eie");
    expect(cls("중등수학 2T 월목 Alpha")).toBe("math");
    expect(cls("중등영어완성특반 화금토 Beta")).toBe("injaewon"); // 영어 = EiE 표시가 없으면 인재원 영어
    expect(cls("초등 과학 탐구")).toBe("science");
    expect(cls("고등E정규2T월목Beta")).toBe("injaewon");
    expect(cls("중등M 중1 BS3C")).toBe("math");
    expect(cls("중2E정규(3시간)월목")).toBe("injaewon");
    expect(cls("초5Bridge-TOP 3T 화수금")).toBe("injaewon");
    expect(cls("[특강] 중1도형특강")).toBe("math");
  });

  it("두 과목이 적힌 합반은 모름(강사 표시로도 정하지 않는다) · 과목이 아닌 낱말 · 영문 과목 이름은 낱말로만", () => {
    const cls = lessonProgramClassifier(names(["중등영어 정규 Brian", 30], ["고등영어 특강 Brian", 20]), SUBJECTS);
    expect(cls("수학 영어 통합반 Brian")).toBeNull();
    expect(cls("중국어 회화")).toBeNull();
    expect(cls("과학고 대비반")).toBeNull();
    expect(cls("(토) 모의고사 특강")).toBeNull();
    // 'Mathew'는 math 키가 아니다 — 머리글 E로 영어.
    expect(lessonProgramClassifier([], [...SUBJECTS, { key: "mathx", label: "Math" }])("고등E정규 Mathew")).toBe("injaewon");
  });

  it("④ 강사 표시 — 같은 별명의 다른 수업명이 줄 수·수업명 수로 90% 이상(10줄 · 2개 이상) · 섞였거나 근거가 적으면 모름", () => {
    const cls = lessonProgramClassifier(
      names(
        ["중등수학 2T 월목 Alpha", 40],
        ["고등수학 1T 수 Alpha", 30],
        ["중등영어 정규 Beta", 20],
        ["고등영어 정규 Beta", 15],
        ["중등수학 보강 Gamma", 10],
        ["중등영어 보강 Gamma", 10],
        ["중등영어 대타 Delta", 30], // 수업명 하나뿐 — 배우지 않는다
        ["(토) 모의고사 특강 Alpha", 10],
        ["(토) 모의고사 특강 Beta", 10],
        ["(토) 모의고사 특강 Gamma", 10],
        ["(토) 모의고사 특강 Delta", 10],
      ),
      SUBJECTS,
    );
    expect(cls("(토) 모의고사 특강 Alpha")).toBe("math");
    expect(cls("(토) 모의고사 특강 Beta")).toBe("injaewon");
    expect(cls("(토) 모의고사 특강 Gamma")).toBeNull(); // 두 과목 반반
    expect(cls("(토) 모의고사 특강 Delta")).toBeNull(); // 근거가 수업명 하나
  });

  it("직원 정보가 먼저 — 대타 수업 몇 줄이 담당 과목을 뒤집지 않는다 · 'OOO반'·'(OOO)'는 사람 이름 모양만", () => {
    const cls = lessonProgramClassifier(
      names(["중등영어 대타 (김가나)", 3], ["고등영어 대타 (김가나)", 8], ["[강아] 강의하는아이들 (김가나)", 60], ["토요 서술형 정규반", 12], ["(월목) 서술형 특강", 12]),
      SUBJECTS,
      [{ names: ["김가나", "Gana Kim"], subjects: ["math"] }],
    );
    expect(cls("[강아] 강의하는아이들 (김가나)")).toBe("math");
    expect(cls("토요 서술형 정규반")).toBeNull();
    expect(cls("(월목) 서술형 특강")).toBeNull();
    expect(teacherTokens("(토)1:00 고등모의고사 특강 Brian")).toEqual(["brian"]);
    expect(teacherTokens("고등 SKY영특반 정규반 (월목)")).toEqual([]); // 약자·흔한 낱말·요일은 강사가 아니다
  });

  it("직원 이름이 같고 담당 묶음이 다르면 그 이름은 쓰지 않는다 · 영문 이름은 낱말마다", () => {
    const cls = lessonProgramClassifier([], SUBJECTS, [
      { names: ["박사자", "Brian Park"], subjects: ["english"] },
      { names: ["박사자", null], subjects: ["math"] },
    ]);
    expect(cls("[강아] 강의하는아이들 (박사자)")).toBeNull();
    expect(cls("(토) 모의고사 특강 Brian")).toBe("injaewon");
  });

  it("⑤ 두 번 돈다 — 강사로 정해진 수업명이 프로그램 낱말을 가르친다('[인재원] 강의하는아이들') · 낱말은 수업명 3개 이상", () => {
    const cls = lessonProgramClassifier(
      names(["[강아] 강의하는아이들 (김가나)", 20], ["[강아] 강의하는아이들 (이라마)", 20], ["[강아] 강의하는아이들 (최바사)", 15], ["[인재원] 강의하는아이들", 15]),
      SUBJECTS,
      [
        { names: ["김가나"], subjects: ["math"] },
        { names: ["이라마"], subjects: ["math"] },
        { names: ["최바사"], subjects: ["math"] },
      ],
    );
    expect(cls("[인재원] 강의하는아이들")).toBe("math");
    expect(wordTokens("[인재원] 강의하는아이들")).toContain("강의하는아이들");
  });

  it("EiE 표시는 이름 앞에서만 · 대소문자 무시('[EIE] Let's Speak 6'도 EiE — 메이크에듀 집계 `ilike '[EiE]%'`와 같은 규칙)", () => {
    expect(isEieLesson("  [EiE] Let's Speak 6")).toBe(true);
    expect(isEieLesson("[EIE] Let's Speak 6")).toBe(true);
    expect(isEieLesson("보강 [EiE] Let's Speak")).toBe(false);
  });

  it("영어·수학 묶음이 설정에 없으면 머리글(M·E)로 정하지 않는다", () => {
    const cls = lessonProgramClassifier([], [{ key: "korean", label: "국어" }]);
    expect(cls("중등M 중1 BS3C")).toBeNull();
    expect(cls("중등 국어 정규")).toBe("korean");
  });
});
