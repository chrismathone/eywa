import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 자리 **배치**(드래그로 옮긴 자리) 구조 가드 — 원장 2026-09-10.
 *
 * 순수 규칙은 `placement.test.ts`가 잡는다. 여기는 **배선**을 잠근다: 게이트·감사로그·공개 화면 제외·
 * 출결 불변·서버 재계산. 이 다섯은 값이 아니라 "어느 코드를 거치는가"라서 단위 테스트로는 안 잡힌다.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
/** 주석을 걷어낸 본문 — 주석에 적힌 단어가 가드를 통과시키지 않게. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ACTIONS = strip(read("src", "features", "attendance", "seat", "server", "placement-actions.ts"));
const QUERY = strip(read("src", "features", "attendance", "seat", "server", "placements.ts"));
const PURE = strip(read("src", "features", "attendance", "seat", "placement.ts"));
const BOARD = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "_components", "seat-board.tsx"));
const LAB = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "_components", "seat-lab-grid.tsx"));
const DRAG = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "_components", "seat-drag.ts"));
const ALL_DAY = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "_components", "seat-all-day.tsx"));
const SHELL_PAGE = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "page.tsx"));
const PUBLIC_PAGE = strip(read("src", "app", "(seat)", "seat", "[seat]", "page.tsx"));
const GATE = strip(read("src", "features", "attendance", "seat", "server", "move-gate.ts"));
const PERIOD_ACTIONS = strip(read("src", "features", "attendance", "seat", "server", "period-actions.ts"));
const AUDIT = read("src", "features", "audit", "server", "log.ts");

describe("① 출결과 다른 축 — 배치는 attendance_records를 건드리지 않는다", () => {
  it("배치 액션은 출결 표를 아예 읽지도 쓰지도 않는다", () => {
    expect(ACTIONS).not.toContain("attendance_records");
    expect(QUERY).not.toContain("attendance_records");
  });

  it("배치 액션에 출결 상태(present/absent/late)가 등장하지 않는다", () => {
    expect(ACTIONS).not.toMatch(/"(present|absent|late)"/);
  });

  it("수강 반이동 RPC를 부르지 않는다 — 자리 화면은 출결 전용이라는 상위 결정 그대로", () => {
    for (const src of [ACTIONS, QUERY, PURE, LAB, BOARD]) {
      expect(src).not.toContain("move_enrollments_batch");
      expect(src).not.toContain("moveEnrollmentsBatch");
      expect(src).not.toContain("enrollments");
    }
  });
});

describe("② 게이트 — 옮길 수 있는 사람만, 되돌릴 수도 있다", () => {
  it("이동 계열 **전부**가 같은 문 한 벌을 지난다 — 배치·초기화·교시 선택", () => {
    // 🔴 문은 `move-gate.ts` 하나다(2026-09-10 교시 선택이 생기며 뽑아냈다) — 두 벌이면 언젠가
    //    한쪽만 조여지고, 그때 화면은 아무 말도 안 한다.
    expect(GATE).toContain("gateSeatWrite");
    // ⚠️ 옛 `moveSeatStudent`(같은 교시 안 배치 드래그)는 원장 2026-09-11로 쓰기 경로째 없앴다(③) — 남은 쓰기
    //    셋이 같은 문을 지난다. 찾는 함수가 없으면 `slice(-1)`이 한 글자라 아래 검사가 헛돌지 않게 길이도 본다.
    const fns = [
      ACTIONS.slice(ACTIONS.indexOf("export async function resetSeatPlacements")),
      PERIOD_ACTIONS.slice(PERIOD_ACTIONS.indexOf("export async function moveSeatStudentPeriod")),
      PERIOD_ACTIONS.slice(PERIOD_ACTIONS.indexOf("export async function clearSeatPeriodChoices")),
    ];
    for (const fn of fns) expect(fn.length).toBeGreaterThan(40);
    for (const fn of fns) expect(fn).toContain("gateSeatMoveWrite(");
    // 🔴 게이트 파일은 서버 액션이 아니다([[#119]]) — 되면 화면이 직접 불러 tenantId·userId를 받는다.
    expect(GATE).not.toContain("use server");
  });

  it("🔴 비로그인 공개 PIN 갈래는 거절한다 — 감사로그에 실행자를 못 남기는 동작은 열지 않는다", () => {
    expect(GATE).toMatch(/via === "pin"/);
    expect(GATE).toContain("로그인한 뒤에만");
  });

  it("공개 화면은 배치를 **보기만** 한다 — 드래그를 열지 않는다", () => {
    expect(PUBLIC_PAGE).toContain("placements={placements.rows}");
    // '전체' 보기(원장 2026-09-10 'seat/lab에서도 자리 출석부와 동일')가 SeatAllDay를 쓰면서 이동 prop이 생겼다 —
    // 값은 언제나 false여야 한다(PIN엔 감사로그에 남길 사람이 없다: 원장 '이것도 감사로그에 남아야함').
    expect(PUBLIC_PAGE).toContain("canMove={false}");
    expect(PUBLIC_PAGE).toContain("canMovePlacement={false}");
    // 🔴 이동 prop은 **모두 리터럴 false**여야 한다 — `canMove={placementsDay.ready}`처럼 다른 식이 들어오면 PIN에서
    //    드래그가 열린다(적대적 리뷰 2026-09-10: 옛 가드는 `={true}`·`={can…`만 막아 그런 식이 통과했다).
    const moveProps = [...PUBLIC_PAGE.matchAll(/canMove(?:Placement)?=\{([^}]*)\}/g)].map((m) => m[1]);
    expect(moveProps.length).toBeGreaterThan(0);
    expect(moveProps.every((v) => v === "false")).toBe(true);
    expect(PUBLIC_PAGE).not.toMatch(/canChoosePeriod=/);
    expect(PUBLIC_PAGE).not.toContain("onClearPeriodChoices");
    // JSX 축약형(`<SeatBoard canMove />`)은 `={…}`가 없어 위 검사를 비껴간다 — 이름만 서도 참이다.
    expect(PUBLIC_PAGE).not.toMatch(/\scanMove(?:Placement)?(?=[\s/>])/);
    expect(PUBLIC_PAGE).not.toMatch(/\bcanChoosePeriod\b/);
    expect(PUBLIC_PAGE).not.toContain("moveSeatStudent");
    expect(PUBLIC_PAGE).not.toContain("resetSeatPlacements");
  });

  it("로그인 화면은 랩실 + 오늘(또는 지난 날짜 쓰기 권한) + 표 적용됨일 때만 연다", () => {
    expect(SHELL_PAGE).toMatch(/canMovePlacement\s*=\s*seat === "lab" && !readOnly && placementsDay\.ready/);
  });
});

describe("③ 서버가 대상을 다시 계산한다([[#77]])", () => {
  it("🔴 배치를 **새로 만드는** 쓰기는 없다 — 원장 2026-09-11 '같은 시간대의 수업으로 옮기고 싶은게 아니야'", () => {
    // 옛 `moveSeatStudent`(같은 교시 안 옆 반 묶음으로 끌기)는 클라 호출자와 함께 없앴다 — 호출자 없는 서버 액션은
    // 그 자체로 열린 문이다. 드래그의 뜻은 다른 시간 하나(`moveSeatStudentPeriod`).
    expect(ACTIONS).not.toMatch(/export async function moveSeatStudent\(/);
    expect(ACTIONS).not.toContain(".upsert(");
    expect(ACTIONS).not.toContain("validateSeatMove");
    expect(PURE).not.toContain("export function validateSeatMove");
    // 남은 쓰기(초기화)는 지우기만 한다 — 이미 옮겨 둔 줄을 되돌릴 길은 남긴다(고아 금지).
    expect(ACTIONS).toContain('.from("seat_placements")');
    expect(ACTIONS).toContain(".delete()");
  });

  it("초기화는 화면이 준 학생 목록을 쓰지 않는다 — 자리·날짜·교시(·반)만 받는다", () => {
    const reset = ACTIONS.slice(ACTIONS.indexOf("export async function resetSeatPlacements"));
    expect(reset).toMatch(/classId\?:\s*string/);
    expect(reset).not.toMatch(/input\.studentIds/);
    expect(reset).toContain("applySeatPlacements(rosters, load.rows)");
    expect(reset).toContain("seatResetTargets(applied, input.classId)");
  });

  it("반별·전체가 **한 액션·한 판정**이다(두 벌이면 언젠가 한쪽만 고쳐진다)", () => {
    expect(ACTIONS.match(/export async function resetSeatPlacements/g)).toHaveLength(1);
    expect(ACTIONS).not.toContain("resetSeatClassPlacements");
    // 화면도 같은 함수를 부르고 범위만 다르게 넘긴다.
    expect(BOARD).toContain("resetPlacements(");
    expect(LAB).toContain("onResetClass");
  });
});

describe("④ 감사로그 — 옮긴 것도 되돌린 것도 남는다", () => {
  it("초기화는 logAction을 부른다 — 배치 쓰기는 이제 초기화 하나뿐이다(2026-09-11)", () => {
    expect(ACTIONS).toContain('action: "seat_placement_reset"');
    // 옛 드래그 이동 로그는 **쓰기 경로와 함께** 없어졌다 — 과거 행은 레지스트리가 계속 한글로 읽는다(아래).
    expect(ACTIONS).not.toContain('action: "seat_placement_move"');
  });

  it("어느 학생이 어느 반에서 어느 반으로 되돌아갔는지 남는다 — 옛 이동 로그와 같은 모양(`moves`)", () => {
    expect(ACTIONS.match(/moves:/g)?.length).toBeGreaterThanOrEqual(1);
    expect(ACTIONS).toMatch(/scope:/);
    for (const key of ["seat:", "date:", "slotStart:", "count:"]) expect(ACTIONS).toContain(key);
  });

  it("액션 키가 감사로그 레지스트리에 등록돼 있다(안 하면 화면에 영문 원문이 뜬다)", () => {
    expect(AUDIT).toContain("seat_placement_move:");
    expect(AUDIT).toContain("seat_placement_reset:");
  });

  it("🔴 아무것도 안 바뀌었으면 남기지 않는다(빈 로그 금지)", () => {
    expect(ACTIONS).toContain("if (targets.length === 0) return { ok: true, changed: 0 };");
    expect(ACTIONS).toContain("if (removed === 0) return { ok: true, changed: 0 };");
  });
});

describe("⑤ 드래그와 클릭(출결)은 겹치지 않는다", () => {
  it("문턱은 순수 함수와 **같은 상수**를 쓴다 — 드래그 컨텍스트는 `SeatAllDay` 한 벌(2026-09-11)", () => {
    expect(ALL_DAY).toContain("activationConstraint: { distance: SEAT_DRAG_THRESHOLD_PX }");
    expect(DRAG).toContain("isSeatDragGesture");
    expect(PURE).toContain("export const SEAT_DRAG_THRESHOLD_PX");
  });

  it("드래그 직후의 클릭을 삼킨다 — 안 그러면 옮기면서 출결까지 찍힌다", () => {
    expect(LAB).toContain("onClickCapture={swallowSeatClickAfterDrag}");
    expect(ALL_DAY).toContain("beginSeatDrag()");
    expect(ALL_DAY).toContain("endSeatDrag()");
  });

  it("출결 세 버튼은 드래그 손잡이가 아니다 — 손잡이는 카드 본체 하나뿐", () => {
    // 손잡이(dnd listeners)가 붙는 자리가 한 곳인지. 못 끄는 카드엔 아예 안 붙는다.
    expect(LAB.match(/\{\.\.\.\(canMove \? listeners : \{\}\)\}/g)).toHaveLength(1);
    const marks = LAB.slice(LAB.indexOf("<SeatMarkTriad"));
    expect(marks).not.toContain("listeners");
  });
});

describe("⑥ 저장은 언제나 **원래 반**으로", () => {
  it("랩실 격자가 묶음 id(`r.classId`)로 저장하지 않는다", () => {
    const card = LAB.slice(LAB.indexOf("function SeatCard"));
    expect(card).not.toMatch(/onSave\(r\.classId/);
    expect(card).toMatch(/onSave\(s\.homeClassId/);
    expect(card).toMatch(/statusOf\(s\.homeClassId/);
    expect(card).toMatch(/noteOf\(s\.homeClassId/);
  });

  it("옮겨 온 카드는 어디서 왔는지 적는다 — 화면이 '이 반 학생'이라 거짓말하지 않게", () => {
    expect(LAB).toContain("s.movedFromClassId");
  });
});

describe("⑦ 되돌릴 것이 없으면 버튼이 없다", () => {
  it("반별 [초기화]는 건수가 0이면 안 선다", () => {
    expect(LAB).toContain("canMove && resetCount > 0");
  });
  it("전체 [초기화]도 0건이면 안 서고, 확인을 한 번 받는다", () => {
    expect(BOARD).toContain("canMove && resetAllTargets.length > 0");
    expect(BOARD).toContain("window.confirm(");
  });
  it("반별 초기화엔 확인 창을 두지 않는다(대상이 적고 되돌리기 쉽다)", () => {
    expect(LAB).not.toContain("window.confirm(");
  });
});

describe("⑧ 표가 아직 없어도 화면은 산다([[#95]])", () => {
  it("조회는 throw하지 않고 ready:false로 떨어진다", () => {
    expect(QUERY).toContain("ready: false");
    expect(QUERY).not.toContain("throw");
  });
  it("표 없음과 그냥 실패를 다른 문구로 가른다 — 원인을 단정하지 않는다", () => {
    // 조회는 공용 판정(isMissingRelation — 42P01·PGRST205 + 표 이름, P1-E), 저장은 코드를 직접 본다.
    expect(QUERY).toContain('isMissingRelation(err, "seat_placements")');
    expect(ACTIONS).toContain("42P01");
    expect(ACTIONS).toContain("PGRST205");
  });
  it("배치 조회는 admin + 명시 tenant 필터다([[#104]] — 정책 0개 표)", () => {
    expect(QUERY).toContain("createAdminClient()");
    expect(QUERY).toContain('.eq("tenant_id", tenantId)');
  });
});
