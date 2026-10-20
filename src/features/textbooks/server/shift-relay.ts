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
import { reportError } from "@/lib/observability/report-error";
import { shiftDays } from "@/features/timetable/lib/week";
import { MAX_LOOKAHEAD_DAYS, normalizeLessonPace, planCellKeys, positionCountAt, type SlotAxis } from "../lesson-schedule";
import { expandPlans, groupCellLessons, type PlanRow } from "../plan-expand";
import { isAssignedLine, isBookLine, placeShiftMarker, planRelay, type RelayBook, type RelayLine, type RelayOp } from "../lesson-relay";
import { loadPlanMaterials } from "./month-plan";
import { isMissingTextbookTable } from "./access";
import { shiftActualLines } from "./shift-lines";
import { advanceStackAt, cellMarkerKey, isMarkerAtCell, laneMarkerKey, nextAdvanceStackKey, parseMarkerKey } from "../shift-key";
import { LANE_MIGRATION_NEEDED, writeMarker } from "./shift-markers";
import { applyCellLessons } from "./apply-cell-lessons";

type Admin = ReturnType<typeof createAdminClient>;

export type ShiftRelayResult =
  | { handled: false }
  /**
   * `touched` = 줄이 바뀐 칸(`"YYYY-MM-DD|HH:MM"`) — 화면이 **같은 주의 다른 칸**까지 갈아 끼우는 데 쓴다
   * (화·금 교재는 화요일을 누르면 그 주 금요일도 바뀐다 — 누른 칸만 바꾸면 금요일이 옛 진도로 남아 보인다).
   */
  | { handled: true; ok: true; moved: number; touched: string[] }
  | { handled: true; ok: false; error: string };

const STOPPED = "진도를 옮기다 멈췄습니다 — 새로고침 후 확인해 주세요";

/**
 * 무엇을 눌렀나.
 * · `cell` — 교시 통째(옛 화면이 보내는 모양 — 배포 직후 열려 있던 창). 칸 표식(0282a).
 * · `line` — **줄 하나**(원장 2026-10-20 *"수업이 2개면 각각 미룸, 당김"*). 그 줄의 교재 한 차수만, 줄 표식(0382a).
 * · `fill` — **계획만 있는 칸의 당김**(원장 2026-10-20 *"계획만 있을 경우 미룸버튼은 없고 당겨서 전수업 한시간씩
 *   당겨지게"*). 그 칸의 미룸 표식을 걷어 뒤 수업이 한 칸씩 올라와 그 칸을 채운다 — **아무 차수도 버리지 않는다**.
 */
export type ShiftTarget = { by: "cell" } | { by: "line"; lineId: string } | { by: "fill" };

export async function shiftAlongPlans(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  date: string;
  slot: string;
  kind: "skip" | "advance";
  userId: string;
  target?: ShiftTarget;
}): Promise<ShiftRelayResult> {
  const { admin, tenantId, classId, date, slot, kind, userId } = input;
  const target: ShiftTarget = input.target ?? { by: "cell" };
  const pressedKey = cellMarkerKey(date, slot);

  const materials = await loadPlanMaterials({ tenantId, classIds: [classId], to: shiftDays(date, MAX_LOOKAHEAD_DAYS) });
  if (materials.status === "missing-table") return { handled: false };
  // 🔴 못 읽었으면 종전 방식으로 떨어뜨리지 않는다 — 그게 바로 순서를 꼬던 길이다.
  if (materials.status !== "ok") {
    return { handled: true, ok: false, error: "교재 배정을 불러오지 못해 옮기지 않았습니다 — 잠시 뒤 다시 시도해 주세요" };
  }
  const m = materials.byClass.get(classId);
  const regular = (m?.plans ?? []).filter((p) => p.term_mode !== "exam");

  const picksOf = (p: PlanRow) => (Array.isArray(p.slot_picks) ? (p.slot_picks as unknown[]).map(String) : null);
  const cellsOf = (p: PlanRow) =>
    planCellKeys({
      startDate: String(p.start_date).slice(0, 10),
      schedules: m!.schedules,
      holidays: materials.holidays,
      axis: (p.slot_axis === "jj" ? "jj" : "class") as SlotAxis,
      slotPicks: picksOf(p),
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

  // 실제 줄(평시, 누른 날부터 전부).
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
  let lines: RelayLine[] = rows.map((r) => ({
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
  const byBook = new Map<string, PlanRow[]>();
  for (const r of relevant) byBook.set(String(r.plan.textbook_id), [...(byBook.get(String(r.plan.textbook_id)) ?? []), r.plan]);

  const shifts = { ...(m!.shifts ?? {}) };
  const scheduleOf = (plans: readonly PlanRow[], s: Record<string, "skip" | "advance">, to: string) =>
    expandPlans({
      plans,
      books: materials.books,
      lessonsByBook: materials.lessonsByBook,
      schedules: m!.schedules,
      holidays: materials.holidays,
      shifts: s,
      from: date,
      to,
    });

  // ① 표식 — 무엇을 눌렀나에 따라.
  /** 이번에 다시 깔 교재(그 밖의 교재 줄은 손대지 않는다). */
  let books = [...byBook.keys()];
  /** 다시 깔기 전에 지울 줄 — 줄 하나를 눌렀는데 그 줄이 고쳐 쓴 줄이면(아래). */
  const dropFirst: string[] = [];
  const writes: { key: string; kind: "skip" | "advance" | null }[] = [];

  /** 교시 통째(옛 화면, 또는 0382a 전 줄 누름의 대체) — 그 칸을 지나가는 교재 칸 순서로. */
  const cellMark = () => {
    const sequence = [...new Set(relevant.flatMap((r) => r.cells))].filter((k) => k >= pressedKey).sort();
    return placeShiftMarker({ kind, pressedKey, sequence, shifts });
  };
  const NO_NEXT = "다음 수업일이 없어 미룰 수 없습니다 — 시간표를 확인해 주세요";
  /** 0382a 전에 줄 표식을 못 쓸 때 **교시 통째로 대신해도 같은 뜻인가** — 이 칸에 이 교재 한 차수뿐일 때만. */
  let cellFallbackOk = false;
  /** 줄 하나 대신 교시 통째로 쓸 표식(0382a 전, `cellFallbackOk`일 때만). */
  let cellFallback: { key: string; kind: "skip" | "advance" | null } | null = null;
  /** 줄 표식을 걷어 낸 칸 표식(`fill`) 중 **교시 통째 미룸**이 있었나 — 그때만 손으로 적은 줄도 한 주 되돌린다. */
  let removedCellSkip = false;

  if (target.by === "line") {
    const pressed = lines.find((l) => l.id === target.lineId);
    if (!pressed || pressed.date !== date || pressed.slot !== slot) {
      return { handled: true, ok: false, error: "그 사이 이 줄이 바뀌었습니다 — 새로고침 후 다시 눌러 주세요" };
    }
    const lane = books.find((id) => {
      const b = bookOf(id);
      return b !== null && isBookLine(pressed, b);
    });
    // 배정 교재 줄이 아니다(손으로 적은 다른 교재) — 호출부가 그 줄만 같은 요일·교시끼리 옮긴다.
    if (!lane) return { handled: false };
    const book = bookOf(lane)!;
    const plansT = byBook.get(lane)!;
    // 🔑 옛 칸 표식으로 통째 미뤄 둔 칸 — 이 교재 자리가 없다. 그 칸 안의 줄은 교시 통째로 다룬다(종전 그대로).
    if (shifts[pressedKey] === "skip") {
      const mark = cellMark();
      if (!mark) return { handled: true, ok: false, error: NO_NEXT };
      writes.push({ key: mark.key, kind: mark.op === "delete" ? null : kind });
    } else {
      books = [lane];
      const allDay = plansT.every((p) => normalizeLessonPace(p.pace) === "day");
      const slotsAt = (d: string, sl: string) => (allDay ? 1 : Math.max(...plansT.map((p) => positionCountAt(picksOf(p), d, sl))));
      // 🔑 몇 번째 자리인가 — 칸 안 그 교재 줄의 순서 = 지금 일정에서 차수가 앉은 자리의 순서. 줄 순서는
      //    다시 깔기(`planRelay`)와 **같은 규칙**으로 센다(배정 줄 → 고쳐 쓴 줄, 줄 번호 순 · 안정 정렬) — 다르면
      //    누른 줄이 아닌 옆 줄의 차수가 움직인다. 그 칸의 앞 자리를 미뤄 두었으면 줄 1개가 2번 자리다.
      const inCell = (l: RelayLine) => l.date === date && l.slot === slot;
      const cellLines = [
        ...lines.filter((l) => inCell(l) && isAssignedLine(l, book)),
        ...lines.filter((l) => inCell(l) && isBookLine(l, book) && !isAssignedLine(l, book)),
      ].sort((a, b) => a.lineNo - b.lineNo);
      const filledPos = (scheduleOf(plansT, shifts, date)[pressedKey] ?? []).map((l) => l.pos).sort((a, b) => a - b);
      const i = cellLines.findIndex((l) => l.id === pressed.id);
      if (i < 0 || i >= filledPos.length) {
        return { handled: true, ok: false, error: "이 줄은 교재 일정에 없는 자리라 옮길 수 없습니다 — 줄을 직접 고쳐 주세요" };
      }
      const pos = filledPos[i]!;
      cellFallbackOk = byBook.size === 1 && slotsAt(date, slot) === 1;
      const stack = advanceStackAt(shifts, date, slot, lane, pos);
      if (kind === "advance" && stack.length > 0) {
        // 같은 줄을 또 당겼다 — 그 자리에 하나 더 쌓는다(다음 자리에 걸면 누른 줄은 그대로고 엉뚱한 차수가 빠진다).
        const key = nextAdvanceStackKey(shifts, date, slot, lane, pos);
        if (!key) return { handled: true, ok: false, error: "이 줄은 더 당길 수 없습니다 — 다음 줄에서 당겨 주세요" };
        writes.push({ key, kind: "advance" });
      } else if (kind === "skip" && stack.length > 0) {
        // 당겨 둔 자리를 미룸 — 쌓인 당김을 하나 걷는다(당김 뒤 미룸 = 한 번 덜 당김).
        writes.push({ key: stack.at(-1)!, kind: null });
      } else {
        // 그 교재가 지나가는 자리 순서 — 칸 순 → 자리 순. 칸째 미룬 칸(옛 칸 표식)은 자리가 없다.
        const sequence: string[] = [];
        for (const cell of [...new Set(relevant.filter((r) => String(r.plan.textbook_id) === lane).flatMap((r) => r.cells))].sort()) {
          if (cell < pressedKey || shifts[cell] === "skip") continue;
          const [d, sl] = cell.split("|") as [string, string];
          for (let k = 1; k <= slotsAt(d, sl); k += 1) sequence.push(laneMarkerKey(d, sl, lane, k));
        }
        const mark = placeShiftMarker({ kind, pressedKey: laneMarkerKey(date, slot, lane, pos), sequence, shifts });
        if (!mark) return { handled: true, ok: false, error: NO_NEXT };
        writes.push({ key: mark.key, kind: mark.op === "delete" ? null : kind });
      }
      if (cellFallbackOk) {
        const mark = cellMark();
        cellFallback = mark ? { key: mark.key, kind: mark.op === "delete" ? null : kind } : null;
      }
      // 🔑 누른 줄이 **고쳐 쓴 줄**이면 다시 깔기가 그 줄을 제자리에 둔다(`planRelay` — 사람이 쓴 줄은 안 덮는다).
      //    그러면 미룸의 "해당영역 날리고"도, 당김의 "누른 줄 지움"도 안 된다 → 눌렀다는 건 그 줄을 놓겠다는 뜻이니
      //    먼저 지운다(되돌리기 기록엔 앞뒤 차이로 담긴다).
      if (!isAssignedLine(pressed, book)) dropFirst.push(pressed.id);
    }
  } else if (target.by === "fill") {
    // 🔴 계획만 있는 칸에서만 — 진도가 적힌 칸은 줄마다의 당김을 쓴다(그쪽은 누른 줄을 지운다).
    if (lines.some((l) => l.date === date && l.slot === slot && hasContent(l))) {
      return { handled: true, ok: false, error: "이 칸엔 이미 진도가 있습니다 — 새로고침 후 줄의 [당김]을 눌러 주세요" };
    }
    for (const [key, k] of Object.entries(shifts)) {
      if (k === "skip" && isMarkerAtCell(key, date, slot)) writes.push({ key, kind: null });
    }
    // 🔴 미뤄 비운 칸이 아니면 거절한다 — 걷을 미룸이 없는데 "당겼다"고 하면 거짓이고, 그 칸만 가져오기를 하면
    //    다른 칸과 어긋나 같은 차수가 두 번 생길 수 있다(적대적 리뷰 2026-10-20). 화면도 미룸이 있는 칸에만 세운다.
    if (writes.length === 0) return { handled: true, ok: false, error: "이 칸은 미뤄 둔 칸이 아니라 당길 것이 없습니다" };
    removedCellSkip = shifts[pressedKey] === "skip";
  } else {
    const mark = cellMark();
    if (!mark) return { handled: true, ok: false, error: NO_NEXT };
    writes.push({ key: mark.key, kind: mark.op === "delete" ? null : kind });
  }

  for (let wi = 0; wi < writes.length; wi += 1) {
    let w = writes[wi]!;
    let { error, laneMissing } = await writeMarker({ admin, tenantId, classId, key: w.key, kind: w.kind, actor: userId });
    // 0382a 전 — 이 칸에 이 교재 한 차수뿐이면 교시 통째 표식이 같은 뜻이다(종전 버튼 그대로 동작).
    if (laneMissing && cellFallback) {
      w = cellFallback;
      writes[wi] = w;
      books = [...byBook.keys()];
      ({ error, laneMissing } = await writeMarker({ admin, tenantId, classId, key: w.key, kind: w.kind, actor: userId }));
    }
    if (error) {
      return {
        handled: true,
        ok: false,
        error: laneMissing
          ? LANE_MIGRATION_NEEDED
          : isMissingTextbookTable(error)
            ? "회차 미루기는 마이그레이션 0282a가 필요합니다 — 적용한 뒤 다시 시도해 주세요"
            : "회차를 바꾸지 못했습니다 — 잠시 뒤 다시 시도해 주세요",
      };
    }
    if (w.kind === null) delete shifts[w.key];
    else shifts[w.key] = w.kind;
  }

  // 🔑 **어느 배정이든** 그 교재의 줄(고쳐 쓴 줄 포함)은 요일 이동에서 뺀다 — 이 칸을 안 지나가는 배정의
  //    줄이나 고쳐 쓴 줄을 한 주씩 옮기면 그 교재가 다시 요일 축으로 꼬인다. 고쳐 쓴 줄은 제자리에 남는다.
  const bookLineIds = new Set<string>();
  for (const id of new Set(regular.map((p) => String(p.textbook_id)))) {
    const book = bookOf(id);
    if (!book) continue;
    for (const l of lines) if (isBookLine(l, book)) bookLineIds.add(l.id);
  }

  let moved = 0;
  const touched = new Set<string>([pressedKey]);
  for (const id of dropFirst) {
    const { error } = await admin.from("class_sheet_plan_lines").delete().eq("tenant_id", tenantId).eq("id", id);
    if (error) return { handled: true, ok: false, error: STOPPED };
    moved += 1;
  }
  if (dropFirst.length > 0) lines = lines.filter((l) => !dropFirst.includes(l.id));

  // ② 다시 깔 교재마다 새 일정대로. 계획만 있는 칸의 당김은 누른 칸이 새 일정의 첫 칸이다(당김과 같은 범위).
  const relayKind = target.by === "fill" ? "advance" : kind;
  const lineCell = new Map(lines.map((l) => [l.id, cellMarkerKey(l.date, l.slot)]));
  const cellOfOp = (op: RelayOp) => (op.op === "insert" ? cellMarkerKey(op.date, op.slot) : (lineCell.get(op.id) ?? ""));
  const ops: { book: Book; op: RelayOp }[] = [];
  for (const textbookId of books) {
    const plans = byBook.get(textbookId)!;
    const book = bookOf(textbookId);
    if (!book) continue;
    const mine = lines.filter((l) => isAssignedLine(l, book));
    const edited = lines.filter((l) => isBookLine(l, book) && !isAssignedLine(l, book));
    const end = mine.map((l) => l.date).sort().at(-1);
    if (!end) continue; // 아직 가져오기 전 — 표식만으로 월간계획이 맞춰진다.
    // 범위는 planRelay가 자른다 — 미룸은 마지막 줄 다음 칸까지 쓰므로 그 칸이 보이게 넉넉히 펼친다.
    const scheduleWith = (s: Record<string, "skip" | "advance">) =>
      groupCellLessons(Object.values(scheduleOf(plans, s, shiftDays(end, 120))).flat());
    // 새 일정(표식 반영) + 누르기 전 일정(지워도 되는 칸을 가른다 — `planRelay`의 🔴).
    const plan = planRelay({ kind: relayKind, date, slot, lines: mine, edited, targets: scheduleWith(shifts), previous: scheduleWith(m!.shifts ?? {}) });
    for (const op of plan.ops) ops.push({ book, op });
  }

  for (const { op } of ops) {
    const k = cellOfOp(op);
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

  // ③ 배정 교재가 아닌 줄은 종전대로 같은 요일·교시끼리 — **교시 통째**로 눌렀을 때만(0382a 전 대체 포함).
  //    · 줄 하나를 눌렀으면 그 줄의 교재만 움직인다(같은 칸의 다른 줄은 제자리 — "수업이 2개면 각각").
  //    · 계획만 있는 칸의 당김은 **교시 통째 미룸을 걷었을 때만** — 그 미룸이 손으로 적은 줄도 한 주 밀었으니
  //      되돌린다. 줄 미룸만 걷었다면 손으로 적은 줄은 움직인 적이 없다(적대적 리뷰 2026-10-20).
  //    옮길 게 없거나 다음 수업일이 없으면 그냥 둔다(손으로 적은 줄 하나 때문에 전체를 실패로 돌리지 않는다).
  const cellWide = target.by === "cell" || (target.by === "line" && writes.some((w) => parseMarkerKey(w.key)?.lane === "")) || removedCellSkip;
  if (cellWide) {
    const weekly = await shiftActualLines({ admin, tenantId, classId, date, slot, kind: relayKind, userId, excludeIds: bookLineIds });
    if (weekly.ok) moved += weekly.moved;
    else if (weekly.stopped) return { handled: true, ok: false, error: STOPPED };
  }

  // 모자란 줄 채우기 — 가져오기와 **같은 쓰기**(차수 하나 = 줄 하나, 같은 교재 줄이 있으면 빈 칸만 채운다
  // = 고쳐 쓴 줄을 안 덮는다).
  const inserts = new Map<Book, Extract<RelayOp, { op: "insert" }>[]>();
  for (const { book, op } of ops) if (op.op === "insert") inserts.set(book, [...(inserts.get(book) ?? []), op]);
  for (const [book, list] of inserts) {
    const cells = list
      .map((o) => ({ date: o.date, slot: o.slot, lessons: o.lessons }))
      .sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)));
    try {
      const out = await applyCellLessons({
        admin,
        tenantId,
        actorId: userId,
        classId,
        termMode: "regular",
        book: { skillArea: book.skillArea, title: book.title, pageTime: book.pageTime },
        cells,
      });
      moved += out.applied;
    } catch (e) {
      reportError(e, { scope: "textbooks.shift-relay.insert", classId });
      return { handled: true, ok: false, error: STOPPED };
    }
  }

  return { handled: true, ok: true, moved, touched: [...touched].sort() };
}

/** 내용이 적힌 줄인가 — 구분만 고른 빈 줄은 없는 것과 같다(`canShiftCell`과 같은 규약). */
function hasContent(l: RelayLine): boolean {
  return [l.textbook, l.progress, l.homework].some((v) => String(v ?? "").trim() !== "");
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}
