import { describe, expect, it, vi } from "vitest";
import { buildGridRows } from "./grid";
import { attachPhotoEntries, photoBlock, photoTargets, resolvePhotoTarget, type PhotoEntry } from "./sequential-photo";
import type { OneScreenStudent } from "./types";

const student = {
  id: "a", name: "이학생", subjects: [
    { name: "영어 · JJ1A", subjectKey: "english", classId: "class-a", className: "JJ1A", today: "Unit 1" },
    { name: "수학", subjectKey: "math", classId: "math", today: "1단원" },
    { name: "영어 · 특강", subjectKey: "english", classId: "class-b", className: "특강", today: "Unit 2" },
  ],
} as OneScreenStudent;
const rows = buildGridRows([student]);
const target = photoTargets(rows, {}, "2026-11-13")[0];
const file = (name: string) => new File([name], name, { type: "image/jpeg" });
const entry = (key: string, files: File[]): PhotoEntry => ({ target: { ...target, key }, files, added: 0 });

describe("표 순서와 수업별 촬영 대상", () => {
  it("화면 순서를 유지하고 같은 학생의 두 수업과 날짜를 구분한다", () => {
    const targets = photoTargets([rows[2], rows[1], rows[0]], {}, "2026-10-29");
    expect(targets.map(t => [t.subjectName, t.classId, t.date])).toEqual([
      ["영어 · 특강", "class-b", "2026-10-29"], ["영어 · JJ1A", "class-a", "2026-10-29"],
    ]);
  });
  it("결석·발송분도 자리를 남겨 순서가 당겨지지 않는다", () => {
    const targets = photoTargets([rows[0], { ...rows[2], subject: { ...rows[2].subject, attendanceRaw: "absent" } }], {}, "2026-11-13");
    expect(targets).toHaveLength(2);
    expect(targets[1].block).toBe("absent");
    expect(photoBlock(rows[0], { draft: "", sent: true, classnoteStatus: "processing" })).toBe("locked");
  });
  it("날짜·반·학생이 바뀌면 같은 이름의 새 보고서에 붙이지 않는다", () => {
    expect(resolvePhotoTarget(target, [student], "2026-11-13")?.subject.classId).toBe("class-a");
    expect(resolvePhotoTarget(target, [student], "2026-11-14")).toBeNull();
    expect(resolvePhotoTarget(target, [], "2026-11-13")).toBeNull();
    expect(resolvePhotoTarget(target, [{ ...student, subjects: student.subjects.map(s => ({ ...s, classId: "moved" })) }], "2026-11-13")).toBeNull();
  });
  it("진도 없이 사진을 먼저 받고 첨부 수·보강·미발송 반·발송 잠금은 유지한다", () => {
    expect(photoBlock(rows[0], { draft: "", sent: true, attachments: Array(6).fill({ path: "x", name: "x" }) })).toBe("full");
    expect(photoBlock({ ...rows[0], subject: { ...rows[0].subject, today: "" } }, undefined)).toBeUndefined();
    expect(photoBlock({ ...rows[0], subject: { ...rows[0].subject, splitIn: "other-class" } }, undefined)).toBe("split");
    expect(photoBlock({ ...rows[0], subject: { ...rows[0].subject, reportOptout: true } }, undefined)).toBe("optout");
    expect(photoBlock({ ...rows[0], subject: { ...rows[0].subject, classnoteStatus: "success" } }, { sent: true, draft: "", classnoteStatus: null })).toBeUndefined();
    expect(photoBlock({ ...rows[0], subject: { ...rows[0].subject, classnoteStatus: "success" } }, { sent: false, draft: "", classnoteStatus: null })).toBeUndefined();
  });
});

it("일부 실패 후에는 성공한 사진을 빼고 같은 학생의 남은 사진만 다시 올린다", async () => {
  const entries = [entry("a", [file("a1"), file("a2")]), entry("skipped", []), entry("b", [file("b1")])];
  const attach = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  await attachPhotoEntries(entries, attach, (i, next) => { entries[i] = next; });
  expect(attach.mock.calls.map(([t, files]) => [t.key, files[0].name])).toEqual([["a", "a1"], ["a", "a2"], ["b", "b1"]]);
  expect(entries.map(e => [e.target.key, e.files.map(f => f.name), e.added, e.error])).toEqual([
    ["a", ["a2"], 1, true], ["skipped", [], 0, undefined], ["b", [], 1, false],
  ]);
  const retry = vi.fn().mockResolvedValue(1);
  await attachPhotoEntries(entries, retry, (i, next) => { entries[i] = next; });
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry.mock.calls[0][0].key).toBe("a");
  expect(retry.mock.calls[0][1][0].name).toBe("a2");
  expect(entries[0].added).toBe(2);
});

it("업로드 예외도 해당 사진을 보존하고 다른 학생의 대상으로 옮기지 않는다", async () => {
  const entries = [entry("a", [file("a1")]), entry("b", [file("b1")])];
  const attach = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(1);
  await attachPhotoEntries(entries, attach, (i, next) => { entries[i] = next; });
  expect(entries[0].files[0].name).toBe("a1");
  expect(entries[0].error).toBe(true);
  expect(entries[1].added).toBe(1);
});
