import { describe, expect, it } from "vitest";
import { DEFAULT_STALL_RUN, isStalled, positionFrozen, stalledDatesOf } from "./progress-stall";

const P = (date: string, progress: string | null) => ({ date, progress });

describe("stalledDatesOf — 몇 번부터 정체라 부르나", () => {
  it("기본 임계는 3회 연속", () => {
    expect(DEFAULT_STALL_RUN).toBe(3);
  });

  it("🔴 2회로는 경고하지 않는다 — 한 차시를 두 번에 나눠 하는 건 정상이다", () => {
    expect(stalledDatesOf([P("2026-08-05", "A"), P("2026-08-12", "A")])).toEqual([]);
  });

  it("🔴 실측(박서준): 8/5·8/19·8/26 같은 진도 → 3번째부터 정체", () => {
    const points = [
      P("2026-08-05", "소수와 거듭제곱 / 소인수분해 / 공약수와 최대공약수"),
      P("2026-08-12", "소수와 거듭제곱 / 소인수분해 / 공약수와 최대공약수"),
      P("2026-08-19", "소수와 거듭제곱 / 소인수분해 / 공약수와 최대공약수"),
      P("2026-08-26", "소수와 거듭제곱 / 소인수분해 / 공약수와 최대공약수"),
    ];
    expect(stalledDatesOf(points)).toEqual(["2026-08-19", "2026-08-26"]);
    expect(isStalled(points)).toBe(true);
  });

  it("줄바꿈·공백만 다른 같은 진도는 같은 것으로 본다", () => {
    const points = [
      P("2026-08-05", "유리수의 곱셈\n유리수의 나눗셈"),
      P("2026-08-12", "유리수의 곱셈 / 유리수의 나눗셈"),
      P("2026-08-19", "유리수의곱셈유리수의나눗셈"),
    ];
    expect(stalledDatesOf(points)).toEqual(["2026-08-19"]);
  });

  it("진도가 바뀌면 연속이 끊긴다", () => {
    const points = [P("2026-08-05", "A"), P("2026-08-12", "A"), P("2026-08-19", "B"), P("2026-08-26", "A")];
    expect(stalledDatesOf(points)).toEqual([]);
  });

  it("🔴 안 적힌 날은 연속을 끊지도 잇지도 않는다 — 결석 한 번으로 리셋되면 몇 달째 제자리인 학생이 안 걸린다", () => {
    const points = [P("2026-08-05", "A"), P("2026-08-12", null), P("2026-08-19", "A"), P("2026-08-26", "A")];
    expect(stalledDatesOf(points)).toEqual(["2026-08-26"]);
  });

  it("🔴 안 적힌 날 자체는 정체가 아니다(미작성으로 이미 세고 있다)", () => {
    const points = [P("2026-08-05", null), P("2026-08-12", null), P("2026-08-19", null)];
    expect(stalledDatesOf(points)).toEqual([]);
  });

  it("날짜 순서가 뒤섞여 들어와도 시간 순으로 판정한다", () => {
    // 3개뿐이라 임계(3)에 닿는 건 마지막 날 하나 — 뒤섞어 넣어도 결과가 같아야 한다.
    const points = [P("2026-08-26", "A"), P("2026-08-05", "A"), P("2026-08-19", "A")];
    expect(stalledDatesOf(points)).toEqual(["2026-08-26"]);
  });

  it("임계를 올리면 덜 걸린다", () => {
    const points = [P("2026-08-05", "A"), P("2026-08-12", "A"), P("2026-08-19", "A")];
    expect(stalledDatesOf(points, 4)).toEqual([]);
    expect(stalledDatesOf(points, 2)).toEqual(["2026-08-12", "2026-08-19"]);
  });

  it("임계가 2 미만이면 판정하지 않는다(모든 날이 정체가 되는 것 방지)", () => {
    expect(stalledDatesOf([P("2026-08-05", "A")], 1)).toEqual([]);
  });
});

describe("positionFrozen — 보조 근거일 뿐", () => {
  it("실측(박서준 현행): 341 → 341", () => {
    expect(positionFrozen(341, 341)).toBe(true);
  });

  it("움직였으면 false", () => {
    expect(positionFrozen(340, 352)).toBe(false);
  });

  it("🔴 위치를 모르면 '멈췄다'고 하지 않는다 — 교재가 '프린트'면 매칭이 안 된다", () => {
    expect(positionFrozen(null, 341)).toBe(false);
    expect(positionFrozen(341, null)).toBe(false);
  });
});
