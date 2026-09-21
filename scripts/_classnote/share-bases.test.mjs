import { describe, it, expect } from "vitest";
import { CURRENT_SHARE_BASE, FIRST_SHARE_BASE, normalizeShareBase, recallShareBases, shareUrlVariants } from "./share-bases.mjs";

describe("recallShareBases — 회수는 지금 주소와 옛 주소를 전부 대 본다", () => {
  it("지금 도메인 = www.aywa.co.kr(2026-09-21) — 옛 별칭이 전환되는 곳과 같다", () => {
    expect(CURRENT_SHARE_BASE).toBe("https://www.aywa.co.kr");
    expect(FIRST_SHARE_BASE).toBe("https://eywa-alpha.vercel.app");
  });

  it("env가 없으면 지금 도메인 + 첫 배포 주소 — 발송 워커의 기본값과 같은 곳을 먼저 본다", () => {
    expect(recallShareBases(undefined, undefined)).toEqual([CURRENT_SHARE_BASE, FIRST_SHARE_BASE]);
  });

  it("🔴 연동 PC env가 아직 옛 주소여도 새 도메인 글을 찾는다(env를 바꾼 날을 경계로 두 주소의 글이 섞인다)", () => {
    expect(recallShareBases(FIRST_SHARE_BASE, undefined)).toEqual([FIRST_SHARE_BASE, CURRENT_SHARE_BASE]);
  });

  it("env가 새 도메인이면: 새 주소가 먼저, 옛 주소(기본값)도 남는다 — 이전 전 글을 회수할 수 있어야 한다", () => {
    expect(recallShareBases(CURRENT_SHARE_BASE, undefined)).toEqual([CURRENT_SHARE_BASE, FIRST_SHARE_BASE]);
  });

  it("다른 주소로 또 옮겨도 지금·첫 주소가 후보에 남는다", () => {
    expect(recallShareBases("https://eywa.kr", undefined)).toEqual([
      "https://eywa.kr",
      CURRENT_SHARE_BASE,
      FIRST_SHARE_BASE,
    ]);
  });

  it("옛 주소를 env로 더 줄 수 있다 · 원문 표기와 정리한 표기 둘 다 · 중복·빈 칸은 정리된다", () => {
    expect(recallShareBases("https://eywa.kr", " https://old.example.com/ , ,https://EYWA.kr")).toEqual([
      "https://eywa.kr",
      "https://old.example.com/",
      "https://old.example.com",
      "https://EYWA.kr",
      CURRENT_SHARE_BASE,
      FIRST_SHARE_BASE,
    ]);
  });

  it("🔴 PC의 옛 값이 끝 슬래시였으면 그때 글 본문(`…app//r/토큰`)도 찾는다 — 스크립트가 옛 원문을 LEGACY로 옮겨 적는다", () => {
    const TOKEN = "21fdfa4f-c6c3-4f14-ac27-1738787e1f2a";
    const oldPosted = `https://eywa-alpha.vercel.app//r/${TOKEN}`; // 발송 워커는 env 원문 + "/r/…"
    expect(shareUrlVariants(`${CURRENT_SHARE_BASE}/r/${TOKEN}`, CURRENT_SHARE_BASE, "https://eywa-alpha.vercel.app/")).toContain(
      oldPosted,
    );
  });

  it("🔴 지금 주소는 env 원문 표기도 후보에 넣는다 — 발송 워커가 env를 가공 없이 본문에 쓰기 때문", () => {
    expect(recallShareBases("https://Eywa.kr/", undefined)).toEqual([
      "https://Eywa.kr/",
      "https://eywa.kr",
      CURRENT_SHARE_BASE,
      FIRST_SHARE_BASE,
    ]);
  });

  it("주소가 아닌 값은 버린다(본문 비교에 쓰레기 후보를 넣지 않는다)", () => {
    expect(normalizeShareBase("eywa.kr")).toBeNull();
    expect(normalizeShareBase("javascript:alert(1)")).toBeNull();
    expect(normalizeShareBase("")).toBeNull();
    expect(recallShareBases("not-a-url", "ftp://x")).toEqual([CURRENT_SHARE_BASE, FIRST_SHARE_BASE]);
  });
});

describe("shareUrlVariants — 게시 전 중복 확인은 같은 토큰의 옛·새 주소 글을 다 알아본다", () => {
  const TOKEN = "21fdfa4f-c6c3-4f14-ac27-1738787e1f2a";

  it("🔴 PC 주소를 새 도메인으로 바꾼 뒤에도 옛 주소로 올라간 같은 보고서를 찾는다(재시작 순간 게시 중이던 건)", () => {
    expect(shareUrlVariants(`${CURRENT_SHARE_BASE}/r/${TOKEN}`, CURRENT_SHARE_BASE, undefined)).toEqual([
      `${CURRENT_SHARE_BASE}/r/${TOKEN}`,
      `${FIRST_SHARE_BASE}/r/${TOKEN}`,
    ]);
  });

  it("아직 옛 주소 env여도 맨 앞은 지금 보낼 링크 그대로", () => {
    expect(shareUrlVariants(`${FIRST_SHARE_BASE}/r/${TOKEN}`, FIRST_SHARE_BASE, undefined)).toEqual([
      `${FIRST_SHARE_BASE}/r/${TOKEN}`,
      `${CURRENT_SHARE_BASE}/r/${TOKEN}`,
    ]);
  });

  it("토큰이 다른 글은 후보가 아니다 — 모든 후보가 같은 토큰으로 끝난다", () => {
    for (const v of shareUrlVariants(`https://eywa.kr/r/${TOKEN}`, "https://eywa.kr", "https://old.example.com")) {
      expect(v.endsWith(`/r/${TOKEN}`)).toBe(true);
    }
  });

  it("링크 모양이 아니면 그 문자열 하나만(추측으로 후보를 늘리지 않는다)", () => {
    expect(shareUrlVariants("본문", undefined, undefined)).toEqual(["본문"]);
    expect(shareUrlVariants("", undefined, undefined)).toEqual([]);
  });
});
