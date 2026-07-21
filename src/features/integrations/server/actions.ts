"use server";

import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canManageSheetSync, SHEET_ACCESS_DENIED_MSG } from "@/features/integrations/server/sheet-access";
import { isPushableConsultation } from "@/features/integrations/push-eligibility";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { overwriteTimetableSheet, applySheetFormulas } from "@/features/integrations/google-sheets";
import { buildMathTimetableBuffer } from "@/features/exports/math-timetable/build-buffer";
import { buildEnglishTimetableBuffer, INTEGRATED_SHEET_NAME } from "@/features/exports/english-timetable/build-buffer";
import type { FormulaCell } from "@/features/exports/english-timetable/injaewon-integrated-sheet";
import {
  isSheetExportSubject,
  sheetsProvider,
  type SheetExportSubject,
} from "@/features/integrations/sheets-provider";
import {
  claimSheetSyncLease,
  isSheetSyncBusy,
  SHEET_SYNC_BUSY_MSG,
} from "@/features/integrations/server/sheet-sync-lease";

import {
  getMakeeduSyncLock,
  getMakeeduSyncWorkers,
  SYNC_COOLDOWN_MS,
  type MakeeduSyncLock,
  type MakeeduWorker,
} from "@/features/integrations/server/makeedu-sync";

// 트리거 직후 버튼을 즉시 잠글 락(요청/실행 행이 아직 커밋 전이어도 눌린 사용자 버튼이 바로 비활성).
function freshBusyLock(): MakeeduSyncLock {
  return { busyUntil: new Date(Date.now() + SYNC_COOLDOWN_MS).toISOString(), running: true };
}

export type ToggleState = { error?: string; enabled?: boolean } | undefined;

/**
 * '지금 동기화' 버튼 공유 잠금 상태 폴링용 — 카드가 주기적으로 호출해 모든 사용자 버튼을 실시간 동기화.
 * (읽기 전용. 게이트 불필요 — 잠금 상태는 민감정보 아님, RLS로 테넌트 격리.)
 */
export async function checkMakeeduSyncLock(): Promise<MakeeduSyncLock> {
  return getMakeeduSyncLock();
}

/**
 * 동기화 담당 PC(워처) 상태 폴링용 — 워커 상태 카드가 20초마다 호출해 온라인/오프라인을 실시간 반영.
 * 카드가 정적 스냅샷이라 "새로고침 전 옛 상태"로 화면마다 다르게 보이던 혼란(2026-07-03) 해소.
 * (읽기 전용. 게이트 불필요 — hostname·활동시각은 민감정보 아님, getMakeeduSyncWorkers가 getCurrentUser+RLS로 격리.)
 */
export async function checkMakeeduSyncWorkers(): Promise<{ workers: MakeeduWorker[]; nowMs: number }> {
  const nowMs = Date.now();
  return { workers: await getMakeeduSyncWorkers(nowMs), nowMs };
}

/**
 * 시트 동기화 리스 진행 여부 폴링용 — 시간표 툴바가 주기 호출해 '시트 반영/가져오기' 버튼을
 * 선제 비활성+마우스오버 안내(새벽 자동 반영·다른 관리자 실행 모두). 서버 액션 리스 거부가 2차 방어.
 * (읽기 전용. 게이트 불필요 — 잠금 상태는 민감정보 아님, RLS로 테넌트 격리.)
 */
export async function checkSheetSyncBusy(subject: string): Promise<boolean> {
  if (!isSheetExportSubject(subject)) return false;
  const supabase = await createClient();
  return isSheetSyncBusy(supabase, sheetsProvider(subject));
}

/**
 * 구글 시트 내보내기 연동 ON/OFF. owner 콘솔(연동 면)의 설정 토글이라 게이트도 owner 메뉴 쓰기
 * (canWriteTenant, override 반영 — 위임받은 admin/manager도 조정 가능. #58 owner 콘솔 위임 정합).
 * ⚠️ 켜기만으로 데이터가 나가진 않음 — 실제 **내보내기 실행**(syncSheetsNow, 테넌트 전체 시간표를 외부
 * 시트로)은 여전히 master 전용(B5 PII). 대상 스프레드시트·서비스 계정은 운영자 설정.
 */
export async function setSheetsExportEnabled(
  subject: string,
  enabled: boolean,
): Promise<ToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!isSheetExportSubject(subject)) return { error: "지원하지 않는 과목입니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      tenant_id: user.tenantId,
      provider: sheetsProvider(subject),
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
 * 과목별 내보낼 대상 구글 시트 ID 등록. owner 콘솔(연동 면)이라 게이트=owner 메뉴 쓰기(canWriteTenant).
 * `user_integrations`의 `sheetsProvider(subject)` 행에 spreadsheet_id upsert(과목마다 전용 시트).
 */
export async function setSubjectSheetTarget(
  subject: string,
  spreadsheetId: string,
): Promise<{ error?: string; ok?: boolean } | undefined> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!isSheetExportSubject(subject)) return { error: "지원하지 않는 과목입니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      tenant_id: user.tenantId,
      provider: sheetsProvider(subject),
      spreadsheet_id: spreadsheetId.trim() || null,
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) return { error: error.message };

  revalidatePath("/owner");
  revalidatePath("/timetable");
  return { ok: true };
}

/**
 * makeedu 자동 동기화(cron) ON/OFF. owner 콘솔(연동 면)의 설정 토글이라 게이트도 owner 메뉴 쓰기
 * (canWriteTenant, override 반영 — 위임받은 admin/manager도 조정 가능. #58 owner 콘솔 위임 정합).
 * cron 오케스트레이터(sync-all.cjs)가 매 실행 시작에 이 값을 읽어 false면 스킵한다(행 없으면 기본 ON).
 * (수동 '지금 동기화' 트리거는 별도로 integrations 권한 키 게이트 — triggerMakeeduSyncNow.)
 */
export async function setMakeeduSyncEnabled(enabled: boolean): Promise<ToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" };
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

export type TriggerSyncState =
  | { error?: string; ok?: boolean; message?: string; lock?: MakeeduSyncLock }
  | undefined;

/**
 * makeedu 동기화를 **지금 즉시 1회** 실행.
 * 게이트 = `integrations` 권한 키(canWriteTenant — 기본 master/admin/manager, 역할·권한 면에서 조정 가능).
 * - 로컬/셀프호스티드 서버(스크립트 있음): `sync-all.cjs`를 직접 spawn(즉시 실행, 기존 경로).
 * - Vercel(서버리스: 스크립트 미포함·원격 IP·ephemeral): 직접 실행이 불가하므로 **makeedu_sync_requests(0069a)에
 *   요청 행을 남긴다** → 동기화 PC의 상주 워처(watch-sync-requests.cjs, 15초 폴링)가 감지해 대신 실행.
 *   즉 프로덕션 웹에서도 버튼이 실제로 동작한다(PC가 꺼져 있으면 pending으로 대기, 켜지면 따라잡음).
 * force=true(MAKEEDU_FORCE) = 연동 ON/OFF 토글 무시(수동 강제). 성공 검증한 로컬 명령과 동일 인자.
 */
export async function triggerMakeeduSyncNow(): Promise<TriggerSyncState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "integrations"))) {
    return { error: "동기화 실행 권한이 없습니다 — 학원 설정 › 역할·권한의 'makeedu 연동'에서 조정할 수 있습니다" };
  }

  // 공유 쿨다운(5분)·진행 중을 **서버에서도** 강제 — 어느 화면(owner 카드·목록 배지 버튼)에서 누르든,
  // 클라 초기 락이 없어도 쿨다운 중 재실행/중복 큐잉이 안 된다(목록 배지 버튼은 페이지 로드 비용 0을 위해
  // 락 선조회를 안 하므로 이 서버 강제가 유일한 방어다).
  const lock = await getMakeeduSyncLock();
  if (lock.running || (lock.busyUntil && Date.parse(lock.busyUntil) > Date.now())) {
    return {
      ok: true,
      message: lock.running
        ? "이미 다른 곳에서 동기화가 실행 중입니다 — 완료까지 기다려 주세요."
        : "조금 전에 동기화가 실행됐습니다 — 아래 남은 시간 후 다시 시도할 수 있습니다.",
      lock,
    };
  }

  const cwd = process.cwd();
  const script = path.join("scripts", "_makeedu", "sync-all.cjs");
  // 서버리스/원격(Vercel 등)에선 로컬 스크립트를 spawn할 수 없다 → 요청 큐로 릴레이(동기화 PC 워처가 실행).
  if (process.env.VERCEL || !existsSync(path.join(cwd, script))) {
    return enqueueSyncRequest(user.tenantId, user.id);
  }

  // 중복 실행 방지(중복 makeedu 로그인·DB 경합) — 90초 디바운스(마커 파일 mtime 기준).
  const markPath = path.join(os.tmpdir(), "eywa-makeedu-sync-last");
  const now = Date.now();
  if (existsSync(markPath) && now - statSync(markPath).mtimeMs < 90_000) {
    // 이미 조금 전에 시작됨 — 버튼은 원래 트리거(마커 mtime) 기준 쿨다운까지 잠금 유지.
    return {
      ok: true,
      message: "이미 조금 전에 동기화가 시작됐습니다 — 완료까지 기다려 주세요.",
      lock: {
        busyUntil: new Date(statSync(markPath).mtimeMs + SYNC_COOLDOWN_MS).toISOString(),
        running: true,
      },
    };
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
      // MAKEEDU_TRIGGERED_BY = 버튼 누른 사용자 → sync-all이 실행 로그에 "누가"로 남김(0076a). 원격 경로는 요청자(requested_by).
      env: { ...process.env, MAKEEDU_FORCE: "true", MAKEEDU_TRIGGER: "button", MAKEEDU_TRIGGERED_BY: user.id },
    });
    child.unref();
    closeSync(logFd); // 자식이 fd를 dup했으므로 부모 핸들은 닫아 누수 방지.
    return {
      ok: true,
      message: "동기화를 시작했습니다 — 1~2분 뒤 각 화면 배지에 반영됩니다.",
      lock: freshBusyLock(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "로컬 동기화 시작 중 오류" };
  }
}

/**
 * Vercel(서버리스) 경로: makeedu_sync_requests에 pending 요청을 남긴다(admin client — integrations 쓰기
 * 게이트는 호출부에서 이미 통과). 동기화 PC의 워처가 15초 내 감지해 sync-all을 실행하고 done/error로 마감한다.
 * 이미 pending/running 요청이 있으면 중복 insert 없이 그 사실만 알린다(연타 = 동기화 1회).
 */
async function enqueueSyncRequest(tenantId: string, userId: string): Promise<TriggerSyncState> {
  try {
    const admin = createAdminClient();
    const { data: existing, error: selErr } = await admin
      .from("makeedu_sync_requests")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "running"])
      .limit(1);
    if (selErr) return { error: `동기화 요청 확인 실패: ${selErr.message}` };
    if (existing && existing.length > 0) {
      // 다른 사용자(또는 다른 탭)가 이미 눌러 처리 중 — 같은 시각까지 이 버튼도 잠근다(공유 lock).
      return {
        ok: true,
        message:
          existing[0].status === "running"
            ? "이미 다른 곳에서 동기화가 실행 중입니다 — 완료까지 기다려 주세요."
            : "이미 다른 곳에서 동기화 요청이 접수됐습니다 — 동기화 PC가 곧 실행합니다.",
        lock: await getMakeeduSyncLock(),
      };
    }

    const { error: insErr } = await admin
      .from("makeedu_sync_requests")
      .insert({ tenant_id: tenantId, requested_by: userId });
    if (insErr) return { error: `동기화 요청 접수 실패: ${insErr.message}` };
    return {
      ok: true,
      message:
        "동기화 요청을 보냈습니다 — 동기화 PC가 켜져 있으면 곧 실행되고, 1~2분 뒤 각 화면 배지에 반영됩니다. " +
        "(PC가 꺼져 있으면 켜질 때 자동 실행)",
      lock: freshBusyLock(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "동기화 요청 접수 중 오류" };
  }
}

export type PushState = { error?: string; ok?: boolean; message?: string } | undefined;

/**
 * 역동기화(eywa→makeedu) — 선택한 QR 공개접수 상담을 makeedu 예비상담 등록 큐(makeedu_push_requests)에 넣는다.
 * 게이트 = `integrations` 권한 키(canWriteTenant — 기본 master/admin/manager, 역할·권한 면에서 조정 가능).
 * 실제 makeedu 쓰기는 동기화 PC 워처(watch-sync-requests.cjs → push-consultations.cjs)가 신뢰 IP에서 수행.
 * 멱등: 이미 pending/running 요청이 있거나 이미 푸시된(makeedu_id/makeedu_pushed_at) 상담은 큐잉하지 않는다.
 */
export async function enqueueConsultationPush(ids: string[]): Promise<PushState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "integrations"))) {
    return { error: "makeedu 전송 권한이 없습니다 — 학원 설정 › 역할·권한의 'makeedu 연동'에서 조정할 수 있습니다" };
  }
  const clean = [...new Set((ids ?? []).map((s) => String(s)).filter(Boolean))];
  if (clean.length === 0) return { error: "전송할 상담을 선택하세요" };

  const admin = createAdminClient();
  // 대상 검증: 이 테넌트의 QR 접수 + 미푸시(makeedu_id/pushed_at 없음) + 푸시 가능.
  // ⚠️ enrolled 판정은 [push-eligibility.ts](../push-eligibility.ts) 단일 규칙(후보 쿼리·워커와 동일):
  // "등록완료면 무조건 제외"가 아니라 **"등록완료 + 학생이 makeedu 원생일 때만 제외"**.
  const { data: valid, error: selErr } = await admin
    .from("enrollment_consultations")
    .select("id, outcome, student:student_id ( makeedu_id )")
    .eq("tenant_id", user.tenantId)
    .eq("from_public_intake", true)
    .is("makeedu_id", null)
    .is("makeedu_pushed_at", null)
    .in("id", clean);
  if (selErr) return { error: `대상 확인 실패: ${selErr.message}` };
  const validIds = (valid ?? [])
    .filter((r) => {
      const s = Array.isArray(r.student) ? r.student[0] : r.student;
      return isPushableConsultation({
        outcome: r.outcome as string,
        studentMakeeduId: (s as { makeedu_id?: string | null } | null | undefined)?.makeedu_id ?? null,
      });
    })
    .map((r) => r.id as string);
  if (validIds.length === 0)
    return { error: "전송 가능한 상담이 없습니다(이미 전송됐거나, 등록완료됐거나, QR 접수가 아님)" };

  // 이미 큐에 있는(pending/running) 상담은 제외 — 중복 큐잉 방지.
  const { data: inflight } = await admin
    .from("makeedu_push_requests")
    .select("consultation_id")
    .in("consultation_id", validIds)
    .in("status", ["pending", "running"]);
  const busy = new Set((inflight ?? []).map((r) => r.consultation_id as string));
  const toQueue = validIds.filter((id) => !busy.has(id));
  if (toQueue.length === 0) return { ok: true, message: "선택한 상담은 이미 전송 대기 중입니다." };

  const { error: insErr } = await admin.from("makeedu_push_requests").insert(
    toQueue.map((cid) => ({ tenant_id: user.tenantId, consultation_id: cid, requested_by: user.id })),
  );
  if (insErr) return { error: `전송 요청 접수 실패: ${insErr.message}` };

  revalidatePath("/owner");
  revalidatePath("/enrollment"); // 전송 카드가 등록상담 화면에도 뜬다(2026-07-03)
  return {
    ok: true,
    message:
      `${toQueue.length}건을 makeedu 전송 대기열에 넣었습니다 — 동기화 PC가 켜져 있으면 곧 등록되고, ` +
      "완료되면 목록에서 사라집니다. (PC가 꺼져 있으면 켜질 때 자동 전송)",
  };
}

export type SyncState = { error?: string; ok?: boolean } | undefined;

/** 과목별 xlsx 버퍼 빌더 선택(레지스트리) — SHEET_EXPORT_SUBJECTS와 1:1. 구글시트는 수식(withFormulas). */
async function buildTimetableBufferFor(
  subject: SheetExportSubject,
  compactSections?: Set<number>,
): Promise<{ buffer: ArrayBuffer; formulaCells: FormulaCell[] }> {
  // master 전용 경로라 전체(unscoped) 내보내기 — teacherId 미지정.
  if (subject === "math") return { buffer: await buildMathTimetableBuffer(), formulaCells: [] };
  return buildEnglishTimetableBuffer({ withFormulas: true, compactSections });
}

export async function syncSheetsNow(subject: string, compact1h?: number[]): Promise<SyncState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // ⚠️ 시간표 full 권한 전용 (CLAUDE.md #58: 페이지가 아니라 액션을 게이트). 이 동기화는 **테넌트 전체
  // 시간표**(전 강사·전 학생 명단)를 외부 공유 시트로 내보내므로 scoped(강사)·readonly는 제외. 버튼 숨김과 이중 방어.
  if (!(await canManageSheetSync(user.systemRole))) {
    return { error: SHEET_ACCESS_DENIED_MSG };
  }
  if (!isSheetExportSubject(subject)) {
    return { error: "지원하지 않는 과목입니다" };
  }
  const provider = sheetsProvider(subject);

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled")
    .eq("provider", provider)
    .maybeSingle();

  // 연동이 꺼져 있으면 거부(시간표 '시트' 버튼도 같은 조건으로 숨김 — 이중 방어).
  if (data?.sync_enabled !== true) {
    return { error: "구글 시트 내보내기 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  }

  // 대상 시트: 과목 provider 행의 spreadsheet_id. math는 학원 설정 googleSheetId 폴백(레거시 보존).
  let spreadsheetId = data?.spreadsheet_id ?? "";
  if (!spreadsheetId && subject === "math") {
    const settings = await getTenantSettings();
    spreadsheetId = settings.notifications.googleSheetId.trim();
  }
  if (!spreadsheetId)
    return { error: "내보낼 구글 시트가 설정되지 않았습니다(학원 설정 › 연동에서 시트 ID 등록)" };

  // 동시 실행 직렬화 — 창(iframe)마다 버튼 상태가 독립이라 클라 disabled로는 멀티창·복수 master를
  // 못 막는다. 시트 가져오기 apply와 **같은 리스**를 공유(반영↔가져오기 교차 실행도 차단).
  const lease = await claimSheetSyncLease(supabase, provider);
  if (lease === "busy") return { error: SHEET_SYNC_BUSY_MSG };

  try {
    // 과목 익스포터 → 운영자가 미리 만들어 서비스계정에 공유한 기존 구글 시트에 통째 덮어쓰기
    // (서비스계정 용량 0이라 '생성' 불가 → '갱신'만). 대상 시트=과목당 전용 1개(수학·영어 분리).
    const { buffer, formulaCells } = await buildTimetableBufferFor(subject, new Set(compact1h ?? []));
    await overwriteTimetableSheet(spreadsheetId, buffer);
    // 정적 값 업로드(변환) 후 구글시트 수식 주입(방 행 파생·인원/퇴원수 COUNTA). 영어만 수집됨.
    if (formulaCells.length) await applySheetFormulas(spreadsheetId, INTEGRATED_SHEET_NAME, formulaCells);
    await supabase.from("user_integrations").upsert(
      {
        tenant_id: user.tenantId,
        provider,
        spreadsheet_id: spreadsheetId,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        sync_started_at: null, // 리스 해제(성공 기록과 원자적)
      },
      { onConflict: "tenant_id,provider" },
    );

    revalidatePath("/owner");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // best-effort: 즉시 토스트(return)가 1차 피드백 채널이고, 이 upsert는 다음 로드 때 보일 durable
    // last_error 보존용. 이 쓰기 자체가 실패해도(RLS 엣지·일시) 토스트는 떠 사용자에게 오류가 전달되고,
    // 리스는 3분 stale로 자가 해제된다.
    await supabase.from("user_integrations").upsert(
      {
        tenant_id: user.tenantId,
        provider,
        spreadsheet_id: spreadsheetId,
        last_error: msg,
        sync_started_at: null, // 리스 해제
      },
      { onConflict: "tenant_id,provider" },
    );
    return { error: msg };
  }
}
