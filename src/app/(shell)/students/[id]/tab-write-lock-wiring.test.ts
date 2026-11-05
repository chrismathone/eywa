import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 원생 상세 — 읽기 권한이면 탭 안의 쓰기 단추를 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 * 회의록처럼 '읽기'인데 작성 단추가 떠서 다 쓴 뒤에야 "권한이 없습니다"가 뜨던 꼴을 막는다.
 *
 * 페이지를 통째로 그리면 조회·권한 모킹이 열 개가 넘어 **배선만** 고정한다:
 *  · page.tsx가 서버 게이트와 **같은 함수·같은 키**로 계산한다 — 메모·성적·목표·코멘트·레벨테스트·영상 링크 끊기 =
 *    `canWriteTenant("students")`, 상담 = `canWriteTenant("consultations")`. 다른 함수(`canAccessTenant` = 읽기도 참)나
 *    다른 키로 바꾸면 "보이는데 저장이 안 됨"(또는 그 반대)이 다시 생긴다.
 *  · 각 부품은 그 값이 거짓이면 쓰기 단추를 **그리지 않는다**(비활성으로 남기지 않는다) — 입력 폼만 비활성 + 안내.
 */
const read = (p: string) => readFileSync(join(process.cwd(), "src/app/(shell)/students/[id]", p), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const page = read("page.tsx");

describe("원생 상세 탭 — 읽기 권한이면 쓰기 단추를 그리지 않는다", () => {
  it("쓰기 판정은 서버 게이트와 같은 함수·같은 키로 page.tsx가 계산한다", () => {
    expect(page).toContain('canWriteTenant(user.systemRole, "students"),');
    expect(page).toContain('canWriteTenant(user.systemRole, "consultations")');
    expect(page).toContain("<MemosTab studentId={student.id} canWrite={canWriteStudent} />");
    expect(page).toMatch(/<GradesTab [^>]*canWrite=\{canWriteStudent\}/);
    expect(page).toContain("<HomeworkVideoLinks studentId={student.id} canRevoke={canWriteStudent} />");
    expect(page).toMatch(/<ConsultationsTab\s+studentId=\{student\.id\}\s+canWrite=\{canWriteConsultation\}/);
  });

  it("탭은 받은 값을 부품마다 그대로 내린다", () => {
    const memos = read("_tabs/memos-tab.tsx");
    expect(memos).toContain("<MemoForm studentId={studentId} canWrite={canWrite} />");
    expect(memos).toContain("canWrite={canWrite} />");
    const grades = read("_tabs/grades-tab.tsx");
    for (const part of ["GoalsSection", "GradeForm", "GradeCommentsSection", "LevelTests"]) {
      expect(grades).toMatch(new RegExp(`<${part} [^>]*canWrite=\{canWrite\}`));
    }
    expect(grades).toMatch(/goals=\{goalViews\} canWrite=\{canWrite\} \/>/);
  });

  it("🔴 쓰기 단추는 값이 참일 때만 선다(비활성으로 남기지 않는다)", () => {
    expect(read("_components/memo-form.tsx")).toMatch(/\{canWrite \? \(\s*<div className="flex justify-end">\s*<Submit \/>/);
    expect(read("_components/memo-item.tsx")).toMatch(/\{canWrite \? \(\s*<div[^>]*>\s*<PinButton/);
    expect(read("_components/grade-form.tsx")).toContain("{canWrite ? <Submit /> : null}");
    for (const f of ["goals-section.tsx", "grade-comments-section.tsx", "level-tests.tsx"]) {
      expect(read(`_components/${f}`)).toMatch(/\{canWrite \? \(\s*<Button size="sm" variant="outline"/);
    }
    expect(read("_components/student-grade-records.tsx")).toContain("(canWrite ? <DeleteGradeButton");
    expect(read("_tabs/homework-video-link-buttons.tsx")).toContain("done || !props.canRevoke ? null : <Button");
    const consult = read("_tabs/consultations-tab.tsx");
    expect(consult).toMatch(/\{canWrite \? \(\s*<NewConsultationLink/);
    expect(consult).toMatch(/\{canWrite \? \(\s*<div className="ml-auto[^>]*>\s*<Link/);
    expect(consult).toContain("readOnly={!canWrite}");
  });

  it("배정 창의 '반이동' 토글 = 서버 반 이동 게이트와 같은 canManageTenant(\"classes\")", () => {
    expect(page).toContain('const canEditSchedule = await canManageTenant(user.systemRole, "classes");');
    expect(read("_tabs/classes-tab.tsx")).toMatch(/<StudentAssignAction[^>]*allowTransfer=\{canEditSchedule\}/);
  });

  it("입력 폼은 비활성 + 권한 안내 placeholder(lib/write-lock.ts)", () => {
    for (const f of ["memo-form.tsx", "grade-form.tsx"]) {
      const code = read(`_components/${f}`);
      expect(code).toContain("disabled={!canWrite}");
      expect(code).toContain('writeLockedPlaceholder("students")');
    }
  });
});
