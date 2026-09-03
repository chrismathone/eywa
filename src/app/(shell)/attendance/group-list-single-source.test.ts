import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 출석부 화면이 **표에 넘기는 묶음 목록**과 **격자 값을 만드는 목록**이 같은지 잠근다.
 *
 * 원장 제보 2026-09-02: *"이윤 9/1 왜 0개?"* — 보강 묶음을 `<MatrixTable groups={...}>`에만 붙이고
 * `buildGridSource(groups, …)`엔 안 넣었더니 **행은 서는데 칸이 전부 비었다**(격자 초기값이 없어
 * 시수 0, 학생 검색도 못 찾음). 에러는 나지 않는다 — 표가 "값이 없는 행"을 그냥 그린다.
 *
 * 🔴 소스 모양이 아니라 **두 자리에 같은 이름이 오는가**만 본다(이름을 바꿔도 통과).
 */
const PAGE = readFileSync("src/app/(shell)/attendance/page.tsx", "utf8");

describe("출석부 묶음 목록 단일화", () => {
  it("MatrixTable과 buildGridSource가 **같은 배열**을 받는다", () => {
    const table = /<MatrixTable[\s\S]{0,400}?\bgroups=\{([A-Za-z0-9_]+)\}/.exec(PAGE);
    const grid = /buildGridSource\(\s*([A-Za-z0-9_]+)\s*,/.exec(PAGE);
    expect(table?.[1], "MatrixTable groups= 를 못 찾음").toBeTruthy();
    expect(grid?.[1], "buildGridSource 첫 인자를 못 찾음").toBeTruthy();
    expect(table![1]).toBe(grid![1]);
  });

  it("정렬(orderedRows)·검색(searchRows)도 같은 배열에서 나온다", () => {
    const table = /<MatrixTable[\s\S]{0,400}?\bgroups=\{([A-Za-z0-9_]+)\}/.exec(PAGE)![1];
    const ordered = /const orderedRows = sortAttendanceRows\(\s*([A-Za-z0-9_]+)\.flatMap/.exec(PAGE);
    const search = /const searchRows = ([A-Za-z0-9_]+)\.flatMap/.exec(PAGE);
    expect(ordered?.[1]).toBe(table);
    expect(search?.[1]).toBe(table);
  });

  it("보강 묶음을 표에만 덧붙이는 옛 모양이 남아 있지 않다", () => {
    // `groups={makeupGroup ? [...groups, makeupGroup] : groups}` 처럼 **그 자리에서** 이어 붙이면
    // 격자·정렬·검색은 그 묶음을 영영 모른다. 합치는 곳은 한 곳(allGroups)뿐이어야 한다.
    expect(PAGE).not.toMatch(/groups=\{[^}]*makeupGroup[^}]*\}/);
    expect((PAGE.match(/\[\s*\.\.\.groups,\s*makeupGroup\s*\]/g) ?? []).length).toBe(1);
  });
});
