import { describe, it, expect } from "vitest";
import { FIRST_SHARE_BASE, normalizeShareBase, recallShareBases } from "./share-bases.mjs";

describe("recallShareBases — 회수는 지금 주소와 옛 주소를 전부 대 본다", () => {
  it("env가 없으면 첫 배포 주소 하나", () => {
    expect(recallShareBases(undefined, undefined)).toEqual([FIRST_SHARE_BASE]);
  });

  it("도메인 이전 뒤: 새 주소가 먼저, 옛 주소(기본값)도 남는다 — 이전 전 글을 회수할 수 있어야 한다", () => {
    expect(recallShareBases("https://eywa.kr", undefined)).toEqual(["https://eywa.kr", FIRST_SHARE_BASE]);
  });

  it("옛 주소를 env로 더 줄 수 있다 · 중복·끝 슬래시·빈 칸은 정리된다", () => {
    expect(recallShareBases("https://eywa.kr", " https://old.example.com/ , ,https://EYWA.kr")).toEqual([
      "https://eywa.kr",
      "https://old.example.com",
      FIRST_SHARE_BASE,
    ]);
  });

  it("🔴 지금 주소는 env 원문 표기도 후보에 넣는다 — 발송 워커가 env를 가공 없이 본문에 쓰기 때문", () => {
    expect(recallShareBases("https://Eywa.kr/", undefined)).toEqual(["https://Eywa.kr/", "https://eywa.kr", FIRST_SHARE_BASE]);
  });

  it("주소가 아닌 값은 버린다(본문 비교에 쓰레기 후보를 넣지 않는다)", () => {
    expect(normalizeShareBase("eywa.kr")).toBeNull();
    expect(normalizeShareBase("javascript:alert(1)")).toBeNull();
    expect(normalizeShareBase("")).toBeNull();
    expect(recallShareBases("not-a-url", "ftp://x")).toEqual([FIRST_SHARE_BASE]);
  });
});
