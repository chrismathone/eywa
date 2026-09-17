/**
 * 통합뷰 학생 드래그(반 이동 · 빗금 · 날짜 팝업 · 예약 표시)의 **배선**을 구조로 잠근다.
 *
 * 원장 2026-09-09: *"통합뷰에서도 드래그 기능이 있으니까 빗금도 추가"* → *"드래그만 되고 적용이 안되네.
 * 통합뷰에서도 학생 드래그 기능 추가시켜"*(= 드래그 **이동**) → *"드랍을 하면 날짜지정 팝업"* →
 * *"기존 수업에서는 '연보라색 계열'로 '이동 대기' … 미래에 이동할 반에서는 '대기'생"* →
 * *"'반이동 대기'일 경우에 툴팁에 기존 반이름도 나와있어야함"*.
 *
 * 여기서 잠그는 것은 **어디에 무엇이 붙어 있는가**다 — 화면 픽셀이 아니라, 나중에 누가 조용히
 * 두 번째 저장 경로·두 번째 판정을 만들지 못하게 하는 구조 규칙.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src/app/(shell)/timetable/_components");

/**
 * 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석 자체가 위반으로 걸리지 않게 —
 * `postgrest-embed-hints.test.ts`와 같은 규약).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ 	]*\/\/.*$/gm, "");
}
const read = (f: string) => stripComments(readFileSync(join(DIR, f), "utf8"));

describe("통합뷰 반 이동 — 저장 경로는 기본뷰와 한 벌", () => {
  const roster = read("roster-move.tsx");

  it("명단 드래그가 **자기 저장 경로를 만들지 않는다**(반 이동 RPC 직접 호출 금지)", () => {
    // 반 이동은 큐(`openMoveDate` → `queueMove`) → '저장'에서 `moveEnrollmentsBatch` 한 곳으로만 나간다.
    expect(roster).not.toContain("moveEnrollmentsBatch");
    expect(roster).not.toContain("move_enrollments_batch");
  });

  it("드롭이 **날짜 팝업**을 거친다(떨어뜨리는 것만으로 큐에 안 들어간다)", () => {
    expect(roster).toContain("openMoveDate");
    // 팝업을 건너뛰고 바로 큐에 넣는 우회가 없어야 한다.
    expect(roster).not.toContain("queueMove(");
  });

  it("같은 반에 놓으면 아무 일도 없다(재원 칸 제자리 드롭)", () => {
    expect(roster).toContain('if (target.classId === data.classId)');
    expect(roster).toContain('if (target.kind === "active")');
  });

  it("빗금 판정은 **라우트 핸들러**로 받는다([[#102]] — 서버 액션이면 드래그가 죽는다)", () => {
    expect(roster).toContain("/api/timetable/student-busy");
    expect(roster).toContain("annotateStudentBlocks");
    expect(roster).not.toContain('"use server"');
  });

  it("빗금 판정을 새로 만들지 않는다(기본뷰와 같은 함수)", () => {
    expect(roster).not.toContain("blockedClassesForStudent");
    expect(roster).toContain('from "./grid-drop-cell"');
  });
});

describe("빗금 표식 — 반 카드가 받고 좌표는 숨은 표식이 든다", () => {
  it("카드 뿌리에 반 id 표식이 붙는다(판정 단위 = 반)", () => {
    const card = read("rich-card-group.tsx");
    expect(card).toContain("CLASS_CELL_ID_ATTR");
    expect(card).toContain("CLASS_CELL_NAME_ATTR");
    // 🔴 좌표(요일·시각)는 카드에 안 싣는다 — 카드 하나가 요일·교시 여럿이라 한 좌표로 답할 수 없다.
    expect(card).not.toContain("CLASS_CELL_START_ATTR");
  });

  it("좌표 표식은 통합뷰 루트가 슬롯에서 그린다(화면엔 안 보이게)", () => {
    const view = read("rich-grid-view.tsx");
    expect(view).toContain("classWindowsFromSlots");
    expect(view).toContain("CLASS_CELL_START_ATTR");
    expect(view).toContain("CLASS_CELL_END_ATTR");
    expect(view).toMatch(/<div hidden/);
  });
});

describe("예약 이동 표시 — 색은 토큰 하나, 문구는 함수 하나", () => {
  it("연보라를 화면 파일에 hex로 적지 않는다(movingTone 단일 소스)", () => {
    for (const f of ["rich-card-group.tsx", "student-rows.tsx"]) {
      const src = read(f);
      expect(src).toContain("movingTone");
      // `#a4c2f4`(대기)처럼 손으로 박은 색이 새로 들어오지 않게.
      expect(src).not.toMatch(/text-\[#|bg-\[#/);
    }
  });

  it("툴팁 문구는 두 뷰가 같은 함수를 쓴다(기존 반 이름 포함)", () => {
    for (const f of ["rich-card-group.tsx", "student-rows.tsx"]) {
      expect(read(f)).toContain("savedMoveView");
    }
    expect(read("rich-card-group.tsx")).toContain("moveWaitTitle");
  });

  it("저장 전 큐와 저장된 예약을 **문구로 가른다**(saved 플래그가 실제로 갈려 쓰인다)", () => {
    const card = read("rich-card-group.tsx");
    expect(card).toContain("saved: false"); // 큐(저장 전)
    // 저장된 쪽은 savedMoveView 안에서 saved:true로 만든다 — 화면이 직접 true를 적지 않는다.
    expect(card).not.toContain("saved: true");
  });
});

describe("적용일 — 툴바 값과 건별 값이 갈리지 않는다", () => {
  const board = read("timetable-board.tsx");

  it("저장이 **적용일별로 묶어** 부른다(한 번의 호출에 날짜 하나)", () => {
    expect(board).toContain("resolveApplyDate");
    expect(board).toMatch(/groups\.set|groups\.get/);
  });

  it("툴바 '적용일' 입력을 없애지 않았다(고르지 않은 건들의 기본값)", () => {
    expect(board).toContain('aria-label="이동 적용일"');
  });

  it("성공 토스트는 **큐에 실제로 들어갔을 때만** 뜬다", () => {
    expect(board).toContain("if (queueMove({ ...moveDate, moveOn })) queued(");
  });
});

describe("퇴원 칸 드롭 팝업 — '수강 종료'가 아니라 '마지막 수업일'", () => {
  const roster = read("roster-move.tsx");

  it("제목·날짜 칸이 마지막 수업일이다(퇴원관리 '수강종료' 유형과 안 겹친다)", () => {
    expect(roster).toContain('isWithdraw ? "마지막 수업일"');
    expect(roster).toContain("반 마지막 수업일을 정할까요?");
    expect(roster).not.toContain('isWithdraw ? "수강 종료"');
    expect(roster).not.toContain("반에서 수강 종료할까요?");
    expect(roster).not.toContain('isWithdraw ? "종료일"');
  });

  it("무엇이 되는지(종강·수강종료·퇴원)는 같은 EndScopeNote가 말한다", () => {
    expect(roster).toContain("EndScopeNote");
  });
});
