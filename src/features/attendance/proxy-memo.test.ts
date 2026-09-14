/**
 * 빗금 칸 입력의 `대신 입력` 메모 줄(원장 2026-09-14 *"대신 다른 사람이 출결하면 메모에 남겨."*) — 붙이기와 걸러내기.
 */
import { describe, expect, it } from "vitest";
import { noteTargetRow, proxyMemoLine, proxyNote, stripProxyMemo } from "./proxy-memo";

describe("noteTargetRow — 메모만 저장이 고칠 행 = 화면이 보여 준 메모의 행", () => {
  const r = (id: string, note: string | null) => ({ id, note });

  it("🔴 사유 있는 메모가 대신 입력 줄뿐인 메모보다 먼저 — 같은 시각 여러 행(빗금 칸 입력 뒤)", () => {
    expect(noteTargetRow([r("a", "대신 입력: 박소선"), r("b", "병결\n대신 입력: 박소선")])?.id).toBe("b");
  });

  it("제 몫 행이 남의 교시 행보다 먼저(조회의 note ?? otherNote) · 메모가 없으면 가장 최근 행", () => {
    const mine = (x: { id: string }) => x.id !== "o";
    expect(noteTargetRow([r("o", "병결"), r("m", "대신 입력: 박소선")], mine)?.id).toBe("m");
    expect(noteTargetRow([r("o", "병결"), r("m", null)], mine)?.id).toBe("o");
    expect(noteTargetRow([r("x", null), r("y", null)])?.id).toBe("x");
    expect(noteTargetRow([])).toBeUndefined();
  });
});

describe("proxyNote — 대신 입력 메모(원장 결정 ③)", () => {
  it("빈 메모엔 그 한 줄만", () => {
    expect(proxyNote(null, "박소선")).toBe("대신 입력: 박소선");
    expect(proxyNote("  ", "박소선")).toBe("대신 입력: 박소선");
  });

  it("🔴 기존 메모(결석 사유)는 보존하고 끝에 붙인다", () => {
    expect(proxyNote("병결", "박소선")).toBe("병결\n대신 입력: 박소선");
  });

  it("🔴 두 번 옮겨도 한 줄(멱등) · 다른 사람이 옮기면 그 줄이 하나 더", () => {
    const once = proxyNote("병결", "박소선");
    expect(proxyNote(once, "박소선")).toBe(once);
    expect(proxyNote(once, "이승엽")).toBe("병결\n대신 입력: 박소선\n대신 입력: 이승엽");
  });

  it("표시 이름이 비었으면 빈 꼬리 대신 '이름 없음'", () => {
    expect(proxyMemoLine("")).toBe("대신 입력: 이름 없음");
    expect(proxyMemoLine(undefined)).toBe("대신 입력: 이름 없음");
  });
});

describe("stripProxyMemo — 사유를 읽는 곳이 먼저 지난다(적대 리뷰 2026-09-14)", () => {
  it("🔴 대신 입력 줄뿐이면 사유는 없다(빈 문자열)", () => {
    expect(stripProxyMemo("대신 입력: 박소선")).toBe("");
    expect(stripProxyMemo("대신 입력: 박소선\n대신 입력: 이승엽")).toBe("");
  });

  it("사유 줄은 순서 그대로 남는다 — 앞이든 뒤든", () => {
    expect(stripProxyMemo("병결\n대신 입력: 박소선")).toBe("병결");
    expect(stripProxyMemo("대신 입력: 박소선\n가족여행 (데스크 접수)")).toBe("가족여행 (데스크 접수)");
    expect(stripProxyMemo("병결\n대신 입력: 박소선\n7/16 결석분 보강")).toBe("병결\n7/16 결석분 보강");
  });

  it("비었거나 없으면 빈 문자열 · 줄 가운데 '대신 입력'이란 말이 있는 사유는 건드리지 않는다", () => {
    expect(stripProxyMemo(null)).toBe("");
    expect(stripProxyMemo(undefined)).toBe("");
    expect(stripProxyMemo("엄마가 대신 입력: 전화로 알림")).toBe("엄마가 대신 입력: 전화로 알림");
  });
});
