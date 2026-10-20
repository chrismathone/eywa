import { describe, expect, it } from "vitest";
import { noticeAckId, parentNotices, parentNoticeText } from "./departure-notices";
import type { RideLeg } from "./parent-rides";

const leg = (over: Partial<RideLeg>): RideLeg => ({
  key: "k", studentId: "s1", direction: "in", vehicleId: "v1", runId: "r1", vehicleName: "1호차", runName: "1회차", stopName: "칠성초 정문",
  plannedTime: "14:40", skipped: false, added: false, status: null, recordedTime: null, notifyParent: true,
  trip: "running", tripStartedTime: "14:30", tripEndedTime: null, staffMemo: null, changeNote: null, route: [], ...over,
});

const kids = [{ id: "s1", name: "김민준" }, { id: "s2", name: "김서연" }];
const none = new Set<string>();

describe("parentNotices — 차량 출발", () => {
  it("출발한 회차만 알린다(출발 전·모름은 없음)", () => {
    const legs = new Map([["s1", [
      leg({ runId: "r1", trip: "running" }),
      leg({ runId: "r2", direction: "out", trip: "ready", tripStartedTime: null }),
      leg({ runId: "r3", trip: null, tripStartedTime: null }),
    ]]]);
    expect(parentNotices(kids, legs, none).map((n) => n.runId)).toEqual(["r1"]);
  });

  it("종료된 회차도 확인 전까지 남는다", () => {
    const legs = new Map([["s1", [leg({ trip: "done", tripEndedTime: "15:00" })]]]);
    expect(parentNotices(kids, legs, none)).toHaveLength(1);
  });

  it("확인한 회차와 타지 않는 구간은 뺀다", () => {
    const legs = new Map([["s1", [leg({ runId: "r1" }), leg({ runId: "r2", skipped: true })]]]);
    expect(parentNotices(kids, legs, new Set([noticeAckId("r1", "depart")]))).toEqual([]);
  });

  it("형제가 같은 회차면 한 줄로 묶는다", () => {
    const legs = new Map([["s1", [leg({ runId: "r1" })]], ["s2", [leg({ runId: "r1", studentId: "s2" })]]]);
    const out = parentNotices(kids, legs, none);
    expect(out).toHaveLength(1);
    expect(parentNoticeText(out[0]!)).toBe("김민준·김서연 등원 — 1호차 1회차 차량이 출발했습니다");
  });
});

describe("parentNotices — 등원 탑승", () => {
  it("등원 탑승 기록이 있으면 아이마다 한 줄, 최근이 위", () => {
    const legs = new Map([
      ["s1", [leg({ status: "boarded", recordedTime: "14:41" })]],
      ["s2", [leg({ studentId: "s2", status: "boarded", recordedTime: "14:50", stopName: "칠산초 후문" })]],
    ]);
    const out = parentNotices(kids, legs, new Set([noticeAckId("r1", "depart")]));
    expect(out.map((n) => [n.noticeKey, n.time])).toEqual([["board:s2", "14:50"], ["board:s1", "14:41"]]);
    expect(parentNoticeText(out[1]!)).toBe("김민준 학생이 지금 1호차 1회차 차량을 탔습니다");
  });

  it("미기록은 알림이 없다", () => {
    const legs = new Map([["s1", [leg({ runId: "r2", status: null })]]]);
    expect(parentNotices(kids, legs, none).filter((n) => n.kind !== "depart")).toEqual([]);
  });

  it("하원 [하차]→[전송]이면 내린 곳과 함께 하차 알림", () => {
    const legs = new Map([["s1", [leg({ runId: "r3", direction: "out", status: "boarded", recordedTime: "18:31", stopName: "칠산푸르지오 정문", runName: "2회차" })]]]);
    const out = parentNotices(kids, legs, new Set([noticeAckId("r3", "depart")]));
    expect(out.map((n) => [n.kind, n.noticeKey])).toEqual([["dropoff", "drop:s1"]]);
    expect(parentNoticeText(out[0]!)).toBe("김민준 학생이 칠산푸르지오 정문에서 내렸습니다");
  });

  it("등원 미탑승을 [전송]하면 '탑승하지 않았습니다' — [저장]이면 없다", () => {
    const sent = new Map([["s1", [leg({ status: "missed", recordedTime: "14:41" })]]]);
    const out = parentNotices(kids, sent, new Set([noticeAckId("r1", "depart")]));
    expect(out.map((n) => [n.kind, n.noticeKey])).toEqual([["missed", "miss:s1"]]);
    expect(parentNoticeText(out[0]!)).toBe("김민준 학생이 1호차 1회차 차량에 탑승하지 않았습니다");
    const saved = new Map([["s1", [leg({ status: "missed", recordedTime: "14:41", notifyParent: false })]]]);
    expect(parentNotices(kids, saved, new Set([noticeAckId("r1", "depart")]))).toEqual([]);
  });

  it("미탑승을 확인한 뒤 탑승으로 고쳐 보내면 탑승 알림은 새로 뜬다", () => {
    const legs = new Map([["s1", [leg({ status: "boarded", recordedTime: "14:45" })]]]);
    const out = parentNotices(kids, legs, new Set([noticeAckId("r1", "depart"), noticeAckId("r1", "miss:s1")]));
    expect(out.map((n) => n.noticeKey)).toEqual(["board:s1"]);
  });

  it("[등원 안함](오늘 안 탐)은 어떤 알림도 없다", () => {
    const legs = new Map([["s1", [leg({ skipped: true, status: null })]]]);
    expect(parentNotices(kids, legs, none)).toEqual([]);
  });

  it("[저장](알림 끔)으로 찍은 탑승은 알리지 않는다", () => {
    const legs = new Map([["s1", [leg({ status: "boarded", recordedTime: "14:41", notifyParent: false })]]]);
    expect(parentNotices(kids, legs, new Set([noticeAckId("r1", "depart")]))).toEqual([]);
  });

  it("확인한 아이의 탑승만 내리고 출발 알림은 따로 남는다", () => {
    const legs = new Map([["s1", [leg({ status: "boarded", recordedTime: "14:41" })]]]);
    const out = parentNotices(kids, legs, new Set([noticeAckId("r1", "board:s1")]));
    expect(out.map((n) => n.kind)).toEqual(["depart"]);
  });
});
