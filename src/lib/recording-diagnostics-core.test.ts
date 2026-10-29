import { describe, expect, it } from "vitest";
import { browserFamily, classifyLeftover, parseInterruptReport } from "./recording-diagnostics-core";
import type { RecordingMeta } from "./recording-recovery";

const meta = (values: Partial<RecordingMeta> = {}): RecordingMeta => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e", kind: "meeting", scopeKey: '["t","u","meeting:x"]',
  startedAt: Date.now() - 600_000, mimeType: "audio/webm", chunkCount: 120, diag: 1, ...values,
});

describe("녹음 중단 진단 — 남은 백업 판정", () => {
  it("끝 기록 없이 사라졌고 잠금도 없으면 = 끝 기록 없이 사라짐 · 탭 닫기 표시가 있으면 = 탭 닫기", () => {
    expect(classifyLeftover(meta(), false, false)).toBe("unclean_end");
    expect(classifyLeftover(meta(), false, true)).toBe("page_closed");
  });
  it("🔴 어느 탭이 대상 잠금을 쥐고 있으면(살아 있는 녹음 · 절전 중인 탭) 판정하지 않는다", () => {
    expect(classifyLeftover(meta(), true, false)).toBeNull();
    expect(classifyLeftover(meta(), true, true)).toBeNull();
  });
  it("직접 끝낸 녹음 · 이미 보고한 것 · 소리 없는 것 · 진단 이전 백업은 보내지 않는다", () => {
    expect(classifyLeftover(meta({ endReason: "stopped", endedAt: 1 }), false, false)).toBeNull();
    expect(classifyLeftover(meta({ endReason: "track_ended", endedAt: 1, reportedAt: 2 }), false, false)).toBeNull();
    expect(classifyLeftover(meta({ chunkCount: 0 }), false, false)).toBeNull();
    expect(classifyLeftover(meta({ diag: undefined }), false, false)).toBeNull();
  });
  it("즉시 보고를 못 보낸 중단 · 버린 녹음 · 끝난 뒤 적은 탭 닫기는 다시 보낸다(끝났으면 잠금과 무관)", () => {
    expect(classifyLeftover(meta({ endReason: "track_ended", endedAt: 1 }), true, false)).toBe("track_ended");
    // 끊김을 적은 뒤 onstop 전에 탭이 닫힘 — 끝 시각은 없지만 원인은 마이크 끊김(탭 닫기 표시보다 먼저)
    expect(classifyLeftover(meta({ endReason: "track_ended" }), false, true)).toBe("track_ended");
    // 끊김을 적었지만 아직 그 탭이 쥐고 있음 — 건드리지 않는다
    expect(classifyLeftover(meta({ endReason: "track_ended" }), true, false)).toBeNull();
    expect(classifyLeftover(meta({ endReason: "signed_out", endedAt: 1 }), false, false)).toBe("signed_out");
    expect(classifyLeftover(meta({ endReason: "page_closed", endedAt: 1 }), false, true)).toBe("page_closed");
  });
  it("소리를 비운 표 — 녹음이 죽었으면 보내고, 다른 탭에서 아직 녹음 중이면(잠금) 건드리지 않는다 · 보낸 표는 다시 보내지 않는다", () => {
    expect(classifyLeftover(meta({ cleared: true }), false, false)).toBe("unclean_end");
    expect(classifyLeftover(meta({ cleared: true }), true, false)).toBeNull();
    expect(classifyLeftover(meta({ cleared: true, reportedAt: 1 }), false, false)).toBeNull();
  });
  it("🔴 동기 저장소에 적은 처음 사유가 탭 닫기보다 앞선다 — 백업 쓰기가 못 끝난 채 탭이 닫혀도", () => {
    expect(classifyLeftover(meta(), false, true, "track_ended")).toBe("track_ended");
    expect(classifyLeftover(meta({ endReason: "page_closed", endedAt: 1 }), false, true, "recorder_error")).toBe("recorder_error");
    expect(classifyLeftover(meta({ endReason: "stopped", endedAt: 1 }), false, false, "track_ended")).toBeNull();
    expect(classifyLeftover(meta(), true, false, "track_ended")).toBeNull(); // 아직 녹음 중
  });
  it("끝내기를 누른 뒤 끝 기록 전에 탭이 닫히면 직접 끝낸 녹음 — 보내지 않는다(먼저 본 중단은 그대로)", () => {
    expect(classifyLeftover(meta(), false, true, null, true)).toBeNull();
    expect(classifyLeftover(meta({ endReason: "track_ended" }), false, false, null, true)).toBe("track_ended");
  });
  it("모르는 끝 사유 + 끝 시각이 있으면 보내지 않는다", () => {
    expect(classifyLeftover(meta({ endReason: "weird", endedAt: 1 }), false, false)).toBeNull();
  });
});

describe("녹음 중단 진단 — 서버가 받는 모양", () => {
  const ok = { sessionId: "0F8FAD5B-D9CB-469F-A165-70867728950E", ownerTenantId: "t", ownerUserId: "u", kind: "meeting", reason: "track_ended", startedAt: Date.now() - 1000, endedAt: Date.now(), seconds: 61, browser: "whale" };
  it("맞는 값은 받고 id는 소문자로", () => {
    expect(parseInterruptReport(ok)).toMatchObject({ sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e", reason: "track_ended", seconds: 61, browser: "whale", late: false });
  });
  it("모르는 사유·종류·id는 거절", () => {
    expect(parseInterruptReport({ ...ok, reason: "x" })).toBeNull();
    expect(parseInterruptReport({ ...ok, kind: "x" })).toBeNull();
    expect(parseInterruptReport({ ...ok, sessionId: "abc" })).toBeNull();
    expect(parseInterruptReport({ ...ok, endedAt: ok.startedAt - 5 })).toBeNull();
    expect(parseInterruptReport({ ...ok, ownerUserId: "" })).toBeNull();
  });
  it("오래 묵은 백업(90일 넘음)도 받는다 — 거절하면 기록 없이 '보냄'으로 끝난다", () => {
    expect(parseInterruptReport({ ...ok, startedAt: Date.now() - 200 * 86400_000, endedAt: null })).not.toBeNull();
  });
  it("🔴 제목·이름 같은 칸은 실리지 않는다 · 이상한 코드·브라우저는 버린다", () => {
    const parsed = parseInterruptReport({ ...ok, title: "김철수 상담", label: "김철수", errorCode: "<script>", browser: "Mozilla/5.0" })!;
    expect(Object.keys(parsed)).not.toContain("title");
    expect(Object.keys(parsed)).not.toContain("label");
    expect(parsed.errorCode).toBeNull();
    expect(parsed.browser).toBe("other");
  });
});

describe("브라우저 계열", () => {
  it("Chrome을 품는 브라우저를 먼저 가른다", () => {
    expect(browserFamily("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Whale/4.28 Safari/537.36")).toBe("whale");
    expect(browserFamily("Mozilla/5.0 Chrome/128.0 Safari/537.36 Edg/128.0")).toBe("edge");
    expect(browserFamily("Mozilla/5.0 Chrome/128.0 Safari/537.36")).toBe("chrome");
    expect(browserFamily("Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15")).toBe("safari");
  });
});
