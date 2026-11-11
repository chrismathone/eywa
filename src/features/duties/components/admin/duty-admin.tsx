"use client";

import { useEffect, useRef, useState } from "react";
import { Toolbar, ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { PeriodNav } from "@/components/period-nav";
import { DatePickerButton } from "@/components/date-picker-button";
import { adminRange, buildAttention, periodKey, periodParts, periodPresets, periodUnit, shiftPeriod, distinctStudents, type AdminPeriod, type AttentionRow, type DutyAdminData, type DutyAdminScope, type LateItem, type SubjectFilter } from "../../view-admin";
import { attentionItems, buildTree, foldAttention, ownerMeta, NO_CLASS, NO_OWNER, NO_SUBJECT, rootOfTree, type TreeSubject } from "../../view-admin-levels";
import type { DutyWork } from "../duty-work-context";
import { AdminAttention } from "./admin-attention";
import { ClassPane, StudentPane, SubjectLevel } from "./admin-panes";
import { WithdrawalItemsDialog, type WithdrawalPick } from "./admin-withdrawal-items";
import { NoteButton } from "./admin-note";
import { useDutyPing } from "../use-duty-ping";
import { DutyRequestScope, LateRequestButton } from "./admin-late-request";
import { AdminOwnerBoard } from "./admin-owner-board";
import { AdminRanking } from "./admin-ranking";
import { AdminToday } from "./admin-today";
import { AdminOverlay } from "./admin-overlay";
import { AdminTree, ROOT, type Sel } from "./admin-tree";
import { TeacherLevel } from "./admin-level-teacher";
import { OntimeOnlyProvider } from "./admin-mix";
import { saveDutyOntimeOnly } from "../../server/prefs-actions";

/** now = 서버가 이 재료를 만든 시각(지난 날 수·기준 시각 비교에 쓴다 — 그리는 중에 시계를 읽지 않는다). */
export type Loaded = { period: AdminPeriod; today: string; now: string; range: { from: string; to: string; label: string }; data: DutyAdminData };
// 저장 순간의 신호(s2_0054 `useDutyPing`)가 바로 다시 받게 한다 — 이 주기는 실시간 연결이 끊겼을 때의 받침이다.
const REFRESH_MS = 60_000;
/** 장부를 맞춘 지 이보다 오래면 '최신이 아님'을 알린다(맞춤은 30분마다 + 화면을 열 때). */
const STALE_MS = 90 * 60_000;
const kstStamp = (iso: string) => { const d = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString(); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${d.slice(11, 16)}`; };

/**
 * 업무 완성도(관리자) 본체 — 과목 → 선생님 → 반 → 학생으로 파고드는 화면(원장 2026-11-10 *"지금 너무 나열되어있어서 보기가 어려움"*).
 * 왼쪽 트리(과목·선생님·반 · 판정 점) | 오른쪽 그 단계의 상세. 판정 = 기한이 온 것 중 제때 끝낸 비율(`judge`). 기간은 바꿀 때 GET · 보일 때 60초 갱신.
 * 오늘·이번 주는 일간만(강사 홈과 같은 셈) · 이번 달·지난 달은 월간·신규생 정착까지. 누르면 열리는 간이 페이지(학생 상세·상담)는 오버레이.
 * **'지금 지연'은 고른 기간과 무관하다**(지금 열려 있는 지연 전부) — 그래서 그 줄의 선생님·반이 이 기간 트리에 없으면 이동하지 않고 제자리에서 펼친다.
 * 평가 시작(live_from) 전 기한의 의무(이관)는 **화면에 보이지 않는다**(원장 2026-11-10 *"그런거 표시하지마"* — 판정·지연 수·할 일에도 안 든다 · 장부에는 남는다).
 * 고른 자리(`Sel`)는 **지금 기간의 트리에 맞춰 바로잡는다** — 없는 과목은 전체로, 없는 선생님·반은 그 위 단계로(기간을 바꿔도 화면이 어긋나지 않게).
 */
export function DutyAdmin({ initial, scope, managers = null, tenantId = null, ontimeOnly: ontimeOnly0 = false }: { initial: Loaded; scope: DutyAdminScope; /** '기한 내만 보기'의 저장값(계정 귀속). */ ontimeOnly?: boolean; /** 저장 순간의 신호를 들을 지점(s2_0054). */ tenantId?: string | null; /** 과목 키 → 과목 관리자 이름(학원 전체를 보는 사람에게만 — 원장 첫 화면의 '과목 관리자별 현황'). */ managers?: Record<string, string[]> | null }) {
  const [period, setPeriod] = useState<AdminPeriod>(initial.period);
  const [loaded, setLoaded] = useState<Partial<Record<AdminPeriod, Loaded>>>({ [initial.period]: initial });
  const [failed, setFailed] = useState<Partial<Record<AdminPeriod, true>>>({});
  const [lateOnly, setLateOnly] = useState(false);
  // 기한 내만 보기 — 칸의 숫자와 막대를 기한 내 몫만으로(선생님끼리 '기한 안에 한 것'을 견준다). 바꾸는 순간 계정에 저장한다(실패해도 화면은 그대로 — 내 보기 취향).
  const [ontimeOnly, setOntimeOnly] = useState(ontimeOnly0);
  const toggleOntimeOnly = () => { const on = !ontimeOnly; setOntimeOnly(on); void saveDutyOntimeOnly({ on }).catch(() => undefined); };
  const [rawSel, setSel] = useState<Sel>(ROOT);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [work, setWork] = useState<{ seq: number; work: DutyWork } | null>(null);
  const [tick, setTick] = useState(0);
  const [wpick, setWpick] = useState<WithdrawalPick | null>(null);
  // 지금 기간을 바로 다시 받기(저장 순간의 신호 · 관리 기록 저장 뒤). 받는 중이면 끝난 뒤 한 번 더.
  const reload = useRef<() => void>(() => undefined);
  const first = useRef(true);
  const refresh = () => reload.current();
  // 출결 · 보고서 · 상담이 저장되는 순간 지금 기간을 다시 받는다(다른 기간은 다음에 볼 때 새로 받게 비운다).
  useDutyPing(tenantId, refresh);
  const periodRef = useRef(period);
  useEffect(() => { periodRef.current = period; }, [period]);

  // 기간 GET — 없는 기간을 고르면 받고, 보일 때 60초마다 현재 기간을 다시 받는다(셸 자동 호출은 서버 액션 금지 #137).
  // 세대 번호(gen)로 탭을 숨겼다 다시 볼 때 옛 고리가 한 번 더 예약하지 못하게 한다(고리가 둘로 늘지 않는다).
  useEffect(() => {
    let alive = true; let gen = 0; let timer: ReturnType<typeof setTimeout> | null = null;
    const busy = { on: false, again: false };
    const load = async (p: AdminPeriod): Promise<void> => {
      if (busy.on) { busy.again = true; return; }
      busy.on = true;
      try {
        const r = await fetch(`/api/duties/admin?period=${p}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const next = (await r.json()) as Loaded;
        if (alive) { setLoaded((cur) => ({ ...cur, [p]: next })); setFailed((f) => { const rest = { ...f }; delete rest[p]; return rest; }); setTick((t) => t + 1); }
      } catch { if (alive) setFailed((f) => ({ ...f, [p]: true })); }
      busy.on = false;
      if (busy.again && alive) { busy.again = false; await load(periodRef.current); }
    };
    reload.current = () => { if (alive) void load(periodRef.current); };
    const loop = async (myGen: number) => {
      if (document.visibilityState === "visible") await load(periodRef.current);
      if (alive && myGen === gen) timer = setTimeout(() => void loop(myGen), REFRESH_MS);
    };
    timer = setTimeout(() => void loop(gen), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") { gen += 1; if (timer) clearTimeout(timer); void loop(gen); } };
    document.addEventListener("visibilitychange", onVisible);
    // 받아 둔 기간이면 그것을 먼저 보이고 곧바로 새로 받는다(다른 기간을 보는 사이 바뀌었을 수 있다) · 첫 그리기는 서버가 준 값 그대로.
    if (!loaded[period] || !first.current) void load(period);
    first.current = false;
    return () => { alive = false; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 기간이 바뀔 때만 새로 받는다(받아 둔 기간은 그대로).
  }, [period]);

  const cur = loaded[period];
  // 볼 수 있는 첫 날 — 한 번 받은 값을 계속 쓴다(불러오는 동안에도 앞쪽 이동을 막는다).
  const viewFrom = cur?.data.viewFrom ?? Object.values(loaded).find((l) => l?.data.viewFrom)?.data.viewFrom ?? null;
  const nowMs = cur ? Date.parse(cur.now) : 0;
  const tree = cur ? buildTree(cur.data.ownerKind, cur.data.classes, cur.data.owners, cur.data.classInfo, scope.labels, { load: cur.data.ownerLoad, managerIds: cur.data.managerIds, ratings: cur.data.ratings, withdrawal: cur.data.withdrawal }) : [];
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
  const fold = (rows: AttentionRow[]) => (classNode ? rows : foldAttention(rows, ownerNode ? "class" : "owner"));
  const attentionAll = cur ? buildAttention(liveHere, cur.data.owners, undefined, nowMs) : [];
  const childrenOf = (all: AttentionRow[], r: AttentionRow) => (ownerNode ? all.filter((c) => (c.classId ?? NO_CLASS) === r.classId) : all.filter((c) => (c.ownerId ?? NO_OWNER) === (r.ownerId ?? NO_OWNER)));
  // 기간 이름 · 기준일은 받기 전에도 바로 바뀌게 화면에서 계산한다(서버와 같은 함수).
  const today = cur?.today ?? initial.today;
  const unit = periodUnit(period); const anchor = periodParts(period)?.anchor ?? today;
  const rangeLabel = adminRange(period, today, viewFrom).label;
  const crumbs: { label: string; sel: Sel }[] = [];
  if (multi) crumbs.push({ label: "전체", sel: ROOT });
  if (subjectNode && !atRoot) crumbs.push({ label: subjectNode.label, sel: { subject: subjectNode.subject, owner: null, classId: null, studentId: null } });
  if (ownerNode) crumbs.push({ label: ownerNode.name, sel: { ...sel, classId: null, studentId: null } });
  if (classNode) crumbs.push({ label: classNode.name, sel: { ...sel, studentId: null } });
  const openWork = (w: DutyWork) => setWork((cur) => ({ seq: (cur?.seq ?? 0) + 1, work: w }));
  const subjectAvg = subjectNode ? { pct: subjectNode.cell.pct, label: atRoot ? "전체" : "과목" } : null;
  // 자리를 옮길 때마다 펼침을 지운다(다른 단계로 갔다 오면 옛 펼침이 되살아나지 않게).
  const go = (next: Sel) => { setOpenKey(null); setSel(next); };
  const toggle = (list: "live", key: string) => setOpenKey((k) => (k === `${list}:${key}` ? null : `${list}:${key}`));
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
  const expandOf = (list: "live", all: AttentionRow[], rows: AttentionRow[]) => { const r = rows.find((x) => `${list}:${x.key}` === openKey); return r ? { key: r.key, rows: childrenOf(all, r) } : null; };
  // 선생님 줄에는 이름 옆에 늘 과목 · 반 수 · 학생 수(그 옆 숫자는 지연이 있는 학생 수).
  const metaOf = new Map((subjectNode?.owners ?? []).map((o) => [o.ownerId, ownerMeta(o)]));
  const attention = fold(attentionAll).map((r) => (r.key.startsWith("owner:") && metaOf.get(r.ownerId ?? NO_OWNER) ? { ...r, sub: [metaOf.get(r.ownerId ?? NO_OWNER), r.sub ? `미처리 ${r.sub}` : ""].filter(Boolean).join(" · ") } : r));
  // 관리 기록(확인 · 사유 · 면제) — 전체 권한에게만. 줄이 가리키는 의무 전부에 남긴다.
  const noteFor = (all: LateItem[], r: AttentionRow) => (scope.canNote ? <NoteButton title={[r.teacher, r.className, r.title].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ")} items={attentionItems(all, r)} onSaved={refresh} /> : null);
  const lateSection = <section className="border-line bg-card rounded-xl border p-2">
    <div className="flex items-center gap-2 px-2 py-1">
      <h4 className="min-w-0 flex-1 text-sm font-bold">미처리 <span className="text-text-dim text-xs font-medium">{distinctStudents(liveHere)}명 · {liveHere.length}건 · 현재 기준</span></h4>
      {ownerNode && ownerNode.ownerId !== NO_OWNER ? <LateRequestButton owner={{ id: ownerNode.ownerId, name: ownerNode.name }} items={liveHere} /> : null}
    </div>
    {/* 처리 요청은 선생님 단위다 — 전체·과목 단계는 줄(선생님)마다, 선생님·반 단계는 위 단추 하나(지금 보이는 범위의 지연). */}
    <AdminAttention rows={attention} onOpen={openRow} expand={expandOf("live", attentionAll, attention)} onOpenChild={openChild}
      action={(r) => <>{ownerNode ? null : <LateRequestButton owner={{ id: r.ownerId, name: r.title }} items={liveHere.filter((it) => it.ownerId === r.ownerId)} />}{noteFor(liveHere, r)}</>} />
  </section>;
  const synced = cur?.data.syncedAt ?? null;
  const stale = !!cur && (!synced || nowMs - Date.parse(synced) > STALE_MS);

  return <DutyRequestScope today={today} tick={tick}><OntimeOnlyProvider value={ontimeOnly}><div className="space-y-4">
    <Toolbar>
      <ToolbarSegment>{periodPresets(today).map((p) => <ToolbarSegmentItem key={p.key} active={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</ToolbarSegmentItem>)}</ToolbarSegment>
      {/* 날짜 이동 — 앱 공용 기간 네비(‹ 라벨 ›) + 달력. 고른 단위(하루 · 한 주 · 한 달)로 앞뒤로 옮기고, 달력에서 고른 날이 든 기간으로 간다. 앞날은 없다. */}
      <PeriodNav label={rangeLabel} labelWidth={unit === "week" ? 190 : 130}
        labelControl={<DatePickerButton label={rangeLabel} value={anchor} min={viewFrom ?? undefined} max={today} onChange={(ymd) => setPeriod(periodKey(unit, viewFrom && ymd < viewFrom ? viewFrom : ymd))} />}
        prevHref={shiftPeriod(period, -1)} nextHref={shiftPeriod(period, 1)} currentHref={periodKey(unit, today)}
        relation={period === periodKey(unit, today) ? "current" : "past"} nextDisabled={(periodParts(shiftPeriod(period, 1))?.anchor ?? "") > today} prevDisabled={!!viewFrom && adminRange(shiftPeriod(period, -1), today).to < viewFrom}
        onNavigate={(key) => setPeriod(key)} />
      {cur && !stale ? <span className="text-text-dim text-xs font-medium">마지막 반영 {kstStamp(cur.now)}</span> : null}
      <ToolbarChip active={ontimeOnly} onClick={toggleOntimeOnly} className="ml-auto">기한 내만 보기</ToolbarChip>
      <ToolbarChip active={lateOnly} onClick={() => setLateOnly((v) => !v)}>미처리만</ToolbarChip>
    </Toolbar>
    {stale ? <p className="bg-amber-soft text-amber rounded-lg px-3 py-2 text-sm font-semibold">{synced ? `${kstStamp(synced)} 이후 반영 지연 · 최신 저장분 누락 가능` : "아직 집계 전 · 수치가 실제와 다를 수 있음"}</p> : null}
    {!cur ? <p className="text-text-dim text-sm">{failed[period] ? "조회 실패 · 잠시 후 다시 열어 주세요" : "불러오는 중…"}</p> : null}

    {cur ? <div className="grid gap-3 lg:grid-cols-[328px_minmax(0,1fr)]">
      {/* 왼쪽 목록 카드의 아래 끝 = 오른쪽 내용의 아래 끝(원장 2026-11-11) — 높이는 오른쪽을 따르고, 목록이 더 길면 카드 안에서 스크롤. */}
      <aside className="border-line bg-card relative min-w-0 overflow-hidden rounded-xl border lg:min-h-[60vh]">
        <div className="p-2 lg:absolute lg:inset-0 lg:overflow-y-auto">
        {tree.length ? <AdminTree tree={tree} multi={multi} sel={sel} lateOnly={lateOnly} onSelect={(next) => { setOpenKey(null); setSel(next); }} /> : <p className="text-text-dim px-2 py-4 text-sm">해당 기간 업무 없음</p>}
        </div>
      </aside>
      {/* 🔴 `min-w-0` + `grid-cols-1`(= minmax(0,1fr)) — 없으면 넓은 표 하나가 이 칸을 제 폭으로 밀어 화면 전체에 가로 스크롤이 생긴다(2026-11-11). */}
      <main className="grid min-w-0 grid-cols-1 content-start gap-4">
        {crumbs.length > 1 || sel.studentId ? <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="위치">
          {crumbs.map((c, i) => <span key={i} className="flex items-center gap-1">
            {i ? <span className="text-text-placeholder" aria-hidden>›</span> : null}
            <button type="button" onClick={() => go(c.sel)} className="hover:text-primary font-semibold">{c.label}</button>
          </span>)}
          {sel.studentId ? <span className="flex items-center gap-1">{crumbs.length ? <span className="text-text-placeholder" aria-hidden>›</span> : null}<span className="font-semibold">{sel.studentName ?? "학생"}</span>
            <button type="button" onClick={() => go({ ...sel, studentId: null })} className="text-text-dim hover:text-primary ml-1 text-xs font-semibold underline">닫기</button></span> : null}
        </nav> : null}

        {sel.studentId ? <StudentPane key={`${sel.studentId}|${fetchSubject ?? ""}`} period={period} tick={tick} studentId={sel.studentId} fetchSubject={fetchSubject} late={lateAll.filter((it) => !it.inherited && it.studentId === sel.studentId)} nowMs={nowMs} onWork={openWork} />
          : !subjectNode ? lateSection
          : classNode && ownerNode ? <ClassPane key={`${classNode.classId}|${ownerNode.ownerId}|${fetchSubject ?? ""}`} period={period} tick={tick} classNode={classNode} owner={ownerNode.ownerId} fetchSubject={fetchSubject} teacher={ownerNode.name} kind={sel.kind ?? null}
              aside={lateSection} onStudent={pickStudent} onWork={openWork} />
          : ownerNode ? <TeacherLevel aside={lateSection} owner={ownerNode} avg={subjectAvg} period={period} subject={fetchSubject} tick={tick} kind={sel.kind ?? null} onClearKind={() => go({ ...sel, kind: null })} onClass={(classId) => go({ ...sel, classId, studentId: null })} />
          : <SubjectLevel node={subjectNode} subjects={atRoot ? tree : null} lateOnly={lateOnly} grade={unit !== "day"} board={<>{atRoot && managers ? <AdminOwnerBoard tree={tree} late={cur.data.late} managers={managers} labels={scope.labels} nowMs={nowMs} onSubject={(subject) => go({ subject, owner: null, classId: null, studentId: null })} /> : null}{unit !== "day" && atRoot ? <AdminRanking tree={tree} onOwner={(subject, owner, kind) => go({ subject, owner, kind, classId: null, studentId: null })} /> : null}</>} side={unit === "day" ? <AdminToday owners={subjectNode.owners} onOwner={(owner, kind) => go({ ...sel, owner, kind, classId: null, studentId: null })} /> : null} avgLabel={atRoot ? "전체" : "과목"} attention={lateSection} onWithdrawal={setWpick} onOwner={(ownerId, kind, subject) => go({ ...sel, ...(subject !== undefined ? { subject } : {}), owner: ownerId, kind, classId: null, studentId: null })} />}

      </main>
    </div> : null}

    {work ? <AdminOverlay key={work.seq} work={work.work} onClose={() => setWork(null)} /> : null}
    {wpick ? <WithdrawalItemsDialog pick={wpick} period={period} tick={tick} onClose={() => setWpick(null)} onWork={openWork} /> : null}
  </div></OntimeOnlyProvider></DutyRequestScope>;
}
