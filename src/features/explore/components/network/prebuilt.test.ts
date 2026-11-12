import { describe, expect, it } from "vitest";
import { buildNetGraph, fullGraphOf, netCenterOf, netHeadOf, netNeighbors, netRootId, summaryGraph, type NetGraph, type NetPrebuiltInput } from "./graph";
import { consumePendingNet, leaveKey, peekPendingNet, prepareNetworkLeave, registerLiveNet, savedNetFor } from "./handoff";
import { netFitView, netLayout } from "./layout";
import { hoverText } from "./node-actions";
import { CENTERS, STUDENT } from "./testing/fixture";

/** 이미 짠 판(`NetPrebuiltInput` — 지식그래프)을 같은 판 기계로 — 연결 탐색 모델 입력은 그대로(graph.test.ts · network-records.test.ts). */

const G: NetGraph = {
  nodes: [
    { id: "c", title: "가운데", kind: "root", tone: "primary" },
    { id: "hub:A", title: "영역 A", kind: "hub", tone: "blue", sectorKey: "A" },
    { id: "hub:B", title: "영역 B", kind: "hub", tone: "green", sectorKey: "B" },
    { id: "a1", title: "기록 a1", kind: "record", tone: "blue", hub: "hub:A", sectorKey: "A", open: "center" },
    { id: "a2", title: "기록 a2", kind: "record", tone: "blue", hub: "hub:A", sectorKey: "A", open: "center" },
    { id: "b1", title: "기록 b1", kind: "record", tone: "green", hub: "hub:B", sectorKey: "B" },
  ],
  edges: [
    { from: "c", to: "hub:A", rel: "영역 A" },
    { from: "c", to: "hub:B", rel: "영역 B" },
    { from: "hub:A", to: "a1", rel: "영역 A" },
    { from: "hub:A", to: "a2", rel: "영역 A" },
    { from: "hub:B", to: "b1", rel: "영역 B" },
    { from: "a1", to: "b1", rel: "수강한다" },
  ],
};
const P: NetPrebuiltInput = { graph: G, center: { id: "c", name: "가운데" } };
const SIZE = { w: 900, h: 700 };

describe("이미 짠 판 — 판을 다시 짜지 않고 그대로 쓴다", () => {
  it("가운데 = 모델이면 netRootId(모델 가운데) · 이미 짠 판이면 그 가운데", () => {
    const S = CENTERS["student:s1"];
    expect(netCenterOf(S)).toEqual({ id: netRootId(STUDENT.center), name: STUDENT.center.name });
    expect(netCenterOf(P)).toEqual({ id: "c", name: "가운데" });
  });

  it("buildNetGraph · fullGraphOf = 받은 판 그대로(같은 객체)", () => {
    expect(buildNetGraph(P)).toBe(G);
    expect(fullGraphOf(P)).toBe(G);
  });

  it("배치·요약·이웃·도구줄 수가 이미 짠 판에서도 돈다", () => {
    const b = netLayout(P, "records");
    expect(b.centerId).toBe("c");
    expect(b.pos.c).toEqual({ x: 0, y: 0 });
    for (const n of G.nodes) expect(b.pos[n.id]).toBeDefined();
    expect(Number.isFinite(netFitView(b, SIZE).k)).toBe(true);
    const sum = summaryGraph(G);
    expect(sum.nodes.find((n) => n.id === "hub:A")?.count).toBe(2);
    expect(sum.edges.find((e) => e.from === "hub:A" && e.to === "hub:B")?.w).toBe(1);
    expect(netNeighbors(P, "a1").map((n) => n.id)).toEqual(["b1"]);
    expect(netHeadOf(b, "가운데", G)).toEqual({ mode: "records", nodes: 3, hubs: 2, edges: 6, name: "가운데" });
  });

  it("hover — 기록에 `open = center`면 '이것이 중심', 아니면 종전처럼 '자세히'", () => {
    const b = netLayout(P, "records");
    expect(hoverText(G.nodes[3], b)).toContain("더블클릭 = 이것이 중심");
    expect(hoverText(G.nodes[5], b)).toContain("더블클릭 = 자세히");
  });
});

describe("판 이어달리기 — 다음 중심을 점 id 그대로", () => {
  it("leaveKey = centerId 그대로 · 연결 탐색 대상은 종전 규칙", () => {
    expect(leaveKey({ centerId: "t:student:s1" })).toBe("t:student:s1");
    expect(leaveKey({ kind: "student", id: "s1" })).toBe("student:s1");
    expect(leaveKey({ kind: "student", id: "s1", sector: "attendance" })).toBe("student:s1:attendance");
  });

  it("떠나기 직전 판을 맡기면 그 점 id가 가운데인 새 판이 받는다(들어감 = 떠난 판을 남긴다)", () => {
    const board = { ...netLayout(P, "records"), view: netFitView(netLayout(P, "records"), SIZE) };
    const off = registerLiveNet({ centerId: "c", freeze: () => undefined, board: () => board, size: () => SIZE, head: () => netHeadOf(board, "가운데", G), lastOpened: () => null, toggled: () => [] });
    prepareNetworkLeave({ centerId: "a1" }, { dir: "in", pivotId: "a1" });
    const got = peekPendingNet("a1");
    expect(got).toMatchObject({ to: "a1", dir: "in", pivot: "a1", from: "c" });
    expect(savedNetFor("c")?.pivotB).toBe("a1");
    expect(peekPendingNet("c")).toBeNull();
    consumePendingNet(got!);
    expect(peekPendingNet("a1")).toBeNull();
    // 지금 가운데로는 맡기지 않는다(같은 판)
    prepareNetworkLeave({ centerId: "c" }, { dir: "in", pivotId: null });
    expect(peekPendingNet("c")).toBeNull();
    off();
  });
});
