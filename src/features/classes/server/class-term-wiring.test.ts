import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * 종강이 시간표 배치를 닫는 길(2026-11-02)은 **종강 버튼·밤 정리**뿐이다 — 영어 시트 반영은 배치를 제 계획으로 닫고
 * 제 스냅샷으로 되돌리므로 여기서 또 닫으면 되돌리기끼리 부딪히고, 폐지는 is_active로 이미 모든 화면에서 빠진다.
 * 영어 구조 가져오기는 종강일이 지난 반을 없는 반으로 본다(LS4b가 "제거"로 뜨던 원인).
 */
it("배치 닫기를 켜는 곳 = 종강 버튼 · 밤 정리 · 영어 시트 반영과 폐지는 켜지 않는다", () => {
  const actions = read("src/features/classes/server/actions.ts");
  expect(actions).toContain("await endClassWithName(user, { classId: id, date, closeSchedules: true });");
  expect(actions).toContain("await endClassWithName(user, { classId: id, date: kstToday(), archive: true });");
  expect(actions).toContain("await reopenClassWithSchedules(user, id);");
  expect(read("src/features/classes/server/class-period-names.ts")).toContain("closeSchedules: true");
  expect(read("src/features/timetable/server/master-sheet-store.ts")).not.toContain("closeSchedules");
});

it("영어 구조 가져오기는 반·배치 모두 종강일이 적용일 전인 반을 뺀다", () => {
  const src = read("src/features/timetable/server/structure-import-actions.ts");
  expect(src).toContain('const openOn = (closedAt: string | null | undefined) => !closedAt || String(closedAt).slice(0, 10) >= today;');
  expect(src).toContain("const classes = allClasses.filter((c) => openOn(c.closed_at));");
  expect(src).toContain("const sched = allSched.filter((s) => openOn(");
  expect(src).toContain("class:class_id!inner ( class_name, subject, is_active, closed_at )");
});
