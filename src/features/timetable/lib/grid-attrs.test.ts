import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CELL_DAY_ATTR, CELL_GRID_ATTR, GRID_ID_ATTR, GRID_ROWS_ATTR } from "./grid-attrs";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/**
 * 격자 좌표 속성은 **서버 컴포넌트가 직접 단다**(`weekday-group-tables.tsx`의 `<table>`·칸) —
 * 그래서 상수가 "use client" 모듈에 있으면 런타임에 `undefined`가 되어 속성이 통째로 안 붙는다([[#81]]).
 *
 * 🔴 실제로 한 번 그렇게 깨졌다(2026-09-04): 타입체크·lint·vitest는 전부 통과했고 화면만 죽었다
 *    — "갈 수 있는 칸 0개 · 전 칸이 '이 자리엔 안 들어갑니다'". 실브라우저에서만 보였다.
 */
describe("시간표 격자 좌표 속성", () => {
  it("상수 모듈은 클라 전용이 아니다(서버 컴포넌트가 import한다)", () => {
    const src = read("src/features/timetable/lib/grid-attrs.ts");
    // ⚠️ 지시문은 자기 줄에 홀로 설 때만 효력이 있으므로 **줄 단위**로 본다(주석 속 문구 오탐 방지).
    expect(/^\s*["']use client["'];?\s*$/m.test(src)).toBe(false);
  });

  it("격자를 그리는 파일이 그 모듈에서 속성 이름을 읽는다", () => {
    const grid = read("src/app/(shell)/timetable/_components/weekday-group-tables.tsx");
    expect(grid).toContain('from "@/features/timetable/lib/grid-attrs"');
    // 표가 자기 교시 행 목록을 들고 있어야 블록이 "그 아래 교시"를 찾을 수 있다.
    expect(grid).toContain("GRID_ROWS_ATTR");
  });

  it("클라 모듈이 속성 이름을 **재-export하지 않는다**", () => {
    // 재-export가 있으면 서버 파일이 `./grid-drop-cell`에서 집어도 컴파일은 통과하고 런타임에만 조용히 깨진다.
    const cell = read("src/app/(shell)/timetable/_components/grid-drop-cell.tsx");
    expect(cell).not.toMatch(/export\s*\{[^}]*CELL_[A-Z_]+/);
  });

  it("속성 이름은 서로 다르고 data-*다", () => {
    const all = [CELL_DAY_ATTR, CELL_GRID_ATTR, GRID_ID_ATTR, GRID_ROWS_ATTR];
    expect(new Set(all).size).toBe(all.length);
    for (const a of all) expect(a.startsWith("data-")).toBe(true);
  });
});
