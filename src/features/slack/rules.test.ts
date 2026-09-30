import { describe, expect, it } from "vitest";
import { nextKeySince, RULE_PRESETS, sanitizeRule, SLACK_MAX_TARGETS, targetLabel } from "./rules";

const KEYS = new Set(["student_create", "payroll_upsert", "invoice_create", "resume_view_unlock"]);
const U1 = "11111111-1111-4111-8111-111111111111";

describe("규칙 정리", () => {
  it("활동: 없는 키·고를 수 없는(급여·이력서) 키는 버린다", () => {
    const r = sanitizeRule({ source: "activity", typeKeys: ["student_create", "payroll_upsert", "resume_view_unlock", "invoice_create", "nope"] }, KEYS)!;
    expect(r.typeKeys).toEqual(["student_create", "invoice_create"]);
  });

  it("알림: 목록에 있는 종류만 · 활동 규칙엔 '받는 사람 1:1'과 멘션이 없다", () => {
    const n = sanitizeRule({ source: "notification", typeKeys: ["approval_requested", "bogus"], targets: [{ kind: "recipient_dm" }], mentionRecipients: true }, KEYS)!;
    expect(n.typeKeys).toEqual(["approval_requested"]);
    expect(n.targets).toEqual([{ kind: "recipient_dm" }]);
    expect(n.mentionRecipients).toBe(true);
    const a = sanitizeRule({ source: "activity", targets: [{ kind: "recipient_dm" }], mentionRecipients: true }, KEYS)!;
    expect(a.targets).toEqual([]);
    expect(a.mentionRecipients).toBe(false);
  });

  it("대상: 채널 id·사람 uuid 모양 확인, 중복 제거, 상한", () => {
    const r = sanitizeRule(
      {
        source: "notification",
        targets: [
          { kind: "channel", channelId: "C0123ABCD", channelName: "데스크" },
          { kind: "channel", channelId: "C0123ABCD", channelName: "중복" },
          { kind: "channel", channelId: "bad" },
          { kind: "user_dm", userId: U1, userName: "원장" },
          { kind: "user_dm", userId: "not-uuid" },
        ],
      },
      KEYS,
    )!;
    expect(r.targets.map(targetLabel)).toEqual(["#데스크", "원장(1:1)"]);
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: "channel", channelId: `C${String(i).padStart(8, "0")}` }));
    expect(sanitizeRule({ source: "activity", targets: many }, KEYS)!.targets).toHaveLength(SLACK_MAX_TARGETS);
  });

  it("값 기본·정리 — 시각 형식, 호출, 제외 목록", () => {
    const r = sanitizeRule({ source: "activity", digestAt: "25:00", ping: "everyone", excludeActorIds: [U1, "x"], timing: "digest" }, KEYS)!;
    expect(r.digestAt).toBeNull();
    expect(r.ping).toBe("none");
    expect(r.excludeActorIds).toEqual([U1]);
    expect(r.timing).toBe("digest");
    expect(sanitizeRule({ source: "activity", digestAt: "18:30:00" }, KEYS)!.digestAt).toBe("18:30");
    expect(sanitizeRule({ source: "other" }, KEYS)).toBeNull();
  });

  it("'누가'(0311a) — uuid만 · 중복 제거 · 50명까지 · 빼기와 겹치면 빼기가 이긴다", () => {
    const U2 = "22222222-2222-4222-8222-222222222222";
    const r = sanitizeRule({ source: "activity", actorIds: [U1, U1, "x", 3, U2], excludeActorIds: [U2] }, KEYS)!;
    expect(r.actorIds).toEqual([U1]);
    expect(r.excludeActorIds).toEqual([U2]);
    expect(sanitizeRule({ source: "notification" }, KEYS)!.actorIds).toEqual([]);
    // 겹쳐서 다 빠지면 '누구든'으로 넓어지지 않게 그대로 둔다(발송은 빼기가 먼저라 아무것도 안 나감).
    expect(sanitizeRule({ source: "activity", actorIds: [U2], excludeActorIds: [U2] }, KEYS)!.actorIds).toEqual([U2]);
    const many = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect(sanitizeRule({ source: "activity", actorIds: many }, KEYS)!.actorIds).toHaveLength(50);
  });

  it("프리셋은 저장 정리를 그대로 통과한다", () => {
    for (const p of RULE_PRESETS) {
      const built = p.build();
      const keys = new Set(built.typeKeys);
      // 순서는 목록 순으로 다시 서므로 집합으로 비교 — 프리셋 키가 하나도 버려지지 않아야 한다.
      expect([...sanitizeRule(built, keys)!.typeKeys].sort(), p.id).toEqual([...built.typeKeys].sort());
    }
  });
});

describe("키별 시작 시각(key_since)", () => {
  const T0 = "2026-09-28T01:00:00.000Z";
  const NOW = "2026-09-28T09:00:00.000Z";
  it("켜진 채 고치면 원래 키는 그 시각, 새 키만 지금, 빠진 키는 버린다", () => {
    const r = nextKeySince({ since: { a: T0, b: T0 }, enabled: true }, { typeKeys: ["a", "c"], enabled: true }, NOW);
    expect(r).toEqual({ a: T0, c: NOW });
  });
  it("새 규칙·꺼져 있던 규칙을 켜는 저장·끄는 저장은 전부 지금부터", () => {
    expect(nextKeySince(null, { typeKeys: ["a"], enabled: true }, NOW)).toEqual({ a: NOW });
    expect(nextKeySince({ since: { a: T0 }, enabled: false }, { typeKeys: ["a"], enabled: true }, NOW)).toEqual({ a: NOW });
    expect(nextKeySince({ since: { a: T0 }, enabled: true }, { typeKeys: ["a"], enabled: false }, NOW)).toEqual({ a: NOW });
  });
});
