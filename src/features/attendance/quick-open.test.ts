import { describe, it, expect } from "vitest";
import { buildQuickOpen, quickOpenLimit, QUICK_OPEN_BUDGET, UNASSIGNED_KEY } from "./quick-open";

const SUBJECTS = [
  { value: "math", label: "수학" },
  { value: "english", label: "영어" },
];

/** 실제 데이터 모양 재현 — 영어반은 로마자 코드, 수학반은 한글 이름(이게 결함의 원인이었다). */
function fixture() {
  const english = ["DP5", "JP1", "KW1", "KW6", "LS2a", "LS2b", "LS4", "LS5", "LT2", "PJ5"].map((n) => ({
    id: `e-${n}`,
    className: n,
    subject: "english" as string | null,
  }));
  const math = ["고등M 고1 BS4A", "고3 공통과목 (토)", "개별(초등M) 초5 BS2C", "중등M 중2 PS3A", "고등M 개별 TP4E"].map(
    (n) => ({ id: `m-${n}`, className: n, subject: "math" as string | null }),
  );
  // DB 정렬(class_name 오름차순) 재현 = 로마자가 한글보다 앞. 이 배열을 그대로 slice하면 영어만 나온다.
  return [...english, ...math];
}

describe("quickOpenLimit", () => {
  it("과목 1개면 예산 전부 — 섹션 헤더가 없으므로 나눌 이유가 없다", () => {
    expect(quickOpenLimit(1)).toBe(QUICK_OPEN_BUDGET);
    expect(quickOpenLimit(0)).toBe(QUICK_OPEN_BUDGET);
  });
  it("예산을 과목 수로 나누되 2~6으로 clamp", () => {
    expect(quickOpenLimit(2)).toBe(6); // 12/2
    expect(quickOpenLimit(3)).toBe(4);
    expect(quickOpenLimit(4)).toBe(3);
    expect(quickOpenLimit(5)).toBe(2); // floor(12/5)=2
    expect(quickOpenLimit(20)).toBe(2); // 하한 — 과목이 아무리 많아도 0이 되지 않는다
  });
});

describe("buildQuickOpen", () => {
  it("🔴 회귀 잠금: 단일 slice면 영어만 나오던 목록에서 수학이 반드시 보인다", () => {
    const classes = fixture();
    // 결함 재현 — 옛 동작(정렬된 전체에서 앞 8개)은 100% 영어반이었다.
    expect(classes.slice(0, 8).every((c) => c.subject === "english")).toBe(true);

    const { groups, limit } = buildQuickOpen(classes, SUBJECTS);
    const math = groups.find((g) => g.key === "math");
    expect(math).toBeDefined();
    expect(math!.classes.length).toBeGreaterThan(0);
    expect(limit).toBe(6); // 과목 2개 → 6+6
    expect(groups.find((g) => g.key === "english")!.classes).toHaveLength(6);
    expect(math!.classes).toHaveLength(5); // 5개뿐이라 상한 미만
  });

  it("불변식 ①: 반이 1개라도 있는 과목은 절대 그룹이 사라지지 않는다", () => {
    const many = [
      ...Array.from({ length: 50 }, (_, i) => ({ className: `M${i}`, subject: "math" })),
      { className: "E1", subject: "english" },
      { className: "S1", subject: "science" },
      { className: "K1", subject: "korean" },
    ];
    const subjects = [...SUBJECTS, { value: "science", label: "과학" }, { value: "korean", label: "국어" }];
    const { groups, limit } = buildQuickOpen(many, subjects);
    expect(groups.map((g) => g.key)).toEqual(["math", "english", "science", "korean"]);
    expect(limit).toBe(3); // 12/4
    // 반 1개짜리 과목도 그대로 노출된다(상한이 낮아질 뿐 드롭되지 않는다).
    expect(groups.every((g) => g.classes.length > 0)).toBe(true);
  });

  it("불변식 ②: 어떤 반도 그룹 밖으로 새지 않는다 — 미등록 과목·과목 없는 반 포함", () => {
    const classes = [
      { className: "A", subject: "math" },
      { className: "B", subject: "ghost" }, // 설정에서 삭제된 과목 키
      { className: "C", subject: null }, // 과목 미지정
      { className: "D", subject: "" }, // 빈 문자열
    ];
    const { groups } = buildQuickOpen(classes, SUBJECTS);
    const total = groups.reduce((n, g) => n + g.total, 0);
    expect(total).toBe(classes.length);

    const orphan = groups.find((g) => g.key === UNASSIGNED_KEY);
    expect(orphan).toBeDefined();
    expect(orphan!.total).toBe(3);
    // raw 과목 키("ghost")를 화면 라벨로 쓰지 않는다 — UI에 영문 코드 노출 금지.
    expect(orphan!.label).toBe("(미지정)");
    expect(orphan!.unassigned).toBe(true);
    // 과목 필터로 드릴다운할 수 없는 그룹이므로 호출부가 링크를 숨길 수 있어야 한다.
    expect(groups.filter((g) => !g.unassigned).every((g) => g.key !== UNASSIGNED_KEY)).toBe(true);
  });

  it("섹션 순서 = 학원설정 과목 순서, 섹션 내부는 호출부 순서 보존", () => {
    const classes = [
      { className: "나반", subject: "math" },
      { className: "가반", subject: "math" },
      { className: "Zed", subject: "english" },
      { className: "Alpha", subject: "english" },
      { className: "다반", subject: "math" },
    ];
    const { groups } = buildQuickOpen(classes, SUBJECTS);
    expect(groups.map((g) => g.key)).toEqual(["math", "english"]); // 설정 순서(math 먼저), 크기 3:2와 무관
    // 이름순으로 재정렬하지 않는다 — 입력 순서 그대로.
    expect(groups[0]!.classes.map((c) => c.className)).toEqual(["나반", "가반", "다반"]);
    expect(groups[1]!.classes.map((c) => c.className)).toEqual(["Zed", "Alpha"]);
  });

  it("🔴 회귀 잠금: 한 과목 안에 한글·로마자 이름이 섞여도 어느 쪽도 굶기지 않는다", () => {
    // 실데이터 모양: 영어 과목 = 로마자 코드반(DP5…) + 한글 이름반(고등E_…) 혼재.
    // 이름순 재정렬을 넣으면 콜레이션에 따라 한쪽이 통째로 상위 N 밖으로 밀린다
    // (ICU "ko"는 한글 우선, Postgres는 로마자 우선) — 이 모듈이 고치려던 실패의 재현.
    // 그래서 정렬하지 않고 호출부 순서를 보존한다: 옛 화면이 보여주던 반이 그대로 남는다.
    const classes = [
      { className: "DP5", subject: "english" },
      { className: "JP1", subject: "english" },
      { className: "고등E_고1", subject: "english" },
      { className: "고등E_고2", subject: "english" },
      { className: "고등M 고1", subject: "math" },
    ];
    const { groups } = buildQuickOpen(classes, SUBJECTS, 4); // 예산 4 → 과목 2개 → 상한 2
    const english = groups.find((g) => g.key === "english")!;
    expect(english.classes.map((c) => c.className)).toEqual(["DP5", "JP1"]);
    // ⚠️ 이 assertion이 ["고등E_고1","고등E_고2"]로 뒤집히면 그룹 내부 정렬이 되살아난 것이다.
  });

  it("반이 0개인 과목은 섹션을 만들지 않는다(강사 필터로 좁혀진 경우)", () => {
    const { groups } = buildQuickOpen([{ className: "A", subject: "math" }], SUBJECTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("math");
  });

  it("truncated는 '한 과목이라도 잘렸는가' — 안내 문구 노출 조건", () => {
    const under = buildQuickOpen([{ className: "A", subject: "math" }], SUBJECTS);
    expect(under.truncated).toBe(false);
    expect(under.limit).toBe(QUICK_OPEN_BUDGET); // 그룹 1개 → 평면 12개

    // 경계: 정확히 상한만큼이면 숨긴 반이 0이므로 안내를 띄우지 않는다(거짓 "더 있다" 방지).
    const exact = buildQuickOpen(
      Array.from({ length: 12 }, (_, i) => ({ className: `M${i}`, subject: "math" })),
      SUBJECTS,
    );
    expect(exact.limit).toBe(QUICK_OPEN_BUDGET);
    expect(exact.truncated).toBe(false);

    const over = buildQuickOpen(
      Array.from({ length: 13 }, (_, i) => ({ className: `M${i}`, subject: "math" })),
      SUBJECTS,
    );
    expect(over.truncated).toBe(true);
    expect(over.groups[0]!.total).toBe(13); // 숨긴 규모는 total로 그대로 노출
    expect(over.groups[0]!.classes).toHaveLength(12);
  });

  it("빈 입력이면 그룹도 없다(호출부가 빈 상태 문구로 분기)", () => {
    const { groups, truncated } = buildQuickOpen([], SUBJECTS);
    expect(groups).toHaveLength(0);
    expect(truncated).toBe(false);
  });
});
