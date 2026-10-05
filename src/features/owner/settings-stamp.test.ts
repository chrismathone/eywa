import { describe, expect, it } from "vitest";
import { isOlderRev, nextSettingsStamp, settingsRevOf, withoutSettingsRev } from "./settings-stamp";

/**
 * 설정 문서의 두 표식(2026-10-05 적대 리뷰 1c N1 · 1d D1·D2).
 *  · 저장 순번(`data.operations.rev`) = 편집 폼이 "내려온 값이 내 저장보다 먼저 읽힌 것인가"를 가리는 순서. 시각이 아니라 숫자다 —
 *    서버 시계 차이나, 자기 시계로 `now()`를 쓰는 DB 안의 쓰기가 순서를 뒤집지 못한다.
 *  · 수정 표식(`updated_at`) = 저장 직전 "읽은 뒤 누가 먼저 썼나"의 판정. 같은 값이 되지 않게만 민다.
 */
describe("저장 순번", () => {
  it("섹션의 rev를 읽는다 · 섹션이 없거나 rev가 없으면(이 규칙 전의 문서) 0", () => {
    expect(settingsRevOf({ rev: 7, subjects: [] })).toBe(7);
    expect(settingsRevOf({ subjects: [] })).toBe(0);
    expect(settingsRevOf(null)).toBe(0);
    expect(settingsRevOf(undefined)).toBe(0);
  });

  it("숫자가 아니거나 음수·소수인 rev는 0으로 본다(무엇이 들어 있을지 모른다)", () => {
    for (const bad of ["3", -1, 1.5, null, {}, [], Number.NaN]) expect(settingsRevOf({ rev: bad })).toBe(0);
    expect(settingsRevOf([{ rev: 3 }])).toBe(0);
  });

  it("🔴 작은 순번만 '먼저 읽힌 것'이다 — 같으면 아니다", () => {
    expect(isOlderRev(4, 5)).toBe(true);
    expect(isOlderRev(5, 5)).toBe(false);
    expect(isOlderRev(6, 5)).toBe(false);
  });

  it("🔴 행이 아직 없던 읽기(0)는 첫 저장(1)보다 먼저다", () => {
    expect(isOlderRev(settingsRevOf(null), settingsRevOf(null) + 1)).toBe(true);
  });

  it("변경 내역을 만들 땐 순번을 뺀다 — 원본은 건드리지 않고, 순번이 없으면 그대로 돌려준다", () => {
    const section = { rev: 3, gradeLevels: ["초1"] };
    expect(withoutSettingsRev(section)).toEqual({ gradeLevels: ["초1"] });
    expect(section.rev).toBe(3);
    const plain = { gradeLevels: ["초1"] };
    expect(withoutSettingsRev(plain)).toBe(plain);
    expect(withoutSettingsRev(undefined)).toBeUndefined();
    expect(withoutSettingsRev(null)).toBeNull();
  });

  it("어느 쪽이든 모르면 먼저 읽힌 것이라고 단정하지 않는다(읽기 전용 열람자 등)", () => {
    expect(isOlderRev(undefined, 5)).toBe(false);
    expect(isOlderRev(5, undefined)).toBe(false);
    expect(isOlderRev(undefined, undefined)).toBe(false);
  });
});

describe("수정 표식(updated_at)", () => {
  const at = (iso: string) => Date.parse(iso);

  it("평소에는 지금 시각이다", () => {
    expect(nextSettingsStamp("2026-10-05T00:00:00.000Z", at("2026-10-05T01:00:00.000Z"))).toBe("2026-10-05T01:00:00.000Z");
  });

  it("시계가 직전 표식보다 뒤처져 있어도 직전 값과 다른 값이 된다 — 직전 값 + 1ms", () => {
    expect(nextSettingsStamp("2026-10-05T01:00:00.500Z", at("2026-10-05T01:00:00.000Z"))).toBe("2026-10-05T01:00:00.501Z");
  });

  it("🔴 같은 ms에 다시 써도 같은 값이 되지 않는다(같으면 '읽은 뒤 누가 썼나'를 못 본다)", () => {
    const first = nextSettingsStamp("2026-10-05T00:00:00.000Z", at("2026-10-05T01:00:00.000Z"));
    expect(nextSettingsStamp(first, at("2026-10-05T01:00:00.000Z"))).toBe("2026-10-05T01:00:00.001Z");
  });

  it("DB가 돌려주는 모양(마이크로초·+00:00)의 직전 값과도 다르다", () => {
    const next = nextSettingsStamp("2026-10-05T01:00:00.123456+00:00", at("2026-10-05T01:00:00.000Z"));
    expect(Date.parse(next)).toBeGreaterThan(Date.parse("2026-10-05T01:00:00.123456+00:00"));
  });

  it("직전 표식이 없거나 읽을 수 없으면 지금 시각이다", () => {
    const now = at("2026-10-05T01:00:00.000Z");
    expect(nextSettingsStamp(null, now)).toBe("2026-10-05T01:00:00.000Z");
    expect(nextSettingsStamp(undefined, now)).toBe("2026-10-05T01:00:00.000Z");
    expect(nextSettingsStamp("알 수 없음", now)).toBe("2026-10-05T01:00:00.000Z");
  });
});
