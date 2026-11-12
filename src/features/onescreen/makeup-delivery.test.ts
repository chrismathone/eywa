import { describe, expect, it } from "vitest";
import { makeupDeliveryOnSave, makeupDeliveryWorkersReady } from "./makeup-delivery";

describe("보강 기록과 전달 반 보존", () => {
  it("JJ 결석분을 다른 반으로 전달해도 다시 저장할 때 JJ로 발송 경로를 되돌리지 않는다", () => {
    expect(makeupDeliveryOnSave({ anchor: "JJ", priorAnchor: "JJ", priorDelivery: "MS" })).toBe("MS");
  });
  it("실제 보강 반을 바꾸면 옛 전달 반을 자동 재사용하지 않는다", () => {
    expect(makeupDeliveryOnSave({ anchor: "C", priorAnchor: "JJ", priorDelivery: "MS" })).toBe("C");
  });
  it("처음 저장은 보강 반을 사용한다", () => {
    expect(makeupDeliveryOnSave({ anchor: "JJ", priorAnchor: null, priorDelivery: null })).toBe("JJ");
  });
});

describe("앱·연동 PC 배포 순서", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  const worker = (supported: boolean, minutes = 1, postMode = true) => ({
    last_seen: new Date(now - minutes * 60_000).toISOString(),
    last_results: { postMode, caps: { makeupDelivery: supported } },
  });
  it("옛 발송 PC가 살아 있으면 새 경로를 적재하지 않는다", () => {
    expect(makeupDeliveryWorkersReady([worker(true), worker(false)], now)).toBe(false);
    expect(makeupDeliveryWorkersReady([], now)).toBe(false);
  });
  it("시험 PC는 제외하고 발송 PC 전부의 지원을 확인한다", () => {
    expect(makeupDeliveryWorkersReady([worker(true), worker(false, 1, false)], now)).toBe(true);
  });
  it("꺼진 시간에는 마지막 발송 PC의 지원 여부를 따른다", () => {
    expect(makeupDeliveryWorkersReady([worker(false, 40), worker(true, 30)], now)).toBe(true);
    expect(makeupDeliveryWorkersReady([worker(true, 40), worker(false, 30)], now)).toBe(false);
  });
});
