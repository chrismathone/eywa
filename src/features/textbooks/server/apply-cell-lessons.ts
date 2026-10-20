import "server-only";

/**
 * 교재 차수 → 실제 계획 줄 쓰기 — **차수 하나 = 줄 하나**(원장 2026-10-19). 서버 전용 IO.
 * 규칙은 [`planCellExtras`](../cell-lessons.ts)(순수) 한 곳이다.
 *
 * 가져오기(`importPlannedRange`)와 미룸·당김(`shiftAlongPlans`)이 **같은 함수**로 쓴다 — 둘이 따로 쓰면
 * 같은 칸이 가져오면 두 줄, 밀면 한 줄이 된다.
 *
 * ① 각 칸의 **첫 차수**는 종전 RPC(`ecs_apply_textbook_lessons`)로 — 같은 교재 줄 → 같은 구분의 빈 줄 → 새 줄,
 *    빈 칸만 채운다. 마이그레이션 없이 그대로 쓴다([[#95]]).
 * ② **둘째 차수부터**는 그 칸의 같은 교재 줄을 다시 읽어 k번째 줄의 빈 칸을 채우거나, 없으면
 *    `ecs_create_plan_line`(칸 락 + 줄 번호 max+1)으로 새 줄을 만든 뒤 채운다. RPC가 같은 교재 줄을 만나면
 *    멈추기 때문에 둘째 차수를 RPC로 보내면 조용히 사라진다(2026-10-16에 한 줄로 이었던 이유).
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { planCellExtras, type CellBookLine } from "../cell-lessons";
import type { CellLessons } from "../plan-expand";
import type { ApplyResult } from "../types";

type Admin = ReturnType<typeof createAdminClient>;

/** RPC 한 번에 싣는 칸 수(RPC 상한 300 = 락 예산 — 0266a). */
const RPC_CHUNK = 100;

export class ApplyCellLessonsError extends Error {
  constructor(readonly dbError: { code?: string; message?: string }) {
    super("apply-cell-lessons");
  }
}

const sameTitle = (a: unknown, b: string) => String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

export async function applyCellLessons(input: {
  admin: Admin;
  tenantId: string;
  actorId: string;
  classId: string;
  termMode: "regular" | "exam";
  book: { skillArea: string; title: string; pageTime: string | null };
  /** 날짜·교시 오름차순(락 순서 규약 — `groupCellLessons`가 그렇게 낸다). */
  cells: readonly CellLessons[];
}): Promise<ApplyResult> {
  const { admin, tenantId, actorId, classId, termMode, book } = input;
  const cells = input.cells.filter((c) => c.lessons.length > 0);
  const total: ApplyResult = { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0 };

  // ① 첫 차수 — 종전 RPC.
  const firsts = cells.map((c) => ({ date: c.date, slot: c.slot, ...c.lessons[0]! }));
  for (let i = 0; i < firsts.length; i += RPC_CHUNK) {
    const { data, error } = await admin.rpc("ecs_apply_textbook_lessons", {
      p_tenant: tenantId,
      p_actor: actorId,
      p_class: classId,
      p_term_mode: termMode,
      p_skill_area: book.skillArea,
      p_title: book.title,
      p_page_time: book.pageTime,
      p_targets: firsts.slice(i, i + RPC_CHUNK),
    });
    if (error) throw new ApplyCellLessonsError(error);
    const out = (data ?? {}) as Partial<ApplyResult>;
    total.applied += Number(out.applied ?? 0);
    total.filled += Number(out.filled ?? 0);
    total.added += Number(out.added ?? 0);
    total.skipped += Number(out.skipped ?? 0);
    total.truncated += Number(out.truncated ?? 0);
  }

  // ② 둘째 차수부터 — 칸마다(한 칸에 차수가 둘 이상인 칸은 한 달에 몇 칸뿐이다).
  for (const c of cells) {
    if (c.lessons.length < 2) continue;
    const cellMatch = { tenant_id: tenantId, class_id: classId, plan_date: c.date, slot_start: c.slot, term_mode: termMode };
    const { data: rows, error: readErr } = await admin
      .from("class_sheet_plan_lines")
      .select("id, skill_area, line_no, textbook, page_range, progress, homework")
      .match(cellMatch)
      .order("line_no", { ascending: true });
    if (readErr) throw new ApplyCellLessonsError(readErr);
    const lines: CellBookLine[] = ((rows ?? []) as Record<string, unknown>[])
      .filter((r) => r.skill_area === book.skillArea && sameTitle(r.textbook, book.title))
      .map((r) => ({
        id: String(r.id),
        textbook: (r.textbook as string | null) ?? null,
        pageRange: (r.page_range as string | null) ?? null,
        progress: (r.progress as string | null) ?? null,
        homework: (r.homework as string | null) ?? null,
      }));
    const plan = planCellExtras({ lessons: c.lessons, lines, title: book.title, pageTime: book.pageTime });
    const now = () => new Date().toISOString();

    for (const u of plan.updates) {
      const { error } = await admin
        .from("class_sheet_plan_lines")
        .update({ ...u.patch, updated_by: actorId, updated_at: now() })
        .eq("tenant_id", tenantId)
        .eq("id", u.id);
      if (error) throw new ApplyCellLessonsError(error);
      total.filled += 1;
      total.applied += 1;
    }
    for (const want of plan.creates) {
      const { data: created, error } = await admin.rpc("ecs_create_plan_line", {
        p_tenant: tenantId,
        p_actor: actorId,
        p_class: classId,
        p_plan_date: c.date,
        p_slot_start: c.slot,
        p_term_mode: termMode,
        p_skill_area: book.skillArea,
      });
      if (error) {
        // 20줄 상한 — RPC의 `truncated`와 같은 뜻(조용히 버리지 않고 센다).
        if (String(error.message ?? "").includes("ECS_MAX_LINES")) {
          total.truncated += 1;
          continue;
        }
        throw new ApplyCellLessonsError(error);
      }
      // 방금 만든 줄 = 이 시기에서 줄 번호가 가장 큰 **빈** 같은 구분 줄(RPC가 칸 전체를 돌려준다).
      const fresh = ((created ?? []) as Record<string, unknown>[])
        .filter(
          (r) =>
            r.term_mode === termMode &&
            r.skill_area === book.skillArea &&
            ![r.textbook, r.page_range, r.progress, r.homework].some((v) => String(v ?? "").trim() !== ""),
        )
        .sort((a, b) => Number(b.line_no) - Number(a.line_no))[0];
      if (!fresh) {
        total.skipped += 1;
        continue;
      }
      const { error: fillErr } = await admin
        .from("class_sheet_plan_lines")
        .update({
          textbook: book.title.trim(),
          page_range: book.pageTime?.trim() || null,
          progress: want.progress,
          homework: want.homework,
          updated_by: actorId,
          updated_at: now(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", String(fresh.id));
      if (fillErr) throw new ApplyCellLessonsError(fillErr);
      total.added += 1;
      total.applied += 1;
    }
  }
  return total;
}
