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
    it(`${name}은 출결 버튼·사유 팝업·메모 표식을 공용 부품에서 가져온다`, () => {
      // 🔴 2026-09-10 원장 지시로 부품이 바뀌었다(옛 `SeatMarkButtons`·`SeatReasonInput`):
      //    ① 출결 = **세 버튼 같은 폭**(`SeatMarkTriad`) ② 사유 = 카드 아래 입력칸이 아니라 **팝업**
      //    (`SeatNotePopover`) ③ 메모가 있으면 **모서리 삼각형**(`SeatMemoMark`).
      //    잠그는 성질은 그대로다 — 두 화면이 **같은 한 벌**을 쓴다.
      expect(src).toContain("./seat-mark-extras");
      expect(src).toContain("<SeatMarkTriad");
      expect(src).toContain("<SeatNotePopover");
      expect(src).toContain("<SeatMemoMark");
      // 🔴 원장 2026-09-10 "지난 결석은 필요없어" — 09-08에 넣었던 한 줄을 뺐다. 되살리지 말 것.
      expect(src).not.toContain("<PrevAbsenceHint");
    });

    it(`${name}에 옛 인라인 사유 칸·결/지 버튼이 남아 있지 않다`, () => {
      expect(src).not.toContain("<SeatReasonInput");
      expect(src).not.toContain("<SeatMarkButtons");
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

  it("🔴 '지난 결석' 조회는 없다 — 원장 2026-09-10 \"지난 결석은 필요없어\"", () => {
    // 09-08에 넣었던 30일 결석 조회(카드의 `지난 결석 8/28 · 사유` 한 줄)를 화면과 함께 걷었다.
    // 조회만 남으면 자리 화면을 열 때마다 아무도 안 쓰는 왕복이 하나 더 돈다(창마다 곱해진다, B6).
    expect(queries).not.toContain("PrevAbsenceRow");
    expect(queries).not.toContain('.in("status", ["absent", "excused"])');
    expect(queries).not.toContain("prevAbsence");
  });
});
