import { describe, expect, it } from "vitest";
import { liveReadersFor, liveSectionReaders } from "./live-query";

describe("학생 현재 연결의 모듈 섹션", () => {
  it("모듈이 전부 켜진 지점은 기존 섹션을 그대로 쓴다", () => {
    expect(liveReadersFor([])).toEqual(liveSectionReaders);
  });

  it("보강이 꺼지면 보강 두 섹션을 제한 안내 없이 목록에서 뺀다", () => {
    expect(liveReadersFor(["makeups"]).map((reader) => reader.key)).toEqual([
      "classes",
      "consultations",
      "memos",
      "family",
    ]);
  });
});
