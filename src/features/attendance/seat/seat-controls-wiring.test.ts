import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 자리 출석부 **컨트롤 규약** — 원장 2026-09-10(화면을 보며 지목):
 *  ① *"출결 버튼을 `출석 / 결석 / 지각` 세 개, 같은 크기로"* · *"상태가 바뀌어도 버튼 수·폭이 변하지
 *     않아야"*  ② *"결석이나 지각 이면 … '입력 팝업'이 뜨고 거기 입력하는걸로"*  ③ *"메모가 생기면 …
 *     삼각형"*  ④ *"우클릭해서 특이사항 입력 … 이름 아래쪽에 특이사항"*  ⑤ 출석 상태에서 라벨 겹침
 *  ⑧ *"다음 17:20 이면 무슨 말인지 … 17:20 304호 가야함처럼"*  ⑫ *"실시간 저장도"*.
 *
 * 여기서 잠그는 건 **눈으로만 보이는 성질**이라 단위 테스트로는 안 잡힌다.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const DIR = ["src", "app", "(shell)", "attendance", "seat", "[seat]", "_components"];
const extras = strip(read(...DIR, "seat-mark-extras.tsx"));
/** 교시 사이 신호 줄(앞 교시 결석·다음 행선지·마지막 수업) — `seat-mark-extras.tsx`에서 떼어 낸 제 파일(2026-09-11). */
const hintsSrc = strip(read(...DIR, "seat-period-hints.tsx"));
const lab = strip(read(...DIR, "seat-lab-grid.tsx"));
const jj = strip(read(...DIR, "seat-jj-table.tsx"));
const shellPage = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "page.tsx"));
const publicPage = strip(read("src", "app", "(seat)", "seat", "[seat]", "page.tsx"));
const noteForm = strip(read("src", "features", "onescreen", "components", "attendance-pills.tsx"));
/** 다음 행선지 **조회 층** — 문 두 개(`next-destination.ts`) + 하루치 조회(`next-destination-day.ts`)를 한 덩어리로 본다. */
const nextDest =
  strip(read("src", "features", "attendance", "seat", "server", "next-destination.ts")) +
  strip(read("src", "features", "attendance", "seat", "server", "next-destination-day.ts"));
const nextPure = strip(read("src", "features", "attendance", "seat", "next-destination.ts"));
const destRoom = strip(read("src", "features", "attendance", "seat", "destination-room.ts"));
const chips = strip(read(...DIR, "seat-period-chips.tsx"));
const allDay = strip(read(...DIR, "seat-all-day.tsx"));

describe("① 출결은 세 버튼 · 같은 폭 · 언제나 셋", () => {
  it("세 상태를 목록으로 돌려 그린다 — 상태별 조건부 렌더가 없다", () => {
    expect(extras).toContain('SEAT_MARK_ORDER: readonly SeatStatus[] = ["present", "absent", "late"]');
    expect(extras).toContain("SEAT_MARK_ORDER.map(");
    // 🔴 옛 모양: `cur !== "absent" ? <button …>` — 이미 그 상태면 버튼이 사라져 칸 폭이 출렁였다.
    expect(extras).not.toMatch(/cur !== "(absent|late)" \?/);
  });

  it("폭은 3등분 격자가 정한다(버튼마다 폭을 적지 않는다)", () => {
    expect(extras).toMatch(/grid w-full grid-cols-3/);
    const triad = extras.slice(extras.indexOf("export function SeatMarkTriad"));
    expect(triad).not.toMatch(/\bsize-\d/);
    expect(triad).not.toMatch(/\bmin-w-\[/);
  });

  it("라벨은 두 글자로 통일 — 화면 파일에 한 글자 버튼을 남기지 않는다", () => {
    expect(extras).toContain("{SEAT_LABEL[k]}");
    for (const src of [lab, jj]) {
      expect(src).not.toMatch(/>\s*결\s*</);
      expect(src).not.toMatch(/>\s*지\s*</);
    }
  });

  it("고른 것을 다시 누르면 미체크로 되돌아간다([[#103]] 되돌릴 문을 잠그지 말 것)", () => {
    for (const src of [lab, jj]) expect(src).toContain("const same = cur === next;");
    expect(lab).toContain("onSave(s.homeClassId, s.id, same ? null : next, cur)");
  });

  it("지난 날짜에도 숨기지 않고 잠근다 — 색만으로 뜻을 나르지 않는다", () => {
    expect(lab).toContain("disabled={readOnly || pending}");
    expect(lab).not.toMatch(/\{!readOnly \? \(\s*<SeatMarkTriad/);
  });
});

describe("② 사유는 팝업 — 카드 아래 입력칸이 아니다", () => {
  it("두 화면 모두 팝업 부품을 쓰고, 인라인 입력칸이 없다", () => {
    for (const src of [lab, jj]) {
      expect(src).toContain("<SeatNotePopover");
      expect(src).not.toContain("<SeatReasonInput");
    }
    expect(extras).not.toContain("export function SeatReasonInput");
  });

  it("🔴 사유 없이도 저장된다 — 상태는 팝업이 뜨기 **전에** 저장된다", () => {
    // onSave(상태) 가 setNoteOpen(…) 보다 먼저 온다.
    for (const src of [lab, jj]) {
      const i = src.indexOf("const same = cur === next;");
      const save = src.indexOf("onSave(", i);
      const open = src.indexOf("setNoteOpen", i);
      expect(save).toBeGreaterThan(-1);
      expect(open).toBeGreaterThan(save);
    }
  });

  it("🔴 비로그인 공개 화면의 팝업은 PIN_NOTE_SEATS(랩실)에서만 열린다 — 원장 2026-09-10 '읽기·쓰기 둘 다 열기'", () => {
    expect(lab).toContain("if (showReason && !readOnly) setNoteOpen(true);");
    expect(jj).toContain("const canNote = showReason && !readOnly;");
    expect(publicPage).toContain("publicPin={!PIN_NOTE_SEATS.includes(seat)}");
  });

  it("폼은 수학·영어 시트와 **같은 것**(NoteForm) — 두 화면이 다른 낱말을 쓰지 않게", () => {
    expect(extras).toContain('from "@/features/onescreen/components/attendance-pills"');
    expect(extras).toContain("<NoteForm");
  });
});

describe("③ 메모가 있으면 모서리 삼각형", () => {
  it("한 글자라도 있을 때만 뜬다", () => {
    expect(extras).toContain("if (!note || !note.trim()) return null;");
  });
  it("의미색이 아니다 — 무채색 채움(출결 색과 다투지 않게)", () => {
    const mark = extras.slice(extras.indexOf("export function SeatMemoMark"));
    expect(mark).toContain("--neutral-fill");
    expect(mark).not.toMatch(/border-t-(green|amber|danger|primary)/);
    // 카드 클릭·드래그를 가로채지 않는다.
    expect(mark).toContain("pointer-events-none");
  });
  it("두 화면이 같은 부품을 쓴다", () => {
    for (const src of [lab, jj]) expect(src).toContain("<SeatMemoMark");
  });
});

describe("④ 우클릭 = 특이사항 · 이름 아래 한 줄", () => {
  it("`preventDefault`는 **못 여는 칸에서도 항상** 부른다(브라우저 메뉴가 뜨면 드래그가 죽는다)", () => {
    for (const src of [lab, jj]) {
      const i = src.indexOf("onContextMenu");
      const block = src.slice(i, i + 220);
      expect(block).toContain("e.preventDefault();");
      // 조건이 preventDefault보다 앞서면 안 된다(잠긴 칸에서 메뉴가 뜬다).
      expect(block.indexOf("e.preventDefault();")).toBeLessThan(
        block.indexOf("setNoteOpen") === -1 ? Number.MAX_SAFE_INTEGER : block.indexOf("setNoteOpen"),
      );
    }
  });

  it("특이사항은 이름 아래에서 **잘리고**, 마우스 오버로 전문이 보인다([[#111]] 블록으로)", () => {
    expect(lab).toMatch(/className="block w-full truncate[^"]*" title=\{note\}/);
  });
});

describe("⑤ 카드 위 겹치는 라벨을 없앴다", () => {
  it("이름 위에 절대배치 상태 배지·결/지 버튼이 없다", () => {
    const card = lab.slice(lab.indexOf("function SeatCard"));
    expect(card).not.toContain("absolute top-1.5 right-2");
    expect(card).not.toContain("absolute top-1.5 right-1.5");
  });
});

describe("⑧ 다음 행선지 = 시각 + 강의실", () => {
  it("방을 모르면 시각만 적는다 — 지어내지 않는다", () => {
    expect(hintsSrc).toContain('{nextStart} {nextRoom ? `${nextRoom} 이동` : "다음 수업"}');
  });
  it("강의실 이름은 등록된 정본으로 정규화한다([[#115]]) — 순수 규칙 한 곳(`destinationRoomOf`)에서", () => {
    expect(destRoom).toContain("canonicalRoomName(");
    expect(nextDest).toContain("destinationRoomOf(");
  });
  it("🔴 배치에 방이 없으면 반 기본 강의실 — 배치 조회의 컬럼 임베드로(원장 2026-09-11 '이도윤B … 강의실이 없고?')", () => {
    expect(nextDest).toContain("class:class_id ( class_name, classroom:classroom_id ( name ) )");
    expect(nextDest).toContain("classRoom: one(klass?.classroom)?.name ?? null");
    // 자리 배치는 반 기본 강의실을 물려받지 않는다(반의 방 ≠ 자리의 방 — 지어낸 방).
    expect(destRoom).toContain("if (src.seatLabel) return null;");
  });
  it("🔴 1,000행 침묵 절단 방지 — 수강·배치 조회는 청크 × 페이징(잘리면 '마지막 수업'이 거짓으로 선다)", () => {
    expect(nextDest).not.toContain("fetchInChunks");
    expect(nextDest.match(/\.order\("id"\)\.range\(from, to\)/g)).toHaveLength(2);
  });
  it("공개 PIN 화면에도 같은 조회로 내려간다 — 원장 2026-09-10 'seat/lab에서도 자리 출석부와 동일해야해'", () => {
    expect(shellPage).toContain("nextRoomByStudent={nextBySlot[");
    expect(publicPage).toContain("nextRoomByStudent=");
    expect(publicPage).toContain("getSeatNextDestinationsBySlot(");
    // 🔴 PIN 다음 행선지는 랩실(`PIN_NOTE_SEATS`)만 — 지시는 랩실 한정, JJ실 PIN은 종전대로 안 싣는다.
    expect(publicPage).toContain("const sameAsLogin = PIN_NOTE_SEATS.includes(seat);");
    expect(publicPage).toMatch(/sameAsLogin\s*\?\s*getSeatNextDestinationsBySlot\(/);
    // 🔴 PIN은 세션이 없어 테넌트를 넘겨 admin으로 읽는다 — 세 조회 모두에 tenant 필터가 **격리선**이다.
    expect(nextDest).toContain('if (tenantId) q = q.eq("tenant_id", tenantId);');
    expect(nextDest).toContain('if (tenantId) roomQ = roomQ.eq("tenant_id", tenantId);');
  });
  it("이 자리 교시만 보던 것을 오늘 전 과목으로 넓혔다(수강 축 조회)", () => {
    expect(nextDest).toContain('.from("enrollments")');
    // 🔵 '전체' 보기(⑨) 이후 조회는 하루치 한 벌이고, "이보다 늦게 시작" 판정만 교시마다 JS에서 돈다.
    //    2026-09-10(16): 그 판정(접기)은 순수 모듈로 옮겼다(Vitest) — 조회는 교시마다 그 함수를 부른다.
    expect(nextPure).toContain("if (next.start <= after) return;");
    expect(nextDest).toContain("foldNextDestination(loaded, after, opts.stays)");
  });

  it("🔴 이 자리 교시는 교시 선택을 얹은 명단으로 잰다 — 옮겨 나간 랩실을 안내하지 않는다(원장 2026-09-10 '다른 시간으로')", () => {
    // 두 페이지가 **같은 함수·같은 명단**(`applySeatDayChoices`를 거친 `rosterByPeriod`)으로 재료를 만든다 —
    // 원본(`day.rosterByPeriod`)을 넘기면 옮긴 학생이 원래 교시에 남아 옮겨 나간 랩실을 다시 안내한다.
    for (const page of [shellPage, publicPage]) {
      expect(page).toContain("const rosterByPeriod = applySeatDayChoices(day, periodChoiceLoad, date);");
      expect(page).toContain("stays: seatStaysFor(seat, rosterByPeriod)");
      expect(page).not.toContain("seatStaysFor(seat, day.rosterByPeriod)");
    }
    // 교시를 옮기는 자리(랩실)만 이 규칙을 탄다 — JJ실은 옛 동작(배치표 그대로).
    expect(nextPure).toContain("if (!MOVABLE_SEATS.includes(seat)) return undefined;");
    // 조회는 자리 라벨을 함께 받고(단일 소스로 판정), 접기는 이 자리 배치를 빼고 명단의 교시를 넣는다.
    expect(nextDest).toContain("slot_teacher_label, classroom:classroom_id ( name )");
    expect(nextDest).toContain("specialSlotLabel(sl.slot_teacher_label)");
    expect(nextPure).toContain("if (seatLabel && sl.seatLabel === seatLabel) continue;");
    expect(nextPure).toContain("stays.startsByStudent[studentId]");
    // 옮겨 가는 교시의 강의실 — 이 자리 반들을 **같은 배치 조회**에 얹는다(새 왕복 없음, B4·B6).
    expect(nextDest).toContain("const slotClassIds = [...new Set([...classIds, ...seatClassIds])];");
    // 🔴 선언만 보면 안 된다 — 조회가 옛 `classIds`를 받아도 tsc·eslint(경고, 종료 0)·위 줄이 다 통과한다.
    //    재료가 조회까지 가는지(호출부 → 로더 → 배치 조회)를 본다. 동작 잠금은 `server/next-destination.test.ts`.
    expect(nextDest).toContain("loadDaySlots(studentIds, date, opts.tenantId, opts.stays?.classIds ?? [])");
    expect(nextDest).toContain("fetchAllPagedInChunks<SlotRow>(slotClassIds, (chunk, from, to) => {");
    expect(nextDest).not.toMatch(/fetchAllPagedInChunks<SlotRow>\(classIds,/);
  });
});

describe("⑬ 마지막 수업 — 원장 2026-09-11 'LAB이나 JJ가 마지막 수업인 학생들은 마지막 수업이라고 표시하자'", () => {
  const board = strip(read(...DIR, "seat-board.tsx"));

  it("🔴 명시 필드로 — 행선지가 없다는 부재로 추측하지 않는다(모름 ≠ 없음)", () => {
    // 접기가 **조회가 실제로 돈 학생** 중 후보가 하나도 안 남은 학생만 담는다.
    expect(nextPure).toContain(
      "for (const studentId of students) if (!(studentId in startByStudent)) lastByStudent[studentId] = true;",
    );
    // 화면은 그 필드만 본다 — 다음 수업이 있으면 그쪽이 이긴다.
    expect(hintsSrc).toContain("const showLast = !nextStart && last === true;");
    expect(hintsSrc).toContain("마지막 수업");
    // 조회 실패는 모름으로 돌려준다 — 빈 결과를 '마지막 수업'으로 읽지 않는다(화면은 산다).
    expect(nextDest).toMatch(/catch \(err\) \{[\s\S]{0,200}return unknownDay\(afterStarts\);/);
  });

  it("랩실 카드·JJ실 표가 같은 부품 한 벌로 그린다", () => {
    for (const src of [lab, jj]) expect(src).toContain("last={hints.lastByStudent?.[s.id]}");
    expect(board).toMatch(/const hints: SeatPeriodHintData = \{[\s\S]{0,200}lastByStudent,/);
    expect(allDay).toContain("lastByStudent={p.lastByStudent}");
  });

  it("두 페이지가 같은 조회 결과를 넘긴다 — JJ실 PIN은 조회를 안 하니 비어 있다(= 모름)", () => {
    for (const page of [shellPage, publicPage]) {
      expect(page).toContain("lastByStudent={nextBySlot[period.start]?.lastByStudent}");
      expect(page).toContain("lastByStudent: nextBySlot[p.start]?.lastByStudent");
    }
    expect(publicPage).toContain("Promise.resolve<SeatDayDestinations>({ bySlot: {}, classesByStudent: {} })");
  });
});

describe("⑫ 메모는 입력하는 동안 자동 저장(그날 그 교시 기록으로만)", () => {
  it("팝업이 글자마다 저장 콜백을 넘긴다", () => {
    expect(extras).toContain("onDraft={onSave}");
  });
  it("자동 저장일 때는 '취소'를 세우지 않는다 — 이미 저장된 글이라 거짓말이 된다", () => {
    expect(noteForm).toContain("onDraft ? (");
    // 🔴 문구는 **사전**에서 온다 — 이 파일은 강사뷰 en 전환 대상이라 한글 리터럴이 0이어야 한다.
    expect(noteForm).toContain('t("os.att.autosave")');
  });
  it("저장 경로는 기존 `noteOnly` 하나 — 새 경로를 만들지 않는다", () => {
    for (const src of [lab, jj]) expect(src).toContain("onSaveNote(");
  });
});

describe("⑦ JJ실 카드는 속살까지 줄맞춤(`grid-rows-subgrid`)", () => {
  it("부모가 행 셋을 못박고 카드가 그 행을 물려받는다", () => {
    expect(jj).toContain("grid grid-rows-[auto_auto_auto]");
    expect(jj).toContain("row-span-3 grid min-w-0 grid-rows-subgrid");
  });
  it("`items-start`를 쓰지 않는다 — 카드가 내용 높이로 줄면 줄맞춤이 죽는다", () => {
    expect(jj).not.toContain("items-start");
  });
  it("계획 구획이 없는 카드도 그 행을 차지한다(빈 자리)", () => {
    const block = jj.slice(jj.indexOf("{plan && slotPlan ?"));
    expect(block.slice(0, 900)).toContain("<div />");
  });
});

describe("⑨ '전체' 보기 — 하루를 한 번에, 조회는 안 늘린다", () => {
  it("칩 줄은 **한 벌**이고 '전체'는 랩실에서만 선다", () => {
    expect(chips).toContain("export function SeatPeriodChips");
    expect(shellPage).toContain('const allowAllView = seat === "lab";');
    expect(shellPage).toContain("showAll={allowAllView}");
  });
  it("교시마다 조회를 새로 하지 않는다 — 배치·다음 행선지는 하루치 한 벌", () => {
    expect(shellPage).toContain("getSeatPlacementsForDay(user.tenantId, seat, date)");
    expect(shellPage).toContain("getSeatNextDestinationsBySlot(");
    // 교시 수만큼 도는 자리에 조회 함수가 들어가면 안 된다.
    const loop = shellPage.slice(shellPage.indexOf("day.periods.map((p) => ("));
    expect(loop).not.toContain("await ");
  });
  it("🔴 하루치를 한 번에 찍는 일괄 버튼은 만들지 않는다 — 교시 요약 줄 안에만 둔다", () => {
    expect(shellPage).not.toMatch(/fillSeat|일괄|전원 출석/);
  });
  it("'전체'에선 칩 줄을 교시마다 반복하지 않는다", () => {
    // 교시 판은 2026-09-10부터 `SeatAllDay`(바깥 드래그 컨텍스트)가 그린다 — 칩은 위에 한 번뿐이다.
    expect(allDay).toContain("showChips={false}");
    expect(shellPage).toContain("<SeatAllDay");
  });
});
