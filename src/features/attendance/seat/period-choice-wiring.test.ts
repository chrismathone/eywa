import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 자리 **교시 선택**(0255a) 구조 가드 — 원장 2026-09-10(① 하루 두 번 도는 반 · ② *"다른 시간으로 이동"*).
 *
 * 순수 규칙은 `period-choice.test.ts`가 잡는다. 여기는 **배선**을 잠근다: 출결·시간표 불변 · 감사로그 ·
 * 공개 화면 제외 · 부분 유니크 금지 · 화면과 서버가 같은 명단을 그린다 · 옮겨 온 학생의 재료는 그날 명단뿐 ·
 * 강사 렌즈가 자리 기록을 담임 값으로 안 센다. 전부 값이 아니라 "어느 코드를 거치는가"라서 단위 테스트로는
 * 안 잡히고, 어긋나도 **에러가 안 난다**.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
/** 주석을 걷어낸 본문 — 주석에 적힌 낱말이 가드를 통과시키지 않게(가드 전체가 문자열 검사다). */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SEAT = ["src", "features", "attendance", "seat"];
const SQL = read("supabase", "migrations", "0255a_seat_period_choice.sql");
const ACTIONS = strip(read(...SEAT, "server", "period-actions.ts"));
const QUERY = strip(read(...SEAT, "server", "period-choice.ts"));
const DAY_QUERY = strip(read(...SEAT, "server", "queries.ts"));
const GATE = strip(read(...SEAT, "server", "gate.ts"));
const SEAT_ACTIONS = strip(read(...SEAT, "server", "actions.ts"));
const PLACE_ACTIONS = strip(read(...SEAT, "server", "placement-actions.ts"));
const PURE = strip(read(...SEAT, "period-choice.ts"));
const DIR = ["src", "app", "(shell)", "attendance", "seat", "[seat]", "_components"];
const BOARD = strip(read(...DIR, "seat-board.tsx"));
const ALL_DAY = strip(read(...DIR, "seat-all-day.tsx"));
const LAB = strip(read(...DIR, "seat-lab-grid.tsx"));
const SHELL_PAGE = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "page.tsx"));
const PUBLIC_PAGE = strip(read("src", "app", "(seat)", "seat", "[seat]", "page.tsx"));
const AXIS = strip(read("src", "features", "attendance", "teacher-axis.ts"));
const ATT_QUERY = strip(read("src", "features", "attendance", "server", "queries.ts"));

describe("① 명단에 보이는 자리만 바뀐다 — 출결·시간표·수강은 한 줄도 안 바뀐다", () => {
  it("교시 선택 액션·조회는 출결·시간표·수강 표를 아예 안 건드린다", () => {
    for (const table of ["attendance_records", "class_schedules", "enrollments"]) {
      expect(ACTIONS).not.toContain(table);
      expect(QUERY).not.toContain(table);
    }
  });

  it("수강 반이동 RPC를 부르지 않는다 — 자리 화면은 출결 전용이라는 상위 결정 그대로", () => {
    for (const src of [ACTIONS, QUERY, PURE, ALL_DAY]) {
      expect(src).not.toContain("move_enrollments_batch");
    }
  });

  it("🔴 세우는 학생은 그날 이 자리 명단에 이미 있는 학생뿐 — 재료는 그 반의 제 교시 명단", () => {
    const byPeriod = PURE.slice(
      PURE.indexOf("export function applySeatPeriodChoicesByPeriod"),
      PURE.indexOf("type SeatCellFields"),
    );
    expect(byPeriod).toContain("homeByClass");
    // 기록 있는 칸도 **제 교시 명단을 도는 반복 안에서만** 꺼낸다 — 명단 밖 학생이 기록만으로 서지 않게.
    expect(byPeriod).toContain("for (const s of home.students");
    expect(byPeriod.indexOf("for (const s of home.students")).toBeLessThan(byPeriod.indexOf("offSlotByCell?.["));
  });

  it("🔴 옮겨 가서 찍힌 칸(offSlotByCell)은 그날 명단 학생의 **이 자리 라벨** 기록에서만 만든다", () => {
    const block = DAY_QUERY.slice(DAY_QUERY.indexOf("const offSlotByCell"), DAY_QUERY.indexOf("const dayLevelFallback"));
    expect(block).toContain("studentsByClass.get(r.class_id)");
    expect(block).toContain("specialSlotLabel(r.seat_label) !== wantLabel");
  });
});

describe("② 감사로그 — 기능 변동은 모두 남는다(원장 지시)", () => {
  it("이동·고정·해제가 전부 `logAction`을 남긴다", () => {
    expect(ACTIONS).toContain("logAction");
    for (const action of ["seat_period_move", "seat_period_pin", "seat_period_clear"]) {
      expect(ACTIONS).toContain(action);
    }
  });

  it("이동 로그는 '다른 시간' 이동인지 담는다 — 하루 두 번 도는 반의 교시 고르기와 갈라 읽힌다", () => {
    expect(ACTIONS).toContain("crossTime: check.crossTime");
  });

  it("🔴 '앞으로도 고정'은 이미 옮긴 뒤에 눌린다 — 학생이 목표 교시에 있으면 고정만 쓴다", () => {
    // 선택을 얹은 명단에선 옮긴 학생이 출발 교시에 없다. 이 갈래가 없으면 고정 버튼이 늘
    // "이 교시 명단에 없는 학생"으로 거절된다(에러는 뜨지만 원인을 알 수 없다).
    expect(ACTIONS).toContain("input.pin === true && findIn(toSlot) !== undefined");
  });

  it("해제 로그는 **무엇을 지웠는지** 담는다 — 지정 로그와 짝지어 읽히게", () => {
    const clear = ACTIONS.slice(ACTIONS.indexOf("export async function clearSeatPeriodChoices"));
    expect(clear).toContain("removedMoves");
    expect(clear).toContain("removedPins");
  });
});

describe("③ 공개 PIN 화면은 **보기만** 한다", () => {
  it("공개 페이지는 교시 선택을 읽되 쓰기 액션을 import하지 않는다", () => {
    expect(PUBLIC_PAGE).toContain("getSeatPeriodChoices");
    expect(PUBLIC_PAGE).not.toContain("moveSeatStudentPeriod");
    expect(PUBLIC_PAGE).not.toContain("clearSeatPeriodChoices");
    // '전체' 보기(원장 2026-09-10 '동일해야해')는 SeatAllDay를 쓰되 **이동을 끈 채**다.
    expect(PUBLIC_PAGE).toContain("<SeatAllDay");
    expect(PUBLIC_PAGE).toContain("canMove={false}");
  });

  it("🔴 두 화면이 **같은 명단**을 그린다 — 로그인 쪽에만 얹으면 서로 다른 사실을 말한다", () => {
    for (const page of [SHELL_PAGE, PUBLIC_PAGE]) {
      expect(page).toContain("resolveSeatPeriodChoices");
      expect(page).toContain("markedSlotsByCell");
    }
  });
});

describe("④ 표 모양 — 부분 유니크 금지([[#113]])와 고정 시작일", () => {
  it("유니크 인덱스에 `where` 술어가 없다 — upsert가 그 축으로 추론해야 한다", () => {
    // 유니크를 만드는 문장 안에 `where`가 있으면 부분 인덱스다 — on conflict 추론이 깨져 전건 42P10.
    const uniqueStatements = SQL.split(";").filter((s) => /unique/i.test(s));
    expect(uniqueStatements.length).toBeGreaterThan(0);
    for (const s of uniqueStatements) expect(s).not.toMatch(/where/i);
    expect(SQL).toContain("unique (tenant_id, seat, session_date, class_id, student_id)");
    expect(SQL).toContain("unique (tenant_id, seat, day_of_week, class_id, student_id)");
  });

  it("upsert의 `onConflict` 축이 유니크와 글자까지 같다", () => {
    expect(ACTIONS).toContain('onConflict: "tenant_id,seat,session_date,class_id,student_id"');
    expect(ACTIONS).toContain('onConflict: "tenant_id,seat,day_of_week,class_id,student_id"');
  });

  it("🔴 고정에는 시작일이 있고, 서버가 **그 화면의 날짜**를 넣는다 — 과거는 기록이다", () => {
    expect(SQL).toContain("effective_from date not null");
    expect(ACTIONS).toContain("effective_from: input.date");
    expect(PURE).toContain("effectiveFrom > v.date");
  });

  it("RLS 정책 0개 규약([[#104]]) — 앱은 admin + 명시 tenant_id로만 읽고 쓴다", () => {
    expect(SQL).toContain("enable row level security");
    expect(SQL).not.toMatch(/create policy/i);
    expect(QUERY).toContain("createAdminClient");
    expect(QUERY).toContain('.eq("tenant_id", tenantId)');
  });
});

describe("⑤ 화면 — 두 축을 섞지 않는다", () => {
  it("명단 필터는 순수 소스 한 벌을 부른다 — 화면이 제 조건을 새로 적지 않는다", () => {
    expect(BOARD).toContain("applySeatPeriodChoices(");
    expect(LAB).not.toContain("applySeatPeriodChoices");
  });

  it("🔴 드래그 컨텍스트는 `SeatAllDay` 한 벌뿐 — 교시 판·격자는 제 `DndContext`를 만들지 않는다", () => {
    // 원장 2026-09-11 — '교시 하나' 보기에서도 다른 시간으로 옮긴다. 판정·낙관 반영·고정 질문이 두 벌이면 두 보기가
    // 다른 말을 한다(종전엔 교시 하나 보기의 격자가 제 컨텍스트로 **같은 시간 배치 이동**만 했다).
    expect(ALL_DAY.match(/<DndContext\b/g)).toHaveLength(1);
    for (const src of [LAB, BOARD]) {
      expect(src).not.toContain("<DndContext");
      expect(src).not.toContain("externalDnd");
    }
  });

  it("🔴 손잡이는 교시 이동(0255a) 가용성만 본다 — 배치(0254a)가 안 돌아도 교시 이동은 산다", () => {
    // 배치를 새로 만드는 드래그가 없어졌으므로(2026-09-11) 배치 가용성이 손잡이를 열 이유도 없다 — 옛 규약
    // ("두 축 중 하나만 열려 있어도")의 목적(0254a 미적용이 교시 이동을 죽이지 않게)은 그대로 더 곧게 선다.
    expect(BOARD).toContain("canDrag={canChoosePeriod}");
    expect(BOARD).not.toContain("canMove || canChoosePeriod");
  });

  it("🔑 다른 교시로는 **떨군 묶음의 반과 무관하게** 옮긴다 — 드롭 데이터는 교시만, 그 반의 다른 수업 시각은 거절", () => {
    expect(ALL_DAY).toContain("verdictOf(card, to.start)");
    expect(LAB).toContain("export type SeatDropTarget = { start: string };");
    expect(PURE).toContain("SEAT_PERIOD_CLASS_BUSY");
    // 옛 규칙(같은 반 자리로만)은 원장이 "같은 시간은 의미없음"으로 뒤집었다 — 되살리지 말 것.
    expect(PURE).not.toContain("SEAT_PERIOD_SAME_CLASS_ONLY");
  });

  it("🔴 같은 교시 안 반 묶음 이동(배치 드래그)은 **없앴다** — 원장 2026-09-11 '같은 시간대의 수업으로 옮기고 싶은게 아니야'", () => {
    // 2026-09-10엔 "지우지 않고 부수 동작으로 남긴다"였다 — 원장이 다음 날 명시로 뒤집었다(가드 약화가 아니라 결정 반영:
    // *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임. 같은 시간대의 수업으로 옮기고 싶은게 아니야."*).
    const MOVES = strip(read(...DIR, "seat-board-moves.ts"));
    expect(ALL_DAY).not.toContain("movesByPeriod");
    expect(ALL_DAY).not.toContain("onRegisterMove");
    expect(BOARD).not.toContain("onRegisterMove");
    expect(MOVES).not.toContain("moveSeatStudent(");
    expect(PLACE_ACTIONS).not.toMatch(/export async function moveSeatStudent\(/);
    // 🔑 이미 있는 줄은 고아가 되지 않게 **표시와 [초기화]가 남는다**.
    expect(MOVES).toContain("resetSeatPlacements(");
    expect(BOARD).toContain("applySeatPlacements(");
  });

  it("🔴 출결이 찍힌 카드는 화면·서버 양쪽에서 막힌다(원장 *절대 불가*)", () => {
    expect(LAB).toContain("seatMoveBlockReason(cur)");
    expect(LAB).toContain("disabled: !canMove || moveBlocked !== null");
    expect(ACTIONS).toContain("seatMoveBlockReason(student.status)");
  });

  it("옮겨 온 묶음은 끝 시각 대신 **어디서 왔는지** 적는다(출결이 원래 반으로 가는 이유)", () => {
    expect(LAB).toContain("r.visiting ?");
    expect(LAB).toContain("다른 시간에서 옴");
  });
});

describe("⑥ 화면과 서버가 같은 명단 — 옮겨 온 학생이 보이는 곳과 찍히는 곳이 같다", () => {
  it("🔴 서버 쓰기 경로(출결 게이트·앞 교시 결석·교시 이동·배치)가 전부 `applySeatDayChoices` 한 벌을 지난다", () => {
    for (const [name, src] of [
      ["gate.ts", GATE],
      ["actions.ts", SEAT_ACTIONS],
      ["period-actions.ts", ACTIONS],
      ["placement-actions.ts", PLACE_ACTIONS],
    ] as const) {
      expect(src, name).toContain("applySeatDayChoices(");
    }
  });

  it("🔴 서버 헬퍼는 옮겨 가서 찍힌 칸·다른 수업 시각·빈 칸 규칙을 빠뜨리지 않는다", () => {
    const helper = QUERY.slice(QUERY.indexOf("export function applySeatDayChoices"));
    expect(helper).toContain("offSlotByCell: day.offSlotByCell");
    expect(helper).toContain("busyStartsByClass: day.busyStartsByClass");
    expect(helper).toContain("blank: blankSeatCell");
  });

  it("교시 하나 보기·'전체' 보기 모두 **얹은 명단**을 보드에 넘긴다", () => {
    expect(SHELL_PAGE).toContain("applySeatDayChoices(");
    expect(SHELL_PAGE).toContain("choicesApplied");
    // 공개 PIN 화면도 같은 명단 — 옮겨 온 학생이 태블릿의 목표 교시에 서야 찍을 수 있다(서버는 받아 준다).
    expect(PUBLIC_PAGE).toContain("applySeatDayChoices(");
    expect(PUBLIC_PAGE).toContain("choicesApplied");
    expect(ALL_DAY).toContain("applySeatPeriodChoicesByPeriod(");
    expect(ALL_DAY).toContain("choicesApplied");
  });

  it("앞 교시 결석 표식은 얹은 명단으로 잰다 — 서버 일괄과 같은 재료", () => {
    expect(SHELL_PAGE).toContain("seatDayCells(day.periods, rosterByPeriod)");
  });
});

describe("⑦ 강사 렌즈 — 자리 기록은 어느 강사 몫도 아니다", () => {
  it("🔴 자리 라벨 행은 누구 몫으로도 안 센다 — 교시 밖 자리 기록이 담임 폴백으로 담임 값에 섞이지 않게", () => {
    expect(AXIS).toContain("if (input.seatLabel?.trim()) return false;");
    expect(ATT_QUERY).toContain("ownsSlot(r.session_date, slot, r.seat_label)");
  });
});

describe("⑧ 드래그 = 다른 시간으로만 — 원장 2026-09-11 'LAB실에서 내가 드래그하고 싶은건 다른 시간대의 수업'", () => {
  const ZONES = strip(read(...DIR, "seat-drop-zones.tsx"));
  const CHIPS = strip(read(...DIR, "seat-period-chips.tsx"));
  const VERDICT = strip(read(...SEAT, "drop-verdict.ts"));
  const STUDENT = strip(read(...SEAT, "student-classes.ts"));

  it("🔴 '교시 하나' 보기(랩실 로그인)도 `SeatAllDay` 한 벌이 그린다 — 교시 칩이 놓을 곳이다", () => {
    expect(SHELL_PAGE).toContain('seat === "lab" ? (');
    expect(SHELL_PAGE).toContain("shownStart={viewAll ? null : period.start}");
    expect(ALL_DAY).toContain("Chip={canMove ? SeatDropChip : undefined}");
    expect(CHIPS).toContain("<Chip");
    // 칩 파일은 서버 페이지도 import한다 — dnd-kit을 여기서 부르면 서버 렌더가 깨진다(조각을 받아 끼울 뿐).
    expect(CHIPS).not.toContain("@dnd-kit");
    // 옮기기가 잠긴 화면(공개 PIN·지난 날짜)에선 놓을 곳이 아예 안 켜진다.
    expect(ALL_DAY).toContain("verdictOf={canMove ? verdictOf : null}");
  });

  it("🔴 같은 시간에 놓으면 아무 일도 없다 — 막힌 게 아니라 취소(빗금 없음·에러 없음)", () => {
    expect(VERDICT).toContain('if (toSlot === card.start) return { kind: "same", text: SEAT_PERIOD_SAME };');
    expect(ALL_DAY).toContain('if (verdict.kind === "same") return;');
    expect(ZONES).toContain('[DRAG_BLOCKED_ATTR]: verdict?.kind === "blocked" ? "1" : undefined');
  });

  it("🔴 미리 표시·끄는 카드 문장·드롭 거절이 **같은 함수**(`verdictOf` → `seatDropVerdict` → `validateSeatPeriodMove`)", () => {
    expect(ALL_DAY).toContain("seatDropVerdict(card, toSlot, verdictInputs)");
    expect(ALL_DAY).toContain("const verdict = verdictOf(card, to.start);");
    expect(ZONES).toContain("ctx.verdictOf(ctx.card, start)");
    expect(ZONES).toContain("seatDragHint(toStart ? ctx.verdictOf(card, toStart) : null)");
    expect(VERDICT).toContain("validateSeatPeriodMove({");
    // 빗금은 시간표와 같은 표식(그림은 globals.css 한 곳) — 새 그림을 만들지 않는다.
    expect(ZONES).toContain('from "@/features/timetable/lib/grid-attrs"');
  });

  it("🔴 끄는 상태를 `SeatAllDay` state에 두지 않는다 — 집는 순간 교시 판 전부가 다시 그려지면 그게 렉이다", () => {
    expect(ALL_DAY).not.toMatch(/useState<CardDrag/);
    expect(ALL_DAY).not.toContain("useDndMonitor");
    expect(ZONES).toContain("useDndMonitor");
  });

  it("🔴 `SeatAllDay`의 key엔 **보기(교시)가 없다** — 자리·날짜뿐(적대 리뷰 2026-09-11)", () => {
    // 교시 칩·'전체' 칩은 같은 날의 보기 전환이다. key에 교시를 넣으면 칩을 누를 때마다 다시 마운트돼 낙관 반영이
    // 버려지고(방금 옮긴 학생이 그 교시에 안 보인다), 기본 착지(시계로 고른 교시)는 새로고침이 교시 경계를 넘는 순간
    // 화면을 갈아엎었다. 동작 잠금은 `seat-all-day.test.tsx`의 '보기를 바꿔도'.
    const keys = [...SHELL_PAGE.matchAll(/<SeatAllDay\s+key=\{`([^`]*)`\}/g)].map((m) => m[1]);
    expect(keys).toEqual(["${seat}|${date}"]);
  });

  it("🔴 고정 질문·호출 장부·에러는 `SeatAllDay` state가 아니라 **가게**에 있다 — 다시 마운트돼도 응답이 버려지지 않는다", () => {
    // 적대 리뷰 2026-09-11: 질문은 서버 응답 **뒤에** 서는데, 그 사이 교시 칩·날짜 화살표·자리 전환을 누르면 화면이 새로
    // 마운트돼 대기열째 버려졌다('고정할까요?'가 끝내 안 떴다). 동작 잠금은 `seat-all-day.test.tsx`의 '다시 마운트돼도'.
    const PIN = strip(read(...DIR, "seat-pin-ask.tsx"));
    expect(ALL_DAY).toContain("useSeatPinView()");
    expect(ALL_DAY).not.toMatch(/useState<readonly SeatPinAsk/);
    expect(ALL_DAY).not.toContain("callSeqRef");
    expect(PIN).toContain("useSyncExternalStore(");
    // 호출·[해제]·응답이 전부 장부 한 벌(`seat-pin-ledger.ts`)을 지난다 — 화면이 번호를 따로 세지 않는다.
    for (const call of ["beginSeatPinMove(target)", "beginSeatPinClear({ seat, date, classId })", "settleSeatPinMove("]) {
      expect(ALL_DAY).toContain(call);
    }
    // '앞으로도 고정'은 **그 질문의 자리·날짜**로 보낸다 — 다른 날 화면에서 답해도 그날로 간다.
    expect(ALL_DAY).toContain("commitPeriodMove({ ...seatPinTargetOf(ask), fromSlot: ask.fromSlot, toSlot: ask.toSlot, pin: true }, null)");
  });

  it("🔴 학생 축 겹침은 화면·서버가 **같은 함수** — 서버는 자기 조회로 다시 채운다([[#77]])", () => {
    const NEXT_SERVER = strip(read(...SEAT, "server", "next-destination.ts"));
    expect(PURE).toContain("seatStudentClash(v.studentClasses, { start: v.toSlot, ends: v.toEnds ?? [] })");
    expect(VERDICT).toContain("studentClasses: v.studentClasses?.[card.studentId]");
    expect(ACTIONS).toContain("getSeatStudentClasses([input.studentId], input.date, input.seat)");
    expect(ACTIONS).toContain("studentClasses: classesLoad.byStudent[input.studentId] ?? []");
    // 서버는 게이트다 — 재료를 못 읽으면 쓰지 않는다(화면의 fail-open과 다르다). 조회 문이 실패를 `ok:false`로 돌려준다.
    expect(ACTIONS).toContain("if (!classesLoad.ok) return { error: classesLoad.error };");
    expect(NEXT_SERVER).toMatch(/catch \(err\) \{[\s\S]{0,200}return \{ ok: false, error: SEAT_STUDENT_CLASSES_FAILED \};/);
    // 겹침 판정은 앱 단일 소스(경계 접촉은 겹침 아님).
    expect(STUDENT).toContain('from "@/features/classes/overlap"');
    // 화면 재료는 로그인 페이지만 싣는다(공개 PIN엔 드래그가 없다).
    expect(SHELL_PAGE).toContain("studentClasses: nextDay.classesByStudent");
    expect(PUBLIC_PAGE).not.toContain("studentClasses");
  });

  it("🔴 목표 교시의 **끝**까지 판정에 간다 — 빠지면 교시 안에서 시작하는 수업(17:00 교시 · 17:20 시작)을 화면·서버가 함께 통과시킨다", () => {
    // 동작 잠금은 `drop-verdict.test`·`period-choice.test`·`server/period-actions.test`·`seat-all-day.test`의 '안에서 시작하는 수업'.
    expect(VERDICT).toContain("toEnds: v.endsByStart[toSlot]");
    expect(ALL_DAY).toContain("endsByStart: Object.fromEntries(periods.map((p) => [p.start, p.ends]))");
    expect(SHELL_PAGE).toMatch(
      /ends: p\.ends,\s*classIds: p\.slots\.map\(\(s\) => s\.classId\),\s*rosters: day\.rosterByPeriod\[p\.start\]/,
    );
    expect(ACTIONS).toContain("toEnds: day.periods.find((p) => p.start === toSlot)?.ends");
  });

  it("🔴 '전체' 보기의 교시 판도 놓을 곳이다 — 판이 가부 표식을 펼치고, 판은 **보이는 자리에서만** 받는다", () => {
    // 원장 2026-09-11 *"아니 드래그는 '전체' 에서도 다른 시간으로 이동하려고하면 경고 문구 뜨면서 안됨"* — 해법은 집는 순간
    // 판마다 가부와 이유가 보이는 것. 동작 잠금은 `seat-all-day.test.tsx`의 '전체' 보기 케이스.
    expect(ALL_DAY).toContain("<SeatPeriodDropZone");
    expect(ZONES).toContain("<div ref={setNodeRef} data-seat-drop-start={start} {...dropAttrs(verdict)}");
    // 스크롤로 가려진 판의 사각형이 칩 줄을 덮어 보이지 않는 교시로 옮겨지던 것(적대 리뷰 2026-09-11) — 판은 판 상자 안에서만.
    expect(ALL_DAY).toContain("seatDropCollision(args, boardsRef.current)");
    expect(ALL_DAY).toContain("ref={boardsRef}");
    expect(ZONES).toContain("if (chips.length > 0) return chips;");
  });

  it("거절(학생 축 포함)은 쓰기·감사로그보다 앞에서 돌아간다 — 새 감사로그 키 없음", () => {
    const reject = ACTIONS.indexOf('if ("error" in check) return check;');
    expect(reject).toBeGreaterThan(-1);
    expect(reject).toBeLessThan(ACTIONS.indexOf('.from("seat_period_moves").upsert('));
    expect(reject).toBeLessThan(ACTIONS.indexOf("await logAction("));
  });
});
