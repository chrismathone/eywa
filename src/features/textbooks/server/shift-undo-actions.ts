"use server";

/**
 * **미룸·당김 되돌리기** 서버 액션 — 규칙은 [`planShiftUndo`](../shift-undo.ts)(순수) 한 곳이다.
 *
 * 🔴 게이트는 그 반의 ECS 쓰기 권한 — 서버 액션은 공개 엔드포인트다([[#77]]).
 * 🔴 기록(token)은 **클라가 들고 온 값**이다 — 그래서 ① 반은 게이트가 연 반으로 고정하고(tenant·class는 서버가
 *    채운다), ② 값의 모양을 전부 검사하며, ③ 지우기·고치기는 **지금도 기록 그대로인 그 반 줄**에만 한다.
 *    되살리는 줄은 그 반의 평시 줄로만 들어간다 — 이 반을 쓸 수 있는 사람이 칸에 직접 쓸 수 있는 것보다
 *    넓은 일은 못 한다.
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { reportError } from "@/lib/observability/report-error";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import type { PlanLineDTO } from "@/features/class-sheets/server/actions";
import { planShiftUndo, slotOf, toUndoLine, type ShiftKind, type ShiftUndoToken, type UndoLine } from "../shift-undo";
import { readWeekCells } from "./shift-snapshot";

export type ShiftUndoResult =
  | { ok: true; cells?: { date: string; slotStart: string; lines: PlanLineDTO[] }[] }
  | { ok: false; error: string };

const CHANGED = "그 사이 이 반의 진도가 바뀌어 되돌리지 않았습니다 — 화면을 새로고침해 확인해 주세요";
const STOPPED = "되돌리다 멈췄습니다 — 새로고침 후 확인해 주세요";
/** 한 번 누름이 바꾸는 줄은 한 반 몇 달 치라 수백 줄 이하다 — 이보다 크면 위조로 본다. */
const MAX_ROWS = 3000;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^[0-2]\d:[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKILL = /^[a-z0-9_]{1,24}$/;

function validLine(v: unknown): v is UndoLine {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  const text = (x: unknown) => x === null || (typeof x === "string" && x.length <= 500);
  return (
    typeof l.id === "string" &&
    UUID.test(l.id) &&
    typeof l.plan_date === "string" &&
    YMD.test(l.plan_date) &&
    typeof l.slot_start === "string" &&
    HHMM.test(l.slot_start) &&
    l.term_mode === "regular" &&
    typeof l.skill_area === "string" &&
    SKILL.test(l.skill_area) &&
    Number.isInteger(l.line_no) &&
    (l.line_no as number) >= 1 &&
    (l.line_no as number) <= 20 &&
    text(l.textbook) &&
    text(l.page_range) &&
    text(l.progress) &&
    text(l.homework)
  );
}
const validKind = (v: unknown): v is ShiftKind | null => v === null || v === "skip" || v === "advance";

function validToken(t: unknown, classId: string): t is ShiftUndoToken {
  if (!t || typeof t !== "object") return false;
  const k = t as Record<string, unknown>;
  if (k.classId !== classId || typeof k.date !== "string" || !YMD.test(k.date)) return false;
  if (typeof k.slot !== "string" || !HHMM.test(k.slot)) return false;
  const { removed, added, changed, markers } = k;
  if (!Array.isArray(removed) || !Array.isArray(added) || !Array.isArray(changed) || !Array.isArray(markers)) return false;
  if (removed.length + added.length + changed.length + markers.length > MAX_ROWS) return false;
  return (
    removed.every(validLine) &&
    added.every(validLine) &&
    changed.every((c) => !!c && typeof c === "object" && validLine(c.before) && validLine(c.after) && c.before.id === c.after.id) &&
    markers.every(
      (m) =>
        !!m &&
        typeof m === "object" &&
        typeof m.key === "string" &&
        YMD.test(m.key.slice(0, 10)) &&
        m.key[10] === "|" &&
        HHMM.test(m.key.slice(11)) &&
        validKind(m.before) &&
        validKind(m.after),
    )
  );
}

export async function undoLessonShift(input: { classId: string; token: ShiftUndoToken }): Promise<ShiftUndoResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!validToken(input.token, input.classId)) return { ok: false, error: "되돌릴 기록이 올바르지 않습니다" };
  const token = input.token;
  const admin = createAdminClient();
  const tenantId = gate.access.tenantId;
  const classId = input.classId;

  try {
    // 지금 모습 — 기록에 나온 줄 id들 + 되살릴 줄이 들어갈 칸들 + 기록에 나온 표식 칸들.
    const ids = [...new Set([...token.added, ...token.removed, ...token.changed.map((c) => c.after)].map((l) => l.id))];
    const tokenIds = new Set(ids);
    const dates = [
      ...new Set([
        ...token.removed.map((l) => l.plan_date),
        ...token.changed.map((c) => c.before.plan_date),
        ...token.markers.map((m) => m.key.slice(0, 10)),
      ]),
    ];
    const [byId, inDates, marks] = await Promise.all([
      fetchInChunks<Record<string, unknown>>(ids, (chunk) =>
        admin
          .from("class_sheet_plan_lines")
          .select("id, plan_date, slot_start, term_mode, skill_area, line_no, textbook, page_range, progress, homework")
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .in("id", chunk) as never,
      ),
      fetchInChunks<Record<string, unknown>>(dates, (chunk) =>
        admin
          .from("class_sheet_plan_lines")
          .select("id, plan_date, slot_start, term_mode, line_no")
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .in("plan_date", chunk) as never,
      ),
      fetchInChunks<Record<string, unknown>>(dates, (chunk) =>
        admin
          .from("class_lesson_shifts")
          .select("plan_date, slot_start, kind")
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .in("plan_date", chunk) as never,
      ),
    ]);
    const current = new Map(byId.map((r) => [String(r.id), toUndoLine(r)]));
    const occupied = new Set(
      inDates
        .filter((r) => !tokenIds.has(String(r.id)))
        .map((r) =>
          slotOf({
            plan_date: String(r.plan_date).slice(0, 10),
            slot_start: String(r.slot_start).slice(0, 5),
            term_mode: String(r.term_mode),
            line_no: Number(r.line_no),
          }),
        ),
    );
    const currentMarkers: Record<string, ShiftKind> = {};
    for (const m of marks) {
      const kind = String(m.kind);
      if (kind === "skip" || kind === "advance") {
        currentMarkers[`${String(m.plan_date).slice(0, 10)}|${String(m.slot_start).slice(0, 5)}`] = kind;
      }
    }

    const plan = planShiftUndo(token, current, currentMarkers, occupied);
    if (!plan.ok) return { ok: false, error: CHANGED };

    const now = new Date().toISOString();
    const actor = gate.access.user.id;
    const lines = () => admin.from("class_sheet_plan_lines");
    // 순서: 되돌려 고치기(내용만 — 자리를 안 바꾼다) → 지우기(자리 비우기) → 되살리기 → 표식.
    // ⚠️ 한 트랜잭션이 아니다(SQL 함수를 새로 두면 손 적용 간격이 생긴다 [[#95]]) — 지우기와 되살리기 사이에서
    //    멈추면 반쪽이 남는다. 그래서 위험이 없는 고치기를 먼저 하고, 지우기~되살리기 구간을 짧게 붙여 둔다.
    for (const r of plan.restores) {
      const { id, ...fields } = r;
      const { error } = await lines()
        .update({ ...fields, updated_by: actor, updated_at: now })
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("id", id);
      if (error) throw error;
    }
    for (let i = 0; i < plan.deletes.length; i += 100) {
      const { error } = await lines().delete().eq("tenant_id", tenantId).eq("class_id", classId).in("id", plan.deletes.slice(i, i + 100));
      if (error) throw error;
    }
    if (plan.reinserts.length > 0) {
      const rows = plan.reinserts.map((r) => ({ ...r, tenant_id: tenantId, class_id: classId, updated_by: actor }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await lines().insert(rows.slice(i, i + 200));
        if (error) throw error;
      }
    }
    for (const m of plan.markers) {
      const [plan_date, slot_start] = m.key.split("|") as [string, string];
      const cell = { tenant_id: tenantId, class_id: classId, plan_date, slot_start };
      const { error } =
        m.kind === null
          ? await admin.from("class_lesson_shifts").delete().match(cell)
          : await admin
              .from("class_lesson_shifts")
              .upsert({ ...cell, kind: m.kind, created_by: actor, updated_at: now }, { onConflict: "tenant_id,class_id,plan_date,slot_start" });
      if (error) throw error;
    }
  } catch (e) {
    reportError(e, { scope: "textbooks.lesson-shift-undo", classId });
    revalidatePath(`/ecs/${classId}`, "layout");
    return { ok: false, error: STOPPED };
  }

  await logAction({
    action: "textbook_lesson_shift_undo",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: {
      date: token.date,
      removed: token.removed.length,
      added: token.added.length,
      changed: token.changed.length,
      markers: token.markers.length,
    },
  });
  revalidatePath(`/ecs/${classId}`, "layout");

  // 화면 갈아 끼우기 — 누른 날이 있는 주의 바뀐 칸들(다른 주는 그 주를 열 때 서버가 준다).
  const keys = [
    ...token.removed,
    ...token.added,
    ...token.changed.map((c) => c.after),
    ...token.changed.map((c) => c.before),
  ].map((l) => `${l.plan_date}|${l.slot_start}`);
  const week = await readWeekCells({ admin, tenantId, classId, date: token.date, slot: token.slot, keys }).catch(() => null);
  return { ok: true, cells: week?.cells };
}
