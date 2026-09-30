"use server";

import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageSheetSync } from "@/features/integrations/server/sheet-access";
import { canManageTimetableImport } from "./import-access";
import { normalizeEffectiveDate } from "../import/effective-date";
import { kstToday } from "@/lib/date-kst";
import { describeSheetsError } from "@/features/integrations/google-sheets";
import { tenantSettingsTag } from "@/features/owner/server/queries";
import {
  claimSheetSyncLease,
  releaseSheetSyncLease,
  SHEET_SYNC_BUSY_MSG,
} from "@/features/integrations/server/sheet-sync-lease";
import { createClient } from "@/lib/supabase/server";
import { sheetsProvider } from "@/features/integrations/sheets-provider";
import { masterTabs, readMasterSource } from "./master-sheet-source";
import {
  applyMasterTransaction,
  loadMasterContext,
  masterPreview,
  MasterApplyError,
  openMasterDb,
} from "./master-sheet-store";
import type { MasterInput, MasterPreview } from "../import/master/types";

const schema = z.object({
  source: z.string().trim().min(1).max(500),
  teacherTab: z.string().min(1).max(100),
  rosterTab: z.string().min(1).max(100),
  effectiveDate: z.string().min(1).max(10),
  maxColumn: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{0,3}$/),
  classBindings: z.record(
    z.string().max(120),
    z.union([z.uuid(), z.literal("")]),
  ),
  teacherBindings: z
    .record(z.string().max(120), z.union([z.uuid(), z.literal("")]))
    .optional(),
  closeClassIds: z.array(z.uuid()).max(300).optional(),
});
export type MasterFailure = {
  ok: false;
  error: string;
  stage: string;
  code?: string;
  preview?: MasterPreview;
};

async function access() {
  const user = await getCurrentUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  const [sheet, classes] = await Promise.all([
    canManageSheetSync(user.systemRole),
    canManageTimetableImport(user.systemRole),
  ]);
  if (!sheet || !classes)
    throw new Error("구글 시트 연동과 반 일괄 관리 권한이 모두 필요합니다.");
  return user;
}
function validate(raw: MasterInput) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new Error("주소·탭·적용일·마지막 열 또는 반 연결을 확인해 주세요.");
  const date = normalizeEffectiveDate(parsed.data.effectiveDate, kstToday());
  if ("error" in date) throw new Error(date.error);
  return { ...parsed.data, effectiveDate: date.date };
}
function failure(e: unknown, stage: string): MasterFailure {
  if (e instanceof MasterApplyError)
    return { ok: false, error: e.message, stage, preview: e.preview };
  const err = e as {
    message?: string;
    code?: string;
    constraint_name?: string;
  };
  console.error("[english-master]", stage, err.code, err.message);
  const reason =
    err.code === "23P01"
      ? "같은 학생·반의 수강 기간이 겹칩니다. 학생 상세에서 기존·예약 수강을 확인해 주세요."
      : err.code === "23505"
        ? "반 이름 또는 배치가 중복됩니다. 보관된 반까지 확인한 뒤 다시 검사해 주세요."
        : err.code === "40001"
          ? "다른 사용자가 같은 데이터를 변경했습니다. 다시 검사한 뒤 적용해 주세요."
          : err.code === "23503"
            ? "연결한 반·학생·강사·강의실이 변경되었습니다. 다시 검사해 주세요."
            : err.message && /[가-힣]/.test(err.message)
              ? err.message
              : stage === "시트 읽기"
                ? describeSheetsError(e)
                : "처리하지 못했습니다. 연결 상태를 확인하고 다시 검사해 주세요.";
  return { ok: false, error: reason, stage, code: err.code };
}
export async function listMasterSheetTabs(source: string) {
  let stage = "권한 확인";
  try {
    await access();
    stage = "시트 읽기";
    if (typeof source !== "string" || source.length > 500)
      throw new Error("시트 주소를 확인해 주세요.");
    return { ok: true as const, ...(await masterTabs(source)) };
  } catch (e) {
    return failure(e, stage);
  }
}
export async function previewMasterSheet(raw: MasterInput) {
  let stage = "권한 확인";
  try {
    const user = await access();
    stage = "입력 확인";
    const input = validate(raw);
    stage = "시트 읽기";
    const { grids, source } = await readMasterSource(input);
    stage = "에이와 규칙 검사";
    const sql = openMasterDb();
    try {
      const ctx = await sql.begin(
        "isolation level repeatable read read only",
        (tx) => loadMasterContext(tx, user.tenantId, input.effectiveDate),
      );
      return {
        ok: true as const,
        preview: masterPreview(input, grids, ctx, source),
      };
    } finally {
      await sql.end().catch(() => console.error('[english-master] DB cleanup failed'));
    }
  } catch (e) {
    return failure(e, stage);
  }
}
export async function applyMasterSheet(
  raw: MasterInput,
  hash: string,
  acknowledgements: string[],
) {
  let stage = "권한 확인";
  try {
    const user = await access();
    stage = "입력 확인";
    const input = validate(raw);
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      !Array.isArray(acknowledgements) ||
      acknowledgements.length > 5000 ||
      acknowledgements.some((s) => typeof s !== "string" || s.length > 1000)
    )
      throw new Error("미리보기를 다시 실행해 주세요.");
    const supabase = await createClient();
    const provider = sheetsProvider("english");
    const lease = await claimSheetSyncLease(supabase, provider);
    if (lease === "busy") throw new Error(SHEET_SYNC_BUSY_MSG);
    let result;
    try {
      stage = "시트 읽기";
      const { grids, source } = await readMasterSource(input);
      stage = "재검사 및 적용";
      const sql = openMasterDb();
      try {
        result = await applyMasterTransaction(
          sql,
          user,
          input,
          grids,
          source,
          hash,
          acknowledgements,
        );
      } finally {
        await sql.end().catch(() => console.error('[english-master] DB cleanup failed'));
      }
    } finally {
      if (lease === "claimed") {
        try {
          await releaseSheetSyncLease(supabase, provider);
        } catch (e) {
          console.error(
            "[english-master] lease release",
            e instanceof Error ? e.message : "failed",
          );
        }
      }
    }
    // Commit has succeeded. Cache refresh failure must not report that the import failed.
    try {
      revalidatePath("/timetable");
      revalidatePath("/classes");
      revalidatePath("/students", "layout");
      revalidatePath("/ecs");
      revalidateTag(tenantSettingsTag(user.tenantId), "max");
    } catch (e) {
      console.error(
        "[english-master] cache refresh",
        e instanceof Error ? e.message : "failed",
      );
    }
    return { ok: true as const, result };
  } catch (e) {
    return failure(e, stage);
  }
}
