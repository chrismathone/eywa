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

  it("적용일 이후 그 교시로 찍힌 출결이 있으면 거절한다([[#126]]) — 요일까지 본다", () => {
    expect(src).toContain("attendance_records");
    expect(src).toContain("slot_start");
    expect(src).toContain("weekdayOf(");
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
