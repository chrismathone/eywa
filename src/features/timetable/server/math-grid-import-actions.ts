"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { licenseBlockReason } from "@/lib/license/server";
import { canManageSheetSync, SHEET_ACCESS_DENIED_MSG } from "@/features/integrations/server/sheet-access";
import { readSheetGridWithMerges, readSheetTabRows } from "@/features/integrations/google-sheets";
import { supportsGridImport } from "@/features/integrations/sheets-provider";
import { buildMathGridPreview, type MathGridPreview } from "@/features/timetable/import/math-grid/build-preview";
import { computeGridDelta } from "@/features/timetable/import/math-grid/delta";
import { studentNameOf } from "@/features/timetable/import/math-grid/grid-text";
import { parseMathGrid } from "@/features/timetable/import/math-grid/parse-cells";
import { META_TAB_NAME, NO_EXPORT_RECORD_MSG, parseMeta } from "@/features/timetable/import/math-grid/parse-meta";
import { previewSheetImport, type PreviewState } from "./import-actions";
import { loadMathGridContext } from "./math-grid-context";
import { resolveImportSheet } from "./sheet-target";

export type MathGridPreviewState = { error?: string; preview?: MathGridPreview };

/**
 * 연결된 구글 시트의 **시간표 격자 탭**을 읽어 "무엇이 바뀌었나"를 돌려준다 — 읽기 전용(DB·시트 무변경).
 *
 * '수강편집' 탭 가져오기(previewSheetImport)와 같은 게이트를 쓴다: 시트 전체(전 강사·전 학생 명단)를 읽으므로
 * 시트 권한 + 지점 라이선스. 🔴 지금은 **미리보기까지**다 — 반을 만들거나 수강을 바꾸는 적용 경로는 아직 없다.
 */
export async function previewMathGridImport(subject: string = "math"): Promise<MathGridPreviewState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  const blocked = await licenseBlockReason(user.tenantId, "google_sheets");
  if (blocked) return { error: blocked };
  if (!supportsGridImport(subject)) return { error: "이 과목은 시간표 탭 읽기를 지원하지 않습니다" };

  try {
    const target = await resolveImportSheet(subject);
    if ("error" in target) return target;
    // 기록 탭과 DB는 서로를 안 쓴다 → 한꺼번에. 격자 탭 이름은 기록 탭이 알려 주므로 그 뒤에 읽는다.
    const [metaRows, ctx] = await Promise.all([
      // 기록 탭이 없으면(한 번도 안 보낸 시트) 탭 이름 대신 할 일을 말한다.
      readSheetTabRows(target.spreadsheetId, META_TAB_NAME).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        throw new Error(msg.includes("탭이 없습니다") ? NO_EXPORT_RECORD_MSG : msg || "시트 읽기 실패");
      }),
      // DB 오류 원문(영문)은 화면에 내보내지 않는다 — 로그에 남기고 사람이 읽는 문구로 바꾼다.
      loadMathGridContext().catch((e: unknown) => {
        console.error("[math-grid-import] 학원 자료 조회 실패:", e);
        throw new Error("학원 자료(반·학생 명단)를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }),
    ]);
    const meta = parseMeta(metaRows);
    const grid = await readSheetGridWithMerges(target.spreadsheetId, meta.mainTab).catch((e: unknown) => {
      // 본 탭 이름을 바꾸면 "탭이 없습니다 — 시트로 보내기를 누르세요"가 뜨는데, 그러면 고친 것이 덮어써진다.
      const msg = e instanceof Error ? e.message : "";
      throw new Error(
        msg.includes("탭이 없습니다")
          ? `시트에서 '${meta.mainTab}' 탭을 찾지 못했습니다. 탭 이름을 바꿨다면 원래 이름으로 되돌린 뒤 다시 불러오세요.`
          : msg || "시트 읽기 실패",
      );
    });
    const studentTexts = meta.cells.flatMap((c) => c.students.flatMap((s) => [s.text, studentNameOf(s.text)]));
    const delta = computeGridDelta(
      parseMathGrid(grid, { roomNames: ctx.roomNames, studentTexts }),
      meta,
      ctx.classes.filter((c) => c.active),
    );
    return { preview: buildMathGridPreview(delta, ctx, meta.mainTab) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
}

/**
 * '시트에서 불러오기' 한 번에 두 탭(수강편집·시간표 격자)을 **서버에서 한꺼번에** 읽는다.
 * 클라이언트가 서버 액션 둘을 부르면 줄지어 돌아 시간이 합산된다(B4) — 묶음은 여기서 만든다.
 * 게이트는 각 읽기가 스스로 건다(이 함수는 권한을 새로 판단하지 않는다).
 */
export async function previewMathSheetBundle(
  subject: string = "math",
): Promise<{ edit: PreviewState; grid: MathGridPreviewState }> {
  const [edit, grid] = await Promise.all([previewSheetImport(subject), previewMathGridImport(subject)]);
  return { edit, grid };
}
