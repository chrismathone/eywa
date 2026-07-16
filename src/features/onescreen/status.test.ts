import { describe, it, expect } from "vitest";
import { rowSendStatus, summarizeSend } from "./status";
import type { GridRow } from "./grid";
import type { Subject } from "./types";
import type { SubjectReport } from "./components/report-card";

const subject = (over: Partial<Subject> = {}): Subject => ({ name: "수학", prev: "", today: "이차함수", ...over });

describe("rowSendStatus", () => {
  it("발송됨 > 작성중(진도/초안) > 미작성", () => {
    expect(rowSendStatus({ draft: "x", sent: true }, subject())).toBe("sent");
    expect(rowSendStatus({ draft: "안녕", sent: false }, subject({ today: "" }))).toBe("draft"); // 초안만 있어도 작성중
    expect(rowSendStatus({ draft: "", sent: false }, subject({ today: "이차함수" }))).toBe("draft"); // 진도만 있어도 작성중
    expect(rowSendStatus({ draft: "", sent: false }, subject({ today: "" }))).toBe("todo"); // 아무것도 없음
    expect(rowSendStatus(undefined, subject({ today: "" }))).toBe("todo");
  });
});

describe("summarizeSend", () => {
  const row = (id: string, sub: Subject): GridRow => ({
    student: { id, name: id, subjects: [sub] } as unknown as GridRow["student"],
    subject: sub,
    subjectIndex: 0,
    key: `${id}::${sub.name}`,
    index: 0,
  });

  it("미작성/작성중/발송/열람 집계 + unsent=draft+todo", () => {
    const rows = [row("a", subject()), row("b", subject()), row("c", subject({ today: "" })), row("d", subject())];
    const reports: Record<string, Record<string, SubjectReport>> = {
      a: { 수학: { draft: "완료", sent: true, viewCount: 2 } }, // 발송+열람
      b: { 수학: { draft: "초안", sent: false } }, // 작성중
      // c: 진도·초안 없음 → 미작성
      d: { 수학: { draft: "완료", sent: true, viewCount: 0 } }, // 발송, 미열람
    };
    const s = summarizeSend(rows, reports);
    expect(s).toEqual({ total: 4, sent: 2, draft: 1, todo: 1, unsent: 2, viewed: 1 });
  });
});
