"use client";

import { useState } from "react";
import { RichEditor } from "@/components/editor/rich-editor";
import { createWorkRequest } from "@/features/work-requests/server/actions";
import { WORK_CATEGORIES, WORK_CATEGORY_LABEL, assignedTo, effectiveStudents, type DraftStudent, type WorkCategory, type WorkDraft } from "@/features/work-requests/model";
import { recipientNames } from "@/features/work-requests/recipient-body";
import { BODY_LIMIT, richBodyText, toRichBody } from "@/features/work-requests/rich-body";
import { AssigneePicker } from "./assignee-picker";
import { RecipientPreview } from "./recipient-preview";
import { StudentGroups } from "./student-groups";
import { useWork, type WorkPrefill } from "./work-context";
import { WorkPanel } from "./work-panel";

const MANAGERS = new Set(["원장", "관리자", "매니저"]);
const QUICK_DUE = [["오늘", 0], ["내일", 1], ["3일 뒤", 3], ["1주 뒤", 7]] as const;
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 업무 요청 만들기 — 담당자 · 기한 · 완료 기준을 정한다. '확인할 일'에서 열면 담당자와 담당자마다 맡을 학생이 미리 들어온다. */
export function WorkForm({ prefill, onClose, onCreated }: { prefill: WorkPrefill; onClose: () => void; onCreated: (id: string) => void }) {
  const { board, today } = useWork();
  const active = new Set(board.staff.map((p) => p.id));
  const [suggested] = useState(() => (prefill.assigneeIds ?? []).filter((id) => active.has(id)));
  // 미리 채운 내용을 근거 학생 묶음대로 다시 짓는다(담당자 목록에서 빠진 사람의 학생은 담당 미정 — 근거 학생 묶음 · 저장과 같은 규칙).
  // 선생님 제목 이름 = 서버가 몫을 가를 때와 같은 함수(`recipientNames` — 이 요청의 담당자끼리 이름이 겹치면 과목을 붙인다).
  const rebuilt = (students: readonly DraftStudent[], assignees: readonly string[]) => {
    const names = recipientNames(assignees.flatMap((id) => board.staff.filter((p) => p.id === id)));
    return prefill.rebody?.(effectiveStudents(students, assignees), (id) => names.get(id));
  };
  // 내용은 서식 글(전자결재와 같은 편집기) — 미리 채운 글이 글자만이면 문단 · 목록으로 바꿔 넣는다. `seed` = 편집기에 넣은 글(다시 지으면 편집기를 새로 띄운다).
  const [seed, setSeed] = useState(() => ({ html: rebuilt(prefill.students ?? [], suggested) ?? toRichBody(prefill.body ?? ""), key: 0 }));
  const [draft, setDraft] = useState<WorkDraft>({
    category: prefill.category ?? "general", title: prefill.title ?? "", body: seed.html, criteria: prefill.criteria ?? "",
    dueOn: prefill.dueOn ?? null, reviewerId: prefill.reviewerId ?? null, assigneeIds: suggested,
    students: prefill.students ?? [], source: prefill.source ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof WorkDraft>(key: K, value: WorkDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  /** 근거 학생 · 담당자가 바뀌면 — 내용을 아직 직접 안 고쳤으면 새 묶음으로 다시 짓는다(선생님마다 받는 몫이 근거 학생과 같게). */
  const regroup = (patch: Partial<Pick<WorkDraft, "students" | "assigneeIds">>) => {
    const next = { ...draft, ...patch };
    const body = richBodyText(draft.body) === richBodyText(seed.html) ? rebuilt(next.students, next.assigneeIds) : undefined;
    if (body !== undefined) { next.body = body; setSeed((s) => ({ html: body, key: s.key + 1 })); }
    setDraft(next);
  };
  const reviewers = board.staff.filter((p) => MANAGERS.has(p.role));
  const missing = !draft.title.trim() ? "제목을 적어 주세요" : !draft.assigneeIds.length ? "담당자를 골라 주세요"
    : draft.body.length > BODY_LIMIT ? "내용이 너무 깁니다 — 서식 포함 20,000자까지입니다" : null;

  const submit = async () => {
    setBusy(true); setError(null);
    const res = await createWorkRequest(draft).catch(() => ({ ok: false as const, error: "연결이 끊겼습니다. 다시 해 주세요." }));
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onCreated(res.data.id);
  };

  return (
    <WorkPanel eyebrow="업무 요청" title="새 업무 요청" onClose={onClose}>
      <div className="work-form">
        <div className="work-form-row">
          <label><span>종류</span>
            <select value={draft.category} onChange={(e) => set("category", e.target.value as WorkCategory)}>{WORK_CATEGORIES.map((c) => <option key={c} value={c}>{WORK_CATEGORY_LABEL[c]}</option>)}</select>
          </label>
          <label><span>검토</span>
            <select value={draft.reviewerId ?? ""} onChange={(e) => set("reviewerId", e.target.value || null)}>
              <option value="">요청한 사람(나)</option>
              {reviewers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
            </select>
          </label>
        </div>
        <label><span>제목</span><input value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} /></label>
        {/* label로 감싸지 않는다 — 툴바 단추가 label 안에 있으면 '내용' 글자를 누를 때 첫 단추(굵게)가 눌린다. */}
        <div className="work-field">
          <span>내용</span>
          <div className="work-rich">
            <RichEditor key={seed.key} name="work-body" defaultValue={seed.html} ariaLabel="내용" placeholder="무엇을 부탁하는지 적어 주세요" onChange={(html) => set("body", html)} />
          </div>
          <small className="work-hint">노션처럼 줄 앞에 <kbd>-</kbd> 를 치면 목록, <kbd>##</kbd> 를 치면 제목이 됩니다 · <kbd>Ctrl</kbd>+<kbd>B</kbd> 굵게</small>
        </div>
        <RecipientPreview body={draft.body} people={draft.assigneeIds.flatMap((id) => board.staff.filter((p) => p.id === id))} owns={(id) => draft.students.some((s) => assignedTo(s, draft.assigneeIds) === id)} />
        <label><span>완료 기준</span><textarea value={draft.criteria} rows={2} maxLength={1000} placeholder="무엇이 되면 끝났다고 볼지" onChange={(e) => set("criteria", e.target.value)} /></label>
        <div className="work-due">
          <label><span>기한</span><input type="date" value={draft.dueOn ?? ""} min={today} onChange={(e) => set("dueOn", e.target.value || null)} /></label>
          <div className="seg-toggle" role="group" aria-label="빠른 기한">
            {QUICK_DUE.map(([label, days]) => <button key={label} type="button" aria-pressed={draft.dueOn === shift(today, days)} onClick={() => set("dueOn", shift(today, days))}>{label}</button>)}
            <button type="button" aria-pressed={draft.dueOn === null} onClick={() => set("dueOn", null)}>기한 없음</button>
          </div>
        </div>
        <fieldset>
          <legend>담당자 <small>담당자마다 확인하고 보고합니다</small></legend>
          <AssigneePicker staff={board.staff} selected={draft.assigneeIds} suggested={suggested} onChange={(ids) => regroup({ assigneeIds: ids })} />
        </fieldset>
        {draft.students.length ? <StudentGroups students={draft.students} assignees={draft.assigneeIds} staff={board.staff} onChange={(next) => regroup({ students: next })} /> : null}
        {error ? <p className="work-error" role="alert">{error}</p> : null}
        <div className="work-buttons is-sticky">
          {missing ? <span className="drawer-note">{missing}</span> : null}
          <button type="button" onClick={onClose}>닫기</button>
          <button type="button" className="is-primary" disabled={busy || !!missing} onClick={() => void submit()}>{busy ? "요청하는 중…" : `${draft.assigneeIds.length}명에게 요청`}</button>
        </div>
        <p className="drawer-note">알림은 아직 보내지 않습니다(미리보기 단계) — 담당자는 대시보드의 업무 흐름에서 봅니다.</p>
      </div>
    </WorkPanel>
  );
}
