import { describe, expect, it } from "vitest";
import { isMakeupPoolClass, makeupPoolName, MAKEUP_POOL_PREFIX, pickMakeupOwner } from "./makeup-pool";

describe("pickMakeupOwner — 보강 반은 저장자가 아니라 **소유자**의 것", () => {
  it("① created_by(0172a 소유 계정)가 있으면 그것 — 이름·저장자와 달라도", () => {
    expect(
      pickMakeupOwner({ createdBy: "T", teacherName: "사무실", sameName: [{ id: "O" }], saver: "O" }),
    ).toEqual({ id: "T", via: "created_by" });
  });

  it("② created_by가 비면 teacher_name이 활성 직원과 **정확히 하나** 일치할 때만", () => {
    expect(pickMakeupOwner({ createdBy: null, teacherName: "김은정", sameName: [{ id: "K" }], saver: "O" }))
      .toEqual({ id: "K", via: "teacher_name" });
  });

  it("🔴 동명이인·미등록이면 귀속하지 않는다(저장자로 떨어지지 않는다) — 남의 계정에 붙이는 것보다 안 만드는 게 낫다", () => {
    expect(pickMakeupOwner({ createdBy: null, teacherName: "수진", sameName: [], saver: "O" })).toBeNull();
    expect(
      pickMakeupOwner({ createdBy: null, teacherName: "김민지", sameName: [{ id: "A" }, { id: "B" }], saver: "O" }),
    ).toBeNull();
  });

  it("③ 소유자 정보가 아예 없을 때만 저장자 — 스크립트처럼 저장자도 없으면 null", () => {
    expect(pickMakeupOwner({ createdBy: null, teacherName: "  ", sameName: [], saver: "O" })).toEqual({
      id: "O",
      via: "saver",
    });
    expect(pickMakeupOwner({ createdBy: undefined, teacherName: null, sameName: [], saver: null })).toBeNull();
  });
});

describe("보이지 않는 '보강' 반 — 판정은 컬럼, 이름은 표시용", () => {
  it("이름은 강사명을 붙인다(없으면 접미사 없이)", () => {
    expect(makeupPoolName("김은정")).toBe("보강 · 김은정");
    expect(makeupPoolName("  ")).toBe(MAKEUP_POOL_PREFIX);
    expect(makeupPoolName(null)).toBe(MAKEUP_POOL_PREFIX);
  });

  it("🔴 판정은 컬럼 하나뿐 — 이름이 '보강'이어도 컬럼이 없으면 아니다", () => {
    expect(isMakeupPoolClass({ is_makeup_pool: true })).toBe(true);
    expect(isMakeupPoolClass({ is_makeup_pool: false })).toBe(false);
    // 이름만 같은 진짜 반이 걸려들면 사무실 목록에서 멀쩡한 반이 사라진다.
    expect(isMakeupPoolClass({} as { is_makeup_pool?: boolean })).toBe(false);
    expect(isMakeupPoolClass(null)).toBe(false);
  });

  it("⚠️ 0241a 미적용(컬럼 없음)이면 항상 false — 종전과 같게 돈다", () => {
    expect(isMakeupPoolClass({ is_makeup_pool: undefined })).toBe(false);
  });
});
