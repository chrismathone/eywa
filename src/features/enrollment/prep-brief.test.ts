import { describe, expect, it } from "vitest";
import {
  applyParentAddress,
  buildFactsBlock,
  buildFallbackPrepBrief,
  parentAddress,
  matchesSubjectCategory,
  normalizeSchool,
  phoneVariants,
  classLine,
  conflictsSchoolLevel,
  formatSchedule,
  gradeToken,
  isClosedOutClass,
  isHalfPeriodClass,
  rankPrepClasses,
  seatsLeft,
  validatePrepBrief,
  tuitionFitsLevel,
  checklistToPairs,
  type PrepBrief,
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
  proposal: "중1 수학 A 반을 후보로 제안한다. 월·수·금 16:30 수업이고 현원 9명이다.",
  objections: [{ objection: "비교해 보고 결정하겠다", answer: "필요한 자료를 정리해 드린다." }],
  closing: "다음 단계로 레벨테스트 일정을 잡고 마무리한다.",
  cautions: ["학습 행동 자가평가가 낮으니 아이를 탓하는 표현을 피할 것"],
  ...over,
});

// 통과 = 고친 곳 없이 원문 그대로(적대 리뷰 2026-11-11 — `ok`만 보면 칸이 기본 문장으로 바뀌어도 통과했다).
const intact = (over: Record<string, unknown>, f = facts()) => {
  const r = validatePrepBrief(brief(over), f);
  expect(r.ok && r.repairs).toEqual([]);
  return r.ok ? r.value : null;
};

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

  it("지금 열려 있지 않은 반(배치·수강생 둘 다 없음)은 뺀다 — 현원 0이라 '현원 적은 순' 맨 앞에 서던 끝난 특강 (2026-10-26)", () => {
    const withEnded = [
      { id: "ended", className: "중1 수학 주말특강 (~26.09.19)", subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: null, enrolled: 0, notes: null, closedOut: true },
      { id: "open", className: "중1 수학 C", subjectLabel: "수학", teacherName: null, scheduleLabel: "월 16:20", seats: null, enrolled: 3, notes: null, closedOut: false },
      { id: "new", className: "중1 수학 신설", subjectLabel: "수학", teacherName: null, scheduleLabel: "화 18:20", seats: null, enrolled: 0, notes: null, closedOut: false },
    ];
    const ranked = rankPrepClasses(withEnded, { subjectKeyLabel: "수학", grade: "중1" });
    expect(ranked.map((c) => c.id)).toEqual(["new", "open"]);
  });

  it("isClosedOutClass — 배치도 학생도 없을 때만(하나라도 있으면 남긴다)", () => {
    expect(isClosedOutClass(0, 0)).toBe(true);
    expect(isClosedOutClass(0, 2)).toBe(false); // 배치 자료가 비었어도 학생이 다니면 남긴다
    expect(isClosedOutClass(1, 0)).toBe(false); // 학생은 없어도 시간이 잡힌 반(새 반)은 남긴다
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
    // 정원·잔여석은 줄에 싣지 않는다(강의실 수용 인원이라 반 정원이 아니다 — 검수 2026-11-11) — 옛 스냅숏의 seats가 있어도 현원만.
    expect(classLine({ ...facts().classes[0]!, seats: null, enrolled: 5 })).toContain("현원 5명");
    expect(classLine({ ...facts().classes[0]!, seats: 10, enrolled: 5 })).not.toMatch(/정원|잔여/);
  });
  it("잔여석은 음수로 내려가지 않는다", () => {
    expect(seatsLeft({ seats: 10, enrolled: 13 })).toBe(0);
  });
});

describe("validatePrepBrief — grounding", () => {
  it("사실에 근거한 브리프는 고친 곳 없이 그대로", () => {
    const v = intact({});
    expect(v?.proposal).toContain("현원 9명");
  });

  // 🔴 걸린 곳만 고친다(검수 2026-11-11) — 단일 칸은 기본 문장으로, 목록 항목은 뺀다. 전체 폴백은 최소 개수 아래일 때만.
  it("사실에 없는 금액을 지어내면 그 칸을 기본 문장으로", () => {
    const r = validatePrepBrief(
      brief({ proposal: "중1 수학 A 반은 월 150000원입니다." }),
      facts(),
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.proposal).not.toContain("150000");
    expect(r.ok && r.repairs.join()).toContain("근거 없는 금액");
  });

  it("사실에 없는 인원수를 지어내면 그 칸을 기본 문장으로", () => {
    const r = validatePrepBrief(brief({ closing: "같은 학교 학생이 87명 다니고 있습니다." }), facts());
    expect(r.ok && r.value.closing).not.toContain("87명");
  });

  it("사실에 있는 숫자는 그대로 쓸 수 있다 — 사실에 없는 인원(15명)은 고친다", () => {
    expect(intact({ closing: "같은 학교 재원생이 14명 있습니다." })?.closing).toContain("14명");
    const r = validatePrepBrief(brief({ closing: "같은 학교 재원생이 15명 있습니다." }), facts());
    expect(r.ok && r.value.closing).not.toContain("15명");
  });

  it("천 단위 구분 기호가 붙은 단가표 금액도 그대로", () => {
    expect(intact({ proposal: "주3회 280,000원 기준으로 안내한다." })?.proposal).toContain("280,000원");
  });

  it("한 자리 숫자는 일반 표현이라 그대로", () => {
    expect(intact({ closing: "다음 단계를 2가지로 정리해 마무리한다." })?.closing).toContain("2가지");
  });

  it("사실에 없는 영문 토큰(raw 코드·환각 반명)은 그 칸을 기본 문장으로", () => {
    const r = validatePrepBrief(brief({ headline: "중1 math 진도 지연 상담" }), facts());
    expect(r.ok && r.value.headline).not.toContain("math");
    expect(r.ok && r.repairs.join()).toContain("근거 없는 영문");
  });

  it("사실 블록에 등장한 영문(반 이름 등)은 그대로", () => {
    const f = facts();
    f.classes[0]!.className = "EIE M3";
    expect(intact({ proposal: "EIE M3 반을 제안한다." }, f)?.proposal).toContain("EIE M3");
  });

  it("목록이 최소 개수 아래면 탈락 · 단일 칸이 비면 기본 문장", () => {
    const h = validatePrepBrief(brief({ headline: "" }), facts());
    expect(h.ok && h.value.headline.length).toBeGreaterThan(0);
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
    // 신청 = 이용 확정이 아니다(검수 2026-11-11) — 희망으로 싣고 운행과 맞는지는 상담에서 확인.
    expect(block).toContain("셔틀버스: 접수서에서 이용을 희망함");
    expect(block).toContain("월 20,000원");
    expect(block).toContain("1호차 주요 노선");
  });

  it("셔틀 미운영 학원은 셔틀 줄 자체가 없다", () => {
    expect(buildFactsBlock(facts())).not.toContain("셔틀");
  });
});

describe("학부모 호칭 (원장 지적 2026-07-29)", () => {
  it("학생 이름 + 관계 호칭으로 부른다 — 학부모 이름은 쓰지 않는다", () => {
    expect(parentAddress(facts())).toBe("이태경 어머님");
    expect(parentAddress(facts({ parent: { name: "김미영", relation: "부" } }))).toBe("이태경 아버님");
    expect(parentAddress(facts({ parent: { name: "김미영", relation: "조모" } }))).toBe("이태경 할머님");
  });

  it("관계가 없거나 '기타'면 단정하지 않고 '학부모님'", () => {
    expect(parentAddress(facts({ parent: { name: "김미영", relation: null } }))).toBe("이태경 학부모님");
    expect(parentAddress(facts({ parent: { name: null, relation: "기타" } }))).toBe("이태경 학부모님");
  });

  it("사실 블록엔 호칭만 싣고 학부모 이름은 안 싣는다(모델이 이름을 호칭으로 쓰던 원인)", () => {
    const block = buildFactsBlock(facts());
    expect(block).toContain("학부모 호칭: 이태경 어머님");
    expect(block).not.toContain("김미영");
  });

  it("모델이 이름을 써도 후처리가 호칭으로 바꾼다 — 님/어머님/맨이름 전부", () => {
    const f = facts();
    const fixed = applyParentAddress(
      brief({
        opening: "김미영님, 접수서 꼼꼼히 읽어보았습니다.",
        closing: "김미영 어머님께 결과를 다시 안내드리겠습니다.",
        cautions: ["김미영 앞에서 성적 이야기를 먼저 꺼내지 말 것"],
      }) as unknown as PrepBrief,
      f,
    );
    expect(fixed.opening).toBe("이태경 어머님, 접수서 꼼꼼히 읽어보았습니다.");
    expect(fixed.closing).toBe("이태경 어머님께 결과를 다시 안내드리겠습니다.");
    expect(fixed.cautions[0]).toBe("이태경 어머님 앞에서 성적 이야기를 먼저 꺼내지 말 것");
    expect(fixed.opening).not.toContain("김미영");
  });

  it("학부모 이름이 학생 이름에 포함되면 치환하지 않는다(학생 언급까지 망가짐)", () => {
    const f = facts({ parent: { name: "이태경", relation: "모" } });
    const fixed = applyParentAddress(
      brief({ opening: "이태경 학생의 진도를 먼저 확인했습니다." }) as unknown as PrepBrief,
      f,
    );
    expect(fixed.opening).toBe("이태경 학생의 진도를 먼저 확인했습니다.");
  });

  it("폴백 오프닝도 같은 호칭으로 시작한다", () => {
    const b = buildFallbackPrepBrief(facts());
    expect(b.opening.startsWith("이태경 어머님,")).toBe(true);
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
    expect(applied.questions.join(" ")).toContain("셔틀 희망 위치·시간이 운행 구간과 수업 시간에 맞는지 확인");
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
    const v = phoneVariants("01000009100");
    expect(v).toContain("01000009100");
    expect(v).toContain("010-0000-9100");
    expect(phoneVariants("010-0000-9100")).toContain("01000009100");
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

describe("isHalfPeriodClass — 반교시 반은 상담지에서 추천하지 않는다", () => {
  // 실측 픽스처(2026-08-04 운영 DB). 수학계열 한 교시(그룹) = 14:30~16:20 = 110분.
  const FULL = 110;
  const day = (d: string, start: string, end: string) => ({ day: d, start, end });

  it("하루 55분(세부교시 하나)만 쓰는 반 = 반교시", () => {
    // 초등M 초5 JJ1A — 월·목 16:20~17:15, 짝인 완교시 반(MS1A 14:30~16:20)과 재원 6/6 일치.
    expect(isHalfPeriodClass([day("mon", "16:20:00", "17:15:00"), day("thu", "16:20:00", "17:15:00")], FULL)).toBe(true);
  });

  it("붙어 있는 세부교시 두 개(=한 교시)를 채우면 완교시", () => {
    // 초등M 초5 MS1A — 월 14:30~15:25 + 15:25~16:20 = 110분(합집합).
    expect(
      isHalfPeriodClass([day("mon", "14:30:00", "15:25:00"), day("mon", "15:25:00", "16:20:00")], FULL),
    ).toBe(false);
  });

  it("한 행이 긴 특강(180분)도 완교시 — 행 수가 아니라 **길이**로 본다", () => {
    expect(isHalfPeriodClass([day("mon", "11:00:00", "14:00:00")], FULL)).toBe(false);
  });

  it("어느 하루라도 교시를 채우면 반교시가 아니다(짧은 요일이 섞여 있어도)", () => {
    expect(
      isHalfPeriodClass([day("mon", "14:30:00", "16:20:00"), day("thu", "16:20:00", "17:15:00")], FULL),
    ).toBe(false);
  });

  it("그룹이 없는 과목(영어 등, fullPeriodMin=null)은 판정하지 않는다", () => {
    expect(isHalfPeriodClass([day("mon", "16:20:00", "17:00:00")], null)).toBe(false);
  });

  it("평일 슬롯이 없으면(주말 전용·시각 미상) 빼지 않는다 — 모르면 그대로 둔다", () => {
    expect(isHalfPeriodClass([day("sat", "09:00:00", "10:00:00")], FULL)).toBe(false);
    expect(isHalfPeriodClass([{ day: "mon", start: null, end: null }], FULL)).toBe(false);
    expect(isHalfPeriodClass([], FULL)).toBe(false);
  });

  it("rankPrepClasses가 반교시 반을 후보에서 뺀다", () => {
    const base = { subjectLabel: "수학", teacherName: null, scheduleLabel: null, seats: null, notes: null };
    const out = rankPrepClasses(
      [
        { id: "half", className: "중1 수학 JJ", enrolled: 1, halfPeriod: true, ...base },
        { id: "full", className: "중1 수학 MS", enrolled: 5, halfPeriod: false, ...base },
      ],
      { subjectKeyLabel: "수학", grade: "중1" },
    );
    expect(out.map((c) => c.id)).toEqual(["full"]);
  });
});

describe("적대적 검수 2026-11-11 — 사실 수집·검증 회귀(Claude·Codex 합의)", () => {
  it("미취학('7세'·'유치')은 학제 '유' — 초·중·고 표기 반은 모두 배제 · '17세'는 미취학이 아니다", () => {
    expect(gradeToken("7세")).toBe("유");
    expect(gradeToken("유치부")).toBe("유");
    expect(gradeToken("17세")).not.toBe("유");
    expect(conflictsSchoolLevel("중등M 중2 PS2S", "유")).toBe(true);
    expect(conflictsSchoolLevel("EiE Dr.Phonics", "유")).toBe(false);
  });
  it("부서 접두사 역누수 — '중등M 초6 …'은 초6 학생 반이지 중1 반이 아니다", () => {
    expect(conflictsSchoolLevel("중등M 초6 MS2A", "초6")).toBe(false);
    expect(conflictsSchoolLevel("중등M 초6 MS2A", "중1")).toBe(true);
    expect(conflictsSchoolLevel("고등E_중3 최상위", "고1")).toBe(true);
  });
  it("후보 반 — 테스트 반 · 중·고 학생의 EiE 반은 뺀다", () => {
    const base = facts().classes[0]!;
    const all = [
      { ...base, id: "a", className: "EiE 월간보고서 테스트", subjectLabel: "영어" },
      { ...base, id: "b", className: "KW3", subjectLabel: "영어", eie: true },
      { ...base, id: "c", className: "중1 영어 A", subjectLabel: "영어" },
    ];
    const got = rankPrepClasses(all, { subjectKeyLabel: "영어", grade: "중1" }).map((c) => c.id);
    expect(got).toEqual(["c"]);
    expect(rankPrepClasses(all, { subjectKeyLabel: "영어", grade: "초3" }).map((c) => c.id)).toContain("b");
  });
  it("단가 학교급 — 다른 학교급 단가 · 중·고 학생의 EIE 단가는 싣지 않는다", () => {
    expect(tuitionFitsLevel("수학 고등 수능반", "중1")).toBe(false);
    expect(tuitionFitsLevel("수학 중등 정규", "중1")).toBe(true);
    expect(tuitionFitsLevel("EIE Pre Junior", "중1")).toBe(false);
    expect(tuitionFitsLevel("EIE Pre Junior", "초3")).toBe(true);
    expect(tuitionFitsLevel("수학 주3회", null)).toBe(true);
  });
  it("금액 — 쉼표 조각으로 지어낸 금액('22,000원' — 22는 인원)은 막고 '28만 원'(=280,000원)은 통과 · 회당 단가를 월로 말하면 막는다", () => {
    const f = facts();
    const bad = validatePrepBrief(brief({ closing: "회당 22,000원으로 시작하시면 됩니다." }), f);
    expect(bad.ok && bad.value.closing).not.toContain("22,000원");
    expect(validatePrepBrief(brief({ closing: "주3회 단가는 28만 원입니다. 안내드리겠습니다." }), f).ok && true).toBe(true);
    const r = validatePrepBrief(brief({ closing: "주3회 단가는 28만 원입니다. 안내드리겠습니다." }), f);
    expect(r.ok && r.value.closing).toContain("28만 원");
    const monthly = validatePrepBrief(brief({ closing: "수강료는 월 280,000원입니다. 다음 단계를 정하겠습니다." }), f);
    expect(monthly.ok && monthly.repairs.join()).toContain("회당 단가를 월 금액으로");
  });
  it("요일·시각 · 강사 · 자리 · 인원 — 사실과 다르면 그 항목만 뺀다", () => {
    const f = facts();
    const r = validatePrepBrief(
      brief({
        questions: ["화·박·금 16:30 수업이 괜찮으신지 확인", "김지훈 선생님 반을 원하시는지 확인", "잔여 2석이라 서두르셔야 하는지 확인", "같은 반 9명 중 몇 명이 친구인지", "가능한 등원 요일 확인", "지금 다니는 학원이 있는지 확인"],
      }),
      f,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.questions).toEqual(["같은 반 9명 중 몇 명이 친구인지", "가능한 등원 요일 확인", "지금 다니는 학원이 있는지 확인"]);
      expect(r.repairs.join(" ")).toMatch(/요일 표기 오류[\s\S]*사실에 없는 강사[\s\S]*자리 수 언급/);
    }
    // 사실에 없는 인원(한 자리도)은 뺀다 — 이 반 현원은 9명뿐.
    const n = validatePrepBrief(brief({ questions: ["같은 반 7명이 함께 다니는지 확인", "가능한 등원 요일 확인", "지금 공부 방식 확인"] }), f);
    expect(n.ok && n.value.questions).not.toContain("같은 반 7명이 함께 다니는지 확인");
  });
  it("약속 — 결과·서비스·기간 약속은 빼고, 부정('보장해 드릴 수는 없습니다')과 상담사 주의는 그대로", () => {
    const f = facts();
    const r = validatePrepBrief(
      brief({
        playbook: [
          { concern: "성적", evidence: "체크리스트", response: "매주 결과를 정리해 보내 드리겠습니다." },
          { concern: "선행", evidence: "체크리스트", response: "3개월 안에 따라잡도록 하겠습니다." },
          { concern: "자신감", evidence: "체크리스트", response: "성적을 보장해 드릴 수는 없지만 막히는 곳부터 함께 찾아보겠습니다." },
        ],
        cautions: ["성적 향상을 보장하는 표현은 쓰지 마세요."],
      }),
      f,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.playbook.map((p) => p.concern)).toEqual(["자신감"]);
      expect(r.value.cautions).toEqual(["성적 향상을 보장하는 표현은 쓰지 마세요."]);
    }
  });
  it("'vs' 같은 비교어 한 단어로 문서를 버리지 않는다(B26)", () => {
    expect(validatePrepBrief(brief({ closing: "4점 vs 2점이라 차이를 함께 보겠습니다." }), facts()).ok).toBe(true);
  });
  it("학부모가 '기타'에 쓴 글은 선택지와 따로(브리프 사실용) — 화면용은 합친 그대로", () => {
    const c = { goals: [], goalsEtc: "월 50만원 이하 반만", worries: [], worriesEtc: null, worryOutcome: null, levelBasis: [], levelBasisEtc: null, math: null, english: null, priorStatus: null, priorReason: null, priorNoneReason: null, advancedStatus: null, advancedReason: null, advancedNoneReason: null, changes: [], changesEtc: null, wants: [], wantsEtc: null, strengths: null, extra: null, habits: {} } as unknown as Parameters<typeof checklistToPairs>[0];
    expect(checklistToPairs(c, { separateEtc: true })).toContainEqual({ question: "가장 알고 싶은 문제(직접 쓴 글)", answer: "월 50만원 이하 반만" });
    const f = facts({ checklist: checklistToPairs(c, { separateEtc: true }) });
    const block = buildFactsBlock(f);
    expect(block).toContain("[학부모가 접수 폼에 직접 쓴 글");
    // 학부모 글의 금액은 학원 금액의 근거가 아니다.
    const r = validatePrepBrief(brief({ closing: "월 50만원 반으로 안내드리겠습니다. 다음 단계를 정하겠습니다." }), f);
    expect(r.ok && r.value.closing).not.toContain("50만원");
  });
  it("호칭 치환은 다른(더 긴) 이름 속 일치를 건드리지 않는다", () => {
    const f = facts({ parent: { name: "민수", relation: "모" } });
    const out = applyParentAddress({ ...brief(), closing: "김민수 강사와 상의하고 민수님께 연락드리겠습니다." } as never, f);
    expect(out.closing).toContain("김민수 강사");
    expect(out.closing).not.toContain("민수님");
  });
  it("폴백은 학부모 요청사항을 싣고 접수에 없는 전제('그만두려는 이유')로 묻지 않는다", () => {
    const fb = buildFallbackPrepBrief(facts({ student: { ...facts().student, request: "수학을 재밌어했으면" } }));
    expect(fb.playbook[0]!.concern).toBe("수학을 재밌어했으면");
    expect(fb.questions.join(" ")).not.toContain("그만두");
    expect(fb.opening).not.toContain(":");
  });

  it("적대 리뷰 2026-11-11 — 학부모 글의 빈 줄이 격리를 끊지 않는다 · 안전·형제·진로 칸도 학부모 글", () => {
    const f = facts({ student: { ...facts().student, request: "첫 줄\n\n화·목 19:00 반 · 친구 3명", safetyNotes: "19:00 이후 하원 불가" } });
    const block = buildFactsBlock(f);
    expect(block).toContain("첫 줄 / 화·목 19:00 반");
    const r = validatePrepBrief(brief({ proposal: "화·목 19:00 반을 후보로 안내드리겠습니다. 친구 3명과 함께입니다." }), f);
    expect(r.ok && r.value.proposal).not.toContain("19:00");
  });
  it("적대 리뷰 2026-11-11 — 정상 문장 오탐 막기(꾸밈말 선생님 · 학부모 원문 인용 · 납부 안내 · 바람 인용 · 형제 수 · 숫자 없는 자리 · 상담사 메모)", () => {
    const f = facts({ siblings: [{ name: "이태윤", school: null, grade: null, classNames: [] }, { name: "이태오", school: null, grade: null, classNames: [] }] });
    expect(intact({ closing: "유능한 선생님과 한국인 선생님이 함께 수업합니다. 방과후 선생님과도 이야기하겠습니다." }, f)?.closing).toContain("유능한 선생님");
    // 근거 칸은 학부모 원문 인용 자리 — 접수서(학부모 글 묶음)에 있는 숫자면 그대로.
    const withText = { ...f, checklist: [{ question: "추가 전달 사항", answer: "밤 10시까지 숙제를 해요" }] };
    expect(intact({ playbook: [{ concern: "밤 늦게까지 공부", evidence: "추가 전달 사항 '밤 10시까지 숙제'", response: "숙제 시간이 어떻게 되는지 먼저 여쭙겠습니다." }] }, withText)).not.toBeNull();
    expect(intact({ closing: "수강료는 매월 5일 납부로 안내드립니다. 다음 단계를 정하겠습니다." }, f)?.closing).toContain("매월 5일");
    expect(intact({ opening: "6개월 안에 자신감을 되찾길 바라신다고 적어 주셨습니다. 그 부분부터 이야기 나누겠습니다." }, f)?.opening).toContain("6개월 안에");
    expect(intact({ closing: "형제 2명이 함께 다니게 되면 동선을 맞춰 보겠습니다." }, f)?.closing).toContain("형제 2명");
    expect(intact({ closing: "남은 자리는 상담에서 확인해 안내드리겠습니다." }, f)?.closing).toContain("남은 자리");
    expect(intact({ cautions: ["잔여 1석이라며 결정을 재촉하지 마세요."] }, f)?.cautions[0]).toContain("잔여 1석");
  });
  it("적대 리뷰 2026-11-11 — 미탐 막기(부정어 섞인 서비스 약속 · 석 달 · 요일 하나 · '요일' 표기 · 회당 단가를 월로)", () => {
    const f = facts();
    const bad = (over: Record<string, unknown>) => {
      const r = validatePrepBrief(brief(over), f);
      return r.ok ? r.repairs.length : 99;
    };
    expect(bad({ closing: "뒤처지지 않도록 매주 리포트를 보내 드리겠습니다." })).toBeGreaterThan(0);
    expect(bad({ closing: "석 달 안에 따라잡을 수 있게 해 드리겠습니다." })).toBeGreaterThan(0);
    expect(bad({ closing: "토 16:30 수업으로 안내드리겠습니다. 다음 단계를 정하겠습니다." })).toBeGreaterThan(0);
    expect(bad({ closing: "화요일·목요일 16:30 수업입니다. 다음 단계를 정하겠습니다." })).toBeGreaterThan(0);
    expect(bad({ closing: "월 수강료는 주3회 기준 280,000원입니다. 다음 단계를 정하겠습니다." })).toBeGreaterThan(0);
    expect(bad({ closing: "보강은 언제든 무료로 해 드리겠습니다." })).toBeGreaterThan(0);
  });
  it("적대 리뷰 2026-11-11 — 폴백은 '기타'에만 쓴 걱정도 읽는다", () => {
    const fb = buildFallbackPrepBrief(facts({ checklist: [{ question: "가장 걱정되는 것(직접 쓴 글)", answer: "숙제를 미룬다" }] }));
    expect(fb.playbook.map((p) => p.concern).join()).toContain("숙제를 미룬다");
    expect(fb.questions.join(" ")).not.toContain("가장 걱정되는 부분 확인");
  });
  it("재리뷰 2026-11-11 — 예외 낱말이 약속을 통과시키지 않는다(약속 동사로 가른다)", () => {
    const f = facts();
    const bad = (closing: string) => {
      const r = validatePrepBrief(brief({ closing }), f);
      return r.ok ? r.repairs.length : 99;
    };
    expect(bad("매주 숙제를 확인해서 결과를 문자로 보내 드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("3개월 안에 목표 점수까지 올려 드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("6개월 안에 원하시는 성적을 만들어 드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("형제 할인은 확인 후 바로 적용해 드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("수강료는 매월 5일 납부인데 매주 학습 리포트를 보내 드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("매주 아이의 진도를 알려 드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("매 수업 후 오늘 배운 내용을 말씀드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("석 달 안에 진도를 따라잡을 수 있습니다.")).toBeGreaterThan(0);
    expect(bad("빠짐없이 관리해서 성적 향상을 보장합니다.")).toBeGreaterThan(0);
    expect(bad("매주 진도를 확인해 말씀드리겠습니다.")).toBeGreaterThan(0);
    expect(bad("결과 보장은 없지만, 막히는 곳부터 함께 찾겠습니다.")).toBe(0);
    expect(bad("성적을 보장하는 것은 아니지만, 막히는 곳부터 함께 찾겠습니다.")).toBe(0);
    // 알려 드리는 말은 그대로
    expect(bad("월별 기록 방식은 확인해서 안내드리겠습니다. 다음 단계를 정하겠습니다.")).toBe(0);
    expect(bad("보강이 가능한지는 확인해 말씀드리겠습니다. 다음 단계를 정하겠습니다.")).toBe(0);
  });
});

