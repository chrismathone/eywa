import { describe, expect, it } from "vitest";
import { checkRows } from "./check-board";
import { INPUT_BYTES, inputBytes, inputKey, secretaryInput } from "./secretary-ai";
import { secretaryBrief } from "./secretary-plan";
import { latestNotes, scheduleOrder, type NoteHead } from "./secretary-schedule";
import { secretaryInputSchema } from "./secretary-schema";
import { FIXTURE_EXTRAS, FIXTURE_SNAPSHOT } from "./testing/fixture";

const ctx = { snapshot: FIXTURE_SNAPSHOT, extras: FIXTURE_EXTRAS, amounts: true, subjects: [], eieOn: true, can: () => true };
const brief = secretaryBrief(ctx, checkRows(ctx), null, true);
const many = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const TODAY = FIXTURE_SNAPSHOT.today;

describe("업무 비서 후보 — 검증 상한 안으로", () => {
  it("근거 줄 · 맡긴 업무 · 후보 · 이름이 많아도 서버 검증을 지난다(넘친 줄은 '외 N건')", () => {
    const big = {
      ...brief,
      candidates: [...brief.candidates.map((c) => ({ ...c, title: "가".repeat(300), facts: many(25, (i) => `근거 ${i}`) })), ...many(25, (i) => ({ ...brief.candidates[0]!, ref: `extra:${i}`, priority: 1 }))],
      delegated: { ...brief.delegated, late: many(25, (i) => ({ id: `w${i}`, title: `업무 ${i}`, dueOn: "2026-11-01", missing: [] })) },
      names: many(1200, (i) => `이름${i}`),
    };
    const input = secretaryInput(big, TODAY, "월", 2);
    expect(secretaryInputSchema.safeParse(input).success).toBe(true);
    expect(input.candidates).toHaveLength(20);
    // 우선순위가 낮은 것부터 빠진다 — 원래 후보는 남는다(순서도 그대로).
    expect(input.candidates.slice(0, brief.candidates.length).map((c) => c.ref)).toEqual(brief.candidates.map((c) => c.ref));
    expect(input.candidates[0]!.facts).toHaveLength(20);
    expect(input.candidates[0]!.facts.at(-1)).toBe("외 6건");
    expect(input.candidates[0]!.title.length).toBe(160);
    expect(input.delegated).toHaveLength(20);
    expect(input.delegated.at(-1)).toMatch(/^외 \d+건$/);
    expect(input.names).toHaveLength(1000);
  });
  it("크기가 표 제약을 넘으면 이름 목록부터, 그다음 근거 줄을 줄인다(바이트 상한 — 한글 줄 400자 × 20줄 × 20후보)", () => {
    const long = "가".repeat(400);
    const huge = { ...brief, candidates: many(20, (i) => ({ ...brief.candidates[0]!, ref: `c${i}`, facts: many(20, () => long) })), names: many(1000, (i) => `이름${i}`) };
    const input = secretaryInput(huge, TODAY, "월", 2);
    expect(inputBytes(input)).toBeLessThanOrEqual(INPUT_BYTES);
    expect(input.names.length).toBeLessThan(1000);
    expect(input.candidates[0]!.facts.length).toBeLessThan(20);
    expect(secretaryInputSchema.safeParse(input).success).toBe(true);
    // 작은 후보는 그대로(줄이지 않는다).
    expect(secretaryInput(brief, TODAY, "월", 2).names).toEqual(brief.names.slice(0, 1000));
  });
  it("같은 후보 = [후보] · [맡긴 업무]가 같다(이름 목록은 견주지 않는다)", () => {
    const a = secretaryInput(brief, TODAY, "월", 2);
    const noNames = { ...a, names: [] };
    expect(inputKey(a)).toBe(inputKey(noNames));
    expect(inputKey(a)).not.toBe(inputKey({ ...a, candidates: a.candidates.map((c, i) => (i ? c : { ...c, count: c.count + 1 })) }));
    expect(inputKey(a)).not.toBe(inputKey({ ...a, delegated: [...a.delegated, "보고를 기다리는 요청 9건"] }));
  });
});

const head = (id: number, user_id: string, model: string | null, extra: Partial<NoteHead> = {}): NoteHead =>
  ({ id, user_id, model, created_at: "2026-11-02T04:00:00Z", run_kind: "schedule", for_date: TODAY, ...extra });

describe("업무 비서 예약 — 순서 · 오늘 마지막 정리", () => {
  it("마지막 예약 정리가 오래된 사람부터(없으면 맨 앞) — 시간이 모자라 빠진 사람이 다음 회차에 먼저", () => {
    const heads = [head(1, "a", "m"), head(2, "b", "m", { created_at: "2026-11-01T16:00:00Z" }), head(3, "c", "m", { run_kind: "button" })];
    expect(scheduleOrder([{ user_id: "a" }, { user_id: "b" }, { user_id: "c" }], heads, TODAY).map((x) => x.user_id)).toEqual(["c", "b", "a"]);
  });
  it("동점(7일 안에 예약 정리가 없는 사람끼리)은 날마다 바뀌는 순서 — 늘 같은 사람이 뒤에 서지 않는다", () => {
    const due = many(6, (i) => ({ user_id: `u${i}` }));
    const firsts = new Set(many(14, (d) => scheduleOrder(due, [], `2026-11-${String(d + 1).padStart(2, "0")}`)[0]!.user_id));
    expect(firsts.size).toBeGreaterThan(1);
    expect(scheduleOrder(due, [], TODAY)).toEqual(scheduleOrder(due, [], TODAY)); // 같은 날은 같은 순서
  });
  it("오늘 마지막 정리 = 모델 칸이 있는 줄 중 가장 늦은 것(시도 표식 · 다른 날은 뺀다)", () => {
    const latest = latestNotes([head(1, "a", "m"), head(3, "a", null), head(2, "a", "m"), head(4, "b", "m", { for_date: "2026-11-01" })], TODAY);
    expect(latest.get("a")?.id).toBe(2);
    expect(latest.has("b")).toBe(false);
  });
});
