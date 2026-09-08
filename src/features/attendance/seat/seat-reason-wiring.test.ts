/**
 * **자리 출석부(랩실·JJ실)의 지각·사유 배선 규약** (원장 2026-09-08:
 * *"jj실 출석부도 결석 누르면 사유 입력할 수 있게. 지각도 만들어주고. 다른 출결과 동일하게"* ·
 * *"지각 및 사유는 JJ/LAB 둘다 동일"* · *"이전수업이 결석인 경우에 사유를 확인할 수 있도록"*).
 *
 * 이 파일이 잠그는 것은 셋이고, 셋 다 **조용히 깨지는** 종류다:
 *  ① 두 화면이 **같은 부품**을 쓴다 — 각자 버튼을 그리면 한쪽만 고쳐진다(오늘 고친 `seatMarkOf`가 그랬다).
 *  ② 사유만 저장할 땐 **상태를 쓰지 않는다**(`noteOnly`) — 같이 실으면 그새 다른 창이 고친 값을 되돌린다.
 *  ③ **비로그인 PIN 화면엔 사유 칸이 없다** — 그 경로는 사유를 조회조차 안 하므로(병원·수술·가족 일정)
 *     입력만 열어 두면 저장은 되는데 화면엔 영영 안 보이는 유령이 된다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const SEAT_DIR = ["src", "app", "(shell)", "attendance", "seat", "[seat]", "_components"];
const jj = strip(read(...SEAT_DIR, "seat-jj-table.tsx"));
const lab = strip(read(...SEAT_DIR, "seat-lab-grid.tsx"));
const board = strip(read(...SEAT_DIR, "seat-board.tsx"));
const saves = strip(read(...SEAT_DIR, "seat-board-saves.ts"));
const actions = strip(read("src", "features", "attendance", "seat", "server", "actions.ts"));
const queries = strip(read("src", "features", "attendance", "seat", "server", "queries.ts"));
const publicPage = strip(read("src", "app", "(seat)", "seat", "[seat]", "page.tsx"));

describe("① JJ실·랩실이 같은 부품을 쓴다", () => {
  for (const [name, src] of [
    ["JJ실", jj],
    ["랩실", lab],
  ] as const) {
    it(`${name}은 결·지 버튼과 사유 칸을 공용 부품에서 가져온다`, () => {
      expect(src).toContain("./seat-mark-extras");
      expect(src).toContain("<SeatMarkButtons");
      expect(src).toContain("<SeatReasonInput");
      expect(src).toContain("<PrevAbsenceHint");
    });

    it(`${name}에 결석 버튼을 직접 그리지 않는다 — 한쪽만 고쳐지는 갈림을 막는다`, () => {
      expect(src).not.toMatch(/aria-label=\{`\$\{s\.name\} 결석`\}/);
    });
  }
});

describe("② 사유만 저장할 땐 상태를 쓰지 않는다", () => {
  it("클라이언트는 noteOnly로 보낸다", () => {
    expect(saves).toContain("noteOnly: true");
  });

  it("서버는 noteOnly면 status를 패치에서 뺀다", () => {
    // 급여 자리(랩실)·비급여(JJ) 두 갈래 모두.
    expect(actions.match(/\.\.\.\(p\.noteOnly \? \{\} : \{ status: p\.status \}\)/g)?.length).toBe(2);
  });

  it("noteOnly는 행을 만들지도, 지우지도, 교시를 옮기지도 않는다", () => {
    expect(actions).toContain("if (p.noteOnly) return 0;");
    expect(actions).toContain("if (p.status === null && !p.noteOnly)");
    expect(actions).toContain("promoteIds.length > 0 && !p.noteOnly");
  });

  it("메모를 안 넘기면 기존 메모를 유지한다(키 자체를 안 넣는다)", () => {
    expect(actions).toContain("note === undefined ? {} : { note: note === \"\" ? null : note }");
  });

  it("상태를 바꿀 때 무엇을 비울지는 출결 모드와 같은 순수 규약이 정한다", () => {
    expect(saves).toContain("noteOnStatusChange");
  });
});

describe("③ 비로그인 PIN 화면엔 사유가 없다", () => {
  it("공개 페이지가 publicPin을 넘긴다", () => {
    expect(publicPage).toMatch(/<SeatBoard[\s\S]*?publicPin[\s\S]*?\/>/);
  });

  it("보드가 그 값으로 두 표의 사유 칸을 끈다", () => {
    expect(board.match(/showReason=\{!publicPin\}/g)?.length).toBe(2);
  });

  it("사유·지난 결석은 로그인 경로에서만 조회한다 — PIN이면 아예 안 받는다", () => {
    // tenantId가 넘어온 경로 = admin 클라이언트 = 공개(PIN) 경로다(queries.ts 주석).
    expect(queries).toMatch(/tenantId\s*\?\s*Promise\.resolve\(\[\] as PrevAbsenceRow\[\]\)/);
    // 결석만 받고(전 기록 아님) 청크 안에서 페이징한다(B2/B3).
    expect(queries).toContain('.in("status", ["absent", "excused"])');
    expect(queries).toContain("fetchAllPagedInChunks<PrevAbsenceRow>");
  });
});
