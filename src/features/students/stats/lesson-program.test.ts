import { describe, expect, it } from "vitest";
import { isEieLesson, lessonProgramClassifier, teacherTokens, wordTokens } from "./lesson-program";

const SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "science", label: "과학" },
  { key: "korean", label: "국어" },
];
const names = (...rows: [string, number][]) => rows.map(([name, weight]) => ({ name, weight }));

describe("lessonProgramClassifier — 2026-10-28 과목 낱말(메이크에듀 '과목 모름'으로 남던 것)", () => {
  it("매쓰몽·기벡 = 수학 · 영단어·voca = 영어 · 과목이 갈리는 낱말(SKY·문법)은 정하지 않는다", () => {
    const classify = lessonProgramClassifier([], SUBJECTS);
    expect(classify("매쓰몽사고력정규1A/2A(월) / 사고력교과")).toBe("math");
    expect(classify("하승훈 기벡2T 목토")).toBe("math");
    expect(classify("(여름특강)중등필수영단어반 화토2T")).toBe("injaewon");
    expect(classify("Power Voca 반")).toBe("injaewon");
    expect(classify("초등 SKY 월수목")).toBeNull();
    expect(classify("중등 핵심문법완성반")).toBeNull();
  });
});

describe("lessonProgramClassifier — 옛 강사 `loose`(원장 2026-10-28 \"디올 승헌 수학 · 브라이언 영어 · (임) 수학\")", () => {
  const former = [
    { names: ["디올", "Rich", "(임)"], subjects: ["math"], loose: true },
    { names: ["브라이언"], subjects: ["english"], loose: true },
  ];
  it("강사 표시 모양이 아니어도 이름이 보이면 그 과목 — '(디올)'·소문자 'richY'·'브라이언 …'·'금(이)' 꼴 괄호", () => {
    const cls = lessonProgramClassifier([], SUBJECTS, former);
    expect(cls("중2 내신대비 주말보충2T 토 (디올)")).toBe("math");
    expect(cls("중등S특별반_화금 richY")).toBe("math");
    expect(cls("브라이언 시그니처 MID 1S 2T(3h) 화금")).toBe("injaewon");
    expect(cls("인재원 초6 중등프리미엄(오끝) 월목2(임)")).toBe("math");
    expect(cls("인재원 금(임) 특강")).toBe("math");
  });
  it("🔴 모름일 때만 — 과목 이름이 적힌 반은 그 과목 · 두 과목 합반·강사 표시가 엇갈린 반은 모름 그대로 · 경계 밖 이름은 아니다", () => {
    const cls = lessonProgramClassifier([], SUBJECTS, former);
    expect(cls("디올T 초등 과학 탐구")).toBe("science");
    expect(cls("수학 영어 통합반 (디올)")).toBeNull();
    expect(cls("Richard 특강")).toBeNull();
    expect(cls("Enrich 특강")).toBeNull();
    expect(cls("이디올 특강")).toBeNull();
    expect(lessonProgramClassifier([], SUBJECTS, former.map((f) => ({ ...f, loose: false })))("중2 주말보충 (디올)")).toBeNull();
    const mixed = lessonProgramClassifier([], SUBJECTS, [...former, { names: ["Gana"], subjects: ["english"] }, { names: ["Rama"], subjects: ["math"] }]);
    expect(mixed("(토) 특강 Gana Rama 디올")).toBeNull(); // 강사 표시 둘이 엇갈림 — 메우지 않는다
  });
});

describe("lessonProgramClassifier — 수업명 → 프로그램(지난 기록)", () => {
  it("실제 설정된 중국어와 전각 괄호 과목 라벨을 보존한다", () => {
    const classify = lessonProgramClassifier([], [...SUBJECTS, { key: "chinese", label: "중국어" }, { key: "advanced_korean", label: "국어（심화）" }]);
    expect(classify("중국어 A")).toBe("chinese");
    expect(classify("중국어 및 국어 합반")).toBeNull();
    expect(classify("국어(심화) A")).toBe("advanced_korean");
    expect(classify("외국어 A")).toBeNull();
  });
  it("과거 수납명의 수학 과정 약칭과 영어 학습 명칭을 구별한다", () => {
    const classify = lessonProgramClassifier([], SUBJECTS);
    for (const name of ["중1 함수", "김선생 수I", "고등수1 월", "공수2 화금", "(겨울특강)수(Ⅱ)완성", "2026년 상반기 KUT", "여름방학특강고등하 2T(3H)"]) expect(classify(name)).toBe("math");
    for (const name of ["고등어법특강", "Inside Out Shadowing", "수행평가 영작 미리보기"]) expect(classify(name)).toBe("injaewon");
    for (const name of ["수요일 특강", "수능 대비", "서술형 특강", "국어 수학 통합", "고등학교 하교 지도"]) expect(classify(name)).toBeNull();
  });
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
