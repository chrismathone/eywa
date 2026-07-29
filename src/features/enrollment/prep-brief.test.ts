import { describe, expect, it } from "vitest";
import {
  buildFactsBlock,
  buildFallbackPrepBrief,
  matchesSubjectCategory,
  normalizeSchool,
  phoneVariants,
  classLine,
  conflictsSchoolLevel,
  formatSchedule,
  gradeToken,
  rankPrepClasses,
  seatsLeft,
  validatePrepBrief,
  type PrepFacts,
} from "./prep-brief";

const facts = (over: Partial<PrepFacts> = {}): PrepFacts => ({
  student: {
    name: "이태경",
    grade: "중1",
    school: "경명여중",
    subjectLabel: "수학",
    genderLabel: null,
    careerGoal: null,
    request: null,
    shuttleRequest: false,
    siblingsText: null,
    safetyNotes: null,
    consultationPath: null,
    enrolledNow: null,
  },
  parent: { name: "김미영", relation: "모" },
  checklist: [{ question: "가장 걱정되는 것", answer: "또래보다 진도가 늦은 것 같다" }],
  habits: [{ label: "도움 없이 공부를 시작한다", score: 2 }],
  priorConsults: [],
  siblings: [],
  classes: [
    {
      id: "c1",
      className: "중1 수학 A",
      subjectLabel: "수학",
      teacherName: "박선생",
      scheduleLabel: "월·수·금 16:30",
      seats: 12,
      enrolled: 9,
      notes: null,
      gradeMatched: true,
    },
  ],
  tuition: [{ category: "수학", name: "주3회", price: 280000, modeLabel: "회당 단가", note: null }],
  textbooks: [],
  peers: { sameSchool: 14, sameGrade: 22, total: 310 },
  policy: {
    academyName: "인재원",
    dueDay: 5,
    latePolicy: null,
    shuttleEnabled: false,
    shuttleFee: null,
    shuttleRoutes: [],
  },
  ...over,
});

const brief = (over: Record<string, unknown> = {}) => ({
  headline: "중1 수학 · 진도 지연 걱정이 핵심인 상담",
  opening: "접수 폼에 또래보다 진도가 늦은 것 같다고 적어주신 부분을 먼저 확인하고 왔습니다.",
  questions: ["현재 사용 중인 교재와 진도 확인", "가능한 등원 요일 확인"],
  playbook: [
    {
      concern: "또래보다 진도가 늦다",
      evidence: "접수 폼 걱정 항목",
      response: "현재 진도를 먼저 진단한 뒤 어디를 채울지 설명한다.",
    },
  ],
  proposal: "중1 수학 A 반을 제안한다. 월·수·금 16:30 수업이고 잔여 3석이다.",
  objections: [{ objection: "비교해 보고 결정하겠다", answer: "필요한 자료를 정리해 드린다." }],
  closing: "다음 단계로 레벨테스트 일정을 잡고 마무리한다.",
  cautions: ["학습 행동 자가평가가 낮으니 아이를 탓하는 표현을 피할 것"],
  ...over,
});

describe("gradeToken", () => {
  it("학제+숫자를 축약 토큰으로", () => {
    expect(gradeToken("중학교 1학년")).toBe("중1");
    expect(gradeToken("중1")).toBe("중1");
    expect(gradeToken("고3")).toBe("고3");
  });
  it("숫자가 없으면 학제만, 값이 없으면 null", () => {
    expect(gradeToken("초등")).toBe("초");
    expect(gradeToken(null)).toBeNull();
    expect(gradeToken("  ")).toBeNull();
  });
});

describe("rankPrepClasses", () => {
  const pool: (Omit<import("./prep-brief").PrepClassFact, "gradeMatched">)[] = [
    { id: "a", className: "중1 수학 A", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: 12, enrolled: 12, notes: null },
    { id: "b", className: "중1 수학 B", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: 12, enrolled: 4, notes: null },
    { id: "c", className: "중2 수학", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: 12, enrolled: 1, notes: null },
    { id: "d", className: "중1 영어", subjectLabel: "영어", teacherName: null, scheduleLabel: null, seats: 12, enrolled: 1, notes: null },
  ];

  it("과목+학년 일치가 먼저, 같은 등급 안에서는 자리 많은 반 먼저 — 타학년('중2 수학')은 배제", () => {
    const ranked = rankPrepClasses(pool, { subjectKeyLabel: "수학", grade: "중1" });
    expect(ranked.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("과목이 다르면 학년이 맞아도 뒤로 — 수학 상담에 영어 반이 앞서지 않는다", () => {
    const ranked = rankPrepClasses(pool, { subjectKeyLabel: "수학", grade: "중1" });
    expect(ranked.find((c) => c.id === "d")).toBeUndefined();
  });

  it("과목·학년 모두 미상이면 전체를 후보로 둔다(빈 목록으로 만들지 않는다)", () => {
    const ranked = rankPrepClasses(pool, { subjectKeyLabel: null, grade: null });
    expect(ranked).toHaveLength(4);
  });

  it("다른 학제가 명시된 반은 과목이 맞아도 배제 — 중1 상담지에 '[특강] 고등개별' 금지 (적대 검수 07-28 실사례)", () => {
    const withSpecial = pool.concat([
      { id: "e", className: "[특강] 고등개별", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: null, enrolled: 5, notes: null },
      { id: "f", className: "초등 연산 집중", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: null, enrolled: 3, notes: null },
    ]);
    const ranked = rankPrepClasses(withSpecial, { subjectKeyLabel: "수학", grade: "중1" });
    expect(ranked.map((c) => c.id)).not.toContain("e");
    expect(ranked.map((c) => c.id)).not.toContain("f");
  });

  it("학제 표기가 아예 없는 반은 남긴다 — 없는 정보로 배제하면 과소포함", () => {
    const withNeutral = pool.concat([
      { id: "g", className: "EIE M3", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: null, enrolled: 2, notes: null },
    ]);
    const ranked = rankPrepClasses(withNeutral, { subjectKeyLabel: "수학", grade: "중1" });
    expect(ranked.map((c) => c.id)).toContain("g");
  });
});

describe("conflictsSchoolLevel", () => {
  it("다른 학제 명시 반을 감지한다", () => {
    expect(conflictsSchoolLevel("[특강] 고등개별", "중1")).toBe(true);
    expect(conflictsSchoolLevel("초3 연산", "중1")).toBe(true);
    expect(conflictsSchoolLevel("중등M 중1 BS3C", "중1")).toBe(false);
  });
  it("같은 학제라도 다른 학년 숫자가 명시되면 충돌 — '[특강]중2-2 문제 풀이반'은 중1 후보 아님 (실사례)", () => {
    expect(conflictsSchoolLevel("[특강]중2-2 문제 풀이반", "중1")).toBe(true);
    expect(conflictsSchoolLevel("중3 심화", "중1")).toBe(true);
    // 학제만 표기("중등M")는 학년 충돌 아님.
    expect(conflictsSchoolLevel("중등M 종합", "중1")).toBe(false);
  });
  it("학생 학년 숫자를 모르면 학년 비교는 생략(학제만 비교)", () => {
    expect(conflictsSchoolLevel("중2 심화", "중")).toBe(false);
    expect(conflictsSchoolLevel("고등개별", "중")).toBe(true);
  });
  it("학제 미상(학생·반 어느 쪽이든)은 충돌 아님", () => {
    expect(conflictsSchoolLevel("EIE M3", "중1")).toBe(false);
    expect(conflictsSchoolLevel("[특강] 고등개별", null)).toBe(false);
  });
});

describe("formatSchedule", () => {
  it("전 요일 같은 시각이면 압축 표기", () => {
    expect(
      formatSchedule([
        { day: "wed", start: "16:30:00" },
        { day: "mon", start: "16:30:00" },
        { day: "fri", start: "16:30:00" },
      ]),
    ).toBe("월·수·금 16:30");
  });
  it("요일별 시각이 다르면 요일마다 명기 — 이른 시각 하나로 뭉뚱그리면 거짓말", () => {
    expect(
      formatSchedule([
        { day: "thu", start: "18:20:00" },
        { day: "mon", start: "16:20:00" },
      ]),
    ).toBe("월 16:20 · 목 18:20");
  });
  it("시각 미상 슬롯은 요일만/시간 미상으로", () => {
    expect(formatSchedule([{ day: "sat", start: null }])).toBe("토");
    expect(formatSchedule([])).toBeNull();
  });
});

describe("seatsLeft / classLine", () => {
  it("정원 미지정은 null — 0석으로 단정하지 않는다", () => {
    expect(seatsLeft({ seats: null, enrolled: 5 })).toBeNull();
    expect(classLine({ ...facts().classes[0]!, seats: null, enrolled: 5 })).toContain("정원 미지정");
  });
  it("잔여석은 음수로 내려가지 않는다", () => {
    expect(seatsLeft({ seats: 10, enrolled: 13 })).toBe(0);
  });
});

describe("validatePrepBrief — grounding", () => {
  it("사실에 근거한 브리프는 통과", () => {
    const r = validatePrepBrief(brief(), facts());
    expect(r.ok).toBe(true);
  });

  it("사실에 없는 금액을 지어내면 탈락", () => {
    const r = validatePrepBrief(
      brief({ proposal: "중1 수학 A 반은 월 150000원입니다." }),
      facts(),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("근거 없는 숫자");
  });

  it("사실에 없는 인원수를 지어내면 탈락", () => {
    const r = validatePrepBrief(brief({ closing: "같은 학교 학생이 87명 다니고 있습니다." }), facts());
    expect(r.ok).toBe(false);
  });

  it("사실에 있는 숫자는 그대로 쓸 수 있다", () => {
    const r = validatePrepBrief(brief({ closing: "같은 학교 재원생이 14명 있습니다." }), facts());
    expect(r.ok).toBe(true);
  });

  it("천 단위 구분 기호가 붙은 단가표 금액도 통과", () => {
    const r = validatePrepBrief(brief({ proposal: "주3회 280,000원 기준으로 안내한다." }), facts());
    expect(r.ok).toBe(true);
  });

  it("한 자리 숫자는 일반 표현이라 허용", () => {
    const r = validatePrepBrief(brief({ closing: "다음 단계를 2가지로 정리해 마무리한다." }), facts());
    expect(r.ok).toBe(true);
  });

  it("사실에 없는 영문 토큰(raw 코드·환각 반명)은 탈락", () => {
    const r = validatePrepBrief(brief({ headline: "중1 math 진도 지연 상담" }), facts());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("근거 없는 영문");
  });

  it("사실 블록에 등장한 영문(반 이름 등)은 허용", () => {
    const f = facts();
    f.classes[0]!.className = "EIE M3";
    const r = validatePrepBrief(brief({ proposal: "EIE M3 반을 제안한다." }), f);
    expect(r.ok).toBe(true);
  });

  it("필수 항목이 비면 탈락", () => {
    expect(validatePrepBrief(brief({ headline: "" }), facts()).ok).toBe(false);
    expect(validatePrepBrief(brief({ questions: [] }), facts()).ok).toBe(false);
    expect(validatePrepBrief(brief({ playbook: [] }), facts()).ok).toBe(false);
  });

  it("개설 반이 없어 제안이 비는 것은 정상 — proposal만 빈 문자열은 통과", () => {
    const r = validatePrepBrief(brief({ proposal: "" }), facts({ classes: [] }));
    expect(r.ok).toBe(true);
  });

  it("형식이 아니면 탈락", () => {
    expect(validatePrepBrief(null, facts()).ok).toBe(false);
    expect(validatePrepBrief("문자열", facts()).ok).toBe(false);
  });
});

describe("buildFactsBlock", () => {
  it("형제 재원생의 현재 수강 반까지 사실로 싣는다 — 상담에서 인용 가능해야 한다", () => {
    const f = facts({
      siblings: [{ name: "이태윤", school: "경명중", grade: "중3", classNames: ["중3 수학 B"] }],
    });
    const block = buildFactsBlock(f);
    expect(block).toContain("이태윤");
    expect(block).toContain("현재 수강: 중3 수학 B");
    // 사실에 실렸으면 브리프에서 그 반을 언급해도 검증을 통과해야 한다.
    expect(validatePrepBrief(brief({ closing: "형제가 중3 수학 B에 재원 중임을 언급한다." }), f).ok).toBe(true);
  });

  it("연락처·주소는 사실 블록에 싣지 않는다(AI 전송·인쇄물 노출 방지)", () => {
    const block = buildFactsBlock(facts());
    expect(block).not.toContain("010");
    expect(block.toLowerCase()).not.toContain("phone");
  });

  it("수강료엔 단가 종류를 함께 명기 — 회당 단가를 월 수강료로 오안내 금지", () => {
    const block = buildFactsBlock(facts());
    expect(block).toContain("주3회: 280000원 (회당 단가)");
    // 미지정이면 미지정임을 명기(월액 단정 금지 지침이 프롬프트에 함께 들어간다).
    const noMode = facts({ tuition: [{ category: "수학", name: "특강", price: 90000, modeLabel: null, note: null }] });
    expect(buildFactsBlock(noMode)).toContain("특강: 90000원 (단가 종류 미지정)");
  });

  // 셔틀은 접수 폼이 이미 묻는 항목 — 답을 양방향으로 실어야 LLM이 되묻지 않는다(원장 지적 2026-07-29).
  it("셔틀 미신청도 사실로 명시하고, 요금·노선은 싣지 않는다", () => {
    const f = facts({
      policy: { ...facts().policy, shuttleEnabled: true, shuttleFee: "월 20,000원", shuttleRoutes: ["1호차 주요 노선"] },
    });
    const block = buildFactsBlock(f);
    expect(block).toContain("셔틀버스: 접수서에서 신청하지 않음(미신청)");
    // 요금·노선이 사실에 없으면 grounding 화이트리스트에도 없어 브리프가 금액을 언급할 수 없다.
    expect(block).not.toContain("20,000");
    expect(block).not.toContain("1호차");
    expect(validatePrepBrief(brief({ questions: ["셔틀 이용을 원하시나요? (월 20,000원)"] }), f).ok).toBe(false);
  });

  it("셔틀 신청 건은 요금·노선을 함께 싣는다(탑승 위치 확정용)", () => {
    const f = facts({
      student: { ...facts().student, shuttleRequest: true },
      policy: { ...facts().policy, shuttleEnabled: true, shuttleFee: "월 20,000원", shuttleRoutes: ["1호차 주요 노선"] },
    });
    const block = buildFactsBlock(f);
    expect(block).toContain("셔틀버스: 접수서에서 신청함");
    expect(block).toContain("월 20,000원");
    expect(block).toContain("1호차 주요 노선");
  });

  it("셔틀 미운영 학원은 셔틀 줄 자체가 없다", () => {
    expect(buildFactsBlock(facts())).not.toContain("셔틀");
  });
});

describe("buildFallbackPrepBrief", () => {
  it("사실만으로도 빈 항목 없이 채운다", () => {
    const b = buildFallbackPrepBrief(facts());
    expect(b.headline).toContain("이태경");
    expect(b.questions.length).toBeGreaterThan(0);
    expect(b.playbook.length).toBeGreaterThan(0);
    expect(b.cautions.length).toBeGreaterThan(0);
    expect(b.proposal).toContain("중1 수학 A");
  });

  it("폴백도 자기 검증을 통과한다 — 지어낸 숫자·영문이 없다", () => {
    const f = facts();
    expect(validatePrepBrief(buildFallbackPrepBrief(f), f).ok).toBe(true);
  });

  it("체크리스트가 비어도 브리프를 만든다(수기 접수 건)", () => {
    const f = facts({ checklist: [], habits: [] });
    const b = buildFallbackPrepBrief(f);
    expect(b.playbook.length).toBeGreaterThan(0);
    expect(validatePrepBrief(b, f).ok).toBe(true);
  });

  it("개설 반이 없으면 주의에 명시한다 — 없는 반을 제안하지 않는다", () => {
    const b = buildFallbackPrepBrief(facts({ classes: [] }));
    expect(b.proposal).toBe("");
    expect(b.cautions.join(" ")).toContain("개설 반");
  });

  it("접수 폼이 이미 답한 항목은 폴백도 되묻지 않는다(형제자매·셔틀)", () => {
    const answered = buildFallbackPrepBrief(facts({ student: { ...facts().student, siblingsText: "없음(외동)" } }));
    expect(answered.questions.join(" ")).not.toContain("형제자매 재원 여부");
    expect(answered.questions.join(" ")).not.toContain("셔틀");
    // 답이 없으면 종전대로 묻는다(수기 접수 건).
    expect(buildFallbackPrepBrief(facts()).questions.join(" ")).toContain("형제자매 재원 여부");
    // 신청한 경우엔 '이용하시나요'가 아니라 노선 확정만.
    const applied = buildFallbackPrepBrief(facts({ student: { ...facts().student, shuttleRequest: true } }));
    expect(applied.questions.join(" ")).toContain("셔틀 탑승 위치와 이용 노선 확정");
  });
});

describe("실데이터 배선 가드 (감사 2026-07-29)", () => {
  it("부서 접두사 반이라도 학생 학제가 이름에 있으면 후보로 남긴다", () => {
    // "중등M 초6 JJ2A" = 중등부가 운영하는 초6 반. 접두사만 보고 빼면 초6 학생이 자기 반을 못 본다.
    expect(conflictsSchoolLevel("중등M 초6 JJ2A", "초6")).toBe(false);
    expect(conflictsSchoolLevel("중등E_초등 브릿지 A", "초5")).toBe(false);
    expect(conflictsSchoolLevel("고등E_중3 최상위", "중3")).toBe(false);
  });

  it("학생 학제 표기가 없는 타학제 반은 계속 배제한다", () => {
    expect(conflictsSchoolLevel("[특강] 고등개별", "중1")).toBe(true);
    expect(conflictsSchoolLevel("중등M 중2 PS3A", "중1")).toBe(true);
  });

  it("정원이 전부 미상이면 현원 적은 반이 먼저 온다(이름순 아님)", () => {
    const pool = [
      { id: "big", className: "중1 수학 B", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: null, enrolled: 14, notes: null },
      { id: "small", className: "중1 수학 C", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: null, enrolled: 3, notes: null },
    ];
    expect(rankPrepClasses(pool, { subjectKeyLabel: "수학", grade: "중1" })[0]!.id).toBe("small");
  });

  it("학교명은 전체형·압축형을 같은 학교로 본다", () => {
    expect(normalizeSchool("칠성초등학교")).toBe("칠성초");
    expect(normalizeSchool("성광중학교")).toBe("성광중");
    expect(normalizeSchool("경명여자중학교")).toBe("경명여자중");
    expect(normalizeSchool("  ")).toBeNull();
  });

  it("전화번호는 하이픈 유무 양쪽 포맷을 후보로 만든다", () => {
    const v = phoneVariants("01067332180");
    expect(v).toContain("01067332180");
    expect(v).toContain("010-6733-2180");
    expect(phoneVariants("010-6733-2180")).toContain("01067332180");
    expect(phoneVariants("정유진")).toEqual([]); // 이름이 들어간 레거시 행은 조회 자체를 안 한다
  });

  it("영어 상담은 EIE 분류 단가도 함께 본다(초등 영어 본프로그램)", () => {
    expect(matchesSubjectCategory("EIE", "영어")).toBe(true);
    expect(matchesSubjectCategory("영어", "영어")).toBe(true);
    expect(matchesSubjectCategory("EIE", "수학")).toBe(false);
    expect(matchesSubjectCategory("수학", "수학")).toBe(true);
  });
});

describe("이미 재원 중인 학생", () => {
  it("재원 사실과 현재 수강 반을 사실 블록에 명시한다", () => {
    const f = facts();
    f.student.enrolledNow = { classNames: ["중등M 중1 BS3E"] };
    const block = buildFactsBlock(f);
    expect(block).toContain("이미 우리 학원 재원생임");
    expect(block).toContain("중등M 중1 BS3E");
  });
});
