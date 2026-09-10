import { describe, expect, it } from "vitest";
import {
  PRIORITY_BUCKETS,
  buildPriorityLines,
  priorityOverflow,
  type PriorityInput,
  type PriorityNewcomer,
  type PriorityTodo,
} from "./priority-lines";

const TODAY = "2026-10-01";

const newcomer = (over: Partial<PriorityNewcomer> = {}): PriorityNewcomer => ({
  studentId: "s1",
  name: "가나",
  enrolledOn: "2026-09-20",
  firstClassOn: "2026-09-22",
  checks: {},
  ...over,
});

const input = (over: Partial<PriorityInput> = {}): PriorityInput => ({
  today: TODAY,
  newcomers: [],
  spotlights: [],
  todos: [],
  ...over,
});

const unwrittenTodo: PriorityTodo = {
  key: "unwritten-reports",
  label: "미작성 보고서",
  count: 32,
  unit: "명",
  note: "영어 제외",
  href: "/report-admin",
};

describe("우선 확인 세 줄", () => {
  it("버킷 순서를 코드에 못박는다 — 순서가 바뀌면 이 테스트가 먼저 깨진다", () => {
    expect([...PRIORITY_BUCKETS]).toEqual([
      "first-class-today",
      "newcomer-absence",
      "after-first-call",
      "churn",
      "month1-call",
      "unwritten-reports",
    ]);
  });

  it("0줄이 정상 — 빈 자리를 덜 급한 것으로 채우지 않는다", () => {
    expect(buildPriorityLines(input())).toEqual([]);
    // 재료가 다 있어도 걸릴 게 없으면 0줄이다.
    const clean = newcomer({
      checks: { pre_call: "d", first_class_guide: "d", ojt: "d", after_first_call: "d", month1_call: "d" },
    });
    expect(buildPriorityLines(input({ newcomers: [clean] }))).toEqual([]);
  });

  it("① 오늘 첫 수업인데 준비 미완이 가장 위 — 오늘이 지나면 되돌릴 수 없다", () => {
    const lines = buildPriorityLines(
      input({
        newcomers: [
          // 첫 수업이 오늘, 사전콜·안내·OJT 미완
          newcomer({ studentId: "a", name: "가나", enrolledOn: "2026-09-24", firstClassOn: TODAY }),
          // 첫 수업 후 콜 지연(더 오래 지났지만 버킷이 아래다)
          newcomer({ studentId: "b", name: "나다", enrolledOn: "2026-09-11", firstClassOn: "2026-09-12" }),
        ],
      }),
    );
    expect(lines[0]!.bucket).toBe("first-class-today");
    expect(lines[0]!.title).toBe("가나");
    expect(lines[0]!.detail).toContain("오늘 첫 수업");
  });

  it("② 신규생 무통보 결석 — 스포트라이트가 이미 사전 통보분을 뺀 배열이다", () => {
    const lines = buildPriorityLines(
      input({
        newcomers: [newcomer({ studentId: "a", name: "가나", checks: { pre_call: "d", first_class_guide: "d", ojt: "d", after_first_call: "d" } })],
        spotlights: [
          // 결석 유래(= action 없음)
          { studentId: "a", name: "가나", reasons: ["최근 14일 결석 4회"], action: null },
          // 신규생이 아닌 학생은 이 칸이 아니다('살펴볼 학생'이 맡는다).
          { studentId: "zz", name: "남남", reasons: ["최근 14일 결석 9회"], action: null },
        ],
      }),
    );
    expect(lines.map((l) => l.bucket)).toEqual(["newcomer-absence"]);
    expect(lines[0]!.detail).toBe("최근 14일 결석 4회");
  });

  it("④ 퇴원위험은 retention 문장 그대로 — 사유는 detail, 권장 조치는 덧말", () => {
    const lines = buildPriorityLines(
      input({
        spotlights: [
          { studentId: "x", name: "다라", reasons: ["성적 12점 하락", "숙제율 55%"], action: "담임 상담" },
        ],
      }),
    );
    expect(lines[0]!.bucket).toBe("churn");
    expect(lines[0]!.detail).toBe("성적 12점 하락 · 숙제율 55%");
    expect(lines[0]!.hint).toBe("담임 상담");
  });

  it("③·⑤ 콜 지연은 더 오래 지난 사람이 위", () => {
    const lines = buildPriorityLines(
      input({
        newcomers: [
          newcomer({ studentId: "a", name: "가나", enrolledOn: "2026-09-20", firstClassOn: "2026-09-23" }),
          newcomer({ studentId: "b", name: "나다", enrolledOn: "2026-09-20", firstClassOn: "2026-09-13" }),
        ],
      }),
    );
    const call = lines.filter((l) => l.bucket === "after-first-call");
    expect(call.map((l) => l.title)).toEqual(["나다", "가나"]);
    expect(call[0]!.detail).toBe("첫 수업 후 콜 · 11일 지남");
  });

  it("같은 학생은 한 줄만 — 위 버킷이 이긴다", () => {
    const s = newcomer({ studentId: "a", name: "가나", enrolledOn: "2026-09-11", firstClassOn: "2026-09-12" });
    const lines = buildPriorityLines(
      input({
        newcomers: [s],
        spotlights: [{ studentId: "a", name: "가나", reasons: ["최근 14일 결석 4회"], action: null }],
      }),
    );
    expect(lines.filter((l) => l.title === "가나")).toHaveLength(1);
    expect(lines[0]!.bucket).toBe("newcomer-absence");
  });

  it("⑥ 미작성 보고서는 '오늘 할 일'이 적용한 영어 제외 규칙을 그대로 받는다", () => {
    // 🔴 여기서 과목을 다시 거르지 않는다 — 목록에 있으면 그대로, 없으면 줄도 없다.
    expect(buildPriorityLines(input({ todos: [unwrittenTodo] }))[0]!.detail).toBe("32명");
    expect(buildPriorityLines(input({ todos: [{ ...unwrittenTodo, count: 0 }] }))).toEqual([]);
    expect(buildPriorityLines(input({ todos: [] }))).toEqual([]);
  });

  it("waived(2026-09-09 이전 기한)는 재촉하지 않는다", () => {
    const old = newcomer({ studentId: "a", enrolledOn: "2026-07-03", firstClassOn: "2026-07-05" });
    expect(buildPriorityLines(input({ newcomers: [old] }))).toEqual([]);
  });

  it("첫수업일 미정 학생은 콜 지연으로 재촉하지 않는다", () => {
    const noFirst = newcomer({ studentId: "a", firstClassOn: null });
    const lines = buildPriorityLines(input({ newcomers: [noFirst] }));
    expect(lines.some((l) => l.bucket === "after-first-call")).toBe(false);
  });

  it("재료를 못 받은 것(null)은 0건이 아니다 — 줄을 만들지 않고 호출부가 그 사실을 적는다", () => {
    // 신규생·스포트라이트를 못 받아도 다른 버킷은 그대로 산다(전멸시키지 않는다).
    const lines = buildPriorityLines(
      input({ newcomers: null, spotlights: null, todos: [unwrittenTodo] }),
    );
    expect(lines.map((l) => l.bucket)).toEqual(["unwritten-reports"]);
  });

  it("3은 상한이고 잘린 나머지는 건수로 센다", () => {
    const many: PriorityNewcomer[] = ["a", "b", "c", "d", "e"].map((id) =>
      newcomer({ studentId: id, name: `이름${id}`, enrolledOn: "2026-09-11", firstClassOn: "2026-09-12" }),
    );
    const lines = buildPriorityLines(input({ newcomers: many }));
    expect(lines).toHaveLength(5);
    expect(priorityOverflow(lines)).toBe(2);
    expect(priorityOverflow(lines.slice(0, 3))).toBe(0);
  });
});
