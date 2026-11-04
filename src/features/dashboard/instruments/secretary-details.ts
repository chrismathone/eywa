/**
 * 업무 비서 · 사람별 표가 여는 상세 — 겹친 학생(`secretary:overlap`)과 사람마다 몰린 일(`person:<id>`).
 * 🔴 사람 상세는 **그 사람 몫만**, 몰린 것마다 따로 표를 세운다(원장 2026-11-02 *"뭐가 몰렸는지 도저히 알 수가 없네"* — 한 표에
 * 학생 51명을 섞고 다른 선생님 반의 결석 · 숙제까지 보여 위 수치와 아래 표가 서로 다른 말을 했다). 많이 몰린 것부터.
 * 값은 비서와 같은 묶음(`studentSignals` · `peopleLoad`)이다. 순수 함수(Vitest).
 */
import type { Detail, Details, DetailContext, DetailRow, DetailTable } from "./details-types";
import { monthDay, num } from "./labels";
import { isOverlap, peopleLoad, studentSignals, type PersonLoad, type StudentSignal } from "./secretary-facts";
import { personParts } from "./secretary-plan";
import { taskKindLabel } from "@/features/staff-tasks/kinds";
import { dueLabel, isLate, type WorkBoard, type WorkItem } from "@/features/work-requests/model";

type Can = Pick<DetailContext, "can">;
const who = (s: StudentSignal) => `${s.name}${s.schoolGrade ? ` · ${s.schoolGrade}` : ""}`;
const link = (s: StudentSignal, ctx: Can, tab?: string): Partial<DetailRow> => (ctx.can("students") ? { href: `/students/${s.id}${tab ? `?tab=${tab}` : ""}`, linkTitle: `${s.name} 상세` } : {});
const lastText = (s: StudentSignal) => (s.consult?.last ? monthDay(s.consult.last) : "기록 없음");

/** 겹친 학생 — 신호마다 책임진 담임을 칸 안에 함께 적는다(어느 선생님 몫인지 바로 보이게). */
function overlapTable(list: readonly StudentSignal[], ctx: Can): DetailTable {
  const names = (by: readonly { name: string }[] | undefined) => [...new Set((by ?? []).map((b) => b.name).filter(Boolean))].join(" · ");
  return {
    title: "겹친 학생", unit: "명", cols: ["학생", "반복 결석", "숙제 60% 미만", "담임 상담"],
    note: "칸마다 그 신호가 난 반의 담임입니다. 요청하면 학생마다 그 담임에게 맡깁니다.",
    rows: list.map((s) => ({
      cells: [
        who(s),
        s.absence ? `${num(s.absence.count)}회 · ${names(s.absence.by) || "담임 없음"}` : "—",
        s.homework ? `${num(s.homework.low)}/${num(s.homework.parsed)}회 · ${names(s.homework.by) || "담임 없음"}` : "—",
        s.consult ? `${lastText(s)} 뒤로 없음 · ${names(s.consult.by)}` : "—",
      ],
      ...link(s, ctx),
    })),
  };
}

/** 사람 몫의 표 — 몰린 것마다 한 장. */
/** 기한을 넘긴 지 — `3일 지남` · 하루가 안 되면 `5시간 지남`. */
export function overdue(dueAt: string, now: number): string {
  const hours = Math.max(1, Math.floor((now - Date.parse(dueAt)) / 3_600_000));
  return hours < 24 ? `${num(hours)}시간 지남` : `${num(Math.floor(hours / 24))}일 지남`;
}

function personTables(p: PersonLoad, signals: readonly StudentSignal[], ctx: Can, now: number): Record<string, DetailTable> {
  const of = (ids: readonly string[]) => signals.filter((s) => ids.includes(s.id));
  return {
    absence: {
      title: "반복 결석", unit: "명", cols: ["학생", "반", "결석", "결석일", "14일 전체"],
      rows: of(p.absence).map((s) => {
        const mine = (s.absence?.by ?? []).filter((b) => b.id === p.id);
        const days = [...new Set(mine.flatMap((b) => b.dates))].sort();
        return { cells: [who(s), mine.map((b) => b.className ?? "—").join(" · "), `${num(days.length)}회`, days.map(monthDay).join(" · "), `${num(s.absence?.count ?? 0)}회`], ...link(s, ctx, "attendance") };
      }),
      note: "사전 통보 없이 빠진 날만 셉니다. '14일 전체'는 다른 선생님 반 결석까지 더한 수입니다.",
    },
    homework: {
      title: "숙제 60% 미만", unit: "명", cols: ["학생", "반", "60% 미만", "수행률 0%", "미제출"],
      rows: of(p.homework).map((s) => ({
        cells: [who(s), (s.homework?.by ?? []).filter((b) => b.id === p.id).map((b) => b.className ?? "—").join(" · "), `${num(s.homework?.low ?? 0)} / ${num(s.homework?.parsed ?? 0)}회`, `${num(s.homework?.zero ?? 0)}회`, `${num(s.homework?.notSubmitted ?? 0)}회`],
        ...link(s, ctx),
      })),
    },
    consult: {
      title: "상담 빠진 학생", unit: "명", cols: ["학생", "지난달", "마지막 담임 상담"],
      rows: of(p.consult).map((s) => ({ cells: [who(s), s.consult?.prev === "other" ? "다른 사람이 상담" : "상담 없음", lastText(s)], ...link(s, ctx) })),
      note: "지난달부터 담임 본인 상담이 없는 학생입니다(월 1회 기준).",
    },
    tasks: p.lateItems.length ? {
      title: "기한 지난 할 일", unit: "건", cols: ["종류", "할 일", "기한"],
      rows: p.lateItems.map((t) => ({ cells: [taskKindLabel(t.kind), t.title, overdue(t.dueAt, now)], ...(t.link ? { href: t.link, linkTitle: `${t.title} 처리하러 가기` } : {}) })),
      note: `줄을 누르면 그 일을 처리하는 화면으로 갑니다. 처리하면 원래 기록으로 저절로 닫힙니다.${p.lateTasks > p.lateItems.length ? ` 오래 늦은 ${num(p.lateItems.length)}건만 보입니다 — 나머지는 할 일 창에서.` : ""}`,
    } : {
      title: "기한 지난 할 일", unit: "종류", cols: ["종류", "기한 지남"],
      rows: p.lateKinds.length ? p.lateKinds.map((k) => ({ cells: [k.label, `${num(k.late)}건`] })) : [{ cells: ["기한 지난 할 일", `${num(p.lateTasks)}건`] }],
    },
  };
}

/** 맡아 아직 보고하지 않은 업무 요청 — 사람별 표 '맡은 업무 요청'과 같은 판정(`peopleLoad`). 기한 지난 것 · 기한 가까운 것부터. */
function workTable(p: PersonLoad, board: WorkBoard, today: string): DetailTable | null {
  const stepOf = (i: WorkItem) => i.steps.find((s) => s.user.id === p.id && s.state !== "reported");
  const mine = board.items.filter((i) => i.status === "working" && stepOf(i));
  if (!mine.length) return null;
  const order = (a: WorkItem, b: WorkItem) => Number(isLate(b, today)) - Number(isLate(a, today)) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999");
  return {
    title: "맡은 업무 요청", unit: "건", cols: ["업무", "기한", "단계"], note: "아직 보고하지 않은 업무 요청입니다. 업무 흐름에서 열어 처리합니다.",
    rows: [...mine].sort(order).map((i) => { const s = stepOf(i)!; return { cells: [i.title, dueLabel(i, today).text, s.returned && s.state !== "reported" ? "보완 요청 받음" : s.state === "ready" ? "확인 전" : "처리 중"] }; }),
  };
}

/** 윗줄 기준 — 그 사람에게 있는 것만. */
const PERIOD_OF: Record<string, string> = { absence: "반복 결석 14일", homework: "숙제 최근 7일", consult: "담임 상담 지난달부터", tasks: "할 일 기한 지남", work: "업무 요청 기한 지남", open: "업무 요청 진행 중" };

/**
 * `work` = 업무 흐름 값 — 있으면 '맡은 업무 요청 N건' 수치와 같은 수의 표(기한 지난 것이 먼저 · '기한 지난 업무 요청' 수치는 그 표의 일부라 따로 표를 세우지 않는다).
 */
export function personDetail(p: PersonLoad, signals: readonly StudentSignal[], ctx: Can, now: number, work: { board: WorkBoard; today: string } | null = null): Detail {
  const tables = personTables(p, signals, ctx, now);
  const works = work ? workTable(p, work.board, work.today) : null;
  if (works) tables.open = works;
  const parts = [...personParts(p), ...(works ? [{ key: "open", short: "맡은 업무 요청", count: works.rows.length, unit: "건" }] : [])];
  const teacher = p.absence.length + p.homework.length + p.consult.length > 0;
  return {
    title: `${p.name || "이름 없는 직원"}${teacher ? " 선생님" : ""}에게 몰린 일`,
    period: parts.map((x) => PERIOD_OF[x.key]).filter(Boolean).join(" · "),
    stats: parts.map((x): [string, string] => [x.short, `${num(x.count)}${x.unit}`]),
    tables: parts.flatMap((x) => (tables[x.key] ? [tables[x.key]!] : [])),
  };
}

export function secretaryDetails(ctx: Pick<DetailContext, "snapshot" | "extras" | "can" | "work">): Details {
  const signals = studentSignals(ctx);
  const out: Details = {};
  const overlap = signals.filter(isOverlap);
  if (overlap.length) {
    out["secretary:overlap"] = {
      title: "결석·숙제·상담이 겹친 학생", period: "반복 결석 14일 · 숙제 최근 7일 · 담임 상담 지난달부터",
      stats: [["겹친 학생", `${num(overlap.length)}명`], ["결석 + 숙제", `${num(overlap.filter((s) => s.absence && s.homework).length)}명`], ["담임", `${num(new Set(overlap.flatMap((s) => [...(s.absence?.by ?? []), ...(s.homework?.by ?? []), ...(s.consult?.by ?? [])].flatMap((b) => (b.id ? [b.id] : [])))).size)}명`]],
      tables: [overlapTable(overlap, ctx)],
    };
  }
  // 업무 흐름 값도 함께 — 사람별 표 · 비서와 같은 묶음이라 업무 요청만 있는 사람의 줄도 상세가 열린다.
  const work = ctx.work ? { board: ctx.work, today: ctx.snapshot.today } : null;
  for (const p of peopleLoad(signals, ctx.extras, ctx.work ?? null, ctx.snapshot.today)) out[`person:${p.id}`] = personDetail(p, signals, ctx, ctx.snapshot.requestedAt, work);
  return out;
}
