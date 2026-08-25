import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — JJ 이어받기(듣기 레벨·누적 암기 단어수)가 **조용히 되돌려지지 않게** 잠근다.
 *
 * 잠그는 것은 세 가지다:
 *  ① 쓰기 payload에 `status`·`progress_note`를 **넣지 않는다** — 넣으면 그 학생의 태도·특이사항이
 *    null로 덮여 **기록이 사라진다**(PostgREST upsert는 보낸 컬럼만 SET한다).
 *  ② 대상이 **JJ 교시일 때만** 돈다 — 기본 폼엔 '시험 점수'뿐이고, 그건 그 수업의 결과라 이어받으면
 *    없던 점수를 지어내는 것이 된다.
 *  ③ 두 호출부(주간 시트·오늘 보드)가 서버 응답을 **화면 상태에 머지**한다 — 마크는 클라 state라
 *    `router.refresh()`로는 안 바뀌고, 안 머지하면 "복사했는데 칸이 그대로"로 보인다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/** 주석 줄을 빼고 **실행되는 줄**만 본다(문서에 적힌 문구가 가드를 속이지 않게). */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("JJ 이어받기 배선", () => {
  const server = read("features/class-sheets/server/carry-marks.ts");
  // '내용 복사'의 구현은 2026-08-25에 액션에서 **밑바닥**으로 옮겼다(공개 자리 PIN 문이 같은 함수를
  // 쓰기 위해서다). 게이트만 액션에 남았으므로 이어받기 배선은 여기서 본다.
  const copyImpl = read("features/class-sheets/server/plan-write.ts");

  it("🔴 쓰기 payload에 status·progress_note를 넣지 않는다(넣으면 태도·특이사항이 지워진다)", () => {
    // ⚠️ **upsert 호출 안만** 본다 — 파일 끝까지 자르면 아래 명단 코드의 `status:`(출결 매핑)가 걸려
    //    가드가 헛되이 실패한다(첫 구현이 그랬다). 경계는 payload가 끝나는 onConflict.
    const src = code(server);
    const start = src.indexOf('class_sheet_student_marks").upsert(');
    const end = src.indexOf("onConflict", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const upsert = src.slice(start, end);
    expect(upsert).toContain("listening_level:");
    expect(upsert).toContain("memorized_words:");
    expect(upsert).not.toMatch(/\bstatus:/);
    expect(upsert).not.toMatch(/progress_note:/);
  });

  it("🔴 JJ(selfStudy) 교시가 아니면 아무것도 안 한다", () => {
    expect(code(server)).toMatch(/form !== "selfStudy"/);
    // 판정 입력은 슬롯 라벨 하나 — 반 이름·강의실로 추측하지 않는다(roster-form과 같은 규약).
    expect(code(server)).toContain("rosterFormOf(");
    expect(code(server)).not.toMatch(/class_name|classroom/);
  });

  it("그 날짜에 유효한 슬롯만 본다(class_schedules는 운영 이력을 함께 담는다 — #88)", () => {
    expect(code(server)).toContain("valid_from");
    expect(code(server)).toContain("valid_to");
  });

  it("🔴 출결은 정정을 접은 뒤 본다(append-only 표 — 접지 않으면 정정된 옛 결석이 학생을 뺀다)", () => {
    expect(code(server)).toContain("effectiveAttendanceRecords(");
    // 접기에 필요한 칼럼이 select에 다 실려야 한다(빠지면 최신 행을 못 고른다).
    for (const col of ["id", "slot_start", "status", "recorded_at"]) {
      expect(code(server)).toContain(col);
    }
    // 명단 규칙(결석 제외)은 순수 모듈이 갖는다.
    expect(code(server)).toContain("carryRoster(");
  });

  it("덮어쓰기 판정은 순수 모듈이 한다(액션이 자기 규칙을 따로 만들지 않게)", () => {
    expect(code(server)).toContain("planCarryMarks(");
    expect(code(copyImpl)).toContain("carrySelfStudyMarks(");
  });

  it("이어받기 실패가 계획 복사를 죽이지 않는다(사유만 돌려준다)", () => {
    expect(code(copyImpl)).toContain("carryError: carry.error");
    // 복사 경로는 carry 결과로 ok:false를 만들지 않는다 — 계획 복사는 이미 성공했다.
    expect(code(copyImpl)).not.toContain("if (carry.error) return { ok: false");
  });

  it("호출부가 응답을 화면 상태에 머지한다(refresh만으론 안 바뀐다)", () => {
    // 계획 줄 기계(주간·오늘 시트 + 자리 출석부 JJ 열이 함께 쓴다)가 서버 응답을 호스트로 넘긴다.
    const machine = code(read("features/class-sheets/components/use-plan-handlers.ts"));
    expect(machine).toContain("r.carried");
    expect(machine).toContain("onCarried?.(planDate, slotStart, r.carried)");
    // 주간 시트: 이어받은 값을 마크 상태에 직접 머지
    const weekly = code(read("features/class-sheets/components/sheet-client.tsx"));
    expect(weekly).toContain("listeningLevel: p.listeningLevel");
    expect(weekly).toContain("memorizedWords: p.memorizedWords");
    // 오늘 보드: 버튼 → 보드로 콜백
    const todayBtn = code(read("features/class-sheets/components/today-copy-slot.tsx"));
    expect(todayBtn).toContain("onCarried?.(slotStart, r.carried)");
    const board = code(read("features/class-sheets/components/today-board.tsx"));
    expect(board).toContain("onCarried={(slotStart, patches)");
    expect(board).toContain("saveMark(");
    // 자리 출석부(JJ): 블록 → 보드 오버레이. 오버레이는 두 칸만 담는 그릇이라 태도·특이사항에 닿지 않는다.
    const seatSaves = code(read("app/(shell)/attendance/seat/[seat]/_components/seat-board-saves.ts"));
    expect(seatSaves).toContain("applyCarried");
    expect(seatSaves).toContain("for (const field of JJ_MARK_FIELDS) cur[field] = p[field];");
  });

  it("머지가 태도·특이사항·시험 점수를 건드리지 않는다(있던 값 그대로)", () => {
    for (const rel of [
      "features/class-sheets/components/sheet-client.tsx",
      "features/class-sheets/components/today-board.tsx",
    ]) {
      const src = code(read(rel));
      const at = src.indexOf("listeningLevel: p.listeningLevel");
      expect(at).toBeGreaterThan(-1);
      // 같은 객체 리터럴 안에서 태도·특이사항·점수를 **있던 값**으로 잇는다.
      const around = src.slice(Math.max(0, at - 400), at);
      expect(around).toMatch(/status: had\?\.status \?\? null/);
      expect(around).toMatch(/progressNote: had\?\.progressNote \?\? null/);
      expect(around).toMatch(/score: had\?\.score \?\? null/);
    }
  });
});
