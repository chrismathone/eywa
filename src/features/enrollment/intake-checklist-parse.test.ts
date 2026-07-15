import { describe, expect, it } from "vitest";
import { parseIntakeChecklist, type FormLike } from "./intake-checklist-parse";
import { wantsSubject, labelOf, GOAL_OPTIONS } from "./intake-checklist";

/** FormData 흉내 — 같은 name의 다중 값 지원. */
function form(entries: Record<string, string | string[]>): FormLike {
  const map = new Map<string, string[]>();
  for (const [k, v] of Object.entries(entries)) map.set(k, Array.isArray(v) ? v : [v]);
  return {
    get: (n) => map.get(n)?.[0] ?? null,
    getAll: (n) => map.get(n) ?? [],
  };
}

describe("parseIntakeChecklist", () => {
  it("아무것도 안 채우면 null(스텝2 건너뜀 = 컬럼 비움)", () => {
    expect(parseIntakeChecklist(form({}))).toBeNull();
  });

  it("한 항목만 있어도 객체를 만든다", () => {
    const c = parseIntakeChecklist(form({ goals: "level" }));
    expect(c).toMatchObject({ version: 1, goals: ["level"] });
  });

  it("화이트리스트 밖 값은 조용히 버린다(위조 POST 방어)", () => {
    const c = parseIntakeChecklist(form({ goals: ["level", "<script>", "drop_table"] }));
    expect(c?.goals).toEqual(["level"]);
  });

  it("최대 선택 개수를 넘기면 초과분 절단 — goals 2, worries 3, wants 3", () => {
    const c = parseIntakeChecklist(
      form({
        goals: ["level", "priority", "exam"],
        worries: ["overload", "behind_peers", "low_yield", "avoids_hard"],
        wants: ["diagnosis", "class_criteria", "teaching_style", "monthly_record"],
      }),
    );
    expect(c?.goals).toHaveLength(2);
    expect(c?.worries).toHaveLength(3);
    expect(c?.wants).toHaveLength(3);
  });

  it("중복 선택은 하나로", () => {
    const c = parseIntakeChecklist(form({ goals: ["level", "level"] }));
    expect(c?.goals).toEqual(["level"]);
  });

  it("과목 문항 — 상태나 교재 중 하나만 있어도 저장, 둘 다 없으면 null", () => {
    const c = parseIntakeChecklist(form({ mathCourse: "쎈 중2-1", englishStates: "vocab" }));
    expect(c?.math).toEqual({ states: [], course: "쎈 중2-1" });
    expect(c?.english).toEqual({ states: ["vocab"], course: null });
  });

  it("학습 행동 점수는 1~5만 — 범위 밖·비숫자는 제외", () => {
    const c = parseIntakeChecklist(
      form({ habit_self_start: "5", habit_finish: "0", habit_explain: "9", habit_recover: "셋" }),
    );
    expect(c?.habits).toEqual({ self_start: 5 });
  });

  it("선행·심화 — 여부/이유가 각각 독립 저장(이유 카탈로그는 서로 다름)", () => {
    const c = parseIntakeChecklist(
      form({
        priorStatus: "partial",
        priorReason: "exam",
        advancedStatus: "active",
        advancedReason: "peers",
      }),
    );
    expect(c).toMatchObject({
      priorStatus: "partial",
      priorReason: "exam",
      advancedStatus: "active",
      advancedReason: "peers",
    });
  });

  it("'하지 않음' 이유는 자유입력으로 저장 — 선행·심화 각각", () => {
    const c = parseIntakeChecklist(
      form({
        priorStatus: "none",
        priorNoneReason: "현재 과정부터 다지려고",
        advancedStatus: "none",
        advancedNoneReason: "기본 개념이 먼저",
      }),
    );
    expect(c).toMatchObject({
      priorStatus: "none",
      priorNoneReason: "현재 과정부터 다지려고",
      advancedStatus: "none",
      advancedNoneReason: "기본 개념이 먼저",
    });
  });

  it("'고려하지 않음' 이유는 폐기 — 위 '여부=하지 않음'과 중복이라 보내도 저장 안 됨", () => {
    const c = parseIntakeChecklist(
      form({ goals: "level", priorReason: "not_considering", advancedReason: "not_considering" }),
    );
    expect(c?.priorReason).toBeNull();
    expect(c?.advancedReason).toBeNull();
  });

  it("폐기된 문항(주당 시간·예산·선행 부작용)은 보내도 저장되지 않는다", () => {
    const c = parseIntakeChecklist(
      form({ goals: "level", weeklyHours: "6", budget: "300000", priorSideEffect: "severe" }),
    );
    expect(c).not.toHaveProperty("weeklyHours");
    expect(c).not.toHaveProperty("budget");
    expect(c).not.toHaveProperty("priorSideEffect");
  });

  it("자유입력은 clip — 초과 길이는 잘린다", () => {
    const c = parseIntakeChecklist(form({ extra: "가".repeat(1500) }));
    expect(c?.extra).toHaveLength(1000);
  });
});

describe("wantsSubject", () => {
  it("표준키(math/english)로 판정", () => {
    expect(wantsSubject([{ key: "math", label: "수학" }], "math")).toBe(true);
    expect(wantsSubject([{ key: "english", label: "영어" }], "math")).toBe(false);
  });

  it("자체 키 과목은 라벨로 판정 — 수학(심화)=subject_1도 수학 문항 노출", () => {
    expect(wantsSubject([{ key: "subject_1", label: "수학(심화)" }], "math")).toBe(true);
    expect(wantsSubject([{ key: "subject_9", label: "미술" }], "math")).toBe(false);
  });
});

describe("labelOf", () => {
  it("미등록 값은 slug 대신 안내 문구(UI에 raw 노출 금지)", () => {
    expect(labelOf(GOAL_OPTIONS, "level")).toBe("현재 영어·수학 수준");
    expect(labelOf(GOAL_OPTIONS, "gone")).toBe("(삭제된 항목)");
  });
});
