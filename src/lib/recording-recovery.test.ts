import { describe, expect, it } from "vitest";
import { consultationRecordingKey, recordingScopeKey } from "./recording-recovery";
import { AUDIO_FILE_ACCEPT, recordingFileName, validateAudioFile } from "./audio-upload";

describe("recording identity", () => {
  it("saved A and B consultations never share a key, even for the same name and phone", () => {
    expect(consultationRecordingKey("a", "김민준", "01012345678")).not.toBe(consultationRecordingKey("b", "김민준", "01012345678"));
  });
  it("saved records survive display-name edits", () => {
    expect(consultationRecordingKey("a", "A", "")).toBe(consultationRecordingKey("a", "A 수정", ""));
  });
  it("unsaved prospects normalize phone formatting and separate homonyms", () => {
    expect(consultationRecordingKey(undefined, " A ", "010-1234-5678")).toBe(consultationRecordingKey(undefined, "A", "01012345678"));
    expect(consultationRecordingKey(undefined, "A", "01012345678")).not.toBe(consultationRecordingKey(undefined, "A", "01099999999"));
  });
  it("never guesses a student using only their name; a restored draft can identify them", () => {
    expect(consultationRecordingKey(undefined, "A", "")).toBeNull();
    expect(consultationRecordingKey(undefined, "A", "", "draft-a")).not.toBe(consultationRecordingKey(undefined, "A", "", "draft-b"));
    expect(consultationRecordingKey(undefined, "", "01012345678", "draft-a")).toBeNull();
  });
  it("isolates account and branch independently of record id", () => {
    const scope = { tenantId: "t1", userId: "u1", recordKey: "a", label: "A" };
    expect(recordingScopeKey(scope)).not.toBe(recordingScopeKey({ ...scope, userId: "u2" }));
    expect(recordingScopeKey(scope)).not.toBe(recordingScopeKey({ ...scope, tenantId: "t2" }));
    expect(recordingScopeKey(scope)).toBe(recordingScopeKey({ ...scope, label: "A 수정" }));
  });
});

describe("disk backup names", () => {
  const time = new Date("2026-10-13T01:02:03Z");
  it("identifies the recording kind, student and Korean time", () => {
    expect(recordingFileName("consultation", "김민준", time, "abcd1234-0000")).toBe("콜앤상담녹음_김민준_2026-10-13_10-02-03_KST_abcd1234.webm");
    expect(recordingFileName("meeting", "강사 회의", time, "abcd1234")).toContain("회의녹음_강사 회의_");
    expect(recordingFileName("student-consultation", "김민준", time, "abcd1234")).toContain("상담녹음_김민준_");
  });
  it("removes Windows-invalid characters and distinguishes recordings made in the same second", () => {
    const a = recordingFileName("consultation", 'A/B:C*D?"E<F>G|H\\I', time, "abcd1234");
    expect(a).not.toMatch(/[<>:"/\\|?*]/);
    expect(a).not.toBe(recordingFileName("consultation", 'A/B:C*D?"E<F>G|H\\I', time, "98765432"));
  });
  it("allows picking and uploading a Windows .webm backup identified as video", () => {
    expect(AUDIO_FILE_ACCEPT.split(",")).toContain(".webm");
    expect(validateAudioFile({ name: "콜앤상담녹음_A.webm", type: "video/webm", size: 100 })).toBeNull();
  });
  it.each([["audio/mp4", "m4a"], ["audio/ogg;codecs=opus", "ogg"], ["audio/webm;codecs=opus", "webm"]])("uses the recording format's extension (%s)", (mime, extension) => {
    const name = recordingFileName("meeting", "회의", time, "abcd1234", mime);
    expect(name).toMatch(new RegExp(`\\.${extension}$`));
    expect(validateAudioFile({ name, type: mime, size: 100 })).toBeNull();
  });
});
