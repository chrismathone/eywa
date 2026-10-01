import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import {
  archivedClassNameCandidates,
  canFreeClassName,
  classNameHolderStatusLabel,
  duplicateClassNameMessage,
  isUniqueViolation,
  strongestClassNameHolder,
  type ClassNameConflict,
  type ClassNameHolder,
  type ClassNameHolderStatus,
  type FreeClosedNameRequest,
} from "../class-name-conflict";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * **반 이름 충돌 가드** — 반 이름을 쓰는 저장(반 수정·생성·레벨 변경)이 함께 지난다. 판정·문구는 순수 모듈
 * [`class-name-conflict.ts`](../class-name-conflict.ts), 여기는 조회·쓰기·감사로그.
 *
 * 🔴 **말없이 남의 반 이름을 바꾸지 않는다**(원장 2026-10-01). 종강·폐지 반 이름을 비우는 건 화면 버튼을 눌러 온
 *    요청뿐이고, 그때도 **지금 다시** 확인한다(그 사이 재운영·개명됐으면 비우지 않고 다시 묻는다).
 * 🔴 범위 = 같은 지점·같은 과목(유니크 인덱스와 같은 축) — 모든 조회·쓰기에 `tenant_id`·`subject`.
 * ⚠️ 트랜잭션이 아니다. "비우기 → 저장" 순서이고 저장이 실패하면 되돌린다. 되돌리지 못하면(그새 다른 반이 그 이름을
 *    가져감) 종강·폐지 반에 접미사가 붙은 채 남는다 — 해는 없지만 감사로그와 화면 문구로 그 사실을 남긴다.
 */

export type ClassNameTarget = {
  tenantId: string;
  subject: string;
  /** 저장하려는 이름(정규화된 값 — readForm이 `normalizeClassName`을 거친다). */
  name: string;
  /** 수정이면 그 반 자신 — 자기가 쥔 이름은 충돌이 아니다. */
  excludeId?: string | null;
};

export type FreedClassName = { id: string; from: string; to: string; status: ClassNameHolderStatus };

type Lookup<T> = { value: T } | { error: true };

/** 그 이름을 쥔 반들(자기 자신 제외). 유니크 인덱스라 보통 0~1개. 모르면 운영 중으로 본다(틀려도 안전한 쪽). */
async function loadHolders(db: Db, t: ClassNameTarget): Promise<Lookup<ClassNameHolder[]>> {
  let q = db
    .from("classes")
    .select("id, is_active, closed_at")
    .eq("tenant_id", t.tenantId)
    .eq("subject", t.subject)
    .eq("class_name", t.name);
  if (t.excludeId) q = q.neq("id", t.excludeId);
  const { data, error } = await q;
  if (error || !data) return { error: true };
  const rows = data as { id: string; is_active: boolean | null; closed_at: string | null }[];
  return { value: rows.map((r) => ({ id: r.id, isActive: r.is_active !== false, closedAt: r.closed_at ?? null })) };
}

/** 접미사 후보 중 비어 있는 첫 이름(대개 조회 1번). `.in()`은 이름에 `"`가 섞이면 인용이 깨져서 `.eq`로 하나씩. */
async function pickFreeName(db: Db, t: ClassNameTarget, closedAt: string | null): Promise<string | null> {
  for (const candidate of archivedClassNameCandidates(t.name, closedAt)) {
    const { data, error } = await db
      .from("classes")
      .select("id")
      .eq("tenant_id", t.tenantId)
      .eq("subject", t.subject)
      .eq("class_name", candidate)
      .limit(1);
    if (error || !data) return null;
    if (data.length === 0) return candidate;
  }
  return null;
}

/** 지금 이 이름이 누구와 겹치는가(없으면 null). `allowFree`=남의 반 이름을 비울 권한 — 없으면 버튼용 이름을 안 만든다. */
export async function describeClassNameConflict(
  db: Db,
  t: ClassNameTarget,
  today: string,
  allowFree: boolean,
): Promise<Lookup<ClassNameConflict | null>> {
  const holders = await loadHolders(db, t);
  if ("error" in holders) return holders;
  const best = strongestClassNameHolder(holders.value, today);
  if (!best) return { value: null };
  const freeTo = allowFree && canFreeClassName(best.status) ? await pickFreeName(db, t, best.holder.closedAt) : null;
  return {
    value: {
      name: t.name,
      status: best.status,
      message: duplicateClassNameMessage(best.status),
      holderId: best.holder.id,
      freeTo,
      allowFree,
    },
  };
}

type FreeOutcome =
  | { kind: "freed"; freed: FreedClassName }
  | { kind: "none" }
  | { kind: "conflict"; conflict: ClassNameConflict }
  | { kind: "error" };

/** 버튼 요청 — 동의한 그대로인지(같은 반·운영 중 아님·같은 새 이름) 다시 보고 비운다. 다르면 지금 상태로 다시 묻는다. */
async function freeHolder(db: Db, t: ClassNameTarget, request: FreeClosedNameRequest, today: string): Promise<FreeOutcome> {
  const now = await describeClassNameConflict(db, t, today, true);
  if ("error" in now) return { kind: "error" };
  if (!now.value) return { kind: "none" };
  const c = now.value;
  if (c.holderId !== request.holderId || !c.freeTo || c.freeTo !== request.to) return { kind: "conflict", conflict: c };
  // 조건부 갱신 — 확인과 쓰기 사이에 재운영·개명됐으면 0행. 운영 중 아님 = 폐지 또는 종강일 ≤ 오늘(순수 판정과 같은 축).
  const { data, error } = await db
    .from("classes")
    .update({ class_name: c.freeTo })
    .eq("id", c.holderId)
    .eq("tenant_id", t.tenantId)
    .eq("subject", t.subject)
    .eq("class_name", t.name)
    .or(`is_active.eq.false,closed_at.lte.${today}`)
    .select("id");
  if (error && !isUniqueViolation(error)) return { kind: "error" };
  if (error || !data || data.length !== 1) {
    // 접미사 이름을 그새 누가 가져갔거나(23505) 그 반이 바뀌었다 — 최신 상태로 다시 묻는다.
    const again = await describeClassNameConflict(db, t, today, true);
    if ("error" in again) return { kind: "error" };
    return again.value ? { kind: "conflict", conflict: again.value } : { kind: "none" };
  }
  return { kind: "freed", freed: { id: c.holderId, from: t.name, to: c.freeTo, status: c.status } };
}

/** 비운 이름을 원래대로 — 비운 그 이름 그대로일 때만(그새 누가 손댔으면 건드리지 않는다). taken = 그 이름을 그새 누가 씀. */
async function revertFreed(db: Db, t: ClassNameTarget, freed: FreedClassName): Promise<{ ok: boolean; taken: boolean }> {
  const { data, error } = await db
    .from("classes")
    .update({ class_name: freed.from })
    .eq("id", freed.id)
    .eq("tenant_id", t.tenantId)
    .eq("subject", t.subject)
    .eq("class_name", freed.to)
    .select("id");
  return { ok: !error && (data?.length ?? 0) === 1, taken: isUniqueViolation(error) };
}

/**
 * freed = 비움 · reverted = 되돌림 · stuck = 저장이 실패했는데 되돌리지 못해 비운 이름이 남음.
 * stuck은 누구를 위해 비웠는지 적지 않는다(그 저장은 없었다). `alreadyLogged`면 같은 변경이 이미 "비움"으로 남아 있어
 * 변경 내역 없이 사유만 남긴다(이력에 이름 변경이 두 번 찍히지 않게).
 */
type FreedLog =
  | { kind: "freed"; forClassId: string | null }
  | { kind: "reverted" }
  | { kind: "stuck"; taken: boolean; alreadyLogged: boolean };

/** 감사로그 — **비운 반을 대상으로**(반 이름은 시간 축이 없어 이력이 남는 자리가 여기뿐). 화면 `class_update`와 같은 모양. */
async function logFreed(freed: FreedClassName, log: FreedLog): Promise<void> {
  const label = classNameHolderStatusLabel(freed.status);
  const [from, to] = log.kind === "reverted" ? [freed.to, freed.from] : [freed.from, freed.to];
  const note =
    log.kind === "freed"
      ? `${label}이 쥔 이름을 비움 — 같은 과목의 다른 반이 이 이름을 쓰도록(저장 화면에서 확인)`
      : log.kind === "reverted"
        ? "비웠던 이름을 되돌림 — 같은 이름으로 만들려던 반 저장이 실패함"
        : `${label}이 쥔 이름을 비웠으나 같은 이름의 반 저장이 실패했고, 비운 이름을 되돌리지 못함${log.taken ? "(그사이 다른 반이 그 이름을 씀)" : ""}`;
  const changes = log.kind === "stuck" && log.alreadyLogged ? [] : [{ field: "반 이름", from, to }];
  await logAction({
    action: "class_update",
    targetType: "class",
    targetLabel: to,
    metadata: {
      classId: freed.id,
      changed: changes.map((c) => c.field),
      changes,
      note,
      ...(log.kind === "freed" && log.forClassId ? { freedForClassId: log.forClassId } : {}),
    },
  });
}

/**
 * 비운 뒤 그 저장을 **나중에** 무른 경우(새 반의 교시 저장 실패 → 반 삭제) — 되돌리고 그 결과도 남긴다.
 * 이 경로는 저장이 한 번 성공해 "비움" 로그가 이미 있다 → 되돌리지 못하면 사유만 남긴다.
 */
export async function rollbackFreedClassName(db: Db, t: ClassNameTarget, freed: FreedClassName): Promise<boolean> {
  const r = await revertFreed(db, t, freed);
  await logFreed(freed, r.ok ? { kind: "reverted" } : { kind: "stuck", taken: r.taken, alreadyLogged: true });
  return r.ok;
}

/** 되돌리지 못했을 때 사용자에게 붙이는 한 줄. */
export const freedLeftNotice = (to: string) => ` (비우려던 반 이름은 '${to}'(으)로 바뀐 채 남았습니다)`;

export type ClassNameGuardResult<T> =
  | { ok: true; data: T; freed: FreedClassName | null }
  | { ok: false; conflict: ClassNameConflict }
  | { ok: false; error: string };

/**
 * 반 이름을 쓰는 저장 한 번을 감싼다: (버튼 요청이면) 다시 확인해 비우기 → 저장 → 실패면 되돌리기.
 * 저장이 23505면 겹친 반의 상태를 돌려준다(오류 코드로만 판정). 다른 오류는 `failMessage`.
 */
export async function writeWithClassNameGuard<T>(args: {
  db: Db;
  target: ClassNameTarget;
  today: string;
  request: FreeClosedNameRequest | null;
  /** 남의 반(종강·폐지) 이름을 비울 권한 — 충돌·요청이 있을 때만 묻는다(평소 저장엔 왕복을 더하지 않는다). */
  canFree: () => Promise<boolean>;
  write: () => Promise<{ data: T; error: unknown }>;
  /** 저장된 반 id(감사로그의 "누구를 위해 비웠나"). */
  savedClassId: (data: T) => string | null;
  failMessage: string;
}): Promise<ClassNameGuardResult<T>> {
  const { db, target, today } = args;
  let allowed: boolean | undefined;
  const canFree = async () => (allowed ??= await args.canFree());
  let freed: FreedClassName | null = null;
  // 동의한 이름과 지금 저장하는 이름이 다르면(버튼을 누르기 전에 칸을 고쳤다) 그 동의는 이 저장의 것이 아니다.
  if (args.request && args.request.name === target.name && (await canFree())) {
    const r = await freeHolder(db, target, args.request, today);
    if (r.kind === "error") return { ok: false, error: args.failMessage };
    if (r.kind === "conflict") return { ok: false, conflict: r.conflict };
    if (r.kind === "freed") freed = r.freed;
  }

  const { data, error } = await args.write();
  if (!error) {
    if (freed) await logFreed(freed, { kind: "freed", forClassId: args.savedClassId(data) });
    return { ok: true, data, freed };
  }

  let tail = "";
  if (freed) {
    const r = await revertFreed(db, target, freed);
    if (!r.ok) {
      // 이 경로에선 "비움" 로그를 아직 안 남겼다 — 이 줄이 그 변경의 유일한 기록이라 변경 내역을 함께 적는다.
      await logFreed(freed, { kind: "stuck", taken: r.taken, alreadyLogged: false });
      tail = freedLeftNotice(freed.to);
    }
  }
  if (isUniqueViolation(error)) {
    const now = await describeClassNameConflict(db, target, today, await canFree());
    if (!("error" in now) && now.value) return { ok: false, conflict: { ...now.value, message: now.value.message + tail } };
  }
  return { ok: false, error: args.failMessage + tail };
}
