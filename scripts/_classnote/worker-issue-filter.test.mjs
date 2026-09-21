import { describe, it, expect } from "vitest";
import { isWorkerIssueLine } from "./worker-issue-filter.mjs";

describe("isWorkerIssueLine", () => {
  // 2026-07-21 실측: 이 줄이 '실패'라는 글자 때문에 경고 5칸 중 2칸을 먹고 있었다.
  it("0건 정상 보고는 문제가 아니다", () => {
    expect(isWorkerIssueLine("처리 완료 — 성공 2 / 실패 0 / 재큐 0 / stale복구 0")).toBe(false);
    expect(isWorkerIssueLine("오류 0건")).toBe(false);
    expect(isWorkerIssueLine("실패: 0")).toBe(false);
  });

  it("실제 실패는 문제다", () => {
    expect(isWorkerIssueLine("처리 완료 — 성공 0 / 실패 3 / 재큐 1")).toBe(true);
    expect(isWorkerIssueLine("heartbeat 실패(무시): connection reset")).toBe(true);
    expect(isWorkerIssueLine("오류 2건 발생")).toBe(true);
  });

  it("0과 0 아닌 게 섞이면 문제다", () => {
    expect(isWorkerIssueLine("실패 0 / 오류 2")).toBe(true);
  });

  it("⚠ 는 무조건 문제", () => {
    expect(isWorkerIssueLine("[읽음] ⚠️ 후보 578건이 aywa 행과 매칭되지 않음")).toBe(true);
  });

  it("영문 error/exception도 문제", () => {
    expect(isWorkerIssueLine("TypeError: cannot read property")).toBe(true);
    expect(isWorkerIssueLine("Navigation failed")).toBe(true);
  });

  it("평범한 진행 로그는 통과", () => {
    expect(isWorkerIssueLine("데몬 시작 — mode=POST(실게시) host=학원동기화-PC")).toBe(false);
    expect(isWorkerIssueLine("[읽음] 새로 반영할 읽음 없음 — 후보 578건 중 aywa 대응 308행은 이미 반영됨(정상)")).toBe(false);
    expect(isWorkerIssueLine("[읽음] edutrix 매칭 갱신 1건")).toBe(false);
  });

  it("빈 값은 문제 아님", () => {
    expect(isWorkerIssueLine("")).toBe(false);
    expect(isWorkerIssueLine(null)).toBe(false);
    expect(isWorkerIssueLine(undefined)).toBe(false);
  });
});
