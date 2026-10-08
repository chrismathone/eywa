import { describe, expect, it } from "vitest";
import { parseUploadEvent, readUploadDiagnostics, uploadFailureText, type UploadEvent } from "./upload-diagnostics";
import { uploadAttemptStatus, type HomeworkUploadAttempt } from "@/features/students/homework-upload-log";

export const event: UploadEvent = { kind: "failed", sequence: 1, elapsedMs: 5000, sentBytes: 1024, phase: "transfer", reason: "network", attempt: 2, httpStatus: null, online: false, visibility: "visible", browser: "chrome" };
describe("업로드 관측값", () => {
  it("원문 오류·세션 주소 등 추가 필드는 저장하지 않는다", () => {
    expect(parseUploadEvent({ ...event, sessionUrl: "secret", error: "secret", fileName: "private" })).toEqual(event);
  });
  it.each([{ sequence: 0 }, { sentBytes: Infinity }, { elapsedMs: -1 }, { reason: "private error" }, { browser: "raw user agent" }, { httpStatus: 999 }, { sequence: 1.5 }])("잘못된 관측값을 거절한다 %j", patch => {
    expect(parseUploadEvent({ ...event, ...patch })).toBeNull();
  });
  it("손상된 저장값은 노출하지 않는다", () => {
    expect(readUploadDiagnostics({ last: { ...event, receivedAt: "invalid" }, history: [null, "broken"] })).toEqual({ last: undefined, lastError: undefined, history: [] });
  });
  it("네트워크와 시간 초과에 서로 다른 재시도 안내가 있다", () => {
    expect(uploadFailureText("network").label).not.toBe(uploadFailureText("timeout").label);
    expect(uploadFailureText("session_gone").help).toContain("새로 시작");
  });
});
describe("완료되지 않은 시도는 미제출", () => {
  const row: HomeworkUploadAttempt = { id: "u", createdAt: "2026-10-08T13:00:00Z", completedAt: null, status: "started", hasVideo: false, bytes: 1024, className: "수학", homeworkDate: "2026-10-06", diagnostics: {} };
  it("이전 기록은 중단 주체를 단정하지 않는다", () => { expect(uploadAttemptStatus(row)).toBe("미제출 · 전송 시작 후 완료되지 않음"); });
  it("기기가 완료라고 보내도 서버 영상이 없으면 완료가 아니다", () => {
    expect(uploadAttemptStatus({ ...row, diagnostics: { last: { ...event, kind: "confirmed", reason: null, receivedAt: new Date().toISOString() } } })).toContain("미제출");
    expect(uploadAttemptStatus({ ...row, status: "completed" })).toContain("미제출");
  });
  it("나중에 복구돼 완료된 업로드는 오래된 오류보다 서버 완료가 우선한다", () => {
    expect(uploadAttemptStatus({ ...row, status: "completed", hasVideo: true, diagnostics: { last: { ...event, receivedAt: new Date().toISOString() } } })).toBe("제출 완료");
  });
});
