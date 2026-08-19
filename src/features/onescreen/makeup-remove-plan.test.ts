import { describe, expect, it } from "vitest";
import {
  canRemoveMakeupRow,
  makeupRemoveBlockReason,
  makeupRemoveMessage,
  planMakeupRemoval,
} from "./makeup-remove-plan";

/**
 * 보강 빼기 판정 — 🔴 핵심 규약은 **"학부모에게 나간 보강은 취소할 수 없다"**
 * (원장 2026-08-18: *"이미 수업보고서가 발송된건은 보강취소를 못하게 강제해"*).
 * 지우려면 회수(게시글 삭제)가 먼저고, 회수 완료분만 지울 수 있다.
 */
const row = (o: Partial<{ id: string; classnoteStatus: string | null; shareToken: string | null }> = {}) => ({
  id: "r1",
  classnoteStatus: null as string | null,
  shareToken: null as string | null,
  ...o,
});

describe("planMakeupRemoval", () => {
  it("미발송(상태 없음)은 바로 삭제", () => {
    expect(planMakeupRemoval([row()])).toEqual({ deleteIds: ["r1"], sentIds: [], busyIds: [] });
  });

  it("🔴 발송 완료는 취소 불가 — 삭제 목록에 절대 들어가지 않는다", () => {
    const p = planMakeupRemoval([row({ classnoteStatus: "success", shareToken: "tok" })]);
    expect(p.sentIds).toEqual(["r1"]);
    expect(p.deleteIds).toEqual([]);
  });

  it("🔴 공유 토큰이 없어도 발송분은 발송분이다(지우면 게시글만 남고 흔적이 사라진다)", () => {
    const p = planMakeupRemoval([row({ classnoteStatus: "success", shareToken: null })]);
    expect(p.sentIds).toEqual(["r1"]);
    expect(p.deleteIds).toEqual([]);
  });

  it("회수 실패는 게시글이 아직 살아 있다 → 취소 불가", () => {
    expect(planMakeupRemoval([row({ classnoteStatus: "recall_failed" })]).sentIds).toEqual(["r1"]);
  });

  it("회수 완료(recalled)는 게시글이 이미 없으므로 삭제 가능", () => {
    const p = planMakeupRemoval([row({ classnoteStatus: "recalled", shareToken: "tok" })]);
    expect(p.deleteIds).toEqual(["r1"]);
    expect(p.sentIds).toEqual([]);
  });

  it("발송 대기·처리 중·회수 요청 중은 건드리지 않는다(워커가 집어간 작업)", () => {
    const p = planMakeupRemoval([
      row({ id: "a", classnoteStatus: "queued" }),
      row({ id: "b", classnoteStatus: "processing" }),
      row({ id: "c", classnoteStatus: "recall_requested", shareToken: "t" }),
    ]);
    expect(p.busyIds).toEqual(["a", "b", "c"]);
    expect(p.deleteIds).toEqual([]);
  });

  it("발송이 애초에 안 된 상태들(실패·과목 제외)은 삭제", () => {
    const p = planMakeupRemoval([
      row({ id: "a", classnoteStatus: "failed" }),
      row({ id: "b", classnoteStatus: "subject_off" }),
      row({ id: "c", classnoteStatus: "too_old" }),
    ]);
    expect(p.deleteIds).toEqual(["a", "b", "c"]);
  });
});

describe("canRemoveMakeupRow / makeupRemoveBlockReason — 🔴 NULL을 '발송됨'으로 보면 미발송 보강을 못 뺀다", () => {
  it("미발송(NULL·undefined)·발송 실패·회수 완료는 뺄 수 있다", () => {
    for (const s of [null, undefined, "failed", "recalled", "subject_off", "too_old"]) {
      expect(canRemoveMakeupRow(s)).toBe(true);
      expect(makeupRemoveBlockReason(s)).toBeNull();
    }
  });

  it("발송·처리 중은 못 뺀다 + 이유가 한글로 갈린다(raw 상태 코드 노출 금지)", () => {
    expect(canRemoveMakeupRow("success")).toBe(false);
    expect(makeupRemoveBlockReason("success")).toContain("먼저 보고서를 회수");
    expect(makeupRemoveBlockReason("recall_failed")).toContain("발송된 보강");
    expect(makeupRemoveBlockReason("queued")).toContain("발송 처리 중");
    expect(makeupRemoveBlockReason("processing")).toContain("발송 처리 중");
    expect(makeupRemoveBlockReason("recall_requested")).toContain("회수 처리 중");
    for (const s of ["success", "queued", "processing", "recall_requested", "recall_failed"]) {
      expect(makeupRemoveBlockReason(s)).not.toContain(s); // 영문 코드가 그대로 새면 안 된다
    }
  });
});

describe("makeupRemoveMessage — 실제로 일어난 일만 적는다", () => {
  it("출결만 지운 경우", () => {
    expect(makeupRemoveMessage({ attendanceRemoved: true, deleted: 0 })).toBe("출결 기록을 지웠습니다");
  });

  it("진도 되감기를 별도로 알린다(원장 '진도기록도 되돌려야지')", () => {
    const msg = makeupRemoveMessage({ attendanceRemoved: true, deleted: 1, progressEntries: 2 });
    expect(msg).toContain("진도 기록 2건을 되돌렸습니다");
  });

  it("남의 보강이 섞였으면 남는다고 말한다(조용히 넘기면 '반만 빠졌다'가 된다)", () => {
    expect(makeupRemoveMessage({ attendanceRemoved: true, deleted: 1, notMine: 2 })).toContain(
      "다른 선생님이 쓴 보강 2건은 그대로 남습니다",
    );
  });

  it("아무것도 안 지웠으면 그렇게 말한다(거짓 성공 금지)", () => {
    expect(makeupRemoveMessage({ attendanceRemoved: false, deleted: 0 })).toBe("지울 기록이 없습니다");
  });
});
