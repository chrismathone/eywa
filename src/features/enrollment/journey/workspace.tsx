"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EmbedLink as Link } from "@/components/embed-link";
import { ChartCard, DonutChart, SeriesChart, StatCard, RankBars } from "@/components/analytics/charts";
import { palette } from "@/components/analytics/chart-math";
import a from "@/components/analytics/analytics.module.css";
import { kinds, statuses, purposes, allowedStatuses, eventDay, saveJourneySchema, validateJourneyDates, type JourneyDocument, type JourneyRecord } from "./model";
import type { JourneyData } from "./server";
import s from "./workspace.module.css";

/**
 * 전화·방문·등록 기록 — aywa-next(375d27df4) `enrollment/journey/workspace.tsx` 이식(실제 기록 · s2_0062).
 * 저장·이력 = `/api/enrollment/journey`(서버가 상담 열람 범위·쓰기 권한·날짜를 다시 본다). 예정과 실적을 섞지 않는다.
 */
type JourneyRevision = { version: number; document: JourneyDocument; voided: boolean; reason: string; recorded_at: string; actor_id: string };
/** 화면엔 한글 사유만 — 검증 도구의 영문 기본 문구는 일반 안내로 바꾼다. */
const korean = (message: string | undefined, fallback: string) => message && /[가-힣]/.test(message) ? message : fallback;
const dateLabel = (v: string | null) => v ?? "미확인";
type Editing = { id: string; consultationId: string; expectedVersion: number; voided: boolean; document: JourneyDocument };

export function JourneyWorkspace({ data, compact = false }: { data: JourneyData; compact?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"records" | "quality" | "history">("records"), [query, setQuery] = useState(""), [onlyOpen, setOnlyOpen] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  const [history, setHistory] = useState<{ id: string; rows: JourneyRevision[] } | null>(null);
  const summary = data.summary, names = new Map(data.choices.map((c) => [c.id, c])), staff = new Map(data.staff.map((p) => [p.id, p.display_name]));
  function start(kind: JourneyDocument["kind"], consultationId = data.consultationId ?? "") {
    setError(""); setSaved(""); setReason(""); setHistory(null);
    setEditing({ id: crypto.randomUUID(), consultationId, expectedVersion: 0, voided: false, document: { kind, status: kind === "visit" ? "scheduled" : kind === "call" ? "connected" : "confirmed", purpose: "new", scheduledOn: null, happenedOn: kind === "visit" ? null : data.today, ownerId: data.staff.some((p) => p.id === data.currentUser && p.status === "active") ? data.currentUser : "", evidence: "", sourceUrl: "", nextAction: "", nextDue: null, nextDoneOn: null } });
  }
  function edit(r: JourneyRecord) { setEditing({ id: r.id, consultationId: r.consultation_id, expectedVersion: r.version, voided: r.voided, document: { ...r.document } }); setReason(""); setError(""); setSaved(""); setHistory(null); }
  function patch(p: Partial<JourneyDocument>) { setEditing((e) => e ? { ...e, document: { ...e.document, ...p } } : e); }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!editing || busy) return;
    setError(""); setSaved("");
    const input = saveJourneySchema.safeParse({ ...editing, reason });
    if (!input.success) { setError(korean(input.error.issues[0]?.message, "입력값을 확인해 주세요")); return; }
    const invalid = validateJourneyDates(input.data.document, data.today); if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/enrollment/journey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.data) });
      const body = await response.json().catch(() => ({})) as { version?: number; error?: string };
      if (!response.ok) throw Error(korean(body.error, "저장하지 못했습니다"));
      setEditing(null); setSaved(`기록을 저장했습니다. 변경 이력 v${body.version}에 남았습니다.`); router.refresh();
    } catch (err) { setError(korean(err instanceof Error ? err.message : undefined, "저장하지 못했습니다")); }
    finally { setBusy(false); }
  }
  async function showHistory(r: JourneyRecord) {
    setError("");
    try {
      const response = await fetch(`/api/enrollment/journey?id=${encodeURIComponent(r.id)}`);
      const body = await response.json().catch(() => ({})) as { history?: JourneyRevision[]; error?: string };
      if (!response.ok || !body.history) throw Error(korean(body.error, "이력을 불러오지 못했습니다"));
      setHistory({ id: r.id, rows: body.history });
    } catch (err) { setError(korean(err instanceof Error ? err.message : undefined, "이력을 불러오지 못했습니다")); }
  }
  const name = (id: string, fallback: string) => <Link href={`/enrollment/${id}#journey`}>{fallback}</Link>;
  // 그 해 기록 + **그 해 전부터 끝나지 않은 일**(후속 업무 미완료 · 결과 확인 전 예약) — 요약의 '결과 확인 전 예약'·'후속 기한 경과'가 세는 줄이 목록에도 보여야 한다.
  const carried = (r: JourneyRecord) => !r.voided && eventDay(r) <= data.through
    && ((!!r.document.nextDue && !r.document.nextDoneOn) || (r.document.kind === "visit" && r.document.status === "scheduled"));
  const list = data.records.filter((r) => {
    if (!compact && !eventDay(r).startsWith(String(data.year)) && !carried(r)) return false;
    if (onlyOpen && (r.voided || (!r.document.nextDue || r.document.nextDoneOn))) return false;
    return !query || `${names.get(r.consultation_id)?.label ?? ""} ${r.document.evidence} ${staff.get(r.document.ownerId) ?? ""}`.includes(query);
  }).sort((x, y) => eventDay(y).localeCompare(eventDay(x)) || y.updated_at.localeCompare(x.updated_at));
  const issues = summary.issues.filter((r) => !query || `${r.name} ${r.school} ${r.reasons.join(" ")}`.includes(query));
  // 2021–2026 검증 자료는 귀속 지점에만 내려온다(server.ts) — 없으면 탭도 세우지 않는다.
  const baseline = data.history, historical = baseline?.monthly ?? [];
  const visitRecords = summary.selected.filter((r) => r.document.kind === "visit");
  return <div id="journey" className={`${s.root} ${a.dashboard} ${compact ? s.compact : ""}`}>
    {!compact && <>
      <header className={s.hero}><div><div className={s.eyebrow}>신규 콜&상담 · 방문·등록 점검</div><h1>전화부터 방문, 등록까지</h1><p>예정과 실적을 구분하고, 확인 근거와 담당자의 다음 액션을 함께 기록합니다.</p></div><Link href="/enrollment">신규 콜&상담으로 돌아가기 →</Link></header>
      <div className={s.toolbar}><label>조회 연도 <select aria-label="조회 연도" value={data.year} onChange={(e) => router.push(`/enrollment/visits?year=${e.target.value}`)}>{Array.from({ length: Number(data.today.slice(0, 4)) - 2020 }, (_, i) => 2021 + i).reverse().map((y) => <option key={y}>{y}</option>)}</select></label><span className={s.muted}>{data.through}까지 · 기록의 현재 확인 상태 기준</span></div>
      <div className={s.metrics}>
        <StatCard label="확인된 실제 방문" value={summary.visits || null} unit="회" note={summary.visits ? `중복 제외 방문 대상 ${summary.people} · 동일 월 재방문은 아래 표에서 구분` : "방문 실적 미입력 · 방문 0명을 의미하지 않습니다"} icon="people" />
        <StatCard label="방문 후 등록 근거" value={summary.people ? summary.registered : null} unit="대상" accent={palette[1]} note={summary.conversion === null ? "방문·등록 확정일 확인 후 계산" : `${summary.registered} / ${summary.people} · 관측 비율 ${summary.conversion}%`} />
        <StatCard label="결과 확인 전 예약" value={summary.pendingVisits} unit="건" accent={palette[2]} note="예정일이 지난 예약 · 노쇼로 자동 처리하지 않음" icon="record" />
        <StatCard label="기록 보완 대상" value={summary.issues.length} unit="건" accent={palette[5]} note={`전화 시도 ${summary.calls}회 / 연결 ${summary.connected}회 · 후속 기한 경과 ${summary.overdue}건`} icon="record" />
      </div>
      <div className={s.warning}>기존 ‘상담일’은 전화·방문 방식이 구분되지 않아 실제 방문으로 자동 확정하지 않습니다. 결제일·수업 시작일도 등록일로 대신 사용하지 않습니다. {summary.unknownIdentity > 0 && <b>학생 식별정보가 부족한 방문 {summary.unknownIdentity}회는 별도 상담 사례로 남아 있어 중복 가능성이 있습니다.</b>}</div>
      <div className={s.charts}>
        <ChartCard title="월별 확인된 방문" note="실제 방문 완료 기록만 집계합니다. 입력이 없는 달은 미확인입니다. 같은 사람은 한 달에 1대상, 다른 달 재방문은 각 달에 포함됩니다."><SeriesChart unit="건" points={summary.monthly.map((m) => ({ label: m.month.slice(5) + "월", values: [m.visits || null, m.people || null], partial: m.unverified > 0 }))} series={[{ label: "방문 횟수", color: palette[0] }, { label: "중복 제외 대상", color: palette[1] }]} /></ChartCard>
        <ChartCard title="방문 기록의 처리 상태" note="신규·재입학만 포함. 전화상담·기존 재원 상담·대상 미확인은 방문 통계에서 제외합니다."><DonutChart label="방문 기록" unit="건" data={(["completed", "scheduled", "no_show", "cancelled"] as const).map((k, i) => ({ label: statuses[k], value: visitRecords.filter((r) => r.document.status === k).length, color: [palette[1], palette[0], palette[2], palette[4]][i] }))} /></ChartCard>
      </div>
      <nav className={s.toolbar} aria-label="방문 점검 보기"><button type="button" aria-pressed={tab === "records"} onClick={() => setTab("records")}>기록·후속 업무</button><button type="button" aria-pressed={tab === "quality"} onClick={() => setTab("quality")}>보완 대상 {summary.issues.length}</button>{baseline ? <button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")}>2021–2026 검증 자료</button> : null}<input className={s.search} aria-label="방문 기록 검색" placeholder="학생·담당자·보완 항목 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></nav>
    </>}
    {(compact || tab === "records") && <section className={s.panel}>
      <div className={s.toolbar}><h2>전화·방문·등록 기록</h2>{compact && <Link href="/enrollment/visits">전체 점검 →</Link>}</div>
      <p className={s.note}>예약을 만든 뒤 실제 결과로 수정하면 같은 방문 1건으로 관리됩니다. 재방문은 새 기록을 추가하세요. 등록 확정 기록은 기존 상담 상태·수납·반 배정을 자동 변경하지 않습니다.</p>
      {data.canWrite && <div className={s.actions}>{Object.entries(kinds).map(([k, v]) => <button key={k} type="button" onClick={() => start(k as JourneyDocument["kind"])}>+ {v}</button>)}</div>}
      {saved && <p role="status" className={s.success}>{saved}</p>}{error && <p role="alert" className={s.error}>{error}</p>}
      {editing && <form className={s.form} onSubmit={submit}>
        <label className={s.full}>연결 상담<select required disabled={!!data.consultationId || editing.expectedVersion > 0} value={editing.consultationId} onChange={(e) => setEditing({ ...editing, consultationId: e.target.value })}><option value="">학생의 상담 기록 선택{data.consultationId ? "" : ` (${data.year - 1}~${data.year}년 접수 상담 · 더 오래된 상담은 그 상담 상세에서 기록)`}</option>{data.choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>기록 종류<input readOnly value={kinds[editing.document.kind]} /></label>
        <label>신규·재입학 구분<select value={editing.document.purpose} onChange={(e) => patch({ purpose: e.target.value as JourneyDocument["purpose"] })}>{Object.entries(purposes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>처리 결과<select value={editing.document.status} onChange={(e) => patch({ status: e.target.value as JourneyDocument["status"], happenedOn: e.target.value === "scheduled" ? null : editing.document.happenedOn ?? data.today })}>{allowedStatuses[editing.document.kind].map((k) => <option key={k} value={k}>{statuses[k]}</option>)}</select></label>
        <label>담당자<select required value={editing.document.ownerId} onChange={(e) => patch({ ownerId: e.target.value })}><option value="">담당자 선택</option>{data.staff.filter((p) => p.status === "active" || p.id === editing.document.ownerId).map((p) => <option key={p.id} value={p.id} disabled={p.status !== "active"}>{p.display_name}{p.status !== "active" ? " (비활성)" : ""}</option>)}</select></label>
        {editing.document.kind === "visit" && <label>방문 예정일<input type="date" value={editing.document.scheduledOn ?? ""} onChange={(e) => patch({ scheduledOn: e.target.value || null })} /></label>}
        {editing.document.status !== "scheduled" && <label>{editing.document.kind === "registration" ? "실제 등록·취소 확인일" : editing.document.status === "completed" ? "실제 방문일" : "실제 통화·결과 확인일"}<input type="date" required max={data.today} value={editing.document.happenedOn ?? ""} onChange={(e) => patch({ happenedOn: e.target.value || null })} /></label>}
        <label className={s.full}>결과·확인 근거<textarea required maxLength={3000} value={editing.document.evidence} onChange={(e) => patch({ evidence: e.target.value })} placeholder="누구와 어떤 내용을 확인했는지, 방문·등록을 확인할 수 있는 근거를 기록하세요." /></label>
        <label className={s.full}>원본 자료 주소 (선택)<input type="url" value={editing.document.sourceUrl} onChange={(e) => patch({ sourceUrl: e.target.value })} placeholder="구글시트·캘린더·녹음 등 원본 주소" /></label>
        <label>다음 할 일<input value={editing.document.nextAction} maxLength={1000} onChange={(e) => patch({ nextAction: e.target.value })} /></label>
        <label>후속 업무 기한<input type="date" value={editing.document.nextDue ?? ""} onChange={(e) => patch({ nextDue: e.target.value || null })} /></label>
        {!!editing.document.nextAction && <label>후속 업무 완료일 (완료했을 때만)<input type="date" max={data.today} value={editing.document.nextDoneOn ?? ""} onChange={(e) => patch({ nextDoneOn: e.target.value || null })} /></label>}
        {editing.expectedVersion > 0 && <><label className={s.full}>수정·제외 사유<input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></label><label className={`${s.check} ${s.full}`}><input type="checkbox" checked={editing.voided} onChange={(e) => setEditing({ ...editing, voided: e.target.checked })} />잘못 입력한 기록을 집계에서 제외 (이력 보존)</label></>}
        <div className={`${s.actions} ${s.full}`}><button type="submit" disabled={busy}>{busy ? "저장 중…" : "확인 기록 저장"}</button><button type="button" className={s.secondary} onClick={() => setEditing(null)}>닫기</button></div>
      </form>}
      {!compact && <label className={`${s.check} ${s.note}`}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> 미완료 후속 업무만 보기</label>}
      <div className={s.scroll}><table className={s.table}><thead><tr><th>학생·일자</th><th>기록·결과</th><th>담당자·후속 업무</th><th>확인 근거</th><th>처리</th></tr></thead><tbody>{list.map((r) => <tr key={r.id}><td>{name(r.consultation_id, names.get(r.consultation_id)?.name ?? "상담")}<span className={s.muted}>{eventDay(r)}<br />{purposes[r.document.purpose]}</span></td><td><b>{kinds[r.document.kind]}</b><span className={`${s.badge} ${r.document.status === "completed" || r.document.status === "confirmed" ? s.done : ""}`}>{r.voided ? "집계 제외" : statuses[r.document.status]}</span>{r.document.scheduledOn && <div className={s.muted}>예정 {r.document.scheduledOn}</div>}</td><td><b>{staff.get(r.document.ownerId) ?? "담당자 확인"}</b>{r.document.nextAction || "후속 업무 없음"}{r.document.nextDue && <div className={`${s.badge} ${r.document.nextDoneOn ? s.done : r.document.nextDue < data.today ? s.late : ""}`}>{r.document.nextDoneOn ? `${r.document.nextDoneOn} 완료` : `${r.document.nextDue}까지`}</div>}</td><td><span>{r.document.evidence}</span>{r.document.sourceUrl && <><br /><a href={r.document.sourceUrl} target="_blank" rel="noreferrer">원본 확인 ↗</a></>}</td><td>{data.canWrite && <button type="button" onClick={() => edit(r)}>결과·수정</button>}<button type="button" onClick={() => showHistory(r)}>이력 v{r.version}</button></td></tr>)}</tbody></table></div>
      {!list.length && <p className={s.empty}>확인 기록이 아직 없습니다.<br />상담별 예약·실제 방문·등록 근거를 기록하면 통계와 학생 지식그래프에 연결됩니다.</p>}
      {history && <div className={s.history}><div className={s.toolbar}><b>변경 이력</b><button type="button" onClick={() => setHistory(null)}>닫기</button></div>{history.rows.map((r) => <div key={r.version}><b>v{r.version} · {staff.get(r.actor_id) ?? "기록 담당자"} · {new Date(r.recorded_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</b><p>{r.voided ? "집계 제외" : statuses[r.document.status]} · 실제 {dateLabel(r.document.happenedOn)} · 예정 {dateLabel(r.document.scheduledOn)}</p><p>{r.document.evidence}</p><p>사유: {r.reason || "최초 기록"}</p></div>)}</div>}
    </section>}
    {!compact && tab === "quality" && <section className={s.panel}><h2>확인하고 보완할 상담</h2><p className={s.note}>접수일 기준, 접수일이 없으면 기존 정렬일로 찾은 후보입니다. 미확인을 미등록·노쇼로 바꾸지 않습니다. 이름을 눌러 기존 상담을 확인하고 실제 근거가 있을 때 기록하세요.</p><div className={s.scroll}><table className={s.table}><thead><tr><th>학생</th><th>접수·기록일</th><th>보완 항목</th><th>다음 액션</th></tr></thead><tbody>{issues.slice(0, 150).map((r) => <tr key={r.id}><td>{name(r.id, r.name)}<div className={s.muted}>{r.school} {r.grade}</div></td><td>{r.date}</td><td>{r.reasons.map((x) => <span key={x} className={`${s.badge} ${s.late}`}>{x}</span>)}</td><td><Link href={`/enrollment/${r.id}#journey`}>상담 확인·보완 →</Link></td></tr>)}</tbody></table></div><p className={s.note}>{issues.length}건 중 {Math.min(150, issues.length)}건 표시 · 검색으로 좁힐 수 있습니다.</p></section>}
    {!compact && tab === "history" && baseline && <>
      <section className={s.panel}><h2>첨부 분석과 현재 기록을 구분해서 보기</h2><p className={s.note}>{baseline.asOf}에 검증한 70개월 스냅샷입니다. 에이와 현재 기록에 중복 가산하지 않습니다. 월 방문자 합계는 연간 고유 학생 수가 아니며, 미확인은 방문 0명이 아닙니다.</p><div className={s.charts}><ChartCard title={`${data.year}년 과거 관측 방문·예약`} note="방문은 명·월, 예약은 횟수로 단위가 다릅니다."><SeriesChart unit="" points={historical.map((m) => ({ label: m.month.slice(5) + "월", values: [m.visitors, m.reservations], partial: m.month === "2026-10" }))} series={[{ label: "방문 관측(명·월)", color: palette[1] }, { label: "예약 기록(회)", color: palette[0] }]} /></ChartCard><ChartCard title="2023–2025 월별 평균 예약" note="예약 수요의 계절성 참고치입니다. 실제 방문·매출 효과로 단정하지 않습니다."><RankBars unit="회" data={baseline.seasonality.map((m) => ({ label: m.month, value: Math.round(m.average * 10) / 10, color: palette[0] }))} /></ChartCard></div></section>
      <section className={s.panel}><h2>{data.year}년 원본 검증표</h2><div className={s.scroll}><table className={s.table}><thead><tr><th>월</th><th>방문(명·월)</th><th>문의 사례</th><th>등록 근거 사례</th><th>결과 미확인</th><th>실제 등록일 확인(명)</th><th>자료 상태</th></tr></thead><tbody>{historical.map((m) => <tr key={m.month}><td>{m.month}</td><td>{m.visitors ?? "미확인"}</td><td>{m.cases ?? "미확인"}</td><td>{m.registeredEvidence ?? "미확인"}</td><td>{m.unknownResults ?? "미확인"}</td><td>{m.datedRegistrations ?? "미확인"}</td><td>{m.note}</td></tr>)}</tbody></table></div><p className={s.note}>출처: {baseline.source} · {baseline.range}. 상담 원문과 개인정보는 이 비교표에 복사하지 않았습니다.</p></section>
    </>}
  </div>;
}
