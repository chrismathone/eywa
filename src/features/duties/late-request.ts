import type { DraftStudent, WorkItem, WorkPrefill } from "@/features/work-requests/model";
import { PREFILL_BUDGET, bullets, esc, para, strong } from "@/features/work-requests/rich-body";
import { DUTY_KINDS, NEWCOMER_ITEM_LABEL, type DutyItemView } from "./kinds";

/**
 * 업무 완성도에서 만든 처리 요청의 출처 표식 — '이미 요청함' 판정이 이 값으로 찾는다. 한 과목의 지연만 담은 요청은 뒤에 과목 키를 붙인다(`duty:late:math`)
 * — 영어 관리자가 보낸 요청 때문에 수학 관리자의 단추가 '요청함'으로 덮이지 않게(리뷰 2026-11-10 · 업무 요청 표의 출처는 40자까지).
 */
export const DUTY_REQUEST_SOURCE = "duty:late";
export const isDutyRequest = (source: string | null) => source === DUTY_REQUEST_SOURCE || !!source?.startsWith(`${DUTY_REQUEST_SOURCE}:`);
/** 지연 묶음의 과목 — 전부 한 과목이면 그 키, 섞였거나 과목이 없으면 null(과목을 가리지 않는 요청). */
export const requestSubject = (items: readonly { subject: string | null }[]): string | null => { const keys = new Set(items.map((it) => it.subject)); const only = keys.size === 1 ? [...keys][0]! : null; return only && only.length <= 28 ? only : null; };
type Late = Pick<DutyItemView, "kind" | "cycle" | "dueAt" | "studentId" | "studentName" | "classId" | "className" | "subject">;

const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const kindLabel = (kind: string) => (DUTY_KINDS as Record<string, { label: string }>)[kind]?.label ?? "업무";
/** 한 의무를 사람 말로 — 일간은 수업일, 월간은 달, 신규생 정착은 항목 이름 + 기한. */
function when(it: Late): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(it.cycle)) return md(it.cycle);
  if (/^\d{4}-\d{2}$/.test(it.cycle)) return `${Number(it.cycle.slice(5, 7))}월`;
  const due = md(kstDay(it.dueAt));
  return it.kind === "newcomer_call" ? `${NEWCOMER_ITEM_LABEL[it.cycle] ?? "항목"}(기한 ${due})` : `기한 ${due}`;
}

/**
 * 기한이 지난 열린 의무 → 그 담당 선생님에게 보내는 업무 요청 초안(원장 화면 협의 2026-11-10 — 관리자가 '보기'만 하지 않고 바로 지시할 수 있게).
 * 받는 사람 = 그 의무의 담당자 한 명 · 근거 학생 = 지연이 있는 학생 · 내용 = 반마다 학생별로 어떤 업무가 어느 날 치인지.
 * 🔴 처리 자체는 업무 요청이 닫지 않는다 — 의무는 원래 기록(출결 · 보고서 · 상담)의 사실로만 닫힌다. 요청은 재촉과 사유 보고의 길이다.
 * 반 이름을 제목(h3)으로 쓰지 않는다 — 업무 요청은 '○○ 선생님' 제목으로 받는 사람을 가른다(`recipient-body`). 순수 함수(Vitest).
 */
export function lateRequestPrefill(items: readonly Late[], owner: { id: string; name: string }, today: string): WorkPrefill | null {
  if (!items.length) return null;
  const classes = new Map<string, { name: string; rows: Map<string, { name: string; kinds: Map<string, string[]> }> }>();
  for (const it of [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    const cls = classes.get(it.classId ?? "") ?? { name: it.className ?? "반 공통", rows: new Map() };
    const row = cls.rows.get(it.studentId ?? "") ?? { name: it.studentName ?? "반 전체", kinds: new Map() };
    row.kinds.set(it.kind, [...(row.kinds.get(it.kind) ?? []), when(it)]);
    cls.rows.set(it.studentId ?? "", row); classes.set(it.classId ?? "", cls);
  }
  const intro = para(esc("기한이 지났는데 아직 열려 있는 업무입니다. 항목마다 처리해 주시고, 처리하지 못하는 항목은 사유를 보고에 적어 주세요."));
  let body = ""; let left = 0;
  for (const cls of [...classes.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"))) {
    const lines = [...cls.rows.values()].map((r) => `${strong(r.name)} — ${esc([...r.kinds.entries()].map(([k, days]) => `${kindLabel(k)} ${[...new Set(days)].join(" · ")}`).join(" / "))}`);
    const block = para(strong(cls.name)) + bullets(lines);
    if (intro.length + body.length + block.length > PREFILL_BUDGET) { left += cls.rows.size; continue; }
    body += block;
  }
  const students: DraftStudent[] = [...new Map(items.flatMap((it) => (it.studentId ? [[it.studentId, { id: it.studentId, name: it.studentName ?? "학생", assigneeId: owner.id }] as const] : []))).values()];
  return {
    title: `${owner.name} 선생님 — 기한 지난 업무 ${items.length.toLocaleString("ko-KR")}건 처리`, dueOn: shift(today, 2),
    source: ((subject) => (subject ? `${DUTY_REQUEST_SOURCE}:${subject}` : DUTY_REQUEST_SOURCE))(requestSubject(items)),
    body: intro + (left ? para(esc(`내용이 길어 일부 반(${left}줄)은 적지 못했습니다. 전체는 '내 업무'에서 확인해 주세요.`)) : "") + body,
    criteria: "항목을 원래 화면(출결 · 수업보고서 · 원생상담 · 신규생 관리)에서 처리하면 '내 업무'에서 저절로 완료된다. 처리하지 못한 항목은 사유와 계획을 보고에 적는다",
    assigneeIds: [owner.id], students,
  };
}

/** 그 출처의 요청이 이 과목의 지연을 덮나 — 과목을 가리지 않는 요청은 늘, 한 과목 요청은 그 과목만. subject undefined = 과목을 묻지 않는다. */
export const coversSubject = (source: string | null, subject?: string | null) => isDutyRequest(source) && (subject === undefined || source === DUTY_REQUEST_SOURCE || source === `${DUTY_REQUEST_SOURCE}:${subject ?? ""}`);

/**
 * 그 선생님에게 이미 보낸, 아직 끝나지 않은 처리 요청(가장 최근 것) — 같은 재촉을 두 번 보내지 않게 화면이 '요청함'으로 바꿔 보인다.
 * `subject` = 지금 보내려는 지연의 과목(`requestSubject`) — 과목을 가리지 않는 요청은 늘 덮고, 한 과목 요청은 그 과목만 덮는다. undefined = 과목 불문(원장 화면의 집계).
 * ⚠️ 내가 볼 수 있는 요청에서만 찾는다(내가 요청·담당·검토하는 것 · 업무 처리 현황 권한자는 전부) — 다른 관리자가 보낸 요청은 안 보일 수 있다.
 */
export function openLateRequest(items: readonly Pick<WorkItem, "id" | "source" | "status" | "createdAt" | "steps">[], ownerId: string, subject?: string | null): { id: string; createdAt: string } | null {
  const mine = items.filter((i) => coversSubject(i.source, subject) && (i.status === "working" || i.status === "review") && i.steps.some((s) => s.user.id === ownerId));
  return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/**
 * 그 요청이 지금의 지연을 덮나 — 요청을 보낸 **뒤에** 기한이 지난 지연이 하나라도 있으면 덮지 않는다(리뷰 2026-11-11:
 * 11/10 요청이 열려 있다는 이유로 11/14에 새로 생긴 지연까지 '요청함'으로 보이면, 아무도 손대지 않은 것이 손댄 것처럼 보인다).
 */
export function coversLate(sent: { createdAt: string } | null, items: readonly { dueAt: string }[]): boolean {
  return !!sent && !items.some((it) => it.dueAt > sent.createdAt);
}
