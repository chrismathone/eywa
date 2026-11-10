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
    const client = readOnescreenScreen();
    expect(client.match(/pilotSendBlocks\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // 파일이 나뉜 뒤(P3-O) 합친 개수만 보면 한 곳이 빠져도 다른 파일이 채운다 — 세 자리를 따로 본다.
    // 일괄 발송(batch D에서 bulk-send-preview.ts로) · 저장 입력(저장·발송 코어 — batch D에서 use-report-save-input.ts로) · 일괄 자동작성
    // · 한 행 자동작성의 고친 글 합치기(batch D에서 use-report-draft-generation.ts로 — 네 번째 자리도 따로 본다).
    for (const f of [
      "bulk-send-preview.ts",
      "components/use-report-save-input.ts",
      "components/use-auto-write.ts",
      "components/use-report-draft-generation.ts",
    ]) {
      expect(read(`./${f}`), f).toMatch(/pilotSendBlocks\(/);
    }
    // 판정이 순수 모듈(bulk-send-preview)로 옮겨 간 뒤에는 **발송 훅이 그 판정을 실제로 거치는지**를 따로 본다(적대 리뷰 2026-11-11) —
    // 거르지 않고 보내도 위 단언은 순수 모듈 덕에 그대로 통과한다.
    const bulkSend = read("./components/use-bulk-send.ts");
    expect(bulkSend).toMatch(/\}\s*=\s*planBulkSendExclusions\(\{/);
    expect(bulkSend).toMatch(/rows = sendable;/);
    expect(bulkSend.indexOf("rows = sendable;")).toBeLessThan(bulkSend.indexOf("await queueOne("));
    expect(client).toMatch(/pilotCheck: \{ factsCurrent:/);
    expect(client).toMatch(/isPilotGateError\(res\.error\)/);
    const server = read("./server/actions.ts");
    expect(server).toMatch(/!input\.pilotCheck\?\.factsCurrent/);
    expect(server).toMatch(/PILOT_REASON_REQUIRED_ERROR/);
  });
});
