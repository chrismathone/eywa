import { describe, expect, it } from "vitest";
import {
  ALERT_HOURS_KST,
  decideHeartbeatAlert,
  heartbeatAlertBucket,
  heartbeatAlertText,
  HEARTBEAT_ALERT_LINK,
  HEARTBEAT_STALE_MS,
  isAppAlive,
  isDryRunWorker,
  isIntentionallyOff,
  latestRealHeartbeat,
  SYNC_AGENT_OFFLINE_TYPE,
} from "./heartbeat-alert";
import { IMPORTANT_NOTIFICATION_TYPES } from "@/features/notifications/important";
import { SAMPLE_NOTIFICATIONS } from "@/features/slack/samples";

/** KST 시각 → Date(UTC 저장). */
const kst = (s: string) => new Date(`${s}+09:00`);

describe("연동 PC 신호 끊김 알림 — 판정(원장 2026-11-09 '제안 바로 적용' · 11-06 발송 정지를 아무도 몰랐던 일)", () => {
  it("실제 발송 PC의 가장 최근 신호만 본다 — 시험용(dry-run) PC·읽을 수 없는 값 제외", () => {
    const at = latestRealHeartbeat([
      { last_seen: "2026-11-09T05:00:00Z", last_results: { postMode: true } },
      { last_seen: "2026-11-09T06:00:00Z", last_results: { postMode: false } }, // dry-run — 살아 있어도 실제 발송이 아니다
      { last_seen: "2026-11-09T05:30:00Z", last_results: null },
      { last_seen: null, last_results: {} },
    ]);
    expect(at?.toISOString()).toBe("2026-11-09T05:30:00.000Z");
    expect(latestRealHeartbeat([])).toBeNull();
    expect(latestRealHeartbeat([{ last_seen: "x", last_results: {} }])).toBeNull();
    expect(isDryRunWorker({ postMode: false })).toBe(true);
    expect(isDryRunWorker([])).toBe(false);
  });

  it("15분 안이면 정상 · 넘으면(알리는 시간) 알린다 · 신호가 한 번도 없으면 대상 아님", () => {
    const now = kst("2026-11-09T15:00:00");
    expect(decideHeartbeatAlert({ now, lastSeen: new Date(now.getTime() - HEARTBEAT_STALE_MS) })).toBe("ok");
    expect(decideHeartbeatAlert({ now, lastSeen: new Date(now.getTime() - HEARTBEAT_STALE_MS - 1) })).toBe("alert");
    expect(decideHeartbeatAlert({ now, lastSeen: null })).toBe("no_worker");
  });

  it(`발송이 몰리는 저녁(20~23시)도 알린다 · 자정~${ALERT_HOURS_KST.from}시 전은 조용히 · 그때 끊기면 아침 ${ALERT_HOURS_KST.from}시 점검에서`, () => {
    expect(decideHeartbeatAlert({ now: kst("2026-11-09T22:30:00"), lastSeen: kst("2026-11-09T22:10:00") })).toBe("alert");
    expect(decideHeartbeatAlert({ now: kst("2026-11-09T23:50:00"), lastSeen: kst("2026-11-09T23:30:00") })).toBe("alert");
    const lastSeen = kst("2026-11-09T23:55:00");
    expect(decideHeartbeatAlert({ now: kst("2026-11-10T00:20:00"), lastSeen })).toBe("off_hours");
    expect(decideHeartbeatAlert({ now: kst("2026-11-10T08:59:00"), lastSeen })).toBe("off_hours");
    expect(decideHeartbeatAlert({ now: kst("2026-11-10T09:00:00"), lastSeen })).toBe("alert");
  });

  it("원장이 일부러 끈 것 — 일시 중지·ClassNote 꺼짐은 앱이 살아 있을 때만 믿는다(업데이트 뒤 안 켜진 기기의 마지막 'off'는 알린다)", () => {
    const now = kst("2026-11-09T15:00:00");
    const alive = kst("2026-11-09T14:59:00").toISOString();
    const dead = kst("2026-11-09T14:20:00").toISOString();
    const dev = (status: unknown, last_seen_at: string | null, revoke_requested_at: string | null = null) => ({ status, last_seen_at, revoke_requested_at });
    expect(isIntentionallyOff(dev({ state: "paused", classnote: "running" }, alive), now)).toBe(true);
    expect(isIntentionallyOff(dev({ state: "ready", classnote: "off" }, alive), now)).toBe(true);
    // 업데이트로 모듈을 내린 뒤 새 판이 안 켜짐(함정 #151) — 마지막 보고가 'off'여도 기기가 죽었으면 알린다
    expect(isIntentionallyOff(dev({ state: "updating", classnote: "off" }, dead), now)).toBe(false);
    expect(isIntentionallyOff(dev({ state: "paused", classnote: "off" }, dead), now)).toBe(false);
    expect(isIntentionallyOff(dev({ state: "working", classnote: "error" }, alive), now)).toBe(false);
    expect(isIntentionallyOff(dev(null, null), now)).toBe(false);
    expect(isIntentionallyOff(dev({ state: "ready", classnote: "running" }, dead, kst("2026-11-09T14:00:00").toISOString()), now)).toBe(true);
    expect(isAppAlive(alive, now)).toBe(true);
    expect(isAppAlive(dead, now)).toBe(false);
  });

  it("끊김 한 번에 한 번 — 중복 방지 칸 = 마지막 신호 시각(같은 끊김이면 같고, 신호가 돌아왔다 다시 끊기면 다르다)", () => {
    expect(heartbeatAlertBucket(kst("2026-11-09T17:37:00"))).toBe(heartbeatAlertBucket(new Date("2026-11-09T08:37:00Z")));
    expect(heartbeatAlertBucket(kst("2026-11-09T17:37:00"))).not.toBe(heartbeatAlertBucket(kst("2026-11-09T19:20:00")));
  });

  it("문구 = 실제 마지막 신호 시각(KST)과 끊긴 시간 · 앱이 켜져 있으면 다른 안내 · 링크 = 연동 PC 탭 · 중요 알림 · 슬랙 견본도 같은 문구", () => {
    const t = heartbeatAlertText(kst("2026-11-06T17:37:00"), kst("2026-11-06T18:02:30"));
    expect(t.title).toBe("연동 PC 신호가 끊겼습니다");
    expect(t.body).toContain("17:37");
    expect(t.body).toContain("25분째 없음");
    expect(t.body).toContain("연동 PC가 켜져 있고 AYWA 연동 앱이 실행 중인지");
    const alive = heartbeatAlertText(kst("2026-11-06T17:37:00"), kst("2026-11-06T18:02:30"), { appAlive: true });
    expect(alive.body).toContain("연동 앱은 켜져 있지만 클래스노트 작업 신호가 없어");
    expect(heartbeatAlertText(kst("2026-11-06T17:37:00"), kst("2026-11-06T20:00:00")).body).toContain("2시간 23분째 없음");
    expect(HEARTBEAT_ALERT_LINK).toBe("/owner?tab=sheets&sub=agent");
    expect(IMPORTANT_NOTIFICATION_TYPES).toContain(SYNC_AGENT_OFFLINE_TYPE);
    expect(SAMPLE_NOTIFICATIONS[SYNC_AGENT_OFFLINE_TYPE]?.title).toBe(t.title);
    expect(SAMPLE_NOTIFICATIONS[SYNC_AGENT_OFFLINE_TYPE]?.link).toBe(HEARTBEAT_ALERT_LINK);
  });
});
