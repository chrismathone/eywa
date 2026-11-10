import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_JJ_SHEET_TEMPLATE_ID } from "@/features/report-templates/defaults";
import { pilotSendBlocks } from "./pilot-send-gate";
import type { OneScreenStudent } from "./types";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

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
  it("시험 없음 사유는 선택 — 안 적어도 막지 않는다(원장 2026-10-27)", () => {
    const b = pilotSendBlocks(student({ dailyTestSkip: { reason: null, detail: "" } }), "수학", null);
    expect(b).not.toContain("testReason");
  });
  it("영어는 사랑의 한마디만 본다", () => {
    expect(pilotSendBlocks(student({ subjectKey: "english" }), "수학", null)).toEqual(["oneline"]);
  });
  it("JJ 수업보고서 글은 사랑의 한마디가 선택 — 고르는 중인 템플릿은 안 본다(원장 2026-10-27)", () => {
    expect(pilotSendBlocks(student({ subjectKey: "english" }), "수학", { templateId: BUILTIN_JJ_SHEET_TEMPLATE_ID })).toEqual([]);
    // 수학 행은 같은 표시가 있어도 그대로 필수
    expect(pilotSendBlocks(student({}), "수학", { templateId: BUILTIN_JJ_SHEET_TEMPLATE_ID })).toContain("oneline");
  });
});

describe("배선", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("일괄 발송·저장 입력·일괄 자동작성이 같은 판정을 쓰고, 서버는 pilotCheck가 없으면 거절한다", () => {
    // 일괄 자동작성은 use-auto-write.ts로 옮겼다(P3-O) — 화면과 합쳐 읽는다.
    const client = readOnescreenScreen();
    expect(client.match(/pilotSendBlocks\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(client).toMatch(/pilotCheck: \{ factsCurrent:/);
    expect(client).toMatch(/isPilotGateError\(res\.error\)/);
    const server = read("./server/actions.ts");
    expect(server).toMatch(/!input\.pilotCheck\?\.factsCurrent/);
    expect(server).toMatch(/PILOT_REASON_REQUIRED_ERROR/);
  });
});
