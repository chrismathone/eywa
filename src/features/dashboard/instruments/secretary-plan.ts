/**
 * 업무 비서의 할 일 후보 — 확인할 일 줄 · 겹친 학생 · 사람 · 맡긴 일에서 '오늘 먼저 할 것'을 고른다(원장 2026-11-02
 * *"이렇게만 보면 좀 일처리하기 곤란할것 같은데. ai가 비서가되어줘서 알려주면 좋을듯"*).
 * 자동 정리는 우선순위 규칙으로, AI 정리는 같은 후보에서 순서와 이유만 다시 쓴다 — 🔴 누를 단추(요청 · 열기)는 언제나 이 후보가 정한다.
 * 숫자를 다시 읽어 주지 않고 "무엇이 · 누구에게 · 왜"를 말한다(옛 일일 브리핑이 "데이터 정리일 뿐"이었던 까닭). 순수 함수(Vitest).
 */
import type { WorkBoard } from "@/features/work-requests/model";
import type { CheckRow } from "./check-board";
import type { DetailContext } from "./details-types";
import { monthDay, num } from "./labels";
import { dayOf, delegatedOf, isOverlap, peopleLoad, studentSignals, studentsOf, taskBacklog, teacherNamesOf, type Delegated, type PersonLoad, type StudentSignal } from "./secretary-facts";

export type SecretaryAction = { kind: "request" } | { kind: "detail"; key: string } | { kind: "tasks"; assignee: string | null } | { kind: "work"; id: string | null } | { kind: "link"; href: string };
/** `ref` = AI가 가리킬 수 있는 유일한 값 · `count` = 정리한 뒤 바뀌었는지 견주는 수 · `facts` = AI에 넘기는 근거 줄 · `detail` = 제목을 누르면 열리는 상세. */
export type Candidate = { ref: string; priority: number; title: string; why: string; people: string[]; count: number; facts: string[]; action: SecretaryAction; label: string; detail?: string };
export type SecretaryStep = { ref: string; title: string; why: string };
export type SecretaryPlan = { headline: string; steps: SecretaryStep[]; later: { ref: string; why: string }[] };
export type SecretaryBrief = { candidates: Candidate[]; auto: SecretaryPlan; signals: StudentSignal[]; people: PersonLoad[]; delegated: Delegated; names: string[] };

const countOf = (target: string) => Number(target.replace(/[^\d]/g, "")) || 0;
const named = (list: readonly string[], max = 3) => `${list.slice(0, max).join(" · ")}${list.length > max ? ` 외 ${num(list.length - max)}명` : ""}`;
const dates = (list: readonly string[]) => list.map(monthDay).join(" · ");
const paren = (parts: readonly string[]) => { const kept = parts.filter(Boolean); return kept.length ? `(${kept.join(" · ")})` : ""; };

/** 학생 한 줄 — 신호마다 책임진 반 · 담임까지(AI 근거 · 겹친 학생 요청 본문이 같은 글). */
export function studentLine(s: StudentSignal): string {
  const parts = [
    s.absence ? `결석 ${num(s.absence.count)}회(${s.absence.by.map((b) => `${b.className ?? "반 모름"} ${b.name || "담임 없음"} ${dates(b.dates)}`).join(" / ")})` : null,
    s.homework ? `숙제 60% 미만 ${num(s.homework.low)}/${num(s.homework.parsed)}회${paren([s.homework.zero ? `0% ${num(s.homework.zero)}회` : "", ...s.homework.by.map((b) => `${b.className ?? ""} ${b.name}`.trim())])}` : null,
    s.consult ? `지난달부터 담임 상담 없음(${s.consult.by.map((b) => b.name).join(" · ")} · 마지막 ${s.consult.last ? monthDay(s.consult.last) : "기록 없음"})` : null,
  ].filter(Boolean);
  return `${s.name}${s.schoolGrade ? `(${s.schoolGrade})` : ""} — ${parts.join(" · ")}`;
}
/** 겹친 학생 짧은 표기 — `곽경찬(결석 4회 · 숙제)`. */
const shortSignals = (s: StudentSignal) => `${s.name}(${[s.absence ? `결석 ${num(s.absence.count)}회` : null, s.homework ? "숙제" : null, s.consult ? "상담 없음" : null].filter(Boolean).join(" · ")})`;

/** 사람에게 몰린 일 — 많은 것부터(무엇이 몰렸는지가 먼저 보이게). */
export function personParts(p: PersonLoad) {
  return [
    { key: "consult", label: "지난달부터 담임 상담 없는 학생", short: "상담 빠진 학생", count: p.consult.length, unit: "명" },
    { key: "absence", label: "반복 결석 학생", short: "반복 결석", count: p.absence.length, unit: "명" },
    { key: "homework", label: "숙제 60% 미만 학생", short: "숙제 60% 미만", count: p.homework.length, unit: "명" },
    { key: "tasks", label: "기한 지난 할 일", short: "기한 지난 할 일", count: p.lateTasks, unit: "건" },
    { key: "work", label: "기한 지난 업무 요청", short: "기한 지난 업무 요청", count: p.work.late, unit: "건" },
  ].filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
}
export const personText = (p: PersonLoad) => personParts(p).map((x) => `${x.label} ${num(x.count)}${x.unit}`).join(" · ");

/** 사람 단계의 이유 — 가장 많이 몰린 것 다음에 나머지를 이름 · 종류와 함께. */
function personWhy(p: PersonLoad, signals: readonly StudentSignal[]): string {
  const nameOf = new Map(signals.map((s) => [s.id, s.name]));
  const detail: Record<string, string> = {
    consult: "", absence: named(p.absence.map((id) => nameOf.get(id) ?? "")), homework: named(p.homework.map((id) => nameOf.get(id) ?? "")),
    tasks: p.lateKinds.slice(0, 2).map((k) => `${k.label} ${num(k.late)}`).join(" · "), work: "",
  };
  const parts = personParts(p).map((x) => `${x.label} ${num(x.count)}${x.unit}${detail[x.key] ? `(${detail[x.key]})` : ""}`);
  return `${parts[0]}이 가장 많습니다.${parts.length > 1 ? ` 그 밖에 ${parts.slice(1).join(" · ")}.` : ""}`;
}
const kindsOf = (p: PersonLoad) => personParts(p).length;

export function secretaryBrief(ctx: Pick<DetailContext, "snapshot" | "extras">, rows: readonly CheckRow[], work: WorkBoard | null, canRequest: boolean): SecretaryBrief {
  const today = ctx.snapshot.today;
  const signals = studentSignals(ctx);
  const overlap = signals.filter(isOverlap);
  const people = peopleLoad(signals, ctx.extras, work, today);
  const delegated = delegatedOf(work, today);
  const backlog = taskBacklog(ctx.extras);
  const row = (key: string) => rows.find((r) => r.key === key);
  const ask = (detail: string): Pick<Candidate, "action" | "label" | "detail"> => (canRequest ? { action: { kind: "request" }, label: "담임에게 요청", detail } : { action: { kind: "detail", key: detail }, label: "명단 보기", detail });
  const out: Candidate[] = [];

  const approval = row("approval");
  if (approval?.href) out.push({ ref: "approval", priority: 96, title: `전자결재 내 차례 ${approval.target}`, why: "결재선이 이 차례에서 기다리고 있습니다.", people: [], count: countOf(approval.target), facts: [`전자결재 내 차례 ${approval.target}`], action: { kind: "link", href: approval.href }, label: "결재 열기" });
  for (const [ref, list, priority, verb] of [["review", delegated.review, 95, "검토할"], ["report", delegated.report, 92, "내가 보고할"]] as const) {
    if (!list.length) continue;
    out.push({
      ref, priority, title: `${verb} 업무 요청 ${num(list.length)}건`, why: `${list.slice(0, 2).map((i) => i.title).join(" · ")}${list.length > 2 ? ` 외 ${num(list.length - 2)}건` : ""}`,
      people: [], count: list.length, facts: list.map((i) => `${verb} 업무: ${i.title}`), action: { kind: "work", id: list.length === 1 ? list[0]!.id : null }, label: ref === "review" ? "검토하기" : "보고하기",
    });
  }
  if (overlap.length) {
    const teachers = [...new Set(overlap.flatMap(teacherNamesOf))];
    out.push({
      ref: "overlap", priority: 90, title: `결석·숙제·상담이 겹친 학생 ${num(overlap.length)}명`,
      why: `${overlap.slice(0, 2).map(shortSignals).join(" · ")}${overlap.length > 2 ? ` 외 ${num(overlap.length - 2)}명` : ""} — 신호가 두 가지 이상 겹쳤습니다.${teachers.length ? ` 신호가 난 반의 담임 ${num(teachers.length)}명에게 학생마다 맡깁니다.` : ""}`,
      people: teachers, count: overlap.length, facts: overlap.slice(0, 12).map(studentLine), ...ask("secretary:overlap"),
    });
  }
  if (delegated.late.length) {
    const missing = [...new Set(delegated.late.flatMap((l) => l.missing))];
    out.push({
      ref: "late", priority: 85, title: `기한 지난 업무 요청 ${num(delegated.late.length)}건`, why: missing.length ? `아직 보고하지 않은 사람: ${named(missing)}` : "기한이 지났습니다.",
      people: missing, count: delegated.late.length, facts: delegated.late.map((l) => `${l.title} · 기한 ${monthDay(l.dueOn)} · 보고 안 함 ${l.missing.join(" · ") || "—"}`),
      action: { kind: "work", id: delegated.late.length === 1 ? delegated.late[0]!.id : null }, label: "열기",
    });
  }
  if (backlog) {
    const piled = !!backlog.top && backlog.late >= 10 && backlog.share >= 0.5;
    const kinds = backlog.kinds.slice(0, 3).map((k) => `${k.label} ${num(k.late)}`).join(" · ");
    out.push({
      ref: "tasks", priority: piled ? 82 : 60, title: `기한 지난 할 일 ${num(backlog.late)}건`,
      why: piled ? `${backlog.top!.name}에게 ${num(backlog.top!.late)}건이 몰려 있습니다 · ${kinds}` : kinds,
      people: backlog.people.slice(0, 3).map((p) => p.name), count: backlog.late,
      facts: [`종류: ${backlog.kinds.map((k) => `${k.label} ${num(k.late)}건`).join(" · ")}`, `사람: ${backlog.people.slice(0, 6).map((p) => `${p.name} ${num(p.late)}건`).join(" · ")}`],
      action: { kind: "tasks", assignee: piled ? backlog.top!.id : null }, label: "할 일 창",
    });
  }
  people.filter((p) => kindsOf(p) >= 2).slice(0, 2).forEach((p, i) => {
    const mine = signals.filter((s) => studentsOf(p).includes(s.id));
    const request = canRequest && mine.length > 0;
    const top = personParts(p)[0]!;
    out.push({
      ref: `person:${p.id}`, priority: 70 - i * 4, title: `${p.name}${mine.length ? " 선생님" : ""} · ${top.short} ${num(top.count)}${top.unit}`, why: personWhy(p, signals),
      people: [p.name], count: mine.length + p.lateTasks, facts: [personText(p), ...p.lateKinds.map((k) => `기한 지난 할 일: ${k.label} ${num(k.late)}건`), ...mine.slice(0, 10).map(studentLine)],
      action: request ? { kind: "request" } : { kind: "tasks", assignee: p.id }, label: request ? "한 번에 요청" : "할 일 창", detail: `person:${p.id}`,
    });
  });
  const plain = (key: string, priority: number, title: string, why: string, detail: string, facts: string[] = [], requestable = false) => {
    const r = row(key);
    if (!r) return;
    out.push({ ref: key, priority, title: `${title} ${r.target}`, why, people: [], count: countOf(r.target), facts: [why, ...facts], ...(requestable ? ask(detail) : { action: { kind: "detail", key: detail }, label: "명단 보기", detail }) });
  };
  plain("absence", 75, "반복 결석 학생", `14일 · ${row("absence")?.basis ?? ""}`, "repeatAbsence", signals.filter((s) => s.absence).slice(0, 8).map(studentLine), true);
  plain("homework", 55, "숙제 60% 미만 학생", `최근 7일 · ${row("homework")?.basis ?? ""}`, "reports", signals.filter((s) => s.homework).slice(0, 8).map(studentLine), true);
  const { day } = dayOf(today);
  plain("homeroom", day <= 7 ? 30 : 50, "지난달부터 담임 상담 없는 학생", `${row("homeroom")?.basis ?? ""} · ${row("homeroom")?.owner ?? ""}`, "studentConsult", homeroomLines(people), true);
  plain("followup", 58, "상담 후속조치 기한 지남", "원생상담 후속조치", "studentConsult");
  plain("billing", 52, row("billing")?.title ?? "미납", row("billing")?.basis ?? "", "billing6");
  const stalled = ctx.snapshot.sections.consultProgress?.data?.summary.stalled ?? [];
  plain("stalled", 48, "멈춘 신규 콜&상담", row("stalled")?.basis ?? "", "consultProgress", stalled.slice(0, 5).map((s) => `${s.name} — ${s.label}`));

  const names = [...new Set([...signals.map((s) => s.name), ...signals.flatMap(teacherNamesOf), ...people.map((p) => p.name), ...(backlog?.people ?? []).map((p) => p.name), ...delegated.late.flatMap((l) => l.missing), ...stalled.map((s) => s.name)])].filter(Boolean);
  return { candidates: out, auto: autoPlan(out, today), signals, people, delegated, names };
}

/** 담임마다 지난달부터 상담이 빠진 학생 수(많은 순). */
function homeroomLines(people: readonly PersonLoad[]): string[] {
  return people.filter((p) => p.consult.length).sort((a, b) => b.consult.length - a.consult.length).slice(0, 8).map((p) => `${p.name} ${num(p.consult.length)}명`);
}

/** 자동 정리 — 우선순위 순. 월초(7일까지)의 담임 상담은 '미뤄도 되는 것'(월 1회라 이번 달 안에 하면 된다). */
export function autoPlan(candidates: readonly Candidate[], today: string): SecretaryPlan {
  const { day } = dayOf(today);
  const later = candidates.some((c) => c.ref === "homeroom") && day <= 7
    ? [{ ref: "homeroom", why: `이번 달 ${num(day)}일째라 담임 상담률은 낮게 보입니다. 월 1회 상담이라 이번 주 안에 담임에게 맡기면 됩니다.` }]
    : [];
  const steps = [...candidates].filter((c) => !later.some((l) => l.ref === c.ref)).sort((a, b) => b.priority - a.priority).map(({ ref, title, why }) => ({ ref, title, why }));
  return { headline: headlineOf(steps), steps, later };
}

/** 자동 한 줄 — AI 한 줄이 검증에 걸렸을 때도 이 문장으로. */
export function headlineOf(steps: readonly Pick<SecretaryStep, "title">[]): string {
  return steps.length ? `오늘 먼저 할 일은 ${num(Math.min(3, steps.length))}가지입니다 — ${steps[0]!.title}부터 보시면 됩니다.` : "지금 먼저 챙길 일이 없습니다.";
}
