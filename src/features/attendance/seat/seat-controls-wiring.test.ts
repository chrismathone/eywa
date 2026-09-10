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
const lab = strip(read(...DIR, "seat-lab-grid.tsx"));
const jj = strip(read(...DIR, "seat-jj-table.tsx"));
const shellPage = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "page.tsx"));
const publicPage = strip(read("src", "app", "(seat)", "seat", "[seat]", "page.tsx"));
const noteForm = strip(read("src", "features", "onescreen", "components", "attendance-pills.tsx"));
const nextDest = strip(read("src", "features", "attendance", "seat", "server", "next-destination.ts"));

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

  it("🔴 비로그인 공개 화면에선 팝업이 열리지 않는다", () => {
    expect(lab).toContain("if (showReason && !readOnly) setNoteOpen(true);");
    expect(jj).toContain("const canNote = showReason && !readOnly;");
    expect(publicPage).toContain("publicPin");
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
    expect(extras).toContain('{nextStart} {nextRoom ? `${nextRoom} 이동` : "다음 수업"}');
  });
  it("강의실 이름은 등록된 정본으로 정규화한다([[#115]])", () => {
    expect(nextDest).toContain("canonicalRoomName(");
  });
  it("🔴 로그인 화면에만 내려간다 — 공개 PIN엔 동선을 안 보낸다", () => {
    expect(shellPage).toContain("nextRoomByStudent={nextRoomByStudent}");
    expect(publicPage).not.toContain("nextRoomByStudent");
    expect(publicPage).not.toContain("getSeatNextDestinations");
  });
  it("이 자리 교시만 보던 것을 오늘 전 과목으로 넓혔다(수강 축 조회)", () => {
    expect(nextDest).toContain('.from("enrollments")');
    expect(nextDest).toContain('.gt("start_time", after)');
  });
});

describe("⑫ 메모는 입력하는 동안 자동 저장(그날 그 교시 기록으로만)", () => {
  it("팝업이 글자마다 저장 콜백을 넘긴다", () => {
    expect(extras).toContain("onDraft={onSave}");
  });
  it("자동 저장일 때는 '취소'를 세우지 않는다 — 이미 저장된 글이라 거짓말이 된다", () => {
    expect(noteForm).toContain("onDraft ? (");
    expect(noteForm).toContain("자동 저장됩니다");
  });
  it("저장 경로는 기존 `noteOnly` 하나 — 새 경로를 만들지 않는다", () => {
    for (const src of [lab, jj]) expect(src).toContain("onSaveNote(");
  });
});
