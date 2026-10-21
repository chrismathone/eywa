import "server-only";

/**
 * **배정 삭제 때 그 교재 진도 줄 + 표식 함께 지우기** — 서버 전용 IO. 원장 2026-10-19: 잘못 배정한 교재 줄을
 * 칸마다 하나씩 열어 지우고 있었다(14:40~14:41 한 반에서 12번).
 *
 * 🔑 지우는 것 = **오늘(또는 배정 시작일 중 늦은 날) 이후** · 그 배정의 시기 · 그 교재의 **손대지 않은 배정 줄**
 *    (`isAssignedLine` — 구분·교재명이 같고 진도·과제가 그 교재 차수 문구로만 된 줄). 요일은 가리지 않는다.
 *    선생님이 고쳐 쓴 줄·다른 교재 줄·지난 수업 줄은 남긴다.
 * 🔑 표식은 그 배정 칸 중 **다른 배정이 같이 쓰지 않는 칸만**([`markersToClear`](../plan-delete.ts)).
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { isAssignedLine, type RelayBook } from "../lesson-relay";
import { markersToClear, picksCover } from "../plan-delete";
import { toUndoLine, type ShiftKind, type UndoLine } from "../shift-undo";
import { markerKeyOfRow, parseMarkerKey } from "../shift-key";
import { withMarkerCols } from "./shift-markers";

type Admin = ReturnType<typeof createAdminClient>;

export async function clearPlanLines(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  /** 지우는 배정 id — 줄 표식(0382a `lane`)의 키다(`planLane`, 2026-10-21). */
  planId: string;
  textbookId: string;
  termMode: "regular" | "exam";
  picks: readonly string[] | null;
  /** 그 반에 남는 다른 배정들의 `slot_picks`. */
  otherPicks: readonly (readonly string[] | null)[];
  /**
   * 같은 교재가 다른 축(JJ ↔ 수업)에도 배정돼 남아 있나 — 그러면 **줄은 안 지운다**. 줄엔 축 표시가 없어
   * 어느 배정이 쓴 줄인지 가를 수 없다(지우면 남는 배정의 줄까지 사라진다, 적대적 리뷰 2026-10-19).
   */
  keepLines: boolean;
  /**
   * 같은 교재의 **다른 배정**이 남아 있으면 그 배정 줄은 남기고 **이 배정 교시의 줄만** 지운다(2026-10-21 같은 교재
   * 배정 여럿 — 교시가 안 겹치니 칸으로 주인이 갈린다, `ownsCell`). null이면 그 교재 줄 전부(형제 없음).
   */
  onlyPicks?: readonly string[] | null;
  /**
   * 진도 줄·칸 표식까지 지우나(사용자가 [진도 줄도 함께 지우기]를 골랐을 때). false여도 **그 교재의 줄 표식**(0382a)은
   * 지운다 — 배정이 없으면 아무 계산에도 안 쓰이다가, 같은 교재를 다시 배정하는 순간 옛 미룸·당김이 새 배정에
   * 조용히 걸린다(적대적 리뷰 2026-10-20).
   */
  withLines?: boolean;
  from: string;
}): Promise<{ removed: UndoLine[]; markers: { key: string; kind: ShiftKind }[]; stopped: boolean }> {
  const { admin, tenantId, classId, from } = input;
  const [bookRes, lessons, lineRows, markRows] = await Promise.all([
    admin.from("textbooks").select("title, skill_area").eq("tenant_id", tenantId).eq("id", input.textbookId).maybeSingle(),
    fetchAllPaged<Record<string, unknown>>((f, t) =>
      admin
        .from("textbook_lessons")
        .select("lesson_no, progress, homework")
        .eq("tenant_id", tenantId)
        .eq("textbook_id", input.textbookId)
        .order("lesson_no", { ascending: true })
        .range(f, t) as never,
    ),
    fetchAllPaged<Record<string, unknown>>((f, t) =>
      admin
        .from("class_sheet_plan_lines")
        .select("id, plan_date, slot_start, term_mode, skill_area, line_no, textbook, page_range, progress, homework")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("term_mode", input.termMode)
        .gte("plan_date", from)
        .order("id", { ascending: true })
        .range(f, t) as never,
    ),
    withMarkerCols((cols) =>
      fetchAllPaged<Record<string, unknown>>((f, t) =>
        admin
          .from("class_lesson_shifts")
          .select(cols)
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .gte("plan_date", from)
          .order("id", { ascending: true })
          .range(f, t) as never,
      ),
    ),
  ]);
  if (bookRes.error) throw bookRes.error;
  const b = bookRes.data;

  // 되돌리기 기록 = **실제로 지운 것만**(앞뒤 스냅숏 차이로 만들면 그 사이 남이 쓴 줄까지 담긴다).
  const removed: UndoLine[] = [];
  const withLines = input.withLines !== false;
  if (withLines && b?.skill_area && !input.keepLines) {
    const texts = (vals: unknown[]) => new Set(vals.map((v) => String(v ?? "").trim()).filter((v) => v !== ""));
    const book: RelayBook = {
      skillArea: String(b.skill_area),
      title: String(b.title),
      progressTexts: texts(lessons.map((l) => l.progress)),
      homeworkTexts: texts(lessons.map((l) => l.homework)),
    };
    const rows = lineRows.filter((r) =>
      (!input.onlyPicks || picksCover(input.onlyPicks, String(r.plan_date).slice(0, 10), String(r.slot_start).slice(0, 5))) &&
      isAssignedLine(
        {
          id: String(r.id),
          date: String(r.plan_date).slice(0, 10),
          slot: String(r.slot_start).slice(0, 5),
          skillArea: String(r.skill_area ?? ""),
          lineNo: Number(r.line_no ?? 0),
          textbook: (r.textbook as string | null) ?? null,
          progress: (r.progress as string | null) ?? null,
          homework: (r.homework as string | null) ?? null,
        },
        book,
      ),
    );
    // 묶음마다 지운 만큼 기록한다 — 중간에 멈춰도 그때까지 지운 줄은 되돌릴 수 있게(`stopped`).
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await admin
        .from("class_sheet_plan_lines")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .in(
          "id",
          chunk.map((r) => String(r.id)),
        );
      if (error) {
        reportError(error, { scope: "textbooks.plan-delete.lines", classId });
        return { removed, markers: [], stopped: true };
      }
      removed.push(...chunk.map(toUndoLine));
    }
  }

  // 표식은 평시 계산에만 쓰인다 — 내신 배정을 지울 땐 건드리지 않는다.
  const markers: { key: string; kind: ShiftKind }[] = [];
  if (input.termMode === "regular") {
    const byKey = new Map<string, Record<string, unknown>>(
      markRows.filter((m) => m.kind === "skip" || m.kind === "advance").map((m) => [markerKeyOfRow(m), m]),
    );
    // 칸 표식은 다른 배정이 같이 쓰지 않는 칸만(`markersToClear`). 줄 표식(0382a)은 **그 배정 것**(`lane` = 배정 id)을
    // 전부 지운다 — 다른 배정은 제 id로 읽으니 남는 배정에 안 닿는다. 옛 앱이 교재 id로 쓴 표식은 같은 교재가
    // 남아 있지 않을 때만(남아 있으면 그 배정 것일 수 있다).
    const keys = [
      ...(withLines
        ? markersToClear(
            [...byKey.keys()].filter((k) => parseMarkerKey(k)?.lane === ""),
            input.picks,
            input.otherPicks,
          )
        : []),
      ...[...byKey.keys()].filter((k) => {
        const lane = parseMarkerKey(k)?.lane;
        return lane === input.planId.toLowerCase() || (!input.keepLines && !input.onlyPicks && lane === input.textbookId.toLowerCase());
      }),
    ];
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const { error } = await admin
        .from("class_lesson_shifts")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .in(
          "id",
          chunk.map((k) => String(byKey.get(k)!.id)),
        );
      if (error) {
        reportError(error, { scope: "textbooks.plan-delete.markers", classId });
        return { removed, markers, stopped: true };
      }
      markers.push(...chunk.map((k) => ({ key: k, kind: byKey.get(k)!.kind as ShiftKind })));
    }
  }
  return { removed, markers, stopped: false };
}
