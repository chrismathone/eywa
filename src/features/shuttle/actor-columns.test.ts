import { describe, expect, it } from "vitest";

import { isMissingActorColumns, isMissingCancelFunction } from "./actor-columns";

describe("isMissingActorColumns — 0321a 전 DB 감지", () => {
  it("읽기 42703 · 쓰기 PGRST204를 잡는다", () => {
    expect(isMissingActorColumns({ code: "42703", message: "column shuttle_ride_exceptions.actor_kind does not exist" })).toBe(true);
    expect(isMissingActorColumns({ code: "PGRST204", message: "Could not find the 'actor_name' column" })).toBe(true);
  });
  it("다른 칸 · 다른 오류는 삼키지 않는다", () => {
    expect(isMissingActorColumns({ code: "42703", message: "column memo does not exist" })).toBe(false);
    expect(isMissingActorColumns({ code: "23505", message: "actor_kind duplicate" })).toBe(false);
    expect(isMissingActorColumns(null)).toBe(false);
  });
});

describe("isMissingCancelFunction — 0321a 전 취소 함수 부재", () => {
  it("PGRST202 · 42883을 잡는다", () => {
    expect(isMissingCancelFunction({ code: "PGRST202", message: "Could not find the function public.cancel_shuttle_ride_exception" })).toBe(true);
    expect(isMissingCancelFunction({ code: "42883", message: "function cancel_shuttle_ride_exception(uuid) does not exist" })).toBe(true);
  });
  it("함수 안의 진짜 오류는 삼키지 않는다", () => {
    expect(isMissingCancelFunction({ code: "P0001", message: "cancel_shuttle_ride_exception: not found" })).toBe(false);
  });
});
