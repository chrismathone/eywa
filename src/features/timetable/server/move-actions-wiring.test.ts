import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const SRC = "src/features/timetable/server/move-actions.ts";

/**
 * 반 블록 이동 저장 경로의 **문**들 — 화면에서만 잠근 것은 잠근 게 아니다([[#77]]).
 * 구현 세부가 아니라 "이 게이트를 통과하는가"만 잠근다(리팩터링을 막지 않게).
 */
describe("반 배치 이동(moveClassSlots) 배선", () => {
  const src = read(SRC);

  it("게이트는 classes **manage** — canWriteTenant(scoped 강사 통과)를 쓰지 않는다", () => {
    expect(src).toContain('canManageTenant(user.systemRole, "classes")');
    // ⚠️ **호출 형태**로 본다 — 주석에 적힌 경고 문구(`canWriteTenant`는 …)까지 걸리면 가드가 자기 문서를 막는다.
    expect(src).not.toContain("canWriteTenant(");
  });

  it("갈 수 있는 자리인지 **서버가 다시 판정**한다 — 화면과 같은 함수", () => {
    // 화면 색인은 페이지를 연 시점의 스냅샷이라, 그사이 남이 넣은 배치와 부딪힐 수 있다.
    expect(src).toContain("moveBlockers(");
    expect(src).toContain("buildClassMoveIndex(");
    // 강사 근무 블록(감독·회의·연차)도 같이 태운다 — 안 태우면 서버가 화면보다 느슨해진다.
    expect(src).toContain("getTeacherScheduleBlocks(");
  });

  it("적용일 이후 그 교시에 매달린 기록을 본다([[#126]]) — 요일까지 · 출결은 거절, 나머지는 함께 옮긴다(원장 2026-10-28 (가)안)", () => {
    expect(src).toContain("SLOT_ANCHORS");
    expect(src).toContain("const slot = String(row.start_time)");
    expect(src).toContain('.eq("slot_start", slot)');
    expect(src).toContain("weekdayOf(d) !== row.day_of_week");
    const anchors = read("src/features/timetable/lib/slot-anchors.ts");
    for (const t of ["attendance_records", "class_sheet_plan_lines", "class_sheet_student_marks", "class_lesson_shifts"]) expect(anchors).toContain(`"${t}"`);
    // 출결(carry 없음)은 막힘 안내로, 나머지는 함께 옮길 목록으로.
    expect(src).toContain("slotAnchorBlockText(");
    expect(src).toContain("carryOffset(row.day_of_week, w.day, effective)");
  });

  it("🔴 함께 옮기기는 판정을 다 끝낸 뒤에 쓴다 — 덮어쓰지 않음(차지한 자리) · 쓰는 순서 · 실패하면 기록과 배치를 함께 되짚는다", () => {
    const lf = src.replace(/\r\n/g, "\n"); // 작업 사본은 CRLF일 수 있다(autocrlf) — 줄을 넘는 검사는 LF로 맞춰 본다.
    const at = (s: string) => lf.indexOf(s);
    const insertNew = '.from("class_schedules")\n      .insert(';
    // 판정(차지한 자리·순서) → 배치 쓰기 → 기록 옮기기 순서.
    expect(at("carryConflicts(carry, occupants)")).toBeGreaterThan(0);
    expect(at("carryRounds(carry)")).toBeGreaterThan(at("carryConflicts(carry, occupants)"));
    expect(at(insertNew)).toBeGreaterThan(at("carryRounds(carry)"));
    expect(at("for (const round of rounds)")).toBeGreaterThan(at(insertNew));
    // 되돌리기 일지에 기록 옮기기가 들어가고, 되짚을 때 원래 (날짜, 교시)로 쓴다.
    expect(src).toContain('kind: "carried"');
    expect(src).toContain("carryPatch(j.table, j.fromDate, j.fromSlot)");
    expect(src).toContain('await undoneText("기록을 새 교시로 옮기지 못해 배치와 기록을")');
    // 쓰기·되짚기 모두 그 반으로 좁힌다.
    expect(lf.match(/\.in\("id", (?:g|j)\.ids\)\n\s*\.eq\("tenant_id", user\.tenantId\)\n\s*\.eq\("class_id", classId\)/g)?.length).toBe(2);
  });

  it("함께 옮긴 기록을 감사로그(한글 요약)와 화면에 알린다", () => {
    expect(src).toContain("carried, carriedCounts");
    const board = read("src/app/(shell)/timetable/_components/timetable-board.tsx");
    expect(board).toContain("res.carried");
    expect(board).toContain("{notices[0]}");
  });

  it("오늘 수업이 있는 교시는 오늘부터 옮기지 않는다 · 분리등원 학생이 있으면 요일을 바꾸지 않는다(리뷰 2026-10-28)", () => {
    expect(src).toMatch(/effective === today && windows\.some\(\(w\) => byId\.get\(w\.slotId\)!\.day_of_week === weekdayOf\(today\)\)/);
    expect(src).toContain("daySplitStudents(");
    expect(src).toContain('.from("enrollments")');
    expect(src).not.toContain("등원 요일을 먼저 정리해 주세요"); // 등원 요일 편집은 반의 지금 요일만 고른다 — 맞는 순서가 없다
  });

  it("🔴 시간표 화면이 실패 **이유**를 그린다 — 개수만 그리면 막힘 안내가 사용자에게 닿지 않는다(리뷰 2026-10-28)", () => {
    const board = read("src/app/(shell)/timetable/_components/timetable-board.tsx");
    expect(board).toContain("{failed[0]}");
    expect(board).not.toContain("실패(시간겹침 등)");
  });

  it("옛 행은 마감하고 새 행을 넣는다(temporal) — 제자리 수정이 아니다", () => {
    expect(src).toContain("valid_to: cutoff");
    expect(src).toContain("valid_from: effective");
    // 교시 이름은 시각을 못 따라가므로 버린다.
    expect(src).toContain("period_label: null");
  });

  it("감사로그를 남긴다", () => {
    expect(src).toContain('action: "class_schedule_move"');
    const audit = read("src/features/audit/server/log.ts");
    // 화면에 영문 키가 그대로 나가지 않게 한글 라벨이 등록돼 있어야 한다.
    expect(audit).toContain("class_schedule_move:");
  });

  it("과거 적용일은 거절한다(소급하면 지난 출결이 어긋난다)", () => {
    expect(src).toContain("effective < today");
  });
});
