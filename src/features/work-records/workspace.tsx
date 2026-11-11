"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EmbedLink as Link } from "@/components/embed-link";
import { workTemplates, workStates, type WorkTemplate, type WorkDocument, type WorkRecord } from "./model";
import type { WorkRecordsData } from "./server";
import s from "./workspace.module.css";

/**
 * 업무 작성센터 — aywa-next(375d27df4) 화면을 계기판 토큰으로 옮겼다. 2026-11-11부터 실제 기록(academy_work_records · s2_0048)을 읽고 쓴다.
 * 바로가기 카드는 각 화면의 문과 같은 권한으로 세운다(연간 행사 기획은 다른 작업에서 다시 만드는 중이라 뺐다).
 */
const destinations = [
  { key: "okr", href: "/organization/okr", label: "조직·OKR", desc: "내 목표·핵심결과·실행·주간 점검을 성과 근거로 연결" },
  { key: "work_records", href: "/work-records/knowledge", label: "현장 관찰·후속 조치·OKR", desc: "학생별 사실·담당자·처리 결과를 지식그래프로 연결" },
  { key: "ecs", href: "/ecs", label: "영어 강사 시트", desc: "반별 진도·과제·수업 기록" },
  { key: "mcs", href: "/mcs", label: "수학 강사 시트", desc: "월간 진도와 학생별 실행 기록" },
  { key: "teacher_onescreen", href: "/onescreen", label: "수업 마감·학생 기록", desc: "담당 학생의 출결·과제·수업 결과" },
  { key: "lesson_reports", href: "/lesson-reports", label: "수업보고서", desc: "수업 기록을 검토하고 전달" },
  { key: "consultations", href: "/consultations", label: "학부모 상담·전화", desc: "학생 ID에 상담·결과·후속 조치 기록" },
  { key: "enrollment", href: "/enrollment", label: "입학상담·최초 약속", desc: "학부모 요구와 약속을 담당자에게 인계" },
  { key: "newcomers", href: "/newcomers", label: "신입생 90일 관리", desc: "단계별 액션과 처리 결과 확인" },
  { key: "students", href: "/students/care", label: "상담 약속·이행 기록", desc: "담당자 인수 → 증거 제출 → 완료 확인" },
  { key: "meetings", href: "/meetings", label: "회의록", desc: "회의 결정과 후속 업무를 직접 작성" },
  { key: "approvals", href: "/approvals", label: "기안·전자결재", desc: "공식 승인·결재가 필요한 업무" },
  { key: "documents", href: "/documents", label: "공용 서식·자료함", desc: "기존 문서와 첨부 자료 조회" },
];

export function WorkRecordsWorkspace({ data, selectedId }: { data: WorkRecordsData; selectedId?: string }) {
  const [creating, setCreating] = useState<WorkTemplate | null>(null), [selected, setSelected] = useState(selectedId ?? null), [filter, setFilter] = useState("mine");
  const record = data.rows.find(r => r.id === selected), rows = data.rows.filter(r => filter === "review" ? r.document.state === "submitted" : r.author_id === data.actorId);
  return <main className={s.page}>
    <header className={s.hero}><span>에이와 · 한 번 쓰고 함께 일하기</span><h1>업무 작성센터</h1><p>내 계정으로 작성하고, 실행과 결과를 같은 기록에 남깁니다.</p></header>
    <section className={s.section}><h2>학생·수업·행사 기록</h2><p>학생별 사실은 아래 업무 화면에 한 번 기록하세요. 상담·수업·행사 ID를 통해 학생 기록과 분석에 이어집니다.</p><div className={s.shortcuts}>{destinations.filter(d => data.access.some(a => a.key === d.key && a.read)).map(d => <Link key={d.href} href={d.href}><strong>{d.label} ↗</strong><span>{d.desc}</span></Link>)}</div></section>
    <section className={s.section}><h2>에이와에서 바로 작성하는 서식</h2><p>작성 중인 문서는 본인에게만 보입니다. 검토를 요청하면 문서 관리 담당자가 확인할 수 있습니다.</p>{!data.canWrite && <p role="note">업무 작성센터 작성 권한이 필요합니다. 내 문서와 검토 현황은 볼 수 있습니다.</p>}<div className={s.templates}>{Object.entries(workTemplates).map(([key, t]) => <button key={key} disabled={!data.canWrite} onClick={() => { setCreating(key as WorkTemplate); setSelected(null); }}><strong>{t.label} ＋</strong><span>{t.description}</span></button>)}</div></section>
    {(creating || record) && <Editor key={creating ? `new:${creating}` : `${record!.id}:${record!.version}`} data={data} record={record} template={creating ?? record!.document.template} onClose={() => { setCreating(null); setSelected(null); }} onSaved={id => { setCreating(null); setSelected(id); }}/>}
    <section className={s.section}><div className={s.heading}><h2>작성·확인 현황</h2><nav><button aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>내 문서</button>{data.seeReview && <button aria-pressed={filter === "review"} onClick={() => setFilter("review")}>검토 요청 {data.rows.filter(r => r.document.state === "submitted").length}</button>}</nav></div><div className={s.list}>{rows.map(r => <button key={r.id} aria-current={r.id === selected || undefined} onClick={() => { setSelected(r.id); setCreating(null); }}><span>{r.document.date} · {workTemplates[r.document.template].label}</span><strong>{r.document.title}</strong><small className={r.document.state === "submitted" ? s.stateWait : undefined}>{workStates[r.document.state]} · v{r.version}</small></button>)}{!rows.length && <p>아직 문서가 없습니다. 위 서식을 선택해 첫 기록을 작성하세요.</p>}</div></section>
  </main>;
}

function Editor({ data, record, template, onClose, onSaved }: { data: WorkRecordsData; record?: WorkRecord; template: WorkTemplate; onClose: () => void; onSaved: (id: string) => void }) {
  const router = useRouter(), [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [doc, setDoc] = useState<WorkDocument>(record?.document ?? { template, title: "", date: data.today, plan: "", action: "", result: "", next: "", state: "draft", reviewNote: "" }), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  // 같은 내용을 다시 보내면 같은 요청 번호 — 응답을 못 받고 다시 눌러도 두 번 저장되지 않는다(저장 함수의 요청 장부).
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const own = !record || record.author_id === data.actorId, editable = own && data.canWrite && record?.document.state !== "reviewed", t = workTemplates[template];
  async function save(state: WorkDocument["state"], action: "save" | "review") {
    if (busy) return;
    setBusy(true); setMessage("");
    const payload = { id, version: record?.version ?? 0, action, document: { ...doc, state } }, body = JSON.stringify(payload);
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/work-records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: attempt.current.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error ?? "저장하지 못했습니다");
      setMessage("저장했습니다."); router.refresh(); onSaved(id);
    } catch (e) { setMessage(e instanceof Error ? e.message : "저장하지 못했습니다"); } finally { setBusy(false); }
  }
  return <section className={s.editor}><div className={s.heading}><h2>{t.label}</h2><button disabled={busy} onClick={onClose}>닫기</button></div><form onSubmit={e => { e.preventDefault(); void save("draft", "save"); }}><fieldset disabled={!editable || busy}><div className={s.pair}><label>문서 제목<input required minLength={2} maxLength={200} value={doc.title} onChange={e => setDoc({ ...doc, title: e.target.value })}/></label><label>기록 날짜<input type="date" required value={doc.date} onChange={e => setDoc({ ...doc, date: e.target.value })}/></label></div>{(["plan", "action", "result", "next"] as const).map(k => <label key={k}>{t[k]}<textarea maxLength={k === "next" ? 2000 : 4000} value={doc[k]} onChange={e => setDoc({ ...doc, [k]: e.target.value })}/></label>)}</fieldset>
    {editable && <div className={s.actions}><button disabled={busy} type="submit">작성 중 저장</button><button className={s.primary} disabled={busy} type="button" onClick={() => void save("submitted", "save")}>검토 요청</button>{record && <button disabled={busy} type="button" onClick={() => void save("cancelled", "save")}>문서 취소</button>}</div>}
    {record?.document.reviewNote && <p className={s.feedback}>확인 의견: {record.document.reviewNote}</p>}
    {data.canReview && !own && record?.document.state === "submitted" && <div className={s.review}><label>확인 의견<textarea maxLength={1500} value={doc.reviewNote} onChange={e => setDoc({ ...doc, reviewNote: e.target.value })}/></label><button disabled={busy} type="button" onClick={() => void save("reviewed", "review")}>확인 완료</button><button disabled={busy} type="button" onClick={() => void save("draft", "review")}>보완 요청</button></div>}
    <p role="status" className={message ? s.status : undefined}>{message}</p><small>기록자와 변경 버전이 함께 저장됩니다. 공식 결재가 필요한 문서는 전자결재에서 처리하세요.</small></form></section>;
}
