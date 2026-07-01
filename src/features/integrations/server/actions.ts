"use server";

import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { overwriteMathTimetableSheet } from "@/features/integrations/google-sheets";
import { buildMathTimetableBuffer } from "@/features/exports/math-timetable/build-buffer";

export type ToggleState = { error?: string; enabled?: boolean } | undefined;

/**
 * 구글 시트 내보내기 연동 ON/OFF (master 전용). `user_integrations.sync_enabled`를 토글.
 * 켜면 **시간표 화면에 '시트' 버튼**이 노출되고(원장), 그 버튼이 `syncSheetsNow`를 호출한다.
 * 대상 스프레드시트·서비스 계정(`GOOGLE_SERVICE_ACCOUNT_KEY`)은 운영자가 설정 — 학원장은 ON/OFF만.
 */
export async function setSheetsExportEnabled(enabled: boolean): Promise<ToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") {
    return { error: "구글 시트 연동은 원장(master)만 변경할 수 있습니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      tenant_id: user.tenantId,
      provider: "google_sheets",
      sync_enabled: enabled,
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) return { error: error.message };

  // 시간표 '시트' 버튼 노출이 이 값에 달려 있으므로 둘 다 재검증.
  revalidatePath("/owner");
  revalidatePath("/timetable");
  return { enabled };
}

/**
 * makeedu 자동 동기화(GitHub Actions cron) ON/OFF (master 전용). `user_integrations(provider=makeedu).sync_enabled` 토글.
 * cron 오케스트레이터(sync-all.cjs)가 매 실행 시작에 이 값을 읽어 false면 스킵한다(행 없으면 기본 ON).
 */
export async function setMakeeduSyncEnabled(enabled: boolean): Promise<ToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") {
    return { error: "makeedu 자동 동기화는 원장(master)만 변경할 수 있습니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      tenant_id: user.tenantId,
      provider: "makeedu",
      sync_enabled: enabled,
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) return { error: error.message };

  revalidatePath("/owner");
  return { enabled };
}

export type TriggerSyncState = { error?: string; ok?: boolean } | undefined;

/**
 * makeedu 동기화를 **지금 즉시 1회** 실행 (master 전용). **앱이 도는 서버에서 로컬 `sync-all.cjs`를 직접 spawn**한다.
 * (GitHub 방식은 makeedu가 데이터센터 IP를 거부해 폐기 — 서버가 신뢰 IP[집 PC/셀프호스티드]에 있으면 여기서 바로 됨.
 *  서버는 계속 도는 프로세스라 detached 자식이 ~1-2분 비동기로 완주하고, 결과는 각 화면 '↻ 동기화' 배지에 반영.)
 * ⚠️ **로컬/셀프호스티드 Node 서버 전용** — Vercel(서버리스: 스크립트 미포함·원격 IP·ephemeral)에선 명확히 거부한다.
 * force=true(MAKEEDU_FORCE) = 연동 ON/OFF 토글 무시(수동 강제). 성공 검증한 로컬 명령과 동일 인자.
 */
export async function triggerMakeeduSyncNow(): Promise<TriggerSyncState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") {
    return { error: "동기화 실행은 원장(master)만 할 수 있습니다" };
  }

  const cwd = process.cwd();
  const script = path.join("scripts", "_makeedu", "sync-all.cjs");
  // 서버리스/원격(Vercel 등)에선 로컬 스크립트를 spawn할 수 없다(파일 미포함·원격·ephemeral) → 명확히 거부.
  if (process.env.VERCEL || !existsSync(path.join(cwd, script))) {
    return {
      error:
        "이 서버에선 즉시 동기화를 실행할 수 없습니다(서버리스/원격). makeedu는 신뢰 IP를 요구하므로, " +
        "동기화 PC의 작업 스케줄러(eywa-makeedu-sync) 또는 PowerShell `Start-ScheduledTask`로 실행하세요.",
    };
  }

  // 중복 실행 방지(중복 makeedu 로그인·DB 경합) — 90초 디바운스(마커 파일 mtime 기준).
  const markPath = path.join(os.tmpdir(), "eywa-makeedu-sync-last");
  const now = Date.now();
  if (existsSync(markPath) && now - statSync(markPath).mtimeMs < 90_000) {
    return { error: "방금 동기화를 시작했습니다 — 1~2분 뒤 다시 시도하세요." };
  }

  try {
    writeFileSync(markPath, ""); // touch(mtime=now) = 디바운스 기준
    const logFd = openSync(path.join(os.tmpdir(), "eywa-makeedu-sync-button.log"), "a");
    // 로컬 명령과 동일: node --env-file=.env.local scripts/_makeedu/sync-all.cjs --apply
    // detached+unref → 액션은 즉시 반환하고 자식이 백그라운드로 완주(~1-2분). MAKEEDU_FORCE=토글 무시.
    const child = spawn(process.execPath, ["--env-file=.env.local", script, "--apply"], {
      cwd,
      detached: true,
      windowsHide: true, // ⚠️ Windows: detached 자식이 새 콘솔 창(도스창)을 띄우는 것을 숨김.
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, MAKEEDU_FORCE: "true" },
    });
    child.unref();
    closeSync(logFd); // 자식이 fd를 dup했으므로 부모 핸들은 닫아 누수 방지.
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "로컬 동기화 시작 중 오류" };
  }
}

export type SyncState = { error?: string; ok?: boolean } | undefined;

export async function syncSheetsNow(
  _prev: SyncState,
  _formData: FormData,
): Promise<SyncState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // ⚠️ master 전용 (CLAUDE.md #58: 페이지가 아니라 액션을 게이트). 이 동기화는 **테넌트 전체 수학
  // 시간표**(전 강사·전 학생 명단)를 외부 공유 시트로 내보내므로 원장만. 버튼 숨김과 이중 방어.
  if (user.systemRole !== "master") {
    return { error: "구글 시트 동기화는 원장(master)만 할 수 있습니다" };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled")
    .eq("provider", "google_sheets")
    .maybeSingle();

  // 연동이 꺼져 있으면 거부(시간표 '시트' 버튼도 같은 조건으로 숨김 — 이중 방어).
  if (data?.sync_enabled !== true) {
    return { error: "구글 시트 내보내기 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  }

  // 대상 시트: 전용 연동 spreadsheet_id 또는 학원 설정 googleSheetId(운영자 설정) 폴백.
  const settings = await getTenantSettings();
  const spreadsheetId = data?.spreadsheet_id || settings.notifications.googleSheetId.trim();
  if (!spreadsheetId)
    return { error: "내보낼 구글 시트가 설정되지 않았습니다(관리자에게 문의)" };

  try {
    // 수학 시간표 = ijw 충실 익스포터 → 운영자가 미리 만들어 서비스계정에 공유한 기존 구글 시트에
    // 통째 덮어쓰기(ijw updateSheetContent 방식). 서비스계정 용량 0이라 '생성'은 불가 → '갱신'만.
    // master 전용이라 전체(unscoped) 내보내기가 정당(전 강사·전 학생). 대상 시트=테넌트 전용 1개 가정.
    const buffer = await buildMathTimetableBuffer();
    await overwriteMathTimetableSheet(spreadsheetId, buffer);
    await supabase.from("user_integrations").upsert(
      {
        tenant_id: user.tenantId,
        provider: "google_sheets",
        spreadsheet_id: spreadsheetId,
        last_synced_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "tenant_id,provider" },
    );

    revalidatePath("/owner");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // best-effort: 즉시 토스트(return)가 1차 피드백 채널이고, 이 upsert는 다음 로드 때 보일 durable
    // last_error 보존용. 이 쓰기 자체가 실패해도(RLS 엣지·일시) 토스트는 떠 사용자에게 오류가 전달된다.
    await supabase.from("user_integrations").upsert(
      {
        tenant_id: user.tenantId,
        provider: "google_sheets",
        spreadsheet_id: spreadsheetId,
        last_error: msg,
      },
      { onConflict: "tenant_id,provider" },
    );
    return { error: msg };
  }
}
