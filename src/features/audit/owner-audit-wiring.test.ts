import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 학원 설정 계열 **변경 액션은 반드시 감사로그를 남긴다**(원장 점검 2026-08-27).
 *
 * 🔴 왜 이 가드가 필요한가: 2026-08-27 전수 점검에서 연동 토글·시트 대상 지정·동기화 실행·상담 역동기화·
 *    AI 프롬프트 편집·강의실 수정·팝업 수정/토글·키오스크 기기 등록/폐기가 **통째로 무기록**이었다.
 *    특히 `user_integrations`·`classrooms`엔 `updated_by`조차 없어 DB에도 흔적이 남지 않는다 —
 *    즉 이 로그가 사라지면 "누가 바꿨나"를 되짚을 근거가 **0**이 된다.
 *
 * ⚠️ 목록 기반이다(휴리스틱 아님) — 새 설정 변경 액션을 만들면 여기에도 한 줄 추가할 것.
 * ⚠️ 스캔은 "함수 본문 안에 logAction( 이 있는가"만 본다. 조건부 호출까지는 못 잡지만, 통째로
 *    빠뜨리는 사고(위 9건이 그랬다)를 막는 게 목적이다.
 */
const MUST_LOG: { file: string; fn: string }[] = [
  { file: "src/features/owner/server/actions.ts", fn: "saveOwnerSection" },
  { file: "src/features/owner/server/classroom-actions.ts", fn: "createClassroom" },
  { file: "src/features/owner/server/classroom-actions.ts", fn: "updateClassroom" },
  { file: "src/features/owner/server/classroom-actions.ts", fn: "updateClassroomCapacity" },
  { file: "src/features/owner/server/classroom-actions.ts", fn: "deleteClassroom" },
  { file: "src/features/owner/server/classroom-actions.ts", fn: "setClassroomArchived" },
  { file: "src/features/owner/server/subject-actions.ts", fn: "absorbSubject" },
  { file: "src/features/owner/server/subject-actions.ts", fn: "removeUnusedSubject" },
  { file: "src/features/owner/server/subject-actions.ts", fn: "saveTeacherViewOrder" },
  { file: "src/features/owner/server/subject-actions.ts", fn: "saveIntegrationGroups" },
  { file: "src/features/periods/server/actions.ts", fn: "savePeriodsForSubject" },
  // 외부로 데이터가 나가거나 외부 연동 상태를 바꾸는 문 — DB에 updated_by가 없어 로그가 유일한 근거다.
  { file: "src/features/integrations/server/actions.ts", fn: "setSheetsExportEnabled" },
  { file: "src/features/integrations/server/actions.ts", fn: "setSubjectSheetTarget" },
  { file: "src/features/integrations/server/actions.ts", fn: "setMakeeduSyncEnabled" },
  { file: "src/features/integrations/server/actions.ts", fn: "triggerMakeeduSyncNow" },
  { file: "src/features/integrations/server/actions.ts", fn: "syncSheetsNow" },
  { file: "src/features/integrations/server/actions.ts", fn: "enqueueConsultationPush" },
  // AI 산출물의 내용을 바꾸는 설정.
  { file: "src/features/onescreen/server/prompt-actions.ts", fn: "savePrompt" },
  { file: "src/features/onescreen/server/prompt-actions.ts", fn: "resetPrompt" },
  { file: "src/features/onescreen/server/ment-style-actions.ts", fn: "rebuildMentStylesNow" },
  // 전 직원·학부모가 보는 글.
  { file: "src/features/notices/server/actions.ts", fn: "createNoticePopup" },
  { file: "src/features/notices/server/actions.ts", fn: "updateNoticePopup" },
  { file: "src/features/notices/server/actions.ts", fn: "toggleNoticePopupActive" },
  { file: "src/features/notices/server/actions.ts", fn: "deleteNoticePopup" },
  // 출결을 찍을 수 있는 물건 + 학부모 발신 자격.
  { file: "src/features/attendance/kiosk/server/actions.ts", fn: "registerKioskDevice" },
  { file: "src/features/attendance/kiosk/server/actions.ts", fn: "revokeKioskDevice" },
  { file: "src/features/attendance/kiosk/server/actions.ts", fn: "deleteKioskDevice" },
  { file: "src/features/attendance/kiosk/server/actions.ts", fn: "saveKakaoChannel" },
  // 데이터 정리 면(학원 설정 → 데이터 정리) — 여러 학생의 기록을 한꺼번에 바꾸는 도구라 전부 남긴다.
  // 2026-10-06: 퇴원 학생의 남은 수강 일괄 종료(closeOrphanEnrollments)가 무기록이었다.
  { file: "src/features/admin/server/actions.ts", fn: "mergeStudents" },
  { file: "src/features/admin/server/actions.ts", fn: "closeOrphanEnrollments" },
  { file: "src/features/admin/server/actions.ts", fn: "bulkWithdrawStudents" },
  { file: "src/features/admin/server/actions.ts", fn: "bulkDeleteStudents" },
];

/** `export async function <fn>(` 부터 다음 최상위 `export ` 전까지를 그 함수 본문으로 본다. */
function bodyOf(src: string, fn: string): string | null {
  const start = src.indexOf(`export async function ${fn}(`);
  if (start === -1) return null;
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("학원 설정 계열 변경 액션의 감사로그 배선", () => {
  it("목록의 액션이 모두 실재한다(스캔이 헛돌지 않게 자기검증)", () => {
    const missing = MUST_LOG.filter(({ file, fn }) => bodyOf(readFileSync(file, "utf-8"), fn) === null);
    expect(missing, `함수를 못 찾음 — 이름이 바뀌었으면 이 목록도 갱신할 것: ${JSON.stringify(missing)}`).toEqual(
      [],
    );
  });

  it("🔴 각 액션이 logAction으로 기록한다", () => {
    const unlogged = MUST_LOG.filter(({ file, fn }) => {
      const body = bodyOf(readFileSync(file, "utf-8"), fn);
      return !body?.includes("logAction(");
    }).map(({ file, fn }) => `${file}#${fn}`);
    expect(
      unlogged,
      "감사로그 없이 학원 설정을 바꾸는 액션 — 누가 바꿨는지 되짚을 근거가 사라진다\n" + unlogged.join("\n"),
    ).toEqual([]);
  });
});
