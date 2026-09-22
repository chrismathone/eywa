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
describe("🔴 강의실 표기는 aywa 등록 이름으로 통일한다(FK 우선)", () => {
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

  /**
   * 🔴 학생 수업 탭(2026-09-11) — 원장 *"…왜 학생 정보에서 수업 들어가면 그냥 606으로 되어있는 경우가 있지?"*.
   *    규칙은 순수 모듈(`class-slots.ts`)에, FK를 싣는 조회는 `getStudentClassesDetail`에 있어 **둘 다** 본다.
   *    Supabase 클라이언트에 DB 타입이 없어 select 문자열은 tsc를 안 받는다 — 컬럼이 빠져도 초록이다.
   * ⚠️ `toContain("classroom_id")`로 보지 말 것 — 같은 함수의 반 임베드 `classroom:classroom_id ( name )`에 같은
   *    글자가 있어 배치 select에서 빠져도 헛통과한다. 배치 select 문자열 **자체**를 뽑아 본다.
   */
  it("학생 수업 탭 은 배치의 강의실 FK를 싣고 등록 강의실로 정정한다", () => {
    const rule = read("features", "students", "lib", "class-slots.ts");
    expect(rule).toContain("canonicalRoomName");
    expect(rule).toContain("resolveRoomName");

    const q = read("features", "students", "server", "queries.ts");
    const start = q.indexOf("export async function getStudentClassesDetail");
    expect(start).toBeGreaterThan(-1);
    const next = q.indexOf("\nexport ", start + 1);
    const body = q.slice(start, next === -1 ? undefined : next);
    const selectOf = (table: string) => {
      const m = body.match(new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)\\s*\\.select\\(\\s*(["'\`])([\\s\\S]*?)\\1`));
      return m ? m[2]!.split(",").map((c) => c.trim()) : null;
    };
    // ① 배치 select 문자열 자체에 FK 컬럼 ② 그 값을 슬롯에 싣는다
    expect(selectOf("class_schedules")).toContain("classroom_id");
    expect(body).toMatch(/roomId:\s*s\.classroom_id\b/);
    // ③ 등록 강의실 **조회 결과**로 만든 RoomBook을 넘긴다(빈 목록·인라인 리터럴이면 FK 이름을 못 찾는다)
    expect(selectOf("classrooms")).toEqual(expect.arrayContaining(["id", "name"]));
    expect(body).toMatch(/\brooms\s*=\s*roomBookOf\(\s*[A-Za-z_$][\w$]*\s*\)/);
    const call = body.match(/buildClassSlots\(\s*[\w$]+\s*,\s*\{([\s\S]*?)\}\s*\)/);
    expect(call).not.toBeNull();
    expect(call![1]).toMatch(/(?:^|[\s{,])rooms(?:\s*:\s*rooms)?\s*(?:,|$)/m);
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
