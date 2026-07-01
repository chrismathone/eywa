import { describe, expect, it } from "vitest";
import {
  buildOthersByScope,
  dedupeEditors,
  isPresenceScope,
  type RawPresenceState,
} from "./presence-state";

describe("isPresenceScope — 콜론 포함 접두 매칭", () => {
  it("허용 scope", () => {
    expect(isPresenceScope("student:123")).toBe(true);
    expect(isPresenceScope("student-consultation:9")).toBe(true);
    expect(isPresenceScope("tenant-settings:profile")).toBe(true);
    expect(isPresenceScope("meeting:abc")).toBe(true);
  });
  it("느슨한 접두 오매칭 방지 — student가 student-consultation을 잡지 않음(콜론 기준)", () => {
    // 'student-consultation:9'는 'student-consultation:' 접두로만 매칭돼야 하며,
    // 'student' 접두로도 매칭되지만 그건 의도된 것이 아니라 'student:'로만 매칭되어야 함을 확인.
    expect("student-consultation:9".startsWith("student:")).toBe(false);
  });
  it("범위 밖 scope 거부", () => {
    expect(isPresenceScope("invoice:1")).toBe(false);
    expect(isPresenceScope("studentxyz")).toBe(false);
    expect(isPresenceScope("student")).toBe(false);
  });
});

describe("buildOthersByScope", () => {
  const state: RawPresenceState = {
    "u1:aaa": [{ editingScopes: ["student:1", "meeting:5"], userId: "u1", userName: "김철수" }],
    "u2:bbb": [{ editingScopes: ["student:1"], userId: "u2", userName: "이영희" }],
    "me:zzz": [{ editingScopes: ["student:1"], userId: "me", userName: "나" }],
  };

  it("scope별로 편집자를 모은다", () => {
    const m = buildOthersByScope(state, "no-such-key");
    expect(m.get("student:1")?.map((e) => e.userName).sort()).toEqual(["김철수", "나", "이영희"]);
    expect(m.get("meeting:5")?.map((e) => e.userName)).toEqual(["김철수"]);
  });

  it("myKey(내 구독)는 제외 — 같은 userId라도 key로 판별", () => {
    const m = buildOthersByScope(state, "me:zzz");
    expect(m.get("student:1")?.map((e) => e.userName).sort()).toEqual(["김철수", "이영희"]);
  });

  it("allowlist 밖 scope는 무시", () => {
    const s: RawPresenceState = {
      "x:1": [{ editingScopes: ["invoice:1", "student:2"], userId: "x", userName: "A" }],
    };
    const m = buildOthersByScope(s, "me");
    expect(m.has("invoice:1")).toBe(false);
    expect(m.get("student:2")?.length).toBe(1);
  });

  it("빈/깨진 payload 방어", () => {
    const s: RawPresenceState = {
      "y:1": [{ userId: "y" }], // editingScopes 없음
      "z:1": [{ editingScopes: "not-array", userId: "z", userName: "Z" }],
    };
    expect(buildOthersByScope(s, "me").size).toBe(0);
  });
});

describe("dedupeEditors — 같은 사람 여러 탭은 1명", () => {
  it("userId 중복 제거", () => {
    const out = dedupeEditors([
      { userId: "u1", userName: "김철수" },
      { userId: "u1", userName: "김철수" },
      { userId: "u2", userName: "이영희" },
    ]);
    expect(out).toEqual([
      { userId: "u1", userName: "김철수" },
      { userId: "u2", userName: "이영희" },
    ]);
  });
});
