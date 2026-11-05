import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/**
 * 시간표 '읽기' 화면 규칙(원장 2026-11-05, `src/lib/write-lock.ts`) — 읽기 권한이면 쓰기 단추를 그리지 않고,
 * 입력칸은 비활성 + 안내. 판정은 서버 게이트와 같은 함수로 page.tsx(서버)에서 계산해 내린다.
 * 구현 세부가 아니라 "이 문을 지나는가"만 잠근다(리팩터링을 막지 않게).
 */
describe("시간표 읽기 권한 — 쓰기 UI 배선", () => {
  const page = read("src/app/(shell)/timetable/page.tsx");

  it("편집(끌기·저장 바·수업 나누기·나눔 해제)은 서버 게이트와 같은 반 관리(classes full)만 본다 — 시간표 키를 AND하지 않는다", () => {
    expect(page).toContain('const canEdit = rel !== "past" && (await canManageTenant(user.systemRole, "classes"));');
    // 서버 쓰기(moveClassSlots·moveEnrollmentsBatch·수업 나누기·가져오기)는 timetable을 보지 않는다 — 화면만 닫으면 어긋난다.
    expect(page).not.toMatch(/canWriteTenant\(user\.systemRole, "timetable"\)/);
    // 수업 나누기 · 나눔 해제 ×는 canEdit을 이어받는다.
    expect(page).toContain("basicOnly && canEdit ? canSplitClassNow() : false");
  });

  it("영어 '시트에서 가져오기'는 서버 적용 게이트(시트 연동 ∧ classes 쓰기)와 같은 값을 받는다 — 과목만 보지 않는다", () => {
    expect(page).toMatch(/const canApplyStructureImport =\s*\(await canManageSheetSync\(user\.systemRole\)\) && \(await canWriteTenant\(user\.systemRole, "classes"\)\);/);
    expect(page).toContain("canApplyStructureImport={canApplyStructureImport}");
    const toolbar = read("src/app/(shell)/timetable/_components/toolbar-actions.tsx");
    expect(toolbar).toContain("const canStructureImport = supportsStructureImport(subjectKey) && canApplyStructureImport;");
    for (const f of ["src/features/timetable/server/structure-import-actions.ts", "src/features/timetable/server/import-actions.ts"]) {
      expect(read(f)).toContain('canWriteTenant(user.systemRole, "classes")');
    }
  });

  it("Delete '수강 종료' 창은 서버 endSingleEnrollment와 같은 문(canManageStudentStatusNow)까지 본다", () => {
    expect(page).toContain("const canEditRoster = rel !== \"past\" && (await canManageStudentStatusNow());");
    expect(page).toContain("canEndEnrollment={canEditRoster}");
    const board = read("src/app/(shell)/timetable/_components/timetable-board.tsx");
    expect(board).toContain("canEndEnrollment = false,");
    expect(board).toContain("const canEndByKey = canDrag && canEndEnrollment;");
    expect(board).toContain("if (!canEndByKey) return;");
    expect(board).toContain("endTarget && canEndByKey ?");
  });

  it("메모 시트 수식 입력줄 — 읽기면 비활성 + 안내", () => {
    const bar = read("src/features/timetable-memo/ui/formula-bar.tsx");
    expect(bar).toContain("disabled={!canEdit}");
    expect(bar).toContain('writeLockedPlaceholder("timetable")');
    expect(bar).not.toContain("readOnly={!canEdit}");
    const status = read("src/features/timetable-memo/ui/save-status.tsx");
    expect(status).toContain('writeLockedNote("timetable")');
  });
});
