/**
 * **자리 출석부(랩실·JJ실)의 지각·사유 배선 규약** (원장 2026-09-08:
 * *"jj실 출석부도 결석 누르면 사유 입력할 수 있게. 지각도 만들어주고. 다른 출결과 동일하게"* ·
 * *"지각 및 사유는 JJ/LAB 둘다 동일"* · *"이전수업이 결석인 경우에 사유를 확인할 수 있도록"*).
 *
 * 이 파일이 잠그는 것은 셋이고, 셋 다 **조용히 깨지는** 종류다:
 *  ① 두 화면이 **같은 부품**을 쓴다 — 각자 버튼을 그리면 한쪽만 고쳐진다(오늘 고친 `seatMarkOf`가 그랬다).
 *  ② 사유만 저장할 땐 **상태를 쓰지 않는다**(`noteOnly`) — 같이 실으면 그새 다른 창이 고친 값을 되돌린다.
 *  ③ **비로그인 PIN 화면의 사유는 `PIN_NOTE_SEATS`(랩실)만** — 원장 2026-09-10 *"seat/lab에서도 자리 출석부와
 *     동일해야해"* → PIN 메모 *"읽기·쓰기 둘 다 열기"*(랩실). 그 밖의 자리 PIN은 사유를 조회조차 안 하므로
 *     (병원·수술·가족 일정) 입력만 열어 두면 화면엔 영영 안 보이는 유령이 된다 — 그래서 조회·화면·서버가 한 배열을 본다.
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

  it("서버는 noteOnly면 **메모만** 고친다 — 상태·기록자·자리 라벨을 안 건드린다", () => {
    // 급여 자리(랩실)·비급여(JJ) 두 갈래 모두. 🔴 기록자(`recorded_by`)를 메모로 덮으면 "누가 찍었나"가 바뀌고
    //    PIN이면 null로 지워진다 — 반 출석부 noteOnly와 같은 규약(적대적 리뷰 2026-09-10).
    expect(actions.match(/p\.noteOnly\s*\?\s*notePatch\(p\.note\)/g)?.length).toBe(2);
  });

  it("noteOnly는 행을 만들지도, 지우지도, 교시를 옮기지도 않는다", () => {
    expect(actions).toContain("if (p.noteOnly) return 0;");
    expect(actions).toContain("if (p.status === null && !p.noteOnly)");
    // 사유만이면 이 교시 행에만 — 날 단위 행만 있으면 거절(보지도 못한 담임 메모를 덮거나, 조용히 버려 "저장됨"만 남긴다).
    expect(actions).toMatch(/if \(p\.noteOnly\) \{\s*if \(updateIds\.length === 0\) \{\s*return "담임이/);
    // 상태 검증은 사유만 저장엔 걸지 않는다(공결·보강 칸에도 사유는 적혀야 한다).
    expect(actions).toContain("input.noteOnly !== true && input.status !== null");
    expect(actions).toContain("SEAT_WRITE_STATUSES.includes(input.status)");
  });

  it("메모를 안 넘기면 기존 메모를 유지한다(키 자체를 안 넣는다)", () => {
    expect(actions).toContain("note === undefined ? {} : { note: note === \"\" ? null : note }");
  });

  it("상태를 바꿀 때 무엇을 비울지는 출결 모드와 같은 순수 규약이 정한다", () => {
    expect(saves).toContain("noteOnStatusChange");
  });
});

describe("③ 비로그인 PIN 화면의 사유는 PIN_NOTE_SEATS(랩실)만 — 원장 2026-09-10 '읽기·쓰기 둘 다 열기'", () => {
  it("조회·화면·서버 거절이 같은 한 배열(PIN_NOTE_SEATS)을 본다", () => {
    expect(queries).toContain("tenantId && PIN_NOTE_SEATS.includes(seat)");
    expect(publicPage).toContain("publicPin={!PIN_NOTE_SEATS.includes(seat)}");
    expect(actions).toContain("!PIN_NOTE_SEATS.includes(input.seat)");
  });

  it("🔴 PIN 쓰기도 감사로그에 남는다 — logAction은 사용자가 없으면 건너뛴다", () => {
    expect(actions).toContain("logSeatAction(g, input.seat,");
    expect(actions).not.toContain("await logAction(");
  });

  it("공개 페이지가 publicPin을 넘긴다", () => {
    expect(publicPage).toMatch(/<SeatBoard[\s\S]*?publicPin[\s\S]*?\/>/);
  });

  it("🔴 메모는 문자열만 받고 길이 상한이 있다 — 숫자·배열로 PIN 거절을 비껴가지 못한다", () => {
    expect(actions).toContain('typeof input.note !== "string"');
    expect(actions).toContain("note.length > SEAT_NOTE_MAXLEN");
  });

  it("🔴 '전체' 보기는 메모를 여는 자리에서만 — SeatAllDay엔 publicPin이 없다", () => {
    expect(publicPage).toContain('const allowAllView = seat === "lab" && sameAsLogin;');
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
