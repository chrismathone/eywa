"use client";
import { Fragment, useState, useTransition } from "react";
import { StageBar } from "./stage-bar";
import a from "@/components/analytics/analytics.module.css";
import { useRouter } from "next/navigation";
import { kstDateOf } from "@/lib/date-kst";
import { EmbedLink as Link } from "@/components/embed-link";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { NewcomerBoard } from "@/app/(shell)/newcomers/_components/newcomer-board";
import type { NewcomersView } from "./server/queries";
import type { BoardFilters } from "./board-model";
import { ONBOARDING_ITEMS, dueDateOf, statusOf } from "./onboarding-items";
import { CONDITIONS, FOLLOWUP_STAGES, callSummary, currentStage, followupOpen, needsReview, studentAttention, managersOf, hasUnassignedSubject, needsEnrollmentLink, subjectStudent, type FollowupView, type FollowupStudent, type FollowupReport } from "./followup-model";
import { assignNewcomerManager, submitNewcomerFeedback, reviewNewcomerFeedback } from "./server/followup-actions";
import { setOnboardingCheck } from "./server/actions";
import { CompletionForm } from "./completion-form";
import css from "./followup-workspace.module.css";
import { FollowupVisuals } from "./followup-visuals";
import { EnrollmentSyncNote, type EnrollmentSyncInfo } from "./enrollment-sync-note";

// '과목 기본 담당' 선택지는 그 과목에 기본 담당이 정해져 있을 때만 낸다(누구인지 이름과 함께) — 없는 기본값을 고르게 하지 않는다.
// 이미 기본 담당을 따르던 학생인데 그 기본 담당이 없어졌으면 '따름 · 지금 기본 담당 없음'으로 보인다(그대로 저장해도 '미지정'으로 굳지 않게).
// '전체 완료 체크표' 쓰기는 `canWriteChecks`를 본다 — 정착 관리 자료 조회가 실패해도(canManage가 꺼져도) 종전 체크표는 잠그지 않는다.
const CALLS = [{ key: "month1_call", label: "30일 콜" }, { key: "month2_call", label: "60일 콜", optional: true }, { key: "month3_call", label: "90일 콜" }];
const short = (date: string | null) => kstDateOf(date)?.slice(5,10).replace("-", ".") ?? "미정";
const reviewLabel = { pending: "확인 대기", confirmed: "확인 완료", revision: "보완 요청" };
type SaveResult = { ok: boolean; error?: string };

export function FollowupWorkspace({ data, legacy, initialFilters, initialStudent, syncInfo }: { data: FollowupView; legacy: NewcomersView; initialFilters: BoardFilters; initialStudent?: string; syncInfo?: EnrollmentSyncInfo }) {
  const { labelOf } = useSubjectMaps();
  const router = useRouter();
  const [tab, setTab] = useState<"students" | "owners" | "checks">(initialFilters.item || initialFilters.bucket || initialFilters.status !== "all" || initialFilters.subject !== "all" ? "checks" : "students");
  const [query, setQuery] = useState(initialFilters.query);
  const [filter, setFilter] = useState("all"), [person, setPerson] = useState("all");
  const [selected, setSelected] = useState<string | null>(initialStudent ?? null);
  const [panel, setPanel] = useState<"calls" | "reports">(initialStudent ? "reports" : "calls");
  const [task, setTask] = useState("month1_call"), [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false), [pending, startTransition] = useTransition();
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const saving = busy || pending, known = !data.error;
  const current = data.students.find(s => s.row.studentId === selected);
  const activeSubject = current?.subjects.find(s => (s.subject ?? "") === subject) ?? current?.subjects[0];
  const activeManager = current?.managers.find(a=>a.subject===(activeSubject?.subject??""));
  const activeReports = current?.reports.filter(r=>r.subject===(subject==="general"?"general":activeSubject?.subject||"general"))??[];
  const item = ONBOARDING_ITEMS.find(i => i.key === task)!;
  const evidence = current?.evidence[`${activeSubject?.subject ?? ""}|${task}`];
  const reports = data.students.flatMap(s => s.reports);
  const unseen = reports.filter(needsReview).length;
  const lateFollowups = reports.filter(r => followupOpen(r) && r.next_due! < data.today).length;
  const unassigned = data.students.filter(s => !needsEnrollmentLink(s) && hasUnassignedSubject(s)).length;
  const unlinked = data.students.filter(needsEnrollmentLink).length;
  const visible = data.students.filter(s => {
    if (query && ![s.row.name, s.row.school, s.row.grade, ...managersOf(s).map(p=>p.name), ...s.homerooms.map(t => t.name)].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) return false;
    if (person !== "all" && !managersOf(s).some(p=>p.id===person) && !s.homerooms.some(t => t.id === person)) return false;
    if (filter === "mine") return managersOf(s).some(p=>p.id===data.actorId) || s.homerooms.some(t => t.id === data.actorId);
    if (filter === "unassigned") return !needsEnrollmentLink(s) && hasUnassignedSubject(s);
    if (filter === "unlinked") return needsEnrollmentLink(s);
    if (filter === "reports") return s.reports.some(needsReview);
    if (filter === "attention") return studentAttention(s, data.checksKnown);
    return true;
  });
  const people = [...new Map(data.students.flatMap(s => [...managersOf(s), ...s.homerooms]).map(p => [p.id, p])).values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));

  async function run(action: () => Promise<SaveResult>) {
    if (saving) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      if (!result.ok) throw Error(result.error || "저장하지 못했습니다");
      setNotice("저장했습니다. 최신 기록을 반영합니다.");
      startTransition(() => router.refresh());
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다"); }
    finally { setBusy(false); }
  }
  function open(s: FollowupStudent, target: "calls" | "reports" = "calls", key = "month1_call", selectedSubject?: string) {
    setSelected(s.row.studentId); setPanel(target); setTask(key); setError(""); setNotice("");
    setSubject(selectedSubject ?? s.managers.find(a=>a.manager?.id===data.actorId)?.subject ?? (s.subjects.find(row => !row.checks[key]) ?? s.subjects[0])?.subject ?? "");
  }

  return <div className={`${css.root} ${a.dashboard}`}>
    <header className={css.hero}>
      <div><p className={css.eyebrow}>신입생 90일 관리 · 정착 지원</p><h1>신입생이 자리 잡을 때까지</h1><p>관리자는 연락을 챙기고, 담임은 적응을 살피고, 피드백은 다음 행동으로 이어집니다.</p></div>
      <div className={css.heroDate}><span>오늘의 관리 기준</span><strong>{data.today.replaceAll("-", ".")}</strong><Link href="/students/care">입학 약속·이행 보기 ↗</Link></div>
    </header>
    <nav className={css.nav} aria-label="신입생 관리 보기">
      {([['students','학생별 정착 관리'],['owners','담당자별 점검'],['checks','전체 완료 체크표']] as const).map(([key,label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      <span>등록 → 첫 적응 → 30일 → 60일 → 90일 → 장기재원</span>
    </nav>
    {data.defaults?.length?<aside className={css.defaultRules} aria-label="과목별 기본 관리자"><b>기본 관리 담당</b>{data.defaults.map(d=><span key={d.subject}>{d.subject==="eie"?"EiE":labelOf(d.subject)} · {d.manager?.name??"재지정 필요"}</span>)}<small>기존 개별 배정은 유지 · 동시 수강은 각 과목별 기록</small></aside>:null}
    {data.error ? <p role="alert" className={css.error}>{data.error} <button type="button" onClick={() => router.refresh()}>다시 조회</button></p> : null}
    <EnrollmentSyncNote info={syncInfo} editing={!!selected || saving}/>
    {tab === "checks" ? <NewcomerBoard view={legacy} canWrite={data.canWriteChecks} initialFilters={initialFilters} /> : <>
      <section className={css.metrics} aria-label="신입생 관리 요약">
        <button type="button" onClick={() => setFilter("all")}><span>집중 관리 학생</span><strong>{data.students.length}<small>명</small></strong><em>학생 한 명 기준으로 관리</em></button>
        <button type="button" onClick={() => setFilter(unlinked > 0 ? "unlinked" : "unassigned")}><span>담당·수강 연결 확인</span><strong data-alert={unassigned + unlinked > 0}>{known ? unassigned + unlinked : "—"}<small>명</small></strong><em>{known ? `담당 미지정 ${unassigned}명 · 수강 연결 필요 ${unlinked}명` : "조회 확인 필요"}</em></button>
        <button type="button" onClick={() => setFilter("reports")}><span>확인할 피드백</span><strong data-alert={unseen > 0}>{known ? unseen : "—"}<small>건</small></strong><em>확인 대기·보완 요청</em></button>
        <button type="button" onClick={() => setFilter("attention")}><span>기한 지난 후속 조치</span><strong data-alert={lateFollowups > 0}>{known ? lateFollowups : "—"}<small>건</small></strong><em>처리 결과까지 남겨야 종료</em></button>
      </section>
      <FollowupVisuals data={data}/>
      {tab === "owners" ? <section className={css.ownerGrid} aria-label="담당자별 이행 점검">
        {people.map(p => {
          const managed = data.students.filter(s => managersOf(s).some(m=>m.id===p.id)), teaching = data.students.filter(s => s.homerooms.some(t => t.id === p.id));
          const lateCalls = managed.reduce((n,s)=>n+s.subjects.filter(row=>s.managers.some(a=>a.subject===(row.subject??"")&&a.manager?.id===p.id)).reduce((total,row)=>total+CALLS.filter(c=>callSummary(subjectStudent(s,row.subject),c.key,data.today,data.checksKnown).state==="overdue").length,0),0);
          const authored = reports.filter(r => r.author_id === p.id);
          return <article key={p.id}><h2>{p.name}</h2><p>관리 담당 {managed.length}명 · 담임 {teaching.length}명</p><dl><dt>기한 지난 관리 콜</dt><dd>{data.checksKnown ? `${lateCalls}건` : "확인 필요"}</dd><dt>제출한 적응 보고</dt><dd>{known ? `${authored.length}건` : "확인 필요"}</dd><dt>확인 대기·보완 요청</dt><dd>{known ? `${authored.filter(needsReview).length}건` : "확인 필요"}</dd></dl><button type="button" onClick={() => { setPerson(p.id); setTab("students"); }}>담당 학생 보기 →</button></article>;
        })}
        {!people.length ? <p>담당자를 지정하거나 반 담임을 연결하면 담당자별 현황이 표시됩니다.</p> : null}
      </section> : <section className={css.board} aria-label="학생별 정착 관리">
        <div className={css.toolbar}><div className={css.filters} role="group" aria-label="관리 대상 필터">{[["all","전체"],["mine","내 담당"],["attention","관심 필요"],["unassigned","담당 미지정"],["unlinked","수강 연결 필요"],["reports","피드백 확인"]].map(([key,label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
          <input type="search" aria-label="신입생·담당자 검색" placeholder="학생·학교·담당자 검색" value={query} onChange={e => setQuery(e.target.value)} />
          <select aria-label="관리 담당자·담임 필터" value={person} onChange={e => setPerson(e.target.value)}><option value="all">전체 담당자</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        <div className={css.tableScroll}><table className={css.table}><thead><tr><th>학생·정착 단계</th><th>관리 담당자</th><th>30·60·90일 연락</th><th>과목별 담임</th><th>피드백·다음 행동</th></tr></thead><tbody>
          {visible.map(s => { const stage=currentStage(s.row.elapsedDays); return <Fragment key={s.row.studentId}>{s.subjects.map((row,index)=>{
            const subjectKey=row.subject??"", subjectName=row.subject?labelOf(row.subject):"과목 미정";
            const assignment=s.managers.find(a=>a.subject===subjectKey), subjectReports=s.reports.filter(r=>r.subject===(subjectKey||"general")), latest=subjectReports[0];
            const teachers=s.homerooms.filter(t=>t.subject===row.subject);
            return <tr key={row.rowKey} className={index===0?css.studentStart:css.subjectContinuation}>
              {index===0?<td rowSpan={s.subjects.length} className={css.studentCell}><button type="button" className={css.studentName} onClick={()=>open(s)}>{s.row.name}</button><span>{[s.row.school,s.row.grade].filter(Boolean).join(" ")}</span><span className={css.stage}>{s.row.elapsedDays>90?"90일 후속 관리":`${FOLLOWUP_STAGES[stage]} 구간`} · {s.row.elapsedDays<0?"등록 예정":`${s.row.elapsedDays}일째`}</span><StageBar elapsed={s.row.elapsedDays} label={`${s.row.name} 90일 정착`}/><span>{s.subjects.map(r=>r.subject?labelOf(r.subject):"과목 미정").join(" · ")}</span>{s.openPromises?<Link href={`/students/${s.row.studentId}/care`}>미완료 약속 {s.openPromises}건 ↗</Link>:null}</td>:null}
              <td><b className={css.subjectBadge}>{subjectName}</b>{!row.subject ? <><Link className={css.missing} href={`/students/${s.row.studentId}`}>수강반 연결 확인 ↗</Link><span>수강 과목이 확인되면 기본 관리자가 연결됩니다.</span></> : <><button type="button" className={assignment?.manager?css.manager:css.missing} onClick={()=>open(s,"calls","month1_call",subjectKey)} aria-label={`${s.row.name} ${subjectName} 관리 담당자`}>{known?assignment?.manager?.name??"+ 담당자 지정":"조회 확인 필요"}</button><span>{assignment?.source==="default"?"과목 기본 담당":assignment?.source==="legacy"?"기존 배정 유지":"과목별 관리 콜 책임자"}</span></>}</td>
              <td><div className={css.calls}>{CALLS.map(c=>{const status=callSummary(subjectStudent(s,row.subject),c.key,data.today,data.checksKnown);return <button type="button" key={c.key} data-state={status.state} onClick={()=>open(s,"calls",c.key,subjectKey)} aria-label={`${s.row.name} ${subjectName} ${c.label} ${status.label}`}><b>{c.label}{c.optional?<small>필요시</small>:null}</b><strong>{status.label}</strong><span>{short(status.state==="done"?status.doneOn:status.due)}{status.state==="done"?" 수행":" 예정"}</span>{status.actors.length?<span>{status.actors.join(" · ")}</span>:null}</button>;})}</div></td>
              <td>{teachers.length?teachers.map(t=><div className={css.teacher} key={t.id}><span>{t.name}{t.upcoming?" (예정)":""}</span></div>):<span className={css.missing}>담임 배정 확인</span>}<button type="button" className={css.textButton} onClick={()=>open(s,"reports","month1_call",subjectKey)}>{subjectName} 적응 보고 {subjectReports.length}건 →</button></td>
              <td>{!known?<span>피드백 조회 확인 필요</span>:latest?<><span className={css.condition} data-condition={latest.condition}>{CONDITIONS[latest.condition]} · {reviewLabel[latest.review_state]}</span><p className={css.summary}>{latest.summary}</p><span>{latest.authorName} · {short(latest.created_at)}</span>{subjectReports.some(followupOpen)?<b className={css.next}>후속 조치 {subjectReports.filter(followupOpen).length}건 남음</b>:null}</>:<p className={css.muted}>{subjectName} 관찰·관리 기록을 기다립니다.</p>}<div className={css.rowAction}><button type="button" className={css.openButton} onClick={()=>open(s,"reports","month1_call",subjectKey)} aria-label={`${s.row.name} ${subjectName} 피드백·점검`}>피드백·점검</button>{data.checksKnown&&row.progress.overdue>0?<span className={css.overdue}>첫 적응·관리 업무 확인</span>:null}</div></td>
            </tr>;
          })}{s.reports.some(r=>r.subject==="general")&&s.subjects.some(r=>r.subject)?<tr><td colSpan={5}><button type="button" className={css.textButton} onClick={()=>open(s,"reports","month1_call","general")}>생활·종합 기록 {s.reports.filter(r=>r.subject==="general").length}건 보기</button></td></tr>:null}</Fragment>;})}
        </tbody></table>{!visible.length ? <p className={css.empty}>조건에 맞는 학생이 없습니다. 검색어나 담당자 필터를 확인해 주세요.</p> : null}</div>
        <footer>{visible.length}명 표시 · 학생 이름은 한 번만 표시하고 과목별 담당·완료·피드백을 나눕니다. 60일 콜은 기존 ‘필요시’ 기준을 유지합니다.</footer>
      </section>}
    </>}
    <Sheet open={!!current} onOpenChange={open => { if (!open && !saving) setSelected(null); }}><SheetContent className={css.drawer}>
      {current ? <><SheetHeader><SheetTitle>{current.row.name} · 90일 정착 관리</SheetTitle><SheetDescription>{[current.row.school,current.row.grade].filter(Boolean).join(" ")} · 등록 {current.row.enrolledOn} · {current.row.elapsedDays}일째</SheetDescription></SheetHeader>
        <div className={css.drawerBody}>
          <div className={css.subjectTabs} role="group" aria-label="학생 과목 선택">{current.subjects.map(row=><button type="button" key={row.rowKey} aria-pressed={subject!=="general"&&(activeSubject?.subject??"")===(row.subject??"")} onClick={()=>{setSubject(row.subject??"");setError("");setNotice("");}}>{row.subject?labelOf(row.subject):"과목 미정"}</button>)}{(data.canManage||current.reports.some(r=>r.subject==="general"))&&current.subjects.some(r=>r.subject)?<button type="button" aria-pressed={subject==="general"} onClick={()=>{setSubject("general");setPanel("reports");}}>생활·종합</button>:null}</div>
          {subject!=="general"?<section className={css.assignment}><h3>{activeSubject?.subject?labelOf(activeSubject.subject):"과목 미정"} 관리 담당자</h3>{data.canManage?<form key={`${selected}:${activeSubject?.subject}:${activeManager?.version??0}`} onSubmit={e=>{e.preventDefault();const value=String(new FormData(e.currentTarget).get("manager")??"");void run(()=>assignNewcomerManager({studentId:selected,subject:activeSubject?.subject??"",mode:value==="default"?"default":"manual",managerId:value==="default"?null:value||null,version:activeManager?.version??0}));}}>
            <select name="manager" aria-label="30·60·90일 콜 관리 담당자" defaultValue={activeManager?.source==="default"?"default":activeManager?.manager?.id??""} disabled={saving}>{activeManager?.defaultManager?<option value="default">과목 기본 담당 · {activeManager.defaultManager.name}</option>:activeManager?.source==="default"?<option value="default">과목 기본 담당 따름 · 지금 기본 담당 없음</option>:null}<option value="">미지정</option>{data.staff.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button type="submit" disabled={saving}>담당 저장</button>
          </form>:<strong>{known?activeManager?.manager?.name??"관리 담당자 미지정":"조회 확인 필요"}</strong>}<p>이 과목만 변경됩니다. 다른 과목의 담당자와 기록은 유지됩니다.</p><p>{current.homerooms.filter(t=>t.subject===activeSubject?.subject).map(t=>`담임 ${t.name}`).join(" · ")||"담임 배정을 확인해 주세요"}</p></section>:null}
          <div className={css.panelTabs} role="group" aria-label="학생 관리 기록 종류"><button type="button" aria-pressed={panel === "calls"} onClick={() => {setPanel("calls");if(subject==="general")setSubject(activeSubject?.subject??"");}}>관리 콜·첫 적응</button><button type="button" aria-pressed={panel === "reports"} onClick={() => setPanel("reports")}>담임 피드백·후속 조치</button></div>
          {error ? <p role="alert" className={css.error}>{error}</p> : null}<p role="status" className={css.notice}>{notice}</p>
          {panel === "calls" && subject!=="general" && activeSubject ? <section className={css.taskPanel}>
            <div className={css.callPicker}>{ONBOARDING_ITEMS.map(i => <button type="button" key={i.key} aria-pressed={task === i.key} onClick={() => setTask(i.key)}>{CALLS.find(c => c.key === i.key)?.label ?? i.shortLabel}</button>)}</div>
            <label>과목별 기록<select aria-label="관리 콜 대상 과목" value={activeSubject.subject ?? ""} onChange={e => setSubject(e.target.value)}>{current.subjects.map(row => <option key={row.rowKey} value={row.subject ?? ""}>{row.subject ? labelOf(row.subject) : "과목 미정"}{row.checks[task] ? " · 완료" : " · 미완료"}</option>)}</select></label>
            <h3>{item.label}</h3><p>예정 {dueDateOf(item,activeSubject) ?? "첫 수업일 확인 필요"} · 관리 담당 {activeManager?.manager?.name ?? "미지정"}</p>
            {activeSubject.checks[task] ? <p className={css.completed}>완료 {activeSubject.checks[task]} · 실제 처리자 {evidence?.doneByName ?? "이전 기록·처리자 확인 필요"}</p> : <p className={css.muted}>{statusOf(item,activeSubject,null,data.today) === "overdue" ? "기한이 지났습니다. 실제 연락 결과를 확인해 주세요." : "실제 액션과 결과를 기록하면 완료로 반영됩니다."}</p>}
            <CompletionForm key={`${selected}:${activeSubject.subject}:${task}:${activeSubject.checks[task] ?? "open"}`} done={!!activeSubject.checks[task]} canWrite={data.canManage && data.checksKnown} busy={saving} today={data.today} memo={evidence?.memo} consultationId={evidence?.consultationId}
              onSave={(done,completion,doneOn) => void run(() => setOnboardingCheck({ studentId: current.row.studentId, subject: activeSubject.subject, itemKey: task, done, completion, doneOn }))} />
          </section> : null}
          {panel === "reports" ? <>
            {data.canReport ? <FeedbackForm key={`${selected}:${subject}:${current.reports.length}`} subject={subject==="general"?"general":activeSubject?.subject||"general"} student={current} data={data} busy={saving} onSubmit={v => run(() => submitNewcomerFeedback(v))} /> : <p className={css.muted}>담당 담임은 자신의 학생·과목에 적응 피드백을 남길 수 있습니다.</p>}
            <h3>이 과목의 보고·확인 이력 <small>{activeReports.length}건</small></h3>
            {!activeReports.length ? <p className={css.empty}>아직 적응 보고가 없습니다. 미등록을 ‘문제 없음’으로 해석하지 않습니다.</p> : null}
            {activeReports.map(report => <ReportCard key={`${report.id}:${report.version}`} report={report} data={data} busy={saving} onSave={v => run(() => reviewNewcomerFeedback(v))} />)}
          </> : null}
          <div className={css.links}><Link href={`/students/${current.row.studentId}/care`}>입학 약속·인수·이행 증거 ↗</Link><Link href={`/students/${current.row.studentId}`}>학생 통합정보·지식그래프 ↗</Link></div>
        </div>
      </> : null}
    </SheetContent></Sheet>
  </div>;
}

function FeedbackForm({ student, subject, data, busy, onSubmit }: { subject:string; student: FollowupStudent; data: FollowupView; busy: boolean; onSubmit: (v: unknown) => Promise<void> }) {
  const { labelOf } = useSubjectMaps();
  const [requestId] = useState(() => crypto.randomUUID());
  const subjects = data.canManage ? [subject] : [...new Set(student.homerooms.filter(t=>t.id===data.actorId&&t.subject===subject).map(t=>t.subject))];
  return <details className={css.reportForm} open><summary>적응 피드백 작성</summary><form onSubmit={e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    void onSubmit({ id: requestId, studentId: student.row.studentId, subject: f.get("subject"), stage: f.get("stage"), condition: f.get("condition"), summary: f.get("summary"), nextAction: f.get("nextAction"), nextDue: f.get("nextDue") || null });
  }}><fieldset disabled={busy}><div className={css.formPair}>
    <label>과목<select name="subject">{subjects.map(s => <option key={s} value={s}>{s==="general"?"생활·종합":labelOf(s)}</option>)}</select></label>
    <label>관리 단계<select name="stage" defaultValue={currentStage((student.subjects.find(r=>r.subject===subject)??student.row).elapsedDays)}>{Object.entries(FOLLOWUP_STAGES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
  </div><label>적응 상태<select name="condition" defaultValue="watch">{Object.entries(CONDITIONS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
  <label>관찰·학부모 반응·지도 결과<textarea name="summary" required minLength={5} maxLength={2000} rows={3} placeholder="학습 참여, 과제, 친구 관계, 부모님 반응과 실제 지도 결과를 적어 주세요." /></label>
  <div className={css.formPair}><label>다음 조치 (선택)<input name="nextAction" maxLength={1000} placeholder="예: 과제량 조정 후 다시 확인" /></label><label>후속 기한<input name="nextDue" type="date" /></label></div>
  <button type="submit" className={css.primary}>{busy ? "저장 중…" : "피드백 보고"}</button></fieldset></form></details>;
}

function ReportCard({ report: r, data, busy, onSave }: { report: FollowupReport; data: FollowupView; busy: boolean; onSave: (v: unknown) => Promise<void> }) {
  const { labelOf } = useSubjectMaps();
  const [note, setNote] = useState("");
  const save = (operation: string) => onSave({ id: r.id, studentId: r.student_id, version: r.version, operation, note });
  return <article className={css.report} aria-label={`${r.authorName} ${FOLLOWUP_STAGES[r.stage]} 피드백`}>
    <div className={css.reportHeading}><strong>{r.authorName} · {r.subject === "general" ? "종합" : labelOf(r.subject)}</strong><span>{short(r.created_at)} · {FOLLOWUP_STAGES[r.stage]}</span></div>
    <div><span className={css.condition} data-condition={r.condition}>{CONDITIONS[r.condition]}</span><span className={css.reviewState}>{reviewLabel[r.review_state]}</span></div>
    <p className={css.reportText}>{r.summary}</p>{r.response ? <p className={css.reviewNote}>보완 보고: {r.response}</p> : null}
    {r.next_action ? <div className={css.nextBox}><b>{r.followup_at ? "후속 조치 완료" : "다음 행동"} · {r.next_due}</b><p>{r.next_action}</p>{r.followup_result ? <p>처리 결과: {r.followup_result}<br />{r.followupName} · {short(r.followup_at)} 처리</p> : null}</div> : null}
    {r.review_note ? <p className={css.reviewNote}>관리자 {r.reviewerName} · {reviewLabel[r.review_state]} · {short(r.reviewed_at)}<br />{r.review_note}</p> : null}
    {data.canManage || (data.canReport && r.author_id === data.actorId && (followupOpen(r) || r.review_state === "revision")) ? <div className={css.reviewForm}><label>확인 의견·조치 결과<textarea aria-label={`${r.id} 확인 의견·조치 결과`} minLength={2} maxLength={1500} rows={2} value={note} onChange={e => setNote(e.target.value)} /></label><div>
      {data.canManage ? <><button type="button" disabled={busy || note.trim().length < 2} onClick={() => void save("confirmed")}>확인 완료</button><button type="button" disabled={busy || note.trim().length < 2} onClick={() => void save("revision")}>보완 요청</button></> : null}
      {r.review_state === "revision" ? <button type="button" disabled={busy || note.trim().length < 2} onClick={() => void save("respond")}>보완 보고</button> : null}
      {followupOpen(r) ? <button type="button" disabled={busy || note.trim().length < 2} onClick={() => void save("resolve")}>후속 조치 완료</button> : null}
    </div></div> : null}
  </article>;
}
