"use client";

import { useEffect, useRef, useState } from "react";
import { Toolbar, ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { ADMIN_PERIODS, buildAttention, distinctStudents, foldMatrixRows, lateByKind, type AdminPeriod, type AttentionRow, type DutyAdminData, type DutyAdminScope, type LateItem, type MatrixRow, type SubjectFilter } from "../../view-admin";
import { buildTree, foldAttention, judge, NO_CLASS, NO_OWNER, NO_SUBJECT, rootOfTree, type TreeSubject } from "../../view-admin-levels";
import type { DutyWork } from "../duty-work-context";
import { AdminAttention } from "./admin-attention";
import { AdminKpiRow } from "./admin-subject";
import { DutyRequestScope, LateRequestButton } from "./admin-late-request";
import { AdminOwnerBoard } from "./admin-owner-board";
import { AdminMatrix } from "./admin-matrix";
import { AdminOverlay } from "./admin-overlay";
import { AdminTree, ROOT, type Sel } from "./admin-tree";
import { VerdictLine } from "./admin-verdict";
import { TeacherLevel } from "./admin-level-teacher";
import { ClassLevel } from "./admin-level-class";
import { StudentLevel } from "./admin-level-student";
import { useStudentsPayload } from "./use-students";

/** now = 서버가 이 재료를 만든 시각(지난 날 수·기준 시각 비교에 쓴다 — 그리는 중에 시계를 읽지 않는다). */
export type Loaded = { period: AdminPeriod; today: string; now: string; range: { from: string; to: string; label: string }; data: DutyAdminData };
const REFRESH_MS = 60_000;
/** 장부를 맞춘 지 이보다 오래면 '최신이 아님'을 알린다(맞춤은 30분마다 + 화면을 열 때). */
const STALE_MS = 90 * 60_000;
const kstStamp = (iso: string) => { const d = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString(); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${d.slice(11, 16)}`; };

/**
 * 업무 완성도(관리자) 본체 — 과목 → 선생님 → 반 → 학생으로 파고드는 화면(원장 2026-11-10 *"지금 너무 나열되어있어서 보기가 어려움"*).
 * 왼쪽 트리(과목·선생님·반 · 판정 점) | 오른쪽 그 단계의 상세. 판정 = 기한이 온 것 중 제때 끝낸 비율(`judge`). 기간은 바꿀 때 GET · 보일 때 60초 갱신.
 * 오늘·이번 주는 일간만(강사 홈과 같은 셈) · 이번 달·지난 달은 월간·신규생 정착까지. 누르면 열리는 간이 페이지(학생 상세·상담)는 오버레이.
 * **'지금 지연'은 고른 기간과 무관하다**(지금 열려 있는 지연 전부) — 그래서 그 줄의 선생님·반이 이 기간 트리에 없으면 이동하지 않고 제자리에서 펼친다.
 * 평가 시작(live_from) 전 기한의 의무는 '이관된 미확인'으로 따로 묶는다(판정·지연 수에 안 든다).
 * 고른 자리(`Sel`)는 **지금 기간의 트리에 맞춰 바로잡는다** — 없는 과목은 전체로, 없는 선생님·반은 그 위 단계로(기간을 바꿔도 화면이 어긋나지 않게).
 */
export function DutyAdmin({ initial, scope, managers = null }: { initial: Loaded; scope: DutyAdminScope; /** 과목 키 → 과목 관리자 이름(학원 전체를 보는 사람에게만 — 원장 첫 화면의 '과목 관리자별 현황'). */ managers?: Record<string, string[]> | null }) {
  const [period, setPeriod] = useState<AdminPeriod>(initial.period);
  const [loaded, setLoaded] = useState<Partial<Record<AdminPeriod, Loaded>>>({ [initial.period]: initial });
  const [failed, setFailed] = useState<Partial<Record<AdminPeriod, true>>>({});
  const [lateOnly, setLateOnly] = useState(false);
  const [rawSel, setSel] = useState<Sel>(ROOT);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [work, setWork] = useState<{ seq: number; work: DutyWork } | null>(null);
  const [tick, setTick] = useState(0);
  const periodRef = useRef(period);
  useEffect(() => { periodRef.current = period; }, [period]);

  // 기간 GET — 없는 기간을 고르면 받고, 보일 때 60초마다 현재 기간을 다시 받는다(셸 자동 호출은 서버 액션 금지 #137).
  // 세대 번호(gen)로 탭을 숨겼다 다시 볼 때 옛 고리가 한 번 더 예약하지 못하게 한다(고리가 둘로 늘지 않는다).
  useEffect(() => {
    let alive = true; let gen = 0; let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (p: AdminPeriod) => {
      try {
        const r = await fetch(`/api/duties/admin?period=${p}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const next = (await r.json()) as Loaded;
        if (alive) { setLoaded((cur) => ({ ...cur, [p]: next })); setFailed((f) => { const rest = { ...f }; delete rest[p]; return rest; }); setTick((t) => t + 1); }
      } catch { if (alive) setFailed((f) => ({ ...f, [p]: true })); }
    };
    const loop = async (myGen: number) => {
      if (document.visibilityState === "visible") await load(periodRef.current);
      if (alive && myGen === gen) timer = setTimeout(() => void loop(myGen), REFRESH_MS);
    };
    timer = setTimeout(() => void loop(gen), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") { gen += 1; if (timer) clearTimeout(timer); void loop(gen); } };
    document.addEventListener("visibilitychange", onVisible);
    if (!loaded[period]) void load(period);
    return () => { alive = false; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 기간이 바뀔 때만 새로 받는다(받아 둔 기간은 그대로).
  }, [period]);

  const cur = loaded[period];
  const nowMs = cur ? Date.parse(cur.now) : 0;
  const tree = cur ? buildTree(cur.data.ownerKind, cur.data.classes, cur.data.owners, cur.data.classInfo, scope.labels) : [];
  const multi = tree.length > 1;
  // 고른 자리 바로잡기 — 과목이 하나면 늘 그 과목 · 트리에 없는 과목은 전체 · 없는 선생님·반은 위 단계로. 학생은 단계와 무관하게 연다(지연 목록에서 바로 들어온다).
  const subject0: Sel["subject"] = !multi ? (tree[0]?.subject ?? null) : rawSel.subject !== undefined && !tree.some((s) => s.subject === rawSel.subject) ? undefined : rawSel.subject;
  const atRoot = multi && subject0 === undefined;
  const subjectNode: TreeSubject | null = !tree.length ? null : atRoot ? rootOfTree(tree) : tree.find((s) => s.subject === subject0) ?? null;
  const ownerNode = subjectNode && rawSel.owner !== null ? subjectNode.owners.find((o) => o.ownerId === rawSel.owner) ?? null : null;
  const classNode = ownerNode && rawSel.classId !== null ? ownerNode.classes.find((c) => c.classId === rawSel.classId) ?? null : null;
  const sel: Sel = { subject: subject0, owner: ownerNode?.ownerId ?? null, classId: classNode?.classId ?? null, studentId: rawSel.studentId, studentName: rawSel.studentName, kind: ownerNode ? rawSel.kind ?? null : null };
  // 학생 집계 GET에 보낼 과목 값 — 전체면 없음 · '과목 미정'이면 NO_SUBJECT(과목 없는 의무만).
  const subjectKey: SubjectFilter = atRoot ? undefined : (subjectNode?.subject ?? null);
  const fetchSubject = subjectKey === undefined ? null : subjectKey === null ? NO_SUBJECT : subjectKey;
  // 지연 — 과목을 **골랐을 때만** 그 과목으로 거른다. 트리에 과목이 하나뿐이라 저절로 그 과목에 서 있는 것은 고른 게 아니다(이 기간에 수업이 없는 과목의 지연이 사라지면 안 된다).
  const lateFilter: SubjectFilter = multi && !atRoot ? subjectKey : undefined;
  const lateAll: LateItem[] = cur ? cur.data.late.filter((it) => lateFilter === undefined || it.subject === lateFilter) : [];
  const here = (it: LateItem) => (ownerNode ? (ownerNode.ownerId === NO_OWNER ? it.ownerId === null : it.ownerId === ownerNode.ownerId) : true)
    && (!classNode || (classNode.classId === NO_CLASS ? it.classId === null : it.classId === classNode.classId));
  const liveHere = lateAll.filter((it) => !it.inherited && here(it));
  const inheritedHere = lateAll.filter((it) => it.inherited && here(it));
  const fold = (rows: AttentionRow[]) => (classNode ? rows : foldAttention(rows, ownerNode ? "class" : "owner"));
  const attentionAll = cur ? buildAttention(liveHere, cur.data.owners, undefined, nowMs) : [];
  const inheritedAll = cur ? buildAttention(inheritedHere, cur.data.owners, undefined, nowMs) : [];
  const childrenOf = (all: AttentionRow[], r: AttentionRow) => (ownerNode ? all.filter((c) => (c.classId ?? NO_CLASS) === r.classId) : all.filter((c) => (c.ownerId ?? NO_OWNER) === (r.ownerId ?? NO_OWNER)));
  const rangeLabel = cur?.range.label ?? "";
  const crumbs: { label: string; sel: Sel }[] = [];
  if (multi) crumbs.push({ label: "전체", sel: ROOT });
  if (subjectNode && !atRoot) crumbs.push({ label: subjectNode.label, sel: { subject: subjectNode.subject, owner: null, classId: null, studentId: null } });
  if (ownerNode) crumbs.push({ label: ownerNode.name, sel: { ...sel, classId: null, studentId: null } });
  if (classNode) crumbs.push({ label: classNode.name, sel: { ...sel, studentId: null } });
  const openWork = (w: DutyWork) => setWork((cur) => ({ seq: (cur?.seq ?? 0) + 1, work: w }));
  const subjectAvg = subjectNode ? { pct: subjectNode.cell.pct, label: atRoot ? "전체" : "과목" } : null;
  // 자리를 옮길 때마다 펼침을 지운다(다른 단계로 갔다 오면 옛 펼침이 되살아나지 않게).
  const go = (next: Sel) => { setOpenKey(null); setSel(next); };
  const toggle = (list: "live" | "inh", key: string) => setOpenKey((k) => (k === `${list}:${key}` ? null : `${list}:${key}`));
  const pickStudent = (studentId: string, studentName: string) => go({ ...sel, studentId, studentName });
  // 지연 줄을 눌렀을 때 — 학생이면 그 학생 · 이 기간 트리에 있는 선생님·반이면 그 단계로 · 없으면 제자리에서 펼친다(눌렀는데 아무 일도 없는 줄을 만들지 않는다).
  const openRow = (r: AttentionRow) => {
    if (r.studentId) return pickStudent(r.studentId, r.title);
    if (classNode) { if (r.classId) openWork({ href: `/classes/${r.classId}`, title: r.title }); return; }
    if (ownerNode) { const id = r.classId ?? NO_CLASS; if (ownerNode.classes.some((c) => c.classId === id)) go({ ...sel, classId: id, studentId: null }); else toggle("live", r.key); return; }
    const id = r.ownerId ?? NO_OWNER;
    if (subjectNode?.owners.some((o) => o.ownerId === id)) go({ ...sel, owner: id, kind: null, classId: null, studentId: null }); else toggle("live", r.key);
  };
  const openChild = (r: AttentionRow) => { if (r.studentId) pickStudent(r.studentId, r.title); else if (r.classId) openWork({ href: `/classes/${r.classId}`, title: r.title }); };
  const expandOf = (list: "live" | "inh", all: AttentionRow[], rows: AttentionRow[]) => { const r = rows.find((x) => `${list}:${x.key}` === openKey); return r ? { key: r.key, rows: childrenOf(all, r) } : null; };
  const attention = fold(attentionAll); const inheritedRows = fold(inheritedAll);
  const lateSection = <section className="border-line-faint rounded-xl border p-2">
    <div className="flex items-center gap-2 px-2 py-1">
      <h4 className="min-w-0 flex-1 text-sm font-bold">현재 지연 <span className="text-text-dim text-xs font-medium">{distinctStudents(liveHere)}명 · {liveHere.length}건 · 기간 무관</span></h4>
      {ownerNode && ownerNode.ownerId !== NO_OWNER ? <LateRequestButton owner={{ id: ownerNode.ownerId, name: ownerNode.name }} items={liveHere} /> : null}
    </div>
    {/* 처리 요청은 선생님 단위다 — 전체·과목 단계는 줄(선생님)마다, 선생님·반 단계는 위 단추 하나(지금 보이는 범위의 지연). */}
    <AdminAttention rows={attention} onOpen={openRow} expand={expandOf("live", attentionAll, attention)} onOpenChild={openChild}
      action={ownerNode ? undefined : (r) => <LateRequestButton owner={{ id: r.ownerId, name: r.title }} items={liveHere.filter((it) => it.ownerId === r.ownerId)} />} />
  </section>;
  const synced = cur?.data.syncedAt ?? null;
  const stale = !!cur && (!synced || nowMs - Date.parse(synced) > STALE_MS);

  return <DutyRequestScope today={cur?.today ?? initial.today} tick={tick}><div className="space-y-4">
    <Toolbar>
      <ToolbarSegment>{ADMIN_PERIODS.map((p) => <ToolbarSegmentItem key={p.key} active={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</ToolbarSegmentItem>)}</ToolbarSegment>
      <span className="text-text-dim text-sm font-semibold">{rangeLabel}</span>
      {synced && !stale ? <span className="text-text-dim text-xs font-medium">장부 기준 {kstStamp(synced)}</span> : null}
      <ToolbarChip active={lateOnly} onClick={() => setLateOnly((v) => !v)} className="ml-auto">지연만</ToolbarChip>
    </Toolbar>
    {stale ? <p className="bg-amber-soft text-amber rounded-lg px-3 py-2 text-sm font-semibold">{synced ? `장부 기준 ${kstStamp(synced)} · 이후 저장분은 미반영일 수 있음` : "장부 기준 시각 없음 · 수치가 실제와 다를 수 있음"}</p> : null}
    {!cur ? <p className="text-text-dim text-sm">{failed[period] ? "조회 실패 · 잠시 후 다시 열어 주세요" : "불러오는 중…"}</p> : null}

    {cur ? <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
      <aside className="border-line-faint rounded-xl border p-2 lg:sticky lg:top-2">
        {tree.length ? <AdminTree tree={tree} multi={multi} sel={sel} lateOnly={lateOnly} onSelect={(next) => { setOpenKey(null); setSel(next); }} /> : <p className="text-text-dim px-2 py-4 text-sm">해당 기간 업무 없음</p>}
      </aside>
      <main className="grid gap-4">
        {crumbs.length > 1 || sel.studentId ? <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="위치">
          {crumbs.map((c, i) => <span key={i} className="flex items-center gap-1">
            {i ? <span className="text-text-placeholder" aria-hidden>›</span> : null}
            <button type="button" onClick={() => go(c.sel)} className="hover:text-primary font-semibold">{c.label}</button>
          </span>)}
          {sel.studentId ? <span className="flex items-center gap-1">{crumbs.length ? <span className="text-text-placeholder" aria-hidden>›</span> : null}<span className="font-semibold">{sel.studentName ?? "학생"}</span>
            <button type="button" onClick={() => go({ ...sel, studentId: null })} className="text-text-dim hover:text-primary ml-1 text-xs font-semibold underline">닫기</button></span> : null}
        </nav> : null}

        {sel.studentId ? <StudentPane key={`${sel.studentId}|${fetchSubject ?? ""}`} period={period} tick={tick} studentId={sel.studentId} fetchSubject={fetchSubject} late={lateAll.filter((it) => it.studentId === sel.studentId)} nowMs={nowMs} onWork={openWork} />
          : !subjectNode ? lateSection
          : classNode && ownerNode ? <ClassPane key={`${classNode.classId}|${ownerNode.ownerId}|${fetchSubject ?? ""}`} period={period} tick={tick} classNode={classNode} owner={ownerNode.ownerId} fetchSubject={fetchSubject} teacher={ownerNode.name} kind={sel.kind ?? null}
              avg={{ pct: ownerNode.cell.pct, label: "선생님" }} onStudent={pickStudent} />
          : ownerNode ? <TeacherLevel owner={ownerNode} avg={subjectAvg} period={period} subject={fetchSubject} tick={tick} kind={sel.kind ?? null} onClearKind={() => go({ ...sel, kind: null })} onClass={(classId) => go({ ...sel, classId, studentId: null })} />
          : <SubjectLevel node={subjectNode} lateOnly={lateOnly} board={atRoot && managers ? <AdminOwnerBoard tree={tree} late={cur.data.late} managers={managers} labels={scope.labels} nowMs={nowMs} onSubject={(subject) => go({ subject, owner: null, classId: null, studentId: null })} /> : null} avgLabel={atRoot ? "전체" : "과목"} lateText={lateByKind(cur.data.ownerKind, subjectKey)} attention={lateSection} onOwner={(ownerId, kind) => { setOpenKey(null); setSel({ ...sel, owner: ownerId, kind, classId: null, studentId: null }); }} />}

        {!sel.studentId && subjectNode && ownerNode ? lateSection : null}
        {!sel.studentId && inheritedHere.length ? <section className="border-line-faint rounded-xl border p-2">
          <h4 className="px-2 py-1 text-sm font-bold">이관 <span className="text-text-dim text-xs font-medium">{distinctStudents(inheritedHere)}명 · {inheritedHere.length}건 · 평가 개시 전 기한 경과 · 평가 제외</span></h4>
          <AdminAttention rows={inheritedRows} onOpen={(r) => (r.studentId || classNode ? openChild(r) : toggle("inh", r.key))} expand={expandOf("inh", inheritedAll, inheritedRows)} onOpenChild={openChild} muted />
        </section> : null}
      </main>
    </div> : null}

    {work ? <AdminOverlay key={work.seq} work={work.work} onClose={() => setWork(null)} /> : null}
  </div></DutyRequestScope>;
}

/** 과목(또는 전체) 단계 — 요약 칸 넷 · 판정 · (전체 단계 · 학원 전체를 보는 사람) 과목 관리자별 현황 · 지금 지연(먼저 손댈 것) · 선생님 × 종류 매트릭스(이름 = 그 선생님 · 칸 = 그 선생님의 그 종류). */
function SubjectLevel({ node, lateOnly, avgLabel, lateText, attention, board, onOwner }: { node: TreeSubject; lateOnly: boolean; avgLabel: string; lateText: string; attention: React.ReactNode; board: React.ReactNode; onOwner: (ownerId: string, kind: string | null) => void }) {
  const rowsAll: MatrixRow[] = node.owners.map((o) => ({ ownerId: o.ownerId, name: o.name, cells: o.cells, all: o.cell }));
  const rows = lateOnly ? rowsAll.filter((r) => r.all.late) : rowsAll;
  return <div className="grid gap-4">
    <AdminKpiRow cell={node.cell} lateText={lateText} />
    <VerdictLine v={judge(node.cell)} />
    {board}
    {attention}
    <section className="border-line-faint rounded-xl border p-2"><AdminMatrix rows={rows} total={foldMatrixRows(rows)} avg={{ pct: node.cell.pct, label: avgLabel }} onCell={onOwner} /></section>
  </div>;
}

/** 반 단계 — 그 반 · 그 담당의 집계(트리 줄과 같은 수) 한 번. 반 없는 의무(신규생 정착)는 반 조건 없이 그 담당의 집계에서 반 없는 줄만 · '담당 미정'은 담당자 없는 의무만. */
function ClassPane({ period, tick, classNode, owner, fetchSubject, teacher, avg, kind, onStudent }: {
  period: AdminPeriod; tick: number; classNode: { classId: string; name: string; cell: MatrixRow["all"] }; owner: string; fetchSubject: string | null; teacher: string; avg: { pct: number | null; label: string } | null; kind: string | null; onStudent: (studentId: string, name: string) => void;
}) {
  const classId = classNode.classId === NO_CLASS ? null : classNode.classId;
  const { data, failed } = useStudentsPayload(period, owner === NO_OWNER ? { classId, ownerNone: true, subject: fetchSubject } : { classId, owner, subject: fetchSubject }, tick);
  return <ClassLevel cls={classNode} teacher={teacher} avg={avg} payload={data} failed={failed} kind={kind} onStudent={onStudent} />;
}

/** 학생 단계 — 그 학생의 집계(반·담당 불문 · 신규생 정착처럼 반 없는 의무도) 한 번. */
function StudentPane({ period, tick, studentId, fetchSubject, late, nowMs, onWork }: {
  period: AdminPeriod; tick: number; studentId: string; fetchSubject: string | null; late: LateItem[]; nowMs: number; onWork: (w: DutyWork) => void;
}) {
  const { data } = useStudentsPayload(period, { studentId, subject: fetchSubject }, tick);
  return <StudentLevel studentId={studentId} payload={data} late={late} nowMs={nowMs} onWork={onWork} />;
}
