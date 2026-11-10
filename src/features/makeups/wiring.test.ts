import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8");

describe("보강 참여 배선", () => {
  it("보고서 저장 두 경로는 upsert 전에 같은 가드를 본다", () => {
    const screen = read("src/features/onescreen/server/actions.ts");
    const save = screen.slice(screen.indexOf("export async function saveLessonReport"));
    const compose = read("src/features/report-admin/server/compose-actions.ts");
    const admin = compose.slice(compose.indexOf("async function upsertAdminReport"));
    expect(save.indexOf("makeupReportUpsertBlock(")).toBeGreaterThan(-1);
    expect(save.indexOf("makeupReportUpsertBlock(")).toBeLessThan(save.indexOf(".upsert("));
    expect(admin.indexOf("makeupReportUpsertBlock(")).toBeGreaterThan(-1);
    expect(admin.indexOf("makeupReportUpsertBlock(")).toBeLessThan(admin.indexOf(".upsert("));
  });

  it("출결·영상·영어 쓰기는 새 참여를 수강 거절과 구분한다", () => {
    expect(read("src/features/attendance/server/actions.ts")).toContain("nativeWriteAllowance(");
    expect(read("src/features/video-homework/server/actions.ts")).toContain("nativeWriteAllowance(");
    expect(read("src/features/class-sheets/server/actions.ts")).toContain("nativeWriteAllowance(");
    // 학생 자격 판정 한 벌(write-eligibility.ts — 옛 makeup-write.ts를 대신한다)이 native 참여를 새 행 근거로 본다.
    expect(read("src/features/attendance/write-eligibility.ts")).toContain("f.native");
  });

  it("연결된 예약은 옛 이행을 타기 전에 갈라지고, 직접 삭제는 가드를 지난다", () => {
    const complete = read("src/features/attendance/server/makeup-reservation-complete.ts");
    expect(complete.indexOf("classifyLegacyReservations(")).toBeLessThan(complete.indexOf("await fulfil("));
    expect(complete).toContain("handleMappedFulfill(");
    expect(read("src/features/makeups/server/adapters/gates.ts")).toContain("mappedSameDayDecision(");
    expect(read("src/features/attendance/server/makeup-reservation-actions.ts")).toContain("mappedReservationMutationBlock(");
    expect(read("src/features/attendance/kiosk/server/checkin.ts")).toContain("observeOnly: true");
    expect(read("src/features/onescreen/server/roster.ts")).toContain("participantsOrLegacy(");
    expect(read("src/features/class-sheets/server/today.ts")).toContain("participantsOrLegacy(");
    expect(read("src/features/video-homework/server/queries.ts")).toContain("participantsOrLegacy(");
    expect(read("src/features/attendance/server/units-master.ts")).toContain("participantsOrLegacy(");
    expect(read("src/features/onescreen/server/makeup-remove-actions.ts")).toContain("mappedMakeupDeleteBlock(");
    expect(read("src/features/class-sheets/server/actions.ts")).toContain("mappedMakeupDeleteBlock(");
  });

  it("명단은 참여를 합치고, 시간표 이관 SQL에는 새 표를 넣지 않는다", () => {
    expect(read("src/features/onescreen/server/roster.ts")).toContain("loadNativeParticipants(");
    expect(read("src/features/video-homework/server/queries.ts")).toContain("loadNativeParticipants(");
    expect(read("src/features/class-sheets/server/today.ts")).toContain("loadNativeParticipants(");
    expect(read("src/features/dashboard/server/makeup-upcoming.ts")).toContain("rowsOrThrow(");
    expect(read("src/features/attendance/server/makeup-reservation-queries.ts")).toContain("loadNativeParticipants(");
    expect(read("src/features/attendance/server/units-master.ts")).toContain("nativeLessonDraft(");
    const links = read("src/features/timetable/server/master-sheet-attendance.ts");
    expect(links).not.toContain("makeup_participants");
    expect(links).toContain("extraLinks: AttendanceLink[] = []");
    expect(read("src/features/timetable/server/master-sheet-store.ts")).toContain("nativeAttendanceLinks(");
    expect(read("src/features/makeups/server/adapters/participants.ts")).toContain("payload.page_size = PAGE_LIMIT");
    expect(read("src/features/makeups/server/adapters/effects.ts")).toContain("participationCommandId(");
    expect(read("src/features/makeups/server/adapters/effects.ts")).toContain("sendParticipation(input.effectKey, input.payload)");
    expect(read("src/features/makeups/server/adapters/effects.ts")).toContain("makeup_projection_evidence");
    expect(read("src/components/scheduled-change-banner.tsx")).toContain("makeupCaseHref(r.makeup.caseId)");
    expect(read("src/features/attendance/server/makeup-reservation-queries.ts")).toContain("caseId: row.caseIds[0] ?? null");
  });
});
