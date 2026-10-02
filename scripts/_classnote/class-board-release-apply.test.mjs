// 반 보드 자동 해제 **실행** — 한 건씩 하고 바로 확인한다. ClassNote 호출은 가짜로 갈아 끼운다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ boards: new Map(), emps: [] }));
vi.mock("./classnote-admin-core.mjs", () => ({ fetchBoardChildren: async (_page, _center, boardId) => (m.boards.get(boardId) ?? []).map((id) => ({ id })) }));
vi.mock("./math-class-teachers.mjs", () => ({ fetchEmployments: async () => m.emps.map((e) => ({ ...e })) }));
vi.mock("./math-class-boards-apply.mjs", () => ({ ClassBoardStop: class ClassBoardStop extends Error {} }));

const { releaseChildren, releaseTeachers } = await import("./class-board-release-apply.mjs");

/** kapi 흉내 — `page.evaluate(fn, [url, method])`만 온다(다른 조회는 위에서 갈아 끼웠다). */
function fakePage(handler) {
  const calls = [];
  return {
    calls,
    waitForTimeout: async () => {},
    evaluate: async (_fn, [url, method]) => {
      calls.push(`${method} ${url.replace("https://kapi.classnote.com", "")}`);
      return handler(url, method);
    },
  };
}
const enrollRow = (id, child, cls, removed = false) => ({ id, child_id: child, belong_to_class: cls, removed_child: removed });
const rel = (childId, boardId = 100, childName = `원아${childId}`) => ({ classId: "c1", className: "가반", boardId, childId, childName });

beforeEach(() => {
  m.boards = new Map([[100, [1, 2, 3]]]);
  m.emps = [];
});

describe("원아 해제 실행", () => {
  it("그 반 배정 줄의 번호로 내보내고, 내보낸 원아만 빠졌는지 확인한다", async () => {
    const page = fakePage((url, method) => {
      if (method === "GET") return { status: 200, json: [enrollRow(901, 2, 100), enrollRow(902, 2, 555), enrollRow(903, 2, 100, true)] };
      m.boards.set(100, [1, 3]);
      return { status: 200, json: null };
    });
    const { done, failed } = await releaseChildren({ page, centerId: 1, releases: [rel(2)], log: () => {} });
    expect(done.map((d) => d.childId)).toEqual([2]);
    expect(failed).toEqual([]);
    // 내보낸 뒤 그 원아의 배정을 한 번 더 읽어 다른 배정이 그대로인지 본다
    expect(page.calls).toEqual(["GET /v1_2/children/2/enrollments", "POST /v1/enrollments/901/out", "GET /v1_2/children/2/enrollments"]);
  });
  it("🔴 내보낸 원아의 다른 배정(1인 보드·다른 반)이 함께 사라졌으면 멈춘다", async () => {
    let out = false;
    const page = fakePage((url, method) => {
      if (method === "GET") return { status: 200, json: out ? [] : [enrollRow(901, 2, 100), { ...enrollRow(902, 2, 555), class_name: "(수학)이서연" }] };
      out = true;
      m.boards.set(100, [1, 3]);
      return { status: 200, json: null };
    });
    const done = [];
    const err = await releaseChildren({ page, centerId: 1, releases: [rel(2)], log: () => {}, done }).catch((e) => e);
    expect(err.message).toContain("다른 배정 1개((수학)이서연)가 함께 사라졌다");
    expect(err.haltRelease).toBe(true); // 사람이 볼 때까지 자동 해제를 세운다
    expect(done.map((d) => d.childId)).toEqual([2]);
  });
  it("🔴 내보낸 뒤 배정을 다시 읽지 못하면 멈춘다 — 다른 배정이 그대로인지 모르는 채로 다음 원아로 가지 않는다", async () => {
    let n = 0;
    const page = fakePage((url, method) => {
      if (method !== "GET") return { status: 200, json: null };
      n += 1;
      return n === 1 ? { status: 200, json: [enrollRow(901, 2, 100)] } : { status: 502, json: null };
    });
    const done = [];
    await expect(releaseChildren({ page, centerId: 1, releases: [rel(2), rel(3)], log: () => {}, done })).rejects.toThrow("배정을 다시 읽지 못했다(HTTP 502)");
    expect(done.map((d) => d.childId)).toEqual([2]);
    expect(page.calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });
  it("응답은 실패인데 실제로는 빠졌으면 해제한 것으로 센다(기록에서 빠지지 않게)", async () => {
    let out = false;
    const page = fakePage((url, method) => {
      if (method === "GET") return { status: 200, json: out ? [] : [enrollRow(901, 2, 100)] };
      out = true;
      m.boards.set(100, [1, 3]);
      return { status: 500, json: null };
    });
    const { done, failed } = await releaseChildren({ page, centerId: 1, releases: [rel(2)], log: () => {} });
    expect(done.map((d) => d.childId)).toEqual([2]);
    expect(failed).toEqual([]);
  });
  it("그 사이 새 원아가 들어온 것(학부모 가입·사람의 배정)은 정상이다 — 멈추지 않는다", async () => {
    const page = fakePage((url, method) => {
      if (method === "GET") return { status: 200, json: [enrollRow(901, 2, 100)] };
      m.boards.set(100, [1, 3, 99]);
      return { status: 200, json: null };
    });
    const { done } = await releaseChildren({ page, centerId: 1, releases: [rel(2)], log: () => {} });
    expect(done.map((d) => d.childId)).toEqual([2]);
  });
  it("통신 오류(상태 0)·승인 전 줄은 그 건만 실패", async () => {
    m.boards.set(100, [1, 2, 3]);
    const page = fakePage((url, method) => {
      if (method !== "GET") return { status: 0, json: null };
      if (url.includes("/children/3/")) return { status: 200, json: [{ ...enrollRow(5, 3, 100), is_approved: false }] };
      return { status: 200, json: [enrollRow(901, 2, 100)] };
    });
    const { done, failed } = await releaseChildren({ page, centerId: 1, releases: [rel(2), rel(3)], log: () => {} });
    expect(done).toEqual([]);
    expect(failed.map((f) => f.why)).toEqual(["ClassNote 통신 오류", "그 반 배정 줄이 0개라 건드리지 않습니다"]);
  });
  it("그 건만 실패 — 이미 빠진 원아 · 배정 줄이 0개·2개 · 응답 실패는 건드리지 않고 다음으로 간다", async () => {
    m.boards.set(100, [1, 2, 3, 4]);
    const page = fakePage((url, method) => {
      if (method !== "GET") return { status: 500, json: null };
      if (url.includes("/children/2/")) return { status: 200, json: [] };
      if (url.includes("/children/3/")) return { status: 200, json: [enrollRow(1, 3, 100), enrollRow(2, 3, 100)] };
      return { status: 200, json: [enrollRow(7, 4, 100)] };
    });
    const { done, failed } = await releaseChildren({ page, centerId: 1, releases: [rel(9), rel(2), rel(3), rel(4)], log: () => {} });
    expect(done).toEqual([]);
    expect(failed.map((f) => f.why)).toEqual([
      "그 사이 반 보드에서 이미 빠졌습니다",
      "그 반 배정 줄이 0개라 건드리지 않습니다",
      "그 반 배정 줄이 2개라 건드리지 않습니다",
      "해제 응답 실패(HTTP 500)",
    ]);
    expect(page.calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /v1/enrollments/7/out"]);
  });
  it("다른 원아의 배정 줄은 집지 않는다(원아 번호가 다르면 0개로 본다)", async () => {
    const page = fakePage((url, method) => (method === "GET" ? { status: 200, json: [enrollRow(901, 777, 100)] } : { status: 200, json: null }));
    const { done, failed } = await releaseChildren({ page, centerId: 1, releases: [rel(2)], log: () => {} });
    expect(done).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(page.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
  it("🔴 해제 뒤 반 원아가 예상과 다르면(다른 원아가 같이 빠짐·안 빠짐) 전체를 멈춘다 — 그때까지 해제한 것은 done에 남는다", async () => {
    const done = [];
    const page = fakePage((url, method) => {
      if (method === "GET") return { status: 200, json: [enrollRow(901, 2, 100)] };
      m.boards.set(100, [1]); // 2뿐 아니라 3도 사라졌다
      return { status: 200, json: null };
    });
    await expect(releaseChildren({ page, centerId: 1, releases: [rel(2)], log: () => {}, done })).rejects.toThrow("원아 해제 뒤 반 원아가 예상과 다르다");
    expect(done.map((d) => d.childId)).toEqual([2]);
  });
});

describe("담임 해제 실행", () => {
  const emp = (id, teacher_id, class_in_charge, is_approved = true) => ({ id, teacher_id, class_in_charge, is_approved });
  const tr = (employmentId, teacherId = 22, boardId = 100) => ({ className: "가반", boardId, employmentId, teacherId, teacher: "김은정" });
  it("연결 번호로 풀고, 그 선생님의 다른 연결이 그대로인지 확인한다", async () => {
    m.emps = [emp(1, 11, 100), emp(2, 22, 100), emp(3, 22, 200)];
    const page = fakePage(() => {
      m.emps = m.emps.map((e) => (e.id === 2 ? { ...e, is_approved: false } : e));
      return { status: 200, json: null };
    });
    const { done, failed } = await releaseTeachers({ page, centerId: 1, releases: [tr(2)], log: () => {} });
    expect(done.map((d) => d.employmentId)).toEqual([2]);
    expect(failed).toEqual([]);
    expect(page.calls).toEqual(["POST /v1/employments/2/out"]);
  });
  it("연결 줄이 계획과 다르면(다른 선생님·다른 반·이미 해제) 그 건만 실패 — 호출하지 않는다", async () => {
    m.emps = [emp(2, 33, 100), emp(4, 22, 999), emp(5, 22, 100, false)];
    const page = fakePage(() => ({ status: 200, json: null }));
    const { done, failed } = await releaseTeachers({ page, centerId: 1, releases: [tr(2), tr(4), tr(5), tr(6)], log: () => {} });
    expect(done).toEqual([]);
    expect(failed).toHaveLength(4);
    expect(page.calls).toEqual([]);
  });
  it("그 사이 사람이 **다른 선생님**의 연결을 정리한 것은 우리 일이 아니다 — 멈추지 않는다", async () => {
    m.emps = [emp(2, 22, 100), emp(7, 11, 300)];
    const page = fakePage(() => {
      m.emps = [emp(2, 22, 100, false), emp(7, 11, 300, false)];
      return { status: 200, json: null };
    });
    const { done } = await releaseTeachers({ page, centerId: 1, releases: [tr(2)], log: () => {} });
    expect(done).toHaveLength(1);
  });
  it("🔴 다른 연결이 함께 사라졌거나, 풀었는데 그대로면 멈춘다", async () => {
    m.emps = [emp(2, 22, 100), emp(3, 22, 200)];
    const wipe = fakePage(() => {
      m.emps = m.emps.map((e) => ({ ...e, is_approved: false }));
      return { status: 200, json: null };
    });
    const err = await releaseTeachers({ page: wipe, centerId: 1, releases: [tr(2)], log: () => {} }).catch((e) => e);
    expect(err.message).toContain("다른 연결 1개가 함께 사라졌다");
    expect(err.haltRelease).toBe(true);
    m.emps = [emp(2, 22, 100)];
    const noop = fakePage(() => ({ status: 200, json: null }));
    await expect(releaseTeachers({ page: noop, centerId: 1, releases: [tr(2)], log: () => {} })).rejects.toThrow("연결 1개가 그대로다");
  });
});
