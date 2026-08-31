/**
 * **시트 가져오기가 폐강의실에 배치를 붙이지 않게** — 배선 규약(구조 가드).
 *
 * 마스터 시트는 강의실을 **번호만으로** 적는다(`PL4/ 602`). 그런데 그 번호를 쓰는 방이 둘이면
 * (`바른602`·`본원602`) 매칭 맵(`roomKey` → 방)이 뒤엣것으로 덮여 **어느 쪽에 붙을지가 목록 순서로
 * 정해진다**. 실측 2026-08-31: 원장이 **8/6에 이미 보관**해 둔 `바른602`에 9월 배치 6칸이 붙었고,
 * 반 하나는 기본 강의실까지 그리로 잡혔다(원장: *"바른602는 더이상 사용하지 않는 강의실임.
 * 절대 그럴일이 없어야함"*). 보관 표시는 눌려 있었고 **가져오기만 그걸 안 보고 있었다.**
 *
 * 🔴 거르는 자리는 **후보 목록을 만드는 곳**뿐이다(앱 `loadStructureContext` · 스크립트 `loadContext`).
 *    id→이름 조회에까지 걸면 지난 배치가 쓰던 보관 강의실 이름이 화면에서 **빈칸**이 된다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const appImport = strip(read("src", "features", "timetable", "server", "structure-import-actions.ts"));
const script = strip(read("scripts", "_english_sync", "master-cutover.mts"));

describe("가져오기 후보 강의실 — 보관된 방은 뺀다", () => {
  it("앱 경로: classrooms 후보 조회가 archived_at is null 로 거른다", () => {
    expect(appImport).toMatch(/from\("classrooms"\)[\s\S]{0,120}?\.is\("archived_at", null\)/);
  });

  it("스크립트 경로: 같은 규약(archived_at is null)", () => {
    expect(script).toMatch(/from classrooms[\s\S]{0,80}?archived_at is null/);
  });

  it("⚠️ 두 경로가 **같은** 후보 집합을 본다 — 한쪽만 거르면 앱과 스크립트 결과가 갈린다", () => {
    const appFilters = /\.is\("archived_at", null\)/.test(appImport);
    const scriptFilters = /archived_at is null/.test(script);
    expect(appFilters).toBe(scriptFilters);
  });
});

describe("🔴 id→이름 조회에는 걸지 않는다 (보관 강의실 이름이 화면에서 사라지지 않게)", () => {
  it("출결 좌석표·오늘 시트의 강의실 이름 조회는 그대로 전부 읽는다", () => {
    for (const f of [
      ["src", "features", "attendance", "live", "server", "load.ts"],
      ["src", "features", "class-sheets", "server", "today.ts"],
    ]) {
      const src = strip(read(...f));
      const m = /from\("classrooms"\)[\s\S]{0,120}?;/.exec(src);
      expect(m, f.join("/")).toBeTruthy();
      expect(m![0], f.join("/")).not.toContain('archived_at');
    }
  });
});
