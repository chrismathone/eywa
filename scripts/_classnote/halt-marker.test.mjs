// 멈춤 표식(반 보드 자동 해제 · 명부 퇴원처리 공용) — 모르면 멈춘다 · 파일을 못 써도 막힌다 · 사람이 파일을 지우면 다시 시작한다(R3 · F2~F4).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ dir: null }));
vi.mock("./classnote-paths.mjs", () => ({ stateFile: (name) => (m.dir ? `${m.dir}/${name}` : null) }));
const { HALT_UNREADABLE, MEMORY_ONLY_NOTE, haltMarker, kstHaltText } = await import("./halt-marker.mjs");

const tmp = [];
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  m.dir = null;
});

describe("haltMarker", () => {
  it("🔴 파일 쓰기에 실패해도 사유가 남는다(파일 사유 || 메모리 사유) — 메모리로만 멈춘 사유엔 '다시 시작해야 풀립니다'", () => {
    m.dir = path.join(os.tmpdir(), `halt-missing-${process.pid}-${Date.now()}`, "없는 폴더"); // 만들지 않는다 → 쓰기 실패
    const h = haltMarker("x-halt.txt");
    expect(h.reason()).toBe("");
    h.set("다른 원아가 함께 사라졌다");
    expect(h.reason()).toBe(`다른 원아가 함께 사라졌다 ${MEMORY_ONLY_NOTE}`);
    h.resetForTest();
    expect(h.reason()).toBe("");
  });
  it("파일을 쓴 경우 — 사유는 파일에서(시각은 KST로) 읽고, 사람이 파일을 지우면 같은 프로세스에서도 바로 다시 시작한다", () => {
    m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "halt-ok-"));
    tmp.push(m.dir);
    const h = haltMarker("x-halt.txt");
    h.set("다른 배정 1개가 함께 사라졌다");
    expect(h.reason()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} KST 다른 배정 1개가 함께 사라졌다$/);
    expect(fs.readFileSync(path.join(m.dir, "x-halt.txt"), "utf8")).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z 다른 배정/); // 파일 안은 UTC 그대로
    fs.rmSync(path.join(m.dir, "x-halt.txt"));
    expect(h.reason()).toBe("");
  });
  it("🔴 파일이 있는데 읽지 못하면 멈춤으로 본다(F2 — 되돌릴 수 없는 퇴원처리도 이 표식을 쓴다)", () => {
    m.dir = "Z:/halt";
    const fsImpl = { existsSync: () => true, readFileSync: () => { throw new Error("EACCES"); }, writeFileSync: () => {} };
    expect(haltMarker("x-halt.txt", { fsImpl }).reason()).toBe(HALT_UNREADABLE);
  });
  it("🔴 한 번 못 쓴 뒤 다음에 쓰기에 성공하면 메모리를 비운다(F3 — 그 뒤엔 파일을 지우면 풀린다)", () => {
    m.dir = "Z:/halt";
    let canWrite = false;
    let exists = false;
    const fsImpl = { existsSync: () => exists, readFileSync: () => "2026-11-03T20:00:00.000Z 두 번째", writeFileSync: () => { if (!canWrite) throw new Error("EPERM"); exists = true; } };
    const h = haltMarker("x-halt.txt", { fsImpl });
    h.set("첫 번째");
    expect(h.reason()).toContain(MEMORY_ONLY_NOTE);
    canWrite = true;
    h.set("두 번째");
    expect(h.reason()).toBe("2026-11-04 05:00 KST 두 번째");
    exists = false; // 사람이 파일을 지웠다
    expect(h.reason()).toBe("");
  });
  it("경로가 없는 환경은 메모리로만 · 시각 표기(KST)", () => {
    const h = haltMarker("x-halt.txt");
    h.set("");
    expect(h.reason()).toBe(`사유 미기록 ${MEMORY_ONLY_NOTE}`);
    expect(kstHaltText("2026-11-03T20:01:02.345Z 다른 원아 1명이 사라짐")).toBe("2026-11-04 05:01 KST 다른 원아 1명이 사라짐");
    expect(kstHaltText("시각 없는 사유")).toBe("시각 없는 사유");
  });
});
