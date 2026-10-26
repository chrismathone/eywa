import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pilotSendBlocks } from "./pilot-send-gate";
import type { OneScreenStudent } from "./types";

const student = (sub: Record<string, unknown>, note = ""): OneScreenStudent =>
  ({
    id: "s1",
    name: "홍길동",
    note,
    attitude: "",
    homework: "",
    tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
    subjects: [{ name: "수학", subjectKey: "math", today: "", ...sub }],
  }) as unknown as OneScreenStudent;

describe("새 보고서 발송 조건(원장 2026-10-26 — 일괄 발송도 같은 판정)", () => {
  it("수학·영어 아닌 행은 막지 않는다", () => {
    expect(pilotSendBlocks(student({ subjectKey: "science" }), "수학", null)).toEqual([]);
  });
  it("자동작성 전이면 자동작성·한마디가 막는다", () => {
    expect(pilotSendBlocks(student({}), "수학", null)).toEqual(expect.arrayContaining(["autowrite", "oneline"]));
  });
  it("시험 없음인데 사유가 없으면 막는다", () => {
    const b = pilotSendBlocks(student({ dailyTestSkip: { reason: null, detail: "" } }), "수학", null);
    expect(b).toContain("testReason");
  });
  it("영어는 사랑의 한마디만 본다", () => {
    expect(pilotSendBlocks(student({ subjectKey: "english" }), "수학", null)).toEqual(["oneline"]);
  });
});

describe("배선", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("일괄 발송·저장 입력·일괄 자동작성이 같은 판정을 쓰고, 서버는 pilotCheck가 없으면 거절한다", () => {
    const client = read("./components/onescreen-client.tsx");
    expect(client.match(/pilotSendBlocks\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(client).toMatch(/pilotCheck: \{ factsCurrent:/);
    expect(client).toMatch(/isPilotGateError\(res\.error\)/);
    const server = read("./server/actions.ts");
    expect(server).toMatch(/!input\.pilotCheck\?\.factsCurrent/);
    expect(server).toMatch(/PILOT_REASON_REQUIRED_ERROR/);
  });
});
