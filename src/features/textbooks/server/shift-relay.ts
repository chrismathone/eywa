import "server-only";

/**
 * 회차 미룸·당김 — **배정 교재가 지나가는 칸**이면 교재 순서대로 다시 깐다. 서버 전용 IO.
 * 규칙은 [`lesson-relay.ts`](../lesson-relay.ts)(순수) 한 곳이다.
 *
 * 원장 2026-10-16(*"1번으로 일단 작업해줘"*): 같은 요일·교시끼리 한 주씩 옮기면 화·금을 번갈아 나가는 교재의
 * 순서가 꼬인다(중등E_중1 SKY). 그래서 누른 칸이 배정 교재의 칸이면:
 *   ① 표식을 먼저 둔다(그 교재가 지나가는 칸 순서로 — 같은 칸을 두 번 누르면 다음 칸)
 *   ② 표식을 반영한 일정을 다시 계산해
 *   ③ 그 교재의 손대지 않은 배정 줄을 누른 칸부터 새 일정대로 고친다(고쳐 쓴 줄은 제자리 그대로)
 *   ④ 배정 교재가 아닌 줄(다른 구분·손으로 적은 다른 교재)은 종전대로 같은 요일·교시끼리 옮긴다([`shiftActualLines`])
 * 누른 칸을 지나가는 배정이 없으면 `handled: false` — 호출부가 종전 방식(④만)으로 처리한다.
 *
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 * 🔴 평시(`regular`)만 — 버튼이 평시 구획에만 서고 미루기 표식도 평시 계산에만 쓰인다.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { shiftDays } from "@/features/timetable/lib/week";
import { MAX_LOOKAHEAD_DAYS, planCellKeys, type SlotAxis } from "../lesson-schedule";
import { expandPlans, mergeSameCellLessons, type PlanRow } from "../plan-expand";
import { isAssignedLine, isBookLine, placeShiftMarker, planRelay, type RelayBook, type RelayLine, type RelayOp } from "../lesson-relay";
import { loadPlanMaterials } from "./month-plan";
import { isMissingTextbookTable } from "./access";
import { shiftActualLines } from "./shift-lines";

type Admin = ReturnType<typeof createAdminClient>;

export type ShiftRelayResult =
  | { handled: false }
  /**
   * `touched` = 줄이 바뀐 칸(`"YYYY-MM-DD|HH:MM"`) — 화면이 **같은 주의 다른 칸**까지 갈아 끼우는 데 쓴다
   * (화·금 교재는 화요일을 누르면 그 주 금요일도 바뀐다 — 누른 칸만 바꾸면 금요일이 옛 진도로 남아 보인다).
   */
  | { handled: true; ok: true; moved: number; touched: string[] }
  | { handled: true; ok: false; error: string };

/** RPC 한 번에 싣는 칸 수 — 가져오기(`importPlannedRange`)와 같은 예산. */
const RPC_CHUNK = 100;
const STOPPED = "진도를 옮기다 멈췄습니다 — 새로고침 후 확인해 주세요";

export async function shiftAlongPlans(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  date: string;
  slot: string;
  kind: "skip" | "advance";
  userId: string;
}): Promise<ShiftRelayResult> {
  const { admin, tenantId, classId, date, slot, kind, userId } = input;
  const pressedKey = `${date}|${slot}`;

  const materials = await loadPlanMaterials({ tenantId, classIds: [classId], to: shiftDays(date, MAX_LOOKAHEAD_DAYS) });
  if (materials.status === "missing-table") return { handled: false };
  // 🔴 못 읽었으면 종전 방식으로 떨어뜨리지 않는다 — 그게 바로 순서를 꼬던 길이다.
  if (materials.status !== "ok") {
    return { handled: true, ok: false, error: "교재 배정을 불러오지 못해 옮기지 않았습니다 — 잠시 뒤 다시 시도해 주세요" };
  }
  const m = materials.byClass.get(classId);
  const regular = (m?.plans ?? []).filter((p) => p.term_mode !== "exam");

  const cellsOf = (p: PlanRow) =>
    planCellKeys({
      startDate: String(p.start_date).slice(0, 10),
      schedules: m!.schedules,
      holidays: materials.holidays,
      axis: (p.slot_axis === "jj" ? "jj" : "class") as SlotAxis,
      slotPicks: Array.isArray(p.slot_picks) ? (p.slot_picks as unknown[]).map(String) : null,
      lookaheadDays: Math.max(1, Math.min(MAX_LOOKAHEAD_DAYS, daysBetween(String(p.start_date).slice(0, 10), date) + 120)),
    });
  // 누른 칸을 지나가는 배정 — 시작일이 누른 날 이후인 배정은 아직 이 칸에 안 왔다.
  const relevant: { plan: PlanRow; cells: string[] }[] = [];
  for (const p of regular) {
    if (String(p.start_date).slice(0, 10) > date) continue;
    const cells = cellsOf(p);
    if (cells.includes(pressedKey)) relevant.push({ plan: p, cells });
  }
  if (relevant.length === 0) return { handled: false };

  // ① 표식 — 그 교재가 지나가는 칸 순서로.
  const shifts = { ...(m!.shifts ?? {}) };
  const sequence = [...new Set(relevant.flatMap((r) => r.cells))].filter((k) => k >= pressedKey).sort();
  const mark = placeShiftMarker({ kind, pressedKey, sequence, shifts });
  if (!mark) return { handled: true, ok: false, error: "다음 수업일이 없어 미룰 수 없습니다 — 시간표를 확인해 주세요" };
  const [markDate, markSlot] = mark.key.split("|") as [string, string];
  const markerCell = { tenant_id: tenantId, class_id: classId, plan_date: markDate, slot_start: markSlot };
  const { error: markErr } =
    mark.op === "delete"
      ? await admin.from("class_lesson_shifts").delete().match(markerCell)
      : await admin
          .from("class_lesson_shifts")
          .upsert(
            { ...markerCell, kind, created_by: userId, updated_at: new Date().toISOString() },
            { onConflict: "tenant_id,class_id,plan_date,slot_start" },
          );
  if (markErr) {
    return {
      handled: true,
      ok: false,
      error: isMissingTextbookTable(markErr)
        ? "회차 미루기는 마이그레이션 0282a가 필요합니다 — 적용한 뒤 다시 시도해 주세요"
        : "회차를 바꾸지 못했습니다 — 잠시 뒤 다시 시도해 주세요",
    };
  }
  if (mark.op === "delete") delete shifts[mark.key];
  else shifts[mark.key] = kind;

  // ② 실제 줄(평시, 누른 날부터 전부).
  const rows = await fetchAllPaged<Record<string, unknown>>((f, t) =>
    admin
      .from("class_sheet_plan_lines")
      .select("id, plan_date, slot_start, skill_area, line_no, textbook, progress, homework")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("term_mode", "regular")
      .gte("plan_date", date)
      .order("plan_date", { ascending: true })
      .order("id", { ascending: true })
      .range(f, t) as never,
  );
  const lines: RelayLine[] = rows.map((r) => ({
    id: String(r.id),
    date: String(r.plan_date).slice(0, 10),
    slot: String(r.slot_start).slice(0, 5),
    skillArea: String(r.skill_area ?? ""),
    lineNo: Number(r.line_no ?? 0),
    textbook: (r.textbook as string | null) ?? null,
    progress: (r.progress as string | null) ?? null,
    homework: (r.homework as string | null) ?? null,
  }));

  type Book = RelayBook & { pageTime: string | null };
  const bookOf = (textbookId: string): Book | null => {
    const b = materials.books.get(textbookId);
    if (!b || !b.skillArea) return null;
    const lessons = [...(materials.lessonsByBook.get(textbookId)?.values() ?? [])];
    const texts = (vals: (string | null)[]) => new Set(vals.map((v) => String(v ?? "").trim()).filter((v) => v !== ""));
    return {
      skillArea: b.skillArea,
      title: b.title,
      pageTime: b.pageTime,
      progressTexts: texts(lessons.map((l) => l.progress)),
      homeworkTexts: texts(lessons.map((l) => l.homework)),
    };
  };

  // 🔑 **어느 배정이든** 그 교재의 줄(고쳐 쓴 줄 포함)은 요일 이동에서 뺀다 — 이 칸을 안 지나가는 배정의
  //    줄이나 고쳐 쓴 줄을 한 주씩 옮기면 그 교재가 다시 요일 축으로 꼬인다. 고쳐 쓴 줄은 제자리에 남는다.
  const bookLineIds = new Set<string>();
  for (const id of new Set(regular.map((p) => String(p.textbook_id)))) {
    const book = bookOf(id);
    if (!book) continue;
    for (const l of lines) if (isBookLine(l, book)) bookLineIds.add(l.id);
  }

  // ③ 이 칸을 지나가는 교재마다 새 일정대로.
  const ops: { book: Book; op: RelayOp }[] = [];
  const byBook = new Map<string, PlanRow[]>();
  for (const r of relevant) byBook.set(String(r.plan.textbook_id), [...(byBook.get(String(r.plan.textbook_id)) ?? []), r.plan]);
  for (const [textbookId, plans] of byBook) {
    const book = bookOf(textbookId);
    if (!book) continue;
    const mine = lines.filter((l) => isAssignedLine(l, book));
    const end = mine.map((l) => l.date).sort().at(-1);
    if (!end) continue; // 아직 가져오기 전 — 표식만으로 월간계획이 맞춰진다.
    const scheduleWith = (s: Record<string, "skip" | "advance">) =>
      mergeSameCellLessons(
        Object.values(
          expandPlans({
            plans,
            books: materials.books,
            lessonsByBook: materials.lessonsByBook,
            schedules: m!.schedules,
            holidays: materials.holidays,
            shifts: s,
            from: date,
            to: end,
          }),
        ).flat(),
      );
    // 새 일정(표식 반영) + 누르기 전 일정(지워도 되는 칸을 가른다 — `planRelay`의 🔴).
    const plan = planRelay({ kind, date, slot, lines: mine, targets: scheduleWith(shifts), previous: scheduleWith(m!.shifts ?? {}) });
    for (const op of plan.ops) ops.push({ book, op });
  }

  let moved = 0;
  const lineCell = new Map(lines.map((l) => [l.id, `${l.date}|${l.slot}`]));
  const touched = new Set<string>([pressedKey]);
  for (const { op } of ops) {
    const k = op.op === "insert" ? `${op.date}|${op.slot}` : lineCell.get(op.id);
    if (k) touched.add(k);
  }
  // 고치기·지우기 먼저(같은 칸의 옛 줄이 비켜야 새 줄이 안 겹친다).
  for (const { op } of ops) {
    if (op.op === "update") {
      const { error } = await admin
        .from("class_sheet_plan_lines")
        .update({ progress: op.progress, homework: op.homework, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", op.id);
      if (error) return { handled: true, ok: false, error: STOPPED };
      moved += 1;
    } else if (op.op === "delete") {
      const { error } = await admin.from("class_sheet_plan_lines").delete().eq("tenant_id", tenantId).eq("id", op.id);
      if (error) return { handled: true, ok: false, error: STOPPED };
      moved += 1;
    }
  }

  // ④ 배정 교재가 아닌 줄은 종전대로 같은 요일·교시끼리. 옮길 게 없거나 다음 수업일이 없으면 그냥 둔다
  //    (표식과 교재 줄은 이미 맞췄다 — 손으로 적은 줄 하나 때문에 전체를 실패로 돌리지 않는다).
  const weekly = await shiftActualLines({ admin, tenantId, classId, date, slot, kind, userId, excludeIds: bookLineIds });
  if (weekly.ok) moved += weekly.moved;
  else if (weekly.stopped) return { handled: true, ok: false, error: STOPPED };

  // 빈 칸에 새로 쓰기 — 가져오기와 같은 RPC(같은 교재명 줄이 있으면 빈 칸만 채운다 = 고쳐 쓴 줄을 안 덮는다).
  const inserts = new Map<Book, Extract<RelayOp, { op: "insert" }>[]>();
  for (const { book, op } of ops) if (op.op === "insert") inserts.set(book, [...(inserts.get(book) ?? []), op]);
  for (const [book, list] of inserts) {
    const targets = list
      .map((o) => ({ date: o.date, slot: o.slot, progress: o.progress, homework: o.homework }))
      .sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)));
    for (let i = 0; i < targets.length; i += RPC_CHUNK) {
      const { data, error } = await admin.rpc("ecs_apply_textbook_lessons", {
        p_tenant: tenantId,
        p_actor: userId,
        p_class: classId,
        p_term_mode: "regular",
        p_skill_area: book.skillArea,
        p_title: book.title,
        p_page_time: book.pageTime,
        p_targets: targets.slice(i, i + RPC_CHUNK),
      });
      if (error) return { handled: true, ok: false, error: STOPPED };
      moved += Number((data as { applied?: number } | null)?.applied ?? 0);
    }
  }

  return { handled: true, ok: true, moved, touched: [...touched].sort() };
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}
