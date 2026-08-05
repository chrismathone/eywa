import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildMathTimetableBuffer } from "@/features/exports/math-timetable/build-buffer";
import { buildEnglishTimetableBuffer, INTEGRATED_SHEET_NAME } from "@/features/exports/english-timetable/build-buffer";
import {
  applySheetFormulas,
  getServiceAccountEmail,
  getSheetLastModifier,
  overwriteTimetableSheet,
} from "@/features/integrations/google-sheets";
import { EDIT_SHEET_NAME } from "@/features/timetable/import/parse";
import { subjectFromProvider } from "@/features/integrations/sheets-provider";
import { claimSheetSyncLease } from "@/features/integrations/server/sheet-sync-lease";
import { getWeeklyScheduleWithStudents } from "@/features/timetable/server/queries";
import { reportError } from "@/lib/observability/report-error";

/**
 * 시간표 → 구글 시트 자동 반영 cron (매일 04:00 KST = 19:00 UTC, 원장 결정 2026-07-13).
 * 수동 '시트 반영'(syncSheetsNow)과 같은 빌더·리스를 공유하되, 세션이 없으므로 admin 클라이언트 +
 * **명시 tenant 필터**(builders의 db 주입, edutrix-sync cron 선례)로 돈다.
 *
 * 안전판 3중 (시트=양방향 표면이라 무가드 자동 덮어쓰기는 시트 편집분 유실):
 *  ① 사람-편집 가드 — 시트 마지막 수정자가 서비스계정이 아니면(=편집 후 '가져오기' 미실행 가능) 건너뜀.
 *     수정자 확인 불가 시 modifiedTime ≤ last_synced_at+1분(시계 오차 여유)일 때만 진행(불확실 = 건너뜀).
 *  ② 첫 반영 가드 — last_synced_at 없는(수동 반영 이력 0) 시트는 자동 반영하지 않음(온보딩은 수동으로).
 *  ③ 빈 데이터 가드 — **빌더와 동일 로직**(getWeeklyScheduleWithStudents)으로 이번 주 유효 슬롯 0건이면
 *     중단(학기 전환/전체 종강 등 valid_from/valid_to/closed_at로 걸러진 상태에서 빈 시트 덮어쓰기 방지).
 * 건너뜀/실패 사유는 user_integrations.last_error로 연동 카드에 표시(다음 성공 시 자동 해소).
 * ⚠️ compactSections(영어 '1시간 단위' 압축)은 화면 토글이라 저장 상태가 없음 — cron은 비압축으로 push한다
 *    (수동 반영도 화면 상태에 의존하므로 저장본 없이는 동일 한계). 압축 유지가 필요하면 별도 영속화 필요.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** 사람-편집 가드 판정 — true면 건너뛴다(위 ①). */
function humanEditedSince(
  mod: { modifiedTime: string | null; email: string | null },
  saEmail: string | null,
  lastSyncedAt: string,
): boolean {
  if (mod.email && saEmail) return mod.email.toLowerCase() !== saEmail.toLowerCase();
  // 수정자 미상(Drive가 외부계정 email 숨김) — 시각 폴백: SA 쓰기는 last_synced_at을 시트 쓰기 **직후**
  // 기록하므로 SA modifiedTime ≤ last_synced_at(초 단위 시계오차만). 여유 1분을 넘는 수정 = 사람 편집.
  // (10분은 그대로 유실 창이 됨 — push 직후 손보정이 가장 흔한 편집 타이밍이라 좁혀야 함.) 둘 다 미상 = 건너뜀.
  if (mod.modifiedTime) {
    return new Date(mod.modifiedTime).getTime() > new Date(lastSyncedAt).getTime() + 60 * 1000;
  }
  return true;
}

type IntegrationRow = {
  tenant_id: string;
  provider: string;
  spreadsheet_id: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // builders/lease는 서버(ssr) 클라이언트 타입을 받지만 런타임 API는 동일 — admin(RLS 우회)을 주입하고
  // 모든 쿼리에 tenant 필터를 강제한다(TimetableDb 계약).
  const supabase = admin as unknown as ServerClient;

  const { data: rows, error } = await admin
    .from("user_integrations")
    .select("tenant_id, provider, spreadsheet_id, sync_enabled, last_synced_at")
    .like("provider", "google_sheets%")
    .eq("sync_enabled", true)
    .not("spreadsheet_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Record<string, string> = {};
  for (const row of (rows ?? []) as IntegrationRow[]) {
    const subject = subjectFromProvider(row.provider);
    const spreadsheetId = row.spreadsheet_id;
    if (!subject || !spreadsheetId) continue; // 미지원 provider 키·빈 시트 ID는 대상 아님
    const tenantId = row.tenant_id;
    const key = `${tenantId}:${row.provider}`; // 멀티테넌트에서 결과가 서로 덮이지 않게(관측성)

    // ② 첫 반영 가드 — 수동 반영 이력이 없는 시트는 자동으로 건드리지 않는다.
    if (!row.last_synced_at) {
      results[key] = "skip: 수동 '시트 반영' 이력이 없어 자동 반영 대상에서 제외(첫 반영은 수동으로)";
      continue;
    }

    const lease = await claimSheetSyncLease(supabase, row.provider, tenantId);
    if (lease !== "claimed") {
      results[key] = `skip: 리스 선점 실패(${lease})`;
      continue;
    }

    try {
      // ① 사람-편집 가드
      const [mod, saEmail] = await Promise.all([
        getSheetLastModifier(spreadsheetId),
        Promise.resolve(getServiceAccountEmail()),
      ]);
      if (humanEditedSince(mod, saEmail, row.last_synced_at)) {
        const notice =
          "자동 반영 건너뜀(시트 보호) — 시트에 '가져오기'로 되읽지 않은 수동 편집이 감지되어 덮어쓰지 않았습니다. " +
          "'시트에서 가져오기' 후 '시트 반영'을 실행하면 다음 새벽부터 자동 반영이 재개됩니다.";
        await admin
          .from("user_integrations")
          .update({ last_error: notice, sync_started_at: null })
          .eq("tenant_id", tenantId)
          .eq("provider", row.provider);
        results[key] = "skip: 사람 편집 감지";
        continue;
      }

      // ③ 빈 데이터 가드 — 빌더와 **동일 로직**으로 이번 주 유효 슬롯을 조회(valid_from/valid_to/closed_at
      // 전부 반영). count 쿼리는 시간 유효성 필터를 못 담아 학기전환/전체종강 상태에서 count>0로 통과하며
      // 빈 시트를 덮어쓸 수 있었다(적대리뷰 2026-07-13). 과목별 슬롯 0건 = 그 시트를 빈 그리드로 만들 상태.
      const guardSlots = await getWeeklyScheduleWithStudents({ subject, db: { supabase, tenantId } });
      if (guardSlots.length === 0) {
        throw new Error(
          `이번 주 유효한 ${subject} 시간표 슬롯이 0건 — 빈 시트 덮어쓰기를 방지하기 위해 자동 반영을 중단했습니다(학기 전환/전체 종강 등).`,
        );
      }

      const settings = await getTenantSettingsByTenantId(tenantId);
      const db = { supabase, tenantId, settings };
      if (subject === "math") {
        const buffer = await buildMathTimetableBuffer({ db });
        await overwriteTimetableSheet(spreadsheetId, buffer, { hiddenTabs: [EDIT_SHEET_NAME] });
      } else {
        const { buffer, formulaCells } = await buildEnglishTimetableBuffer({ withFormulas: true, db });
        await overwriteTimetableSheet(spreadsheetId, buffer, { hiddenTabs: [EDIT_SHEET_NAME] });
        if (formulaCells.length) await applySheetFormulas(spreadsheetId, INTEGRATED_SHEET_NAME, formulaCells);
      }

      // ⚠️ 이 update가 실패하면(일시 오류 등) 시트는 이미 갱신됐는데 last_synced_at은 옛 값 → email 미노출
      // 시트에선 다음날 modifiedTime(방금 SA push) > 옛 last_synced_at+1분으로 '사람 편집' 오판 → 자동 반영
      // 영구 중단 위험. 그래서 update 오류를 표면화한다(email 노출 시트는 SA=최종수정자라 자가 회복).
      const { error: syncedErr } = await admin
        .from("user_integrations")
        .update({ last_synced_at: new Date().toISOString(), last_error: null, sync_started_at: null })
        .eq("tenant_id", tenantId)
        .eq("provider", row.provider);
      if (syncedErr) {
        reportError(new Error(`last_synced_at 기록 실패: ${syncedErr.message}`), {
          scope: "cron.sheets-sync",
          provider: row.provider,
        });
        results[key] = `synced (경고: 동기화 시각 기록 실패 — ${syncedErr.message})`;
      } else {
        results[key] = "synced";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reportError(e, { scope: "cron.sheets-sync", provider: row.provider });
      await admin
        .from("user_integrations")
        .update({ last_error: `자동 반영 실패: ${msg}`, sync_started_at: null })
        .eq("tenant_id", tenantId)
        .eq("provider", row.provider);
      results[key] = `error: ${msg}`;
    }
    // 리스 해제는 각 경로의 update가 sync_started_at=null로 **원자적으로** 수행(성공 기록과 함께 —
    // syncSheetsNow 동일 패턴). finally 재해제는 안 한다: 해제 직후 시작된 수동 반영의 새 리스를
    // 지울 수 있는 이중 해제 레이스. update마저 실패한 극단 경로는 3분 stale로 자가 회복.
  }

  return NextResponse.json({ ok: true, results });
}
