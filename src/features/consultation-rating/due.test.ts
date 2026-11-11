import { describe, expect, it } from "vitest";
import { pickDue, type DueQueue, type DueRating } from "./due";

const T0 = "2026-11-10T10:00:00.000Z";
const T1 = "2026-11-10T11:00:00.000Z";
const T2 = "2026-11-10T12:00:00.000Z";
const c = (id: string, updated_at: string, student_id = `s-${id}`) => ({ id, student_id, updated_at });
const rated = (id: string, source_updated_at: string | null): DueRating => ({ consultation_id: id, source_updated_at });
const line = (id: string, stage: string, source_updated_at: string | null, rubric: string | null = "c1"): DueQueue => ({ consultation_id: id, stage, rubric, source_updated_at });
const pick = (cs: ReturnType<typeof c>[], rs: DueRating[] = [], qs: DueQueue[] = [], tests: string[] = []) => pickDue(cs, rs, qs, new Set(tests), "c1");

describe("평점 줄 세우기 판정", () => {
  it("평점도 줄도 없는 상담은 후보 · 테스트 학생은 아니다", () => {
    expect(pick([c("a", T0), c("b", T0, "t1")], [], [], ["t1"])).toEqual(["a"]);
  });
  it("평점이 있고 그 뒤에 안 고쳐졌으면 후보가 아니다 — 같은 시각이어도(저장 직후) 아니다", () => {
    expect(pick([c("a", T0)], [rated("a", T0)])).toEqual([]);
    expect(pick([c("a", T0)], [rated("a", T1)])).toEqual([]);
  });
  it("평점이 있어도 재료를 읽은 뒤 고쳐졌으면 후보 — 재료 시각이 기록돼 있지 않아도(null) 후보", () => {
    expect(pick([c("a", T1)], [rated("a", T0)])).toEqual(["a"]);
    expect(pick([c("a", T0)], [rated("a", null)])).toEqual(["a"]);
  });
  it("줄에서 움직이는 중(queued·submitting·submitted)이면 어떤 경우에도 다시 세우지 않는다", () => {
    for (const stage of ["queued", "submitting", "submitted"]) expect(pick([c("a", T2)], [rated("a", T0)], [line("a", stage, T0)]), stage).toEqual([]);
  });
  it("🔴 닫힌(failed) 줄은 평점이 있어도 그 상담이 다시 고쳐지기 전엔 다시 세우지 않는다(30분마다 3번씩 모델을 부르는 영구 반복 방지)", () => {
    expect(pick([c("a", T1)], [rated("a", T0)], [line("a", "failed", T1)])).toEqual([]);
    expect(pick([c("a", T1)], [], [line("a", "failed", T1)])).toEqual([]);
  });
  it("닫힌 줄도 그 뒤에 상담이 고쳐지면(녹음 분석이 끝나 전사가 채워지는 때 포함) 다시 후보", () => {
    expect(pick([c("a", T2)], [], [line("a", "failed", T1)])).toEqual(["a"]);
    expect(pick([c("a", T2)], [rated("a", T0)], [line("a", "failed", T1)])).toEqual(["a"]);
  });
  it("기준 판이 올랐으면 다른 판으로 닫힌 줄은 한 번 다시 시도하고, 끝났는데(done) 지금 판 평점이 없는 상담도 후보", () => {
    expect(pick([c("a", T0)], [], [line("a", "failed", T0, "c0")])).toEqual(["a"]);
    expect(pick([c("a", T0)], [], [line("a", "done", T0)])).toEqual(["a"]);
  });
  it("예전 줄(rubric 칸이 비어 있음)은 지금 판으로 본다", () => {
    expect(pick([c("a", T0)], [], [line("a", "failed", T0, null)])).toEqual([]);
  });
});
