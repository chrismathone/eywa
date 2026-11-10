import { describe, expect, it } from "vitest";
import { classIdFor, extFromType, subjectKeyFor } from "./attachment-row";
import type { OneScreenStudent } from "./types";

const st = {
  id: "s1",
  subjects: [
    { name: "수학 A반", subjectKey: "math", subjectLabel: "수학", classId: "c1" },
    { name: "수학 (보강)", subjectLabel: "수학", classId: null },
    { name: "기타" },
  ],
} as unknown as OneScreenStudent;

describe("attachment-row", () => {
  it("이미지 MIME만 확장자를 정한다(나머지는 부르는 쪽이 파일 이름으로)", () => {
    expect(extFromType("image/jpeg")).toBe("jpg");
    expect(extFromType("image/png")).toBe("png");
    expect(extFromType("image/webp")).toBe("webp");
    expect(extFromType("application/pdf")).toBeNull();
  });
  it("과목 = 과목키 → 라벨 → 행 이름 · 없는 행이면 undefined", () => {
    expect(subjectKeyFor(st, "수학 A반")).toBe("math");
    expect(subjectKeyFor(st, "수학 (보강)")).toBe("수학");
    expect(subjectKeyFor(st, "기타")).toBe("기타");
    expect(subjectKeyFor(st, "없음")).toBeUndefined();
  });
  it("반 = 그 행의 반(보강·없는 행은 null) — 같은 과목 두 행이면 반으로 가른다(0134a)", () => {
    expect(classIdFor(st, "수학 A반")).toBe("c1");
    expect(classIdFor(st, "수학 (보강)")).toBeNull();
    expect(classIdFor(st, "없음")).toBeNull();
  });
});
