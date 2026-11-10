import { describe, expect, it } from "vitest";
import { IDLE_GAP_MS, addAutowrite, addEdit, sanitizePayload, toPayload } from "./write-timing";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

describe("작성 시간 기록 — 영역에 시간 붙이기", () => {
  it("직전 손댄 때부터의 틈이 이번 영역 몫 · 첫 손댐은 0", () => {
    let r = addEdit(undefined, "progress", "hand", "card", 1_000, null);
    r = addEdit(r, "attitude", "hand", "card", 21_000, 1_000);
    expect(r.fields.progress!.ms).toBe(0);
    expect(r.fields.attitude!.ms).toBe(20_000);
    expect(r.card).toBe(2);
  });

  it("자리를 비운 긴 틈은 붙이지 않는다", () => {
    let r = addEdit(undefined, "progress", "hand", "grid", 0, null);
    r = addEdit(r, "note", "hand", "grid", IDLE_GAP_MS + 1, 0);
    expect(r.fields.note!.ms).toBe(0);
    expect(r.grid).toBe(2);
  });

  it("글자를 칠 때마다 세지 않는다 — 5초 안에 같은 영역은 한 번", () => {
    let r = addEdit(undefined, "note", "hand", "card", 0, null);
    r = addEdit(r, "note", "hand", "card", 1_000, 0);
    r = addEdit(r, "note", "hand", "card", 2_000, 1_000);
    expect(r.fields.note!.edits).toBe(1);
    expect(r.fields.note!.ms).toBe(2_000);
    r = addEdit(r, "note", "hand", "card", 20_000, 2_000);
    expect(r.fields.note!.edits).toBe(2);
  });

  it("일괄·이전값은 횟수만(시간·카드/표 횟수 없음)", () => {
    let r = addEdit(undefined, "homework", "bulk", "grid", 0, null);
    r = addEdit(r, "homework", "prev", "grid", 10_000, 0);
    expect(r.fields.homework).toMatchObject({ edits: 0, ms: 0, bulk: 1, prev: 1 });
    expect(r.grid).toBe(0);
  });

  it("자동작성은 기다린 시간으로 따로 · 손 시간 합에 안 든다", () => {
    let r = addEdit(undefined, "progress", "hand", "card", 0, null);
    r = addEdit(r, "attitude", "hand", "card", 10_000, 0);
    r = addAutowrite(r, 12_000, 20_000);
    const p = toPayload(r, 30_000, { view: "card", mode: "single", queued: true });
    expect(p.fields.autowrite).toMatchObject({ edits: 1, ms: 8_000 });
    expect(p.activeMs).toBe(10_000);
    expect(p.totalMs).toBe(30_000);
    expect(p.fields.attitude!.firstSec).toBe(10);
  });

  it("기록이 없어도(새로고침 뒤) 화면·방식은 남긴다", () => {
    const p = toPayload(undefined, 0, { view: "grid", mode: "bulk", queued: false });
    expect(p).toMatchObject({ startedAt: null, totalMs: null, activeMs: 0, sendView: "grid", sendMode: "bulk", fields: {} });
  });
});

describe("작성 시간 기록 — 서버 검증", () => {
  it("모르는 화면·방식은 버린다 · 모르는 영역은 뺀다 · 값은 하루 안으로", () => {
    expect(sanitizePayload({ sendView: "status", sendMode: "single" })).toBeNull();
    expect(sanitizePayload(null)).toBeNull();
    const p = sanitizePayload({
      sendView: "grid",
      sendMode: "bulk",
      queued: true,
      activeMs: 9e12,
      fields: { note: { edits: 2, ms: -5 }, hack: { edits: 1 } },
    })!;
    expect(p.activeMs).toBe(86_400_000);
    expect(p.fields.note).toMatchObject({ edits: 2, ms: 0 });
    expect(Object.keys(p.fields)).toEqual(["note"]);
  });
});

describe("배선", () => {
  const client = readOnescreenScreen();
  it("저장·발송 두 코어가 기록을 넘기고, 일괄 발송·저장은 '일괄'로", () => {
    expect(client.match(/queueWriteTiming\(res\.id/g)?.length).toBe(2);
    expect(client).toContain('saveRecord(student, r.subject.name, "bulk")');
    expect(client).toContain('queueOne(student, r.subject.name, "bulk")');
  });
  it("일괄 입력·이전값 가져오기는 손 시간으로 세지 않는다", () => {
    expect(client).toContain('beginWriteOrigin("bulk")');
    for (const f of ["copyFirstRowDown", "importPrevFor", "bulkImportPrev", "applyPrevComments", "applySheetDraft"])
      expect(client).toMatch(new RegExp(`function ${f}\\([^)]*\\) \\{\\n    return withWriteOrigin\\(`));
  });
});
