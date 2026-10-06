"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { licenseBlockReason } from "@/lib/license/server";
import { createClient } from "@/lib/supabase/server";
import { canManageSheetSync, SHEET_ACCESS_DENIED_MSG } from "@/features/integrations/server/sheet-access";
import { readSheetGridWithMerges, readSheetTabRows } from "@/features/integrations/google-sheets";
import { sheetsProvider, supportsGridImport } from "@/features/integrations/sheets-provider";
import {
  claimSheetSyncLease,
  releaseSheetSyncLease,
  SHEET_SYNC_BUSY_MSG,
} from "@/features/integrations/server/sheet-sync-lease";
import {
  buildGridPlan,
  gridPlanHash,
  planSize,
  type GridApplyPlan,
  type GridApplyState,
} from "@/features/timetable/import/math-grid/apply-plan";
import { toGridPreview, type MathGridPreview } from "@/features/timetable/import/math-grid/build-preview";
import { computeGridDelta } from "@/features/timetable/import/math-grid/delta";
import { studentNameOf } from "@/features/timetable/import/math-grid/grid-text";
import { parseMathGrid } from "@/features/timetable/import/math-grid/parse-cells";
import { META_TAB_NAME, NO_EXPORT_RECORD_MSG, parseMeta } from "@/features/timetable/import/math-grid/parse-meta";
import { scheduleChanges, weekendSlotsShifted } from "@/features/timetable/import/math-grid/schedule-diff";
import { normalizeEffectiveDate } from "@/features/timetable/import/effective-date";
import { previewSheetImport, type PreviewState } from "./import-actions";
import { executeGridPlan } from "./math-grid-apply";
import { loadMathExportedClasses, loadMathGridPlanContext } from "./math-grid-context";
import { resolveImportSheet } from "./sheet-target";

export type MathGridPreviewState = { error?: string; preview?: MathGridPreview };

type Fresh = { error: string } | { plan: GridApplyPlan; tabName: string; stats: MathGridPreview["stats"] };

/**
 * 시트의 시간표 격자 탭 + 지금 DB를 읽어 반영 계획을 다시 세운다(무쓰기). 미리보기·적용의 단일 소스 —
 * 적용은 이 결과의 해시를 화면이 본 미리보기 해시와 대조하고, **이 결과로** 쓴다(화면이 보낸 내용은 받지 않는다).
 */
async function computeFreshGridPlan(subject: string): Promise<Fresh> {
  const target = await resolveImportSheet(subject);
  if ("error" in target) return target;
  // DB 오류 원문(영문)은 화면에 내보내지 않는다 — 로그에 남기고 사람이 읽는 문구로 바꾼다.
  const dbFailed = (e: unknown): never => {
    console.error("[math-grid-import] 학원 자료 조회 실패:", e);
    throw new Error("학원 자료(반·학생 명단)를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  };
  // 학원 자료는 시트 기록 탭을 기다리지 않고 함께 읽는다(B4) — 기준 주가 필요한 것은 익스포터 반 목록 하나뿐이다.
  // 실패는 값으로 받아 둔다(기록 탭 읽기가 먼저 실패해도 처리 안 된 거절이 남지 않게).
  const ctxSettled = loadMathGridPlanContext().then(
    (ctx) => ({ ctx }),
    (failed: unknown) => ({ failed }),
  );
  // 기록 탭이 없으면(한 번도 안 보낸 시트) 탭 이름 대신 할 일을 말한다.
  const metaRows = await readSheetTabRows(target.spreadsheetId, META_TAB_NAME).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : "";
    throw new Error(msg.includes("탭이 없습니다") ? NO_EXPORT_RECORD_MSG : msg || "시트 읽기 실패");
  });
  const meta = parseMeta(metaRows);
  // 격자 탭과 그 주의 반 목록은 서로를 안 쓴다 → 한꺼번에(B4). 둘 다 기록 탭이 알려 주는 값(탭 이름·기준 주)이 있어야 읽는다.
  const [grid, exported, settled] = await Promise.all([
    readSheetGridWithMerges(target.spreadsheetId, meta.mainTab).catch((e: unknown) => {
      // 본 탭 이름을 바꾸면 "탭이 없습니다 — 시트로 보내기를 누르세요"가 뜨는데, 그러면 고친 것이 덮어써진다.
      const msg = e instanceof Error ? e.message : "";
      throw new Error(
        msg.includes("탭이 없습니다")
          ? `시트에서 '${meta.mainTab}' 탭을 찾지 못했습니다. 탭 이름을 바꿨다면 원래 이름으로 되돌린 뒤 다시 불러오세요.`
          : msg || "시트 읽기 실패",
      );
    }),
    loadMathExportedClasses(meta.referenceDate).catch(dbFailed),
    ctxSettled,
  ]);
  if ("failed" in settled) return dbFailed(settled.failed);
  const { ctx } = settled;
  const studentTexts = meta.cells.flatMap((c) => c.students.flatMap((s) => [s.text, studentNameOf(s.text)]));
  const delta = computeGridDelta(
    parseMathGrid(grid, { roomNames: ctx.rooms.map((r) => r.name), studentTexts }),
    meta,
    // 종강·폐지 반은 '아는 반'으로 넘기지 않는다 — 그 이름이 격자에 서면 새 반으로 읽히고, 계획이 이름 겹침으로 막는다.
    ctx.classes.filter((c) => c.open),
  );
  const plan = buildGridPlan(
    delta,
    { ...ctx, weekendShifted: weekendSlotsShifted(exported) },
    scheduleChanges(delta.classSlots, exported),
  );
  return { plan, tabName: meta.mainTab, stats: delta.stats };
}

async function gate(
  subject: string,
): Promise<{ error: string } | { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { error: SHEET_ACCESS_DENIED_MSG };
  const blocked = await licenseBlockReason(user.tenantId, "google_sheets");
  if (blocked) return { error: blocked };
  if (!supportsGridImport(subject)) return { error: "이 과목은 시간표 탭 가져오기를 지원하지 않습니다" };
  return { user };
}

/**
 * 연결된 구글 시트의 **시간표 격자 탭**을 읽어 "무엇을 반영할 것인가"를 돌려준다 — 읽기 전용(DB·시트 무변경).
 * '수강편집' 탭 가져오기(previewSheetImport)와 같은 게이트: 시트 전체(전 강사·전 학생 명단)를 읽으므로 시트 권한 + 지점 라이선스.
 */
export async function previewMathGridImport(subject: string = "math"): Promise<MathGridPreviewState> {
  const g = await gate(subject);
  if ("error" in g) return g;
  try {
    const fresh = await computeFreshGridPlan(subject);
    if ("error" in fresh) return fresh;
    return { preview: toGridPreview(fresh.plan, fresh.tabName, fresh.stats) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
}

/**
 * 미리보기에서 확인한 격자 변경을 **적용** — 반 만들기 + 학생 이동·추가·종료, 고른 날짜부터.
 *
 * 게이트는 읽기 게이트 + 시간표 쓰기 + **반 만들기 자격**(수업목록의 '새 반'과 같은 조건)이다. 서버가 시트와 DB를
 * 다시 읽어 계획을 다시 세우고 해시를 대조한다 — 그 사이 시트나 수강이 바뀌었으면 멈추고 다시 불러오게 한다.
 * 시트 잠금을 쥔 채 다시 읽기~쓰기를 한다('시트로 보내기'·다른 가져오기와 줄을 선다).
 */
export async function applyMathGridImport(
  expectedHash: string,
  subject: string = "math",
  effectiveDateRaw?: string,
): Promise<GridApplyState> {
  const g = await gate(subject);
  if ("error" in g) return g;
  const { user } = g;
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "시간표 관리 권한이 없습니다" };
  if (!(await canManageTenant(user.systemRole, "classes"))) return { error: "학원 전체 반 설정은 관리자만 할 수 있습니다" };
  // 적용일은 화면 값을 그대로 쓰지 않는다 — 서버가 같은 순수 규칙으로 다시 검증한다(과거·상한 초과 거절).
  const eff = normalizeEffectiveDate(effectiveDateRaw, kstToday());
  if ("error" in eff) return { error: eff.error };

  const supabase = await createClient();
  const provider = sheetsProvider(subject);
  const lease = await claimSheetSyncLease(supabase, provider);
  if (lease === "busy") return { error: SHEET_SYNC_BUSY_MSG };
  try {
    let fresh: Fresh;
    try {
      fresh = await computeFreshGridPlan(subject);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
    }
    if ("error" in fresh) return fresh;
    const hash = gridPlanHash(fresh.plan);
    if (hash !== expectedHash) {
      return { error: "시트 또는 수강 정보가 미리보기 이후 바뀌었습니다. 다시 불러온 뒤 적용하세요.", staleHash: hash };
    }
    if (planSize(fresh.plan) === 0) return { error: "적용할 변경이 없습니다." };
    // 종강 예정 반 — 계획은 적용일을 모르고 세운다(해시가 날짜와 무관해야 한다). 날짜가 정해진 여기서 막는다.
    const closing = [...fresh.plan.moves, ...fresh.plan.adds].find((x) => x.to.closesOn && x.to.closesOn <= eff.date);
    if (closing) {
      return { error: `"${closing.to.name}" 반은 ${closing.to.closesOn}에 종강 예정이라 ${eff.date}부터는 학생을 넣을 수 없습니다. 적용일을 앞당기거나 시트에서 그 반으로의 이동을 빼 주세요.` };
    }
    return await executeGridPlan(supabase, user, fresh.plan, eff.date);
  } finally {
    // ⚠️ 위 return await 필수 — 프로미스만 돌려주면 쓰기가 끝나기 전에 잠금이 풀린다.
    if (lease === "claimed") await releaseSheetSyncLease(supabase, provider);
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
