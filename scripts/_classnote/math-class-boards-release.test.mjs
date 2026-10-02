// 반 보드 해제 리스트 기록(0329a, 원장 2026-10-02) — 보드가 확인된 반만 · 그 반의 목록을 통째로 갈아 끼운다 · 실패해도 동기화는 그대로.
import { describe, it, expect } from "vitest";
import { releaseLabel, writeReleaseNames } from "./math-class-boards-db.mjs";

/** postgres.js 흉내 — 태그드 템플릿 호출을 모으고, `sql.json`은 값을 그대로 감싼다. */
function fakeSql({ fail = false } = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    if (fail) return Promise.reject(new Error('column "release_names" of relation "classnote_class_boards" does not exist'));
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve([]);
  };
  sql.json = (v) => ({ json: v });
  return { sql, calls };
}
const plan = (over = {}) => ({ classId: "c1", className: "수학 A", board: { action: "exists", id: 111 }, assign: [], hold: [], extras: [], ...over });

describe("해제 리스트 기록", () => {
  it("보드가 확인된 반마다 한 번 — 이름은 다듬고 중복을 뺀다 · 해제할 원아가 없으면 빈 배열로 갈아 끼운다", async () => {
    const { sql, calls } = fakeSql();
    const out = await writeReleaseNames(sql, "t1", [plan({ extras: [" 김민준 ", "김민준", "", "이서연"] }), plan({ classId: "c2", board: { action: "exists", id: 222 } })]);
    expect(out).toEqual({ classes: 2, names: 2, skipped: false });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toMatch(/update classnote_class_boards set release_names = \?, release_checked_at = now\(\)/);
    expect(calls[0].values).toEqual([{ json: ["김민준", "이서연"] }, "t1", "c1", 111]);
    expect(calls[1].values).toEqual([{ json: [] }, "t1", "c2", 222]);
  });
  it("보드가 없는 반(생성 전·특정 불가)은 적지 않는다 — 원아 목록을 읽지 못한 반이다", async () => {
    const { sql, calls } = fakeSql();
    const out = await writeReleaseNames(sql, "t1", [
      plan({ board: { action: "create" }, extras: ["김민준"] }),
      plan({ board: { action: "block", reason: "이름 충돌" }, extras: ["김민준"] }),
    ]);
    expect(out).toEqual({ classes: 0, names: 0, skipped: false });
    expect(calls).toEqual([]);
  });
  it("ClassNote에서 지워진 보드는 목록을 비운다 — 없는 보드의 해제 대상이 보고서에 계속 뜨지 않게", async () => {
    const { sql, calls } = fakeSql();
    await writeReleaseNames(sql, "t1", [plan({ board: { action: "none", deletedBoardId: 5 }, extras: ["김민준"] })]);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([{ json: [] }, "t1", "c1"]);
  });
  it("🔴 그 반 보류 학생과 이름이 겹치는 원아에는 표시를 붙인다 — 그대로 해제하면 지금 다니는 학생이 반 보드에서 빠진다", async () => {
    const { sql, calls } = fakeSql();
    await writeReleaseNames(sql, "t1", [plan({ extras: ["서연", "Jay(이재희)", "최하린"], hold: [{ name: "박서연E", reasons: ["1인 보드 없음"] }, { name: "이재희", reasons: [] }] })]);
    expect(calls[0].values[0].json).toEqual([
      "서연 (확인 필요 — 이 반 보류 학생 '박서연E'의 원아일 수 있음)",
      "Jay(이재희) (확인 필요 — 이 반 보류 학생 '이재희'의 원아일 수 있음)",
      "최하린",
    ]);
    expect(releaseLabel("민", [{ name: "김민준" }])).toBe("민"); // 한 글자는 겹침으로 보지 않는다
    expect(releaseLabel("  ", [])).toBe("");
  });
  it("자동 해제가 보류한 원아는 이름 뒤에 그 사유를 붙인다(전 반 최신 목록에서도 왜 남았는지 보이게)", async () => {
    const { sql, calls } = fakeSql();
    const held = [
      { className: "수학 A", childName: "윤현소", why: "이 반 학생 '윤정인'에 연결된 원아입니다" },
      { className: "다른 반", childName: "최하린", why: "다른 반의 사유" },
    ];
    await writeReleaseNames(sql, "t1", [plan({ extras: ["윤현소", "최하린"] })], () => {}, held);
    expect(calls[0].values[0].json).toEqual(["윤현소 (자동 해제 보류 — 이 반 학생 '윤정인'에 연결된 원아입니다)", "최하린"]);
  });
  it("칸이 아직 없으면(0329a 전) 그 기록만 건너뛴다 — 던지지 않는다", async () => {
    const { sql } = fakeSql({ fail: true });
    const logs = [];
    const out = await writeReleaseNames(sql, "t1", [plan({ extras: ["김민준"] })], (line) => logs.push(line));
    expect(out.skipped).toBe(true);
    expect(logs[0]).toContain("해제 리스트 기록 건너뜀");
  });
});
