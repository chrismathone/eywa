import "server-only";
/**
 * 업무 비서 예약 정리 — 매일 01:00 · 13:00 KST(vercel.json `0 4,16 * * *` UTC · 원장 2026-11-02 *"업무 비서를 새벽 1시에 한번, 오후 1시에
 * 한번 이렇게 두번 돌려주고 … 언제 돌렸는지 시간도 남겨"*).
 * 🔴 비서의 숫자는 그 사람 화면이 계산한 값이라(사람 권한으로 도는 조회 — 서버 키로 다시 세면 다른 숫자가 된다) 여기서 다시 세지 않는다.
 * 화면이 남긴 마지막 후보(24시간 안)로 정리하고 숫자 기준 시각(`basis_at`)을 함께 남긴다. 업무를 요청할 수 있는 재직자만(버튼과 같은 판정).
 * 건너뛰는 것 — AI가 꺼진 지점(실패로 세지 않는다) · 3시간 안에 예약이 이미 돈 사람 · 오늘 마지막 정리와 후보가 같은 사람(01:00에 정리한
 * 후보 그대로 13:00 — 화면을 안 열었으면 후보가 그대로다). 30일 지난 정리는 먼저 지운다.
 * 시간 예산 안에서 몇 명씩 함께 돌리고, 넘치면 남은 사람은 다음 회차로 — 마지막 예약 정리가 오래된 사람부터라 늘 같은 사람이 빠지지 않는다.
 */
import { getSuperAdminIds } from "@/lib/auth/super-admin";
import { kstToday } from "@/lib/date-kst";
import { isFeatureLicensed } from "@/lib/license/server";
import { reportError } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import type { SystemRole } from "@/lib/permissions";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { canMonitorStaffTasks } from "@/features/staff-tasks/access";
import { basisText, inputKey, type SecretaryInput } from "./secretary-ai";
import { dayOf } from "./secretary-facts";
import { INPUTS, NOTES, SCHEDULE_REPEAT_MS, runSecretary } from "./secretary-server";

const FRESH_MS = 24 * 3_600_000;
/** 순서를 정하는 재료 — 마지막 예약 정리(실제로 남은 정리 · 실패한 시도는 빼서 다음 회차에 먼저)를 7일까지 본다. */
const ORDER_MS = 7 * 86_400_000;
const KEEP_DAYS = 30;
/** 이 시간이 지나면 새 정리를 시작하지 않는다(함수 한도 300초 — 진행 중인 AI 답을 기다릴 몫을 남긴다). */
const BUDGET_MS = 180_000;
/** 한꺼번에 부르는 AI 수. */
const PARALLEL = 3;
const CREATOR_ROLES: readonly string[] = ["master", "admin", "manager"];

export type Capture = { tenant_id: string; user_id: string; input: SecretaryInput; captured_at: string };
export type CaptureUser = { id: string; tenant_id: string; system_role: string; status: string };
/** 정리 줄의 머리(가벼운 칸만) — 모델 칸이 비면 시도 표식이다. */
export type NoteHead = { id: number; user_id: string; created_at: string; run_kind: string; model: string | null; for_date: string };

/** 업무를 요청할 수 있는 재직자인가 — `canCreateWork`(원장 · 관리자 · 매니저 + 업무 처리 현황 지정자)와 같은 판정. 순수(Vitest). */
export function canRunFor(user: CaptureUser | undefined, monitorIds: readonly string[] | undefined, isSuperAdmin: boolean): boolean {
  if (!user || user.status !== "active") return false;
  return CREATOR_ROLES.includes(user.system_role) || canMonitorStaffTasks({ id: user.id, systemRole: user.system_role as SystemRole }, { isSuperAdmin, monitorIds });
}

/** 날마다 바뀌는 자리 — 동점(둘 다 7일 안에 예약 정리가 없음)이면 이 값으로 가른다(늘 같은 사람이 뒤에 서지 않게). */
const rotation = (today: string, id: string) => { let h = 2166136261; for (const ch of `${today}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/** 돌릴 순서 — 마지막 예약 정리가 오래된 사람부터(7일 안에 없으면 맨 앞) · 동점은 날마다 바뀌는 순서. 순수(Vitest). */
export function scheduleOrder<T extends Pick<Capture, "user_id">>(due: readonly T[], heads: readonly Pick<NoteHead, "user_id" | "created_at" | "run_kind">[], today: string): T[] {
  const last = new Map<string, string>();
  for (const h of heads) if (h.run_kind === "schedule" && h.created_at > (last.get(h.user_id) ?? "")) last.set(h.user_id, h.created_at);
  return [...due].sort((a, b) => (last.get(a.user_id) ?? "").localeCompare(last.get(b.user_id) ?? "") || rotation(today, a.user_id) - rotation(today, b.user_id));
}

/** 오늘 마지막 정리(시도 표식 제외)의 머리 — 사람마다. 순수(Vitest). */
export function latestNotes(heads: readonly NoteHead[], today: string): Map<string, NoteHead> {
  const out = new Map<string, NoteHead>();
  for (const h of heads) if (h.model !== null && h.for_date === today && h.id > (out.get(h.user_id)?.id ?? -1)) out.set(h.user_id, h);
  return out;
}

export async function runScheduledSecretary(now: number, dry: boolean) {
  const started = Date.now();
  const admin = createAdminClient();
  const today = kstToday(new Date(now));
  if (!dry) {
    const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    const { error } = await admin.from(NOTES).delete().lt("for_date", cutoff);
    if (error) reportError(error, { scope: "cron.dashboard-secretary.prune" });
  }
  const captures = await fetchAllPaged<Capture>((from, to) => admin.from(INPUTS).select("tenant_id, user_id, input, captured_at")
    .gte("captured_at", new Date(now - FRESH_MS).toISOString()).order("tenant_id").order("user_id").range(from, to));
  const ids = [...new Set(captures.map((c) => c.user_id))];
  const [users, superAdmins, heads, lastRuns, tenants] = await Promise.all([
    fetchInChunks<CaptureUser>(ids, (chunk) => admin.from("users").select("id, tenant_id, system_role, status").in("id", chunk)),
    getSuperAdminIds(),
    fetchAllPagedInChunks<NoteHead>(ids, (chunk, from, to) => admin.from(NOTES).select("id, user_id, created_at, run_kind, model, for_date")
      .gte("created_at", new Date(now - FRESH_MS).toISOString()).in("user_id", chunk).order("id").range(from, to)),
    fetchAllPagedInChunks<Pick<NoteHead, "id" | "user_id" | "created_at" | "run_kind">>(ids, (chunk, from, to) => admin.from(NOTES).select("id, user_id, created_at, run_kind")
      .eq("run_kind", "schedule").not("model", "is", null).gte("created_at", new Date(now - ORDER_MS).toISOString()).in("user_id", chunk).order("id").range(from, to)),
    Promise.all([...new Set(captures.map((c) => c.tenant_id))].map(async (tenantId) => {
      const [settings, licensed] = await Promise.all([getTenantSettingsByTenantId(tenantId).catch(() => null), isFeatureLicensed(tenantId, "ai_analysis")]);
      return [tenantId, { monitors: settings?.permissions.specialAccess.staffTaskMonitorIds, licensed }] as const;
    })).then((list) => new Map(list)),
  ]);
  const userOf = new Map(users.map((u) => [u.id, u]));
  const allowed = captures.filter((c) => userOf.get(c.user_id)?.tenant_id === c.tenant_id && canRunFor(userOf.get(c.user_id), tenants.get(c.tenant_id)?.monitors, superAdmins.has(c.user_id)));
  const licensed = allowed.filter((c) => tenants.get(c.tenant_id)?.licensed !== false);
  const repeated = new Set(heads.filter((h) => h.run_kind === "schedule" && Date.parse(h.created_at) >= now - SCHEDULE_REPEAT_MS).map((h) => h.user_id));
  const fresh = licensed.filter((c) => !repeated.has(c.user_id));
  // 오늘 마지막 정리가 같은 후보로 만든 것이면 건너뛴다 — 후보 원문은 그 줄만 읽는다(사람마다 하나).
  const latest = latestNotes(heads, today);
  const noteIds = fresh.flatMap((c) => { const h = latest.get(c.user_id); return h ? [String(h.id)] : []; });
  const before = await fetchInChunks<{ id: number; input: SecretaryInput }>(noteIds, (chunk) => admin.from(NOTES).select("id, input").in("id", chunk), 20);
  const keyOf = new Map(before.map((r) => [Number(r.id), inputKey(r.input)]));
  const due = scheduleOrder(fresh.filter((c) => { const h = latest.get(c.user_id); return !h || keyOf.get(h.id) !== inputKey(c.input); }), lastRuns, today);
  const { day, weekday } = dayOf(today);
  let ran = 0, failed = 0, deferred = 0;
  if (!dry) {
    const queue = [...due];
    const work = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        if (Date.now() - started > BUDGET_MS) { deferred += 1 + queue.length; queue.length = 0; return; }
        try {
          const result = await runSecretary({ tenantId: c.tenant_id, userId: c.user_id, input: c.input, runKind: "schedule", basisAt: c.captured_at, asOf: { today, weekday, day, basis: basisText(c.captured_at, today) } });
          if (result.ok) ran += 1;
          else if (result.status !== 429) { failed += 1; reportError(new Error(result.error), { scope: "cron.dashboard-secretary.run", tenantId: c.tenant_id }); }
        } catch (error) {
          failed += 1;
          reportError(error, { scope: "cron.dashboard-secretary.run", tenantId: c.tenant_id });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, work));
  }
  return {
    captures: captures.length, due: due.length, ran, failed, deferred,
    unlicensed: allowed.length - licensed.length, repeated: licensed.length - fresh.length, same: fresh.length - due.length, skipped: captures.length - due.length,
  };
}
