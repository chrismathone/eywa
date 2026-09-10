/**
 * **앞 교시 결석 · 다음 교시 표시의 배선 규약** (원장 2026-09-10:
 * *"이 학생이 이전수업에 결석이였으면 자동 결석체크할 수 있도록"* ·
 * *"이후에 수업이 남아있으면 다음 수업이 있다고 표시해줘"*).
 *
 * 이 파일이 잠그는 것은 넷이고, 넷 다 **조용히 깨지는** 종류다:
 *  ① 화면을 여는 것만으로는 **한 칸도 안 쓴다** — 자동 저장 경로가 생기면 되돌릴 방법이 없다
 *     (셔틀 "신호만, 자동 쓰기 없음" · 재고 "제안만(사람이 누른다)" · 강사 소급 퇴원 사고 이후 규약).
 *  ② 채우는 대상은 **서버가 다시 계산한다** — 화면이 보낸 목록을 믿으면 그새 고친 칸을 덮는다([[#77]]).
 *  ③ 빈 칸에만 쓴다 — 두 일괄이 **같은 함수**(`insertSeatFill`)를 타야 중복 방지 규약이 안 갈린다.
 *  ④ **비로그인 PIN 화면엔 '다음 교시'를 안 내려보낸다**(그 경로에 새 정보를 더하지 않는다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const SEAT_DIR = ["src", "app", "(shell)", "attendance", "seat", "[seat]", "_components"];
const board = strip(read(...SEAT_DIR, "seat-board.tsx"));
const saves = strip(read(...SEAT_DIR, "seat-board-saves.ts"));
const jj = strip(read(...SEAT_DIR, "seat-jj-table.tsx"));
const lab = strip(read(...SEAT_DIR, "seat-lab-grid.tsx"));
const extras = strip(read(...SEAT_DIR, "seat-mark-extras.tsx"));
const actions = strip(read("src", "features", "attendance", "seat", "server", "actions.ts"));
const shellPage = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "page.tsx"));
const publicPage = strip(read("src", "app", "(seat)", "seat", "[seat]", "page.tsx"));

describe("① 자동으로 찍지 않는다 — 사람이 누르는 버튼 하나뿐", () => {
  it("쓰기는 버튼 onClick에서만 출발한다(effect·렌더에서 부르지 않는다)", () => {
    expect(board).toContain("onClick={() => fillPrevAbsent()}");
    // 🔴 부르는 자리가 **그 onClick 하나뿐**이어야 한다 — 렌더·effect에서 한 번이라도 부르면
    //    화면을 여는 것만으로 결석이 찍힌다. (보드에 남는 다른 한 곳은 훅 구조분해뿐.)
    expect(board.match(/fillPrevAbsent\(\)/g)).toHaveLength(1);
    expect(board.match(/fillPrevAbsent/g)).toHaveLength(2);
    // 훅 쪽도 마찬가지 — 서버 액션을 부르는 곳은 그 useCallback 하나뿐이다.
    expect(saves).toContain("const fillPrevAbsent = useCallback(");
    expect(saves.match(/fillSeatPrevAbsent\(\{/g)).toHaveLength(1);
  });

  it("후보가 0명이면 버튼을 아예 안 세운다 — '0명 결석'이라 적으면 화면이 거짓말한다", () => {
    expect(board).toContain("prevAbsentWaiting > 0 ?");
  });

  it("버튼 수는 낙관 오버레이를 얹은 뒤 센다 — 방금 출석으로 고친 학생이 남으면 안 된다", () => {
    // 🔴 축이 `r.classId`(놓인 묶음)가 아니라 **`s.homeClassId`(원래 반)**다(2026-09-10 자리 배치 도입) —
    //    드래그로 옮긴 학생의 출결은 언제나 원래 반에 저장되므로, 묶음 id로 세면 옮긴 학생이 늘 '미체크'로
    //    보여 버튼이 실제로 쓰는 수보다 많게 적힌다.
    expect(board).toMatch(/statusOf\(s\.homeClassId, s\) === null &&\s*prevAbsentByCell\[/);
  });
});

describe("② 대상은 서버가 다시 계산한다", () => {
  it("클라이언트는 자리·날짜·교시만 보낸다(학생 목록을 안 싣는다)", () => {
    const call = saves.match(/fillSeatPrevAbsent\(\{[^}]*\}\)/)?.[0] ?? "";
    expect(call).toContain("slotStart: activeStart");
    expect(call).not.toMatch(/student|targets|keys/i);
  });

  it("서버 액션이 순수 규칙을 스스로 돌린다 — 자기가 읽은 하루치로", () => {
    expect(actions).toMatch(
      /prevAbsentFillTargets\(\s*seatDayCells\(day\.periods, day\.rosterByPeriod\),\s*slot,/,
    );
  });

  it("모호한 반(같은 반·같은 시작·다른 종료)은 rosterKeys와 같은 규약으로 뺀다", () => {
    expect(actions).toMatch(/prevAbsentFillTargets\([\s\S]{0,200}ambiguousClassIds\(period\)/);
  });

  it("🔑 화면도 **같은 인자**로 같은 함수를 돌린다 — 갈리면 버튼이 'N명'이라 적고 그보다 적게 쓴다", () => {
    for (const page of [shellPage, publicPage]) {
      expect(page).toMatch(/prevPeriodAbsences\([\s\S]{0,200}ambiguousClassIds\(period\)/);
    }
  });

  it("게이트를 통과한 뒤에만 쓴다(자리·날짜 판정은 기존 문 그대로)", () => {
    expect(actions).toMatch(/fillSeatPrevAbsent[\s\S]{0,600}gateSeatWrite\(input\.seat, input\.date\)/);
  });

  it("🔴 감사로그가 **근거(앞 교시)**를 남긴다 — 이 일괄은 추론이라 근거 없이는 되짚을 수 없다", () => {
    // 앞 교시 기록은 나중에 고쳐질 수 있다 → 그때 "왜 결석으로 찍혔나"의 유일한 단서가 이 값이다.
    expect(actions).toContain("prevStarts,");
    expect(actions).toMatch(/prevByCell\.get\(`\$\{r\.class_id\}\|\$\{r\.student_id\}`\)/);
  });
});

describe("③ 빈 칸에만 쓴다 — 두 일괄이 같은 함수를 탄다", () => {
  it("insertSeatFill이 한 벌이고 일괄 둘이 그것만 부른다", () => {
    expect(actions.match(/async function insertSeatFill\(/g)).toHaveLength(1);
    expect(actions.match(/await insertSeatFill\(supabase, \{/g)).toHaveLength(2);
    // 일괄 경로에 raw insert를 새로 만들지 말 것(중복 방지 규약이 갈린다). 지금 넷 = 한 칸 쓰기 2(본·폴백)
    // + 일괄 2(본·폴백). 늘어나면 그 경로가 이 규약을 안 타는지 먼저 볼 것.
    expect(actions.match(/\.from\("attendance_records"\)\s*\.insert\(/g)?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it("채우기 대상은 미체크 칸뿐이고, 같은 칸은 한 번만 담는다(중복 슬롯 = 출결 행 둘)", () => {
    const pure = strip(read("src", "features", "attendance", "seat", "prev-period.ts"));
    expect(pure).toMatch(/prevAbsentFillTargets[\s\S]*?c\.status !== null/);
    expect(pure).toMatch(/prevAbsentFillTargets[\s\S]*?seen\.has\(key\)/);
  });

  it("자리판 3종 밖 상태(보강 등)를 결석으로 읽지 않는다 — 상태 비교는 'absent' 하나뿐", () => {
    const pure = strip(read("src", "features", "attendance", "seat", "prev-period.ts"));
    expect(pure).toContain('c.status === "absent"');
    expect(pure).not.toMatch(/status\s*(===|!==)\s*"(present|late)"/);
  });
});

describe("④ 비로그인 PIN 화면엔 '다음 교시'가 안 간다", () => {
  it("공개 페이지는 앞 교시 결석만 넘긴다", () => {
    expect(publicPage).toContain("prevAbsentByCell={prevAbsentByCell}");
    expect(publicPage).not.toContain("nextStartByStudent");
    expect(publicPage).not.toContain("nextSeatPeriodByStudent");
  });

  it("로그인 페이지는 둘 다 넘긴다", () => {
    expect(shellPage).toContain("prevAbsentByCell={prevAbsentByCell}");
    expect(shellPage).toContain("nextStartByStudent={nextStartByStudent}");
  });

  it("보드는 prop이 없으면 그 줄을 안 그린다(기본값을 지어내지 않는다)", () => {
    expect(board).toContain("nextStartByStudent?: Readonly<Record<string, string>>");
    expect(board).toContain("prevAbsentByCell?: Readonly<Record<string, string>>");
  });
});

describe("표시는 두 화면이 같은 부품을 쓴다", () => {
  it("랩실·JJ실이 SeatPeriodHints 한 벌을 그린다", () => {
    for (const src of [jj, lab]) expect(src).toContain("<SeatPeriodHints");
  });

  it("임계값 이름이 아니라 실제 교시 시각을 적는다([[#121]])", () => {
    expect(extras).toContain("앞 교시({prevAbsentStart}) 결석");
    expect(extras).toContain("다음 {nextStart}");
    // '직전'·'방금'처럼 시각을 감추는 말을 쓰지 말 것.
    expect(extras).not.toMatch(/방금 결석|직전 교시 결석/);
  });

  it("이미 찍힌 칸엔 앞 교시 결석을 안 적는다(어느 것이 이 교시의 사실인지 헷갈린다)", () => {
    expect(extras).toContain("const showPrev = !!prevAbsentStart && cur === null;");
  });

  it("🔴 두 신호를 한 줄에 잇거나 자르지 않는다 — JJ 출결 칸은 ≈80px이라 뒤엣것이 통째로 사라진다", () => {
    // 적대 리뷰 2026-09-10: `·`로 이어 `truncate`하면 '다음 17:20'이 어떤 창 폭에서도 안 보였다.
    const block = extras.slice(extras.indexOf("export function SeatPeriodHints"));
    expect(block).not.toContain("truncate");
    expect(block.match(/break-keep/g)?.length).toBe(2);
  });

  it("버튼 수는 칸 키로 중복을 접는다 — 서버가 접는 것과 같은 축", () => {
    // 위와 같은 이유로 키의 반 축도 `s.homeClassId`다(서버 `prevAbsentFillTargets`는 수강 반으로 접는다).
    expect(board).toMatch(/new Set\([\s\S]{0,400}seatCellKey\(s\.homeClassId, s\.id\)\)/);
  });
});
