import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { englishRoomName, roomNameFor } from "./room-name";

/**
 * 🔴 픽스처는 **실제 등록 강의실**이다(2026-09-04 injaewon 조회, 22개 중 대표) — 지어낸 이름으로
 *    잠그면 표가 실제와 어긋나도 초록으로 통과한다.
 */
describe("강의실 이름 영문 표기 — 건물만 로마자, 호수는 그대로", () => {
  it.each([
    ["본원305", "Main 305"],
    ["본원603", "Main 603"],
    ["본원SKY", "Main SKY"],
    ["고수801", "Gosu 801"],
    ["바른602", "Bareun 602"],
  ])("%s → %s", (ko, en) => {
    expect(englishRoomName(ko)).toBe(en);
  });

  it("🔴 한글이 없으면 원문 그대로 — 자리 라벨·맨숫자는 손대지 않는다", () => {
    for (const n of ["305", "LAB", "JJ", "603"]) expect(englishRoomName(n)).toBe(n);
  });

  it("🔴 모르는 건물은 원문 그대로 — 지어내지 않는다", () => {
    expect(englishRoomName("새관301")).toBe("새관301");
    expect(englishRoomName("랩실")).toBe("랩실");
  });

  it("🔴 ko는 글자까지 그대로", () => {
    expect(roomNameFor("본원305", "ko")).toBe("본원305");
    expect(roomNameFor("본원305", "en")).toBe("Main 305");
    expect(roomNameFor("", "en")).toBeNull();
    expect(roomNameFor(null, "ko")).toBeNull();
  });

  it("숫자는 한 글자도 안 바뀐다 — 눈으로 1:1 대조가 되어야 한다", () => {
    for (const n of ["본원305", "고수804", "바른602"]) {
      const digits = (s: string) => (s.match(/\d+/g) ?? []).join(",");
      expect(digits(englishRoomName(n))).toBe(digits(n));
    }
  });
});

/**
 * 🔴 **표시는 FK(등록 강의실 이름)가 먼저다** — 라벨(`slot_room_label`)은 시트가 적은 대로라 같은 방이
 *    `305`·`본원305` 두 표기로 들어 있다(실측 2026-09-04: 유효 슬롯 209건이 접두 없는 표기).
 *    좌석표가 쓰던 두 함수를 시트 3화면이 **그대로** 쓰는지 구조로 잠근다.
 */
describe("🔴 강의실 표기는 eywa 등록 이름으로 통일한다(FK 우선)", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

  it.each([
    ["주간 시트", ["features", "class-sheets", "server", "queries.ts"]],
    ["월간 뷰", ["features", "class-sheets", "server", "month-queries.ts"]],
    ["오늘 면", ["features", "class-sheets", "server", "today.ts"]],
  ])("%s 는 FK 이름을 먼저 보고 라벨을 정정한다", (_label, path) => {
    const src = read(...path);
    expect(src).toContain("canonicalRoomName");
    expect(src).toContain("resolveRoomName");
    // FK를 안 읽으면 정정할 근거가 없다.
    expect(src).toContain("classroom_id");
  });

  it("🔴 학부모·사무실 표면은 영문 강의실 표기를 쓰지 않는다", () => {
    // 인쇄물·발송은 한국어 고정 — 학부모는 `Main 305`가 어디인지 모른다.
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const e of readdirSync(dir)) {
        const f = join(dir, e);
        if (statSync(f).isDirectory()) out = out.concat(walk(f));
        else if (/\.(ts|tsx)$/.test(f)) out.push(f);
      }
      return out;
    };
    for (const p of [
      ["features", "report-admin"],
      ["features", "onescreen"],
      ["features", "exports"],
      ["lib", "messaging"],
      ["app", "(print)"],
    ]) {
      const files = walk(join(process.cwd(), "src", ...p));
      // 🔴 경로가 틀리면 "훑을 게 없었다"는 이유로 초록이 된다(2026-09-04에 실제로 겪었다).
      expect(files.length).toBeGreaterThan(0);
      const offenders = files.filter((f) => /teacher-view\/room-name/.test(readFileSync(f, "utf8")));
      expect(offenders).toEqual([]);
    }
  });
});
