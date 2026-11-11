"use client";

import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { Toolbar } from "@/components/toolbar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { setOnboardingCheck } from "@/features/newcomers/server/actions";
import type { NewcomerRow, NewcomersView } from "@/features/newcomers/server/queries";
import { EMPTY_FILTERS, boardSearchParams, boardStats, filterBoardRows, parseBoardFilters, priorityTasks, studentsIn, withCheckPatches, type BoardFilters, type BoardStatus, type CheckPatch } from "@/features/newcomers/board-model";
import { BUCKET_LABEL, NEWCOMER_BUCKETS, NEWCOMER_BASELINE_DATE, ONBOARDING_ITEMS, daysLeftOf, dueDateOf, statusOf, type OnboardingItemDef } from "@/features/newcomers/onboarding-items";
import { parseCareCellParam } from "@/features/newcomers/care-cells";
import { STATUS_STYLE } from "@/features/newcomers/cell-display";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { NewcomerTable, TaskBadge } from "./newcomer-table";
import styles from "./newcomer-board.module.css";
import { CompletionForm } from "@/features/newcomers/completion-form";
import type { Completion } from "@/features/newcomers/completion";

const STATUS_TABS: { key: BoardStatus; label: string }[] = [
  { key: "all", label: "전체" }, { key: "overdue", label: "기한 경과" }, { key: "due", label: "3일 내" }, { key: "open", label: "미완료" },
];
type Selection = { rowKey: string; itemKey: string };
type SaveFailure = { rowKey: string; itemKey: string; done: boolean; message: string; completion?:Completion;doneOn?:string };
const RATE_HELP = "기존 필수 업무 완료율: 완료 기록 ÷ (완료 + 기한 경과 + 오늘부터 3일 뒤까지 기한인 업무). 선택 업무·날짜 미정·기준일 이전 미기록은 제외합니다. 집계 대상 업무가 없으면 100%입니다.";

export function NewcomerBoard({ view, canWrite, initialFilters = EMPTY_FILTERS }: {
  view: NewcomersView; canWrite: boolean; initialFilters?: BoardFilters;
}) {
  const router = useRouter();
  const { labelOf } = useSubjectMaps();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [compact, setCompact] = useState(false);
  const [previousFonts, setPreviousFonts] = useState(false);
  // 우선 처리는 접힌 채로 시작 — 건수만 보이고 학생 이름은 펼쳐야(원장 2026-10-30 '요약 먼저, 이름은 눌러야').
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [patches, setPatches] = useState<CheckPatch>({});
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const known = view.checksError === null;
  const writable = canWrite && view.checksAvailable && known;
  const rows = useMemo(() => withCheckPatches(view.subjectRows, patches, view.today), [view.subjectRows, patches, view.today]);
  const stats = useMemo(() => boardStats(rows, view.today), [rows, view.today]);
  const tasks = useMemo(() => known ? priorityTasks(rows, view.today) : [], [rows, view.today, known]);
  const filtered = useMemo(() => filterBoardRows(rows, filters, view.today, labelOf), [rows, filters, view.today, labelOf]);
  const subjects = useMemo(() => [...new Set(rows.map(row => row.subject))], [rows]);
  const selectedRow = rows.find(row => row.rowKey === selection?.rowKey);
  const selectedItem = ONBOARDING_ITEMS.find(item => item.key === selection?.itemKey) ?? ONBOARDING_ITEMS[0];
  const filterActive = filters.bucket !== null || filters.status !== "all" || filters.item !== null || filters.query !== "" || filters.subject !== "all" || filters.sort !== "recent";
  const stat = (n: number) => known ? n.toLocaleString("ko-KR") : "—";

  useEffect(() => {
    const fit = () => {
      if (root.current) root.current.style.height = `${Math.max(420, window.innerHeight - root.current.getBoundingClientRect().top - 8)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (root.current?.parentElement) observer.observe(root.current.parentElement);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, []);

  useEffect(() => {
    const restore = () => setFilters(parseBoardFilters(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  // 서버 재조회가 같은 기록을 돌려준 뒤에만 임시 표시를 제거한다. 필터·선택·스크롤은 유지한다.
  useEffect(() => {
    setPatches(current => {
      const next = { ...current };
      let changed = false;
      for (const row of view.subjectRows) for (const item of ONBOARDING_ITEMS) {
        const key = `${row.rowKey}|${item.key}`;
        if (key in next && !inFlight.current.has(key) && (row.checks[item.key] ?? null) === next[key]) {
          delete next[key]; changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [view.subjectRows]);

  function changeFilters(next: BoardFilters) {
    setFilters(next);
    const params = boardSearchParams(next, new URLSearchParams(window.location.search));
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    if (scroller.current) scroller.current.scrollTop = 0;
  }

  function openDetails(row: NewcomerRow, item = ONBOARDING_ITEMS[0]) {
    if (!filtered.some(candidate => candidate.rowKey === row.rowKey)) {
      changeFilters({ ...EMPTY_FILTERS });
      setNotice("선택한 업무를 확인할 수 있도록 표의 필터를 초기화했습니다.");
    }
    setSelection({ rowKey: row.rowKey, itemKey: item.key });
    setDetailOpen(true);
  }

  async function saveCheck(row: NewcomerRow, item: OnboardingItemDef, done = !row.checks[item.key],completion?:Completion,doneOn?:string) {
    if (!writable) return;
    const affected = view.subjectChecks ? [row] : rows.filter(candidate => candidate.studentId === row.studentId);
    const keys = affected.map(candidate => `${candidate.rowKey}|${item.key}`);
    if (keys.some(key => inFlight.current.has(key))) return;
    const previous: CheckPatch = {};
    for (const key of keys) { if (key in patches) previous[key] = patches[key]; inFlight.current.add(key); }
    setBusy(new Set(inFlight.current));
    setFailure(null);
    setPatches(current => ({ ...current, ...Object.fromEntries(keys.map(key => [key, done ? view.today : null])) }));
    try {
      const result = await setOnboardingCheck({ studentId: row.studentId, subject: row.subject, itemKey: item.key, done,completion,doneOn });
      if (!result.ok) throw new Error(result.error || "저장하지 못했습니다. 다시 시도해 주세요.");
      if (result.doneOn !== undefined) {
        setPatches(current => ({ ...current, ...Object.fromEntries(keys.map(key => [key, result.doneOn ?? null])) }));
      }
      setNotice(done ? "완료 기록을 저장했습니다." : "완료 기록을 취소했습니다.");
      startTransition(() => router.refresh());
    } catch (error) {
      setPatches(current => {
        const next = { ...current };
        for (const key of keys) { if (key in previous) next[key] = previous[key]; else delete next[key]; }
        return next;
      });
      setNotice("");
      setFailure({ rowKey: row.rowKey, itemKey: item.key, done,completion,doneOn, message: error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해 주세요." });
    } finally {
      for (const key of keys) inFlight.current.delete(key);
      setBusy(new Set(inFlight.current));
    }
  }

  const statusCount = (status: BoardStatus) => status === "all" ? stats.students : status === "open" ? stats.openStudents : studentsIn(rows.filter(row => status === "overdue" ? row.progress.overdue > 0 : row.progress.dueSoon > 0));
  const retry = () => {
    const row = rows.find(row => row.rowKey === failure?.rowKey), item = ONBOARDING_ITEMS.find(item => item.key === failure?.itemKey);
    if (row && item && failure) void saveCheck(row, item, failure.done,failure.completion,failure.doneOn);
  };

  return <div ref={root} className={`${styles.board} ${previousFonts ? styles.previousFonts : ""} edge-to-edge`}>
    <header className={styles.header}>
      <div className={styles.fontToggle} role="group" aria-label="폰트 서식 비교">
        <span>폰트</span>
        <button type="button" aria-pressed={previousFonts} onClick={() => setPreviousFonts(true)} title="이름 13px · 항목별 크기를 사용하던 서식">작은 글자</button>
        <button type="button" aria-pressed={!previousFonts} onClick={() => setPreviousFonts(false)} title="이름과 본문을 16px로 통일한 서식">큰 글자</button>
      </div>
      <div className="compact-chrome:hidden"><h1><EyIcon name="graduationCap" size={28} />신입생 90일 집중관리</h1><p>최초 상담의 약속부터 단계별 액션·결과, 장기재원 인계까지.</p></div>
      <div className={styles.headerMeta}><EyIcon name="calendar" size={17} /><span>기준 날짜 <strong>{view.today.replaceAll("-", ". ")}</strong></span></div>
    </header>

    <nav aria-label="신입생 관리 단계" className="flex shrink-0 flex-wrap gap-2 rounded-xl border border-line bg-report-tint p-3 text-xs text-primary">
      <WindowLink href="/enrollment" className="rounded-lg bg-white px-3 py-2">① 입학상담 · 요구·약속</WindowLink><WindowLink href="/students/care" className="rounded-lg bg-white px-3 py-2">② 담당 인수 · 이행 증거</WindowLink>
      {(["d7","d30","d60","d90"] as const).map((bucket,i)=><button key={bucket} type="button" className="rounded-lg border border-line bg-white px-3 py-2" aria-pressed={filters.bucket===bucket} onClick={()=>changeFilters({...filters,bucket:filters.bucket===bucket?null:bucket})}>{i+3}. {({d7:"0~7일 · 첫 적응",d30:"8~30일 · 만족도",d60:"31~60일 · 필요시 점검",d90:"61~90일 · 최종 점검"})[bucket]}</button>)}
      <WindowLink href="/students/care" className="rounded-lg bg-white px-3 py-2">⑦ 장기재원 · 미완료 약속 계속 관리</WindowLink>
    </nav>
    <section aria-label="전체 관리 대상 현황" className={styles.metrics}>
      <Metric icon="users" label="전체 관리 대상" value={stats.students.toLocaleString("ko-KR")} unit="명" note={`${stats.rows}개 학생·과목 행 · 최근 90일 등록`} tone="navy" />
      <Metric icon="clipboardList" label="미완료 학생" value={stat(stats.openStudents)} unit="명" note="기한 경과 · 3일 내 기한 업무가 있는 학생" active={filters.status === "open"} disabled={!known} onClick={() => changeFilters({ ...filters, status: filters.status === "open" ? "all" : "open" })} />
      <Metric icon="alert" label="기한 경과 업무" value={stat(stats.overdue)} unit="건" note="기한이 지난 필수 업무" tone="danger" active={filters.status === "overdue"} disabled={!known} onClick={() => changeFilters({ ...filters, status: filters.status === "overdue" ? "all" : "overdue" })} />
      <Metric icon="clock" label="3일 내 기한 업무" value={stat(stats.dueSoon)} unit="건" note="오늘부터 3일 뒤까지 기한인 필수 업무" tone="warning" active={filters.status === "due"} disabled={!known} onClick={() => changeFilters({ ...filters, status: filters.status === "due" ? "all" : "due" })} />
      <Metric icon="clipboardCheck" label="필수 업무 완료율" value={stat(stats.rate)} unit="%" note={known ? `${stats.doneCount} / ${stats.dueTotal}건 완료${stats.dueTotal === 0 ? " · 대상 업무 없음" : ""}` : "체크 기록 확인 필요"} tone="success" help={RATE_HELP} />
    </section>

    {!view.checksAvailable && <div className={styles.warning} role="status"><EyIcon name="alert" size={16} />{view.checksError ? view.checksError.summary : "체크 기록 기능이 아직 준비되지 않아 목록 조회만 가능합니다."}<button type="button" onClick={() => router.refresh()}>다시 불러오기</button></div>}
    {view.checksAvailable && !view.subjectChecks && <div className={styles.warning}>과목별 체크가 아직 켜지지 않았습니다. 지금은 같은 학생의 모든 과목에 완료 기록이 함께 적용됩니다.</div>}
    {failure && !detailOpen && <div className={styles.failure} role="alert"><EyIcon name="error" size={16} /><span>{failure.message} 변경 사항을 되돌렸습니다.</span><button type="button" onClick={retry}>다시 시도</button></div>}

    <section className={styles.priority} aria-label="우선 처리 업무">
      <button type="button" className={styles.priorityHeading} aria-expanded={priorityOpen} onClick={() => setPriorityOpen(!priorityOpen)}><EyIcon name="clipboardList" size={16} />우선 처리 <span>{known ? `${tasks.length}건` : "확인 필요"}</span><EyIcon name={priorityOpen ? "chevronUp" : "chevronDown"} size={12} /></button>
      {priorityOpen && <div className={styles.priorityItems}>
        {tasks.slice(0, 3).map(task => <button type="button" key={task.key} className={styles.priorityTask} onClick={() => openDetails(task.row, task.item)} title={`${task.row.name} · ${task.row.subject ? labelOf(task.row.subject) : "과목 미정"} · ${task.item.label} · 예정일 ${task.due}`}>
          <TaskBadge row={task.row} item={task.item} today={view.today} /><strong>{task.row.name}</strong><span>{task.row.subject ? labelOf(task.row.subject) : "과목 미정"}</span><span>{task.item.shortLabel}</span>
        </button>)}
        {tasks.length === 0 && <span className={styles.muted}>{known ? "지금 처리할 기한 경과 · 3일 내 기한 업무가 없습니다." : "체크 기록을 다시 불러오면 우선 업무를 확인할 수 있습니다."}</span>}
      </div>}
      {known && tasks.length > 0 && <button type="button" className={styles.textButton} onClick={() => changeFilters({ ...EMPTY_FILTERS, status: "open", sort: "priority" })}>전체 보기<EyIcon name="arrowRight" size={14} /></button>}
    </section>

    <section className={styles.panel} aria-label="학생별 90일 관리">
      <div className={styles.toolbar}>
        <Toolbar rail={false} gap="" className={styles.toolbarInner}>
        <div className={styles.tabs} role="group" aria-label="상태 필터">
          {STATUS_TABS.map(tab => <button type="button" key={tab.key} aria-pressed={filters.status === tab.key} disabled={!known && tab.key !== "all"} onClick={() => changeFilters({ ...filters, status: tab.key })}>
            {tab.label}<span>{tab.key === "all" ? stats.students : stat(statusCount(tab.key))}</span>
          </button>)}
        </div>
        <div className={styles.tools}>
          <label className={styles.search}><EyIcon name="search" size={16} /><input aria-label="학생 검색" type="search" placeholder="이름, 학교·학년 검색" value={filters.query} onChange={event => changeFilters({ ...filters, query: event.target.value })} /></label>
          <select aria-label="등록 경과 구간" title="등록 후 경과일의 구간 · 학생 수 · 구간 간 중복 없음" value={filters.bucket ?? "all"} onChange={event => changeFilters({ ...filters, bucket: event.target.value === "all" ? null : event.target.value as BoardFilters["bucket"] })}>
            <option value="all">전체 구간 · {view.rows.length}명</option>
            {NEWCOMER_BUCKETS.filter(bucket => bucket !== "over").map(bucket => <option key={bucket} value={bucket}>{BUCKET_LABEL[bucket]} · {view.rows.filter(row => row.bucket === bucket).length}명</option>)}
          </select>
          <select aria-label="과목 필터" value={filters.subject} onChange={event => changeFilters({ ...filters, subject: event.target.value })}><option value="all">전체 과목</option>{subjects.map(subject => <option key={subject ?? "none"} value={subject ?? "none"}>{subject ? labelOf(subject) : "과목 미정"}</option>)}</select>
          <select aria-label="정렬" value={filters.sort} onChange={event => changeFilters({ ...filters, sort: event.target.value as BoardFilters["sort"] })}><option value="recent">최근 등록순</option><option value="name">이름순</option><option value="firstClass">첫 수업일순</option><option value="priority">업무 우선순</option></select>
          <button type="button" className={styles.density} aria-pressed={compact} title="행 높이를 줄여 더 많은 학생 보기" onClick={() => setCompact(!compact)}><EyIcon name="list" size={15} />압축</button>
        </div>
        </Toolbar>
      </div>
      <div className={styles.tableMeta}>
        <span>집계·구간 숫자는 전체 대상 기준{known && stats.waived > 0 && <> · <span title={`${NEWCOMER_BASELINE_DATE} 이전에 기한이 지난 필수 업무는 기한 경과·완료율 집계에서 제외`}>기준일 이전 {stats.waived}건 제외</span></>}</span>
        <span className={styles.activeFilters}>{filters.item && <button type="button" onClick={() => changeFilters({ ...filters, item: null })}>{parseCareCellParam(filters.item)?.label} <EyIcon name="close" size={12} /></button>}{filterActive && <button type="button" onClick={() => changeFilters({ ...EMPTY_FILTERS })}>필터 초기화</button>}</span>
      </div>
      <div ref={scroller} className={styles.tableScroll} tabIndex={0} role="region" aria-label="학생 관리 표 · 가로와 세로 스크롤">
        {filtered.length > 0 ? <NewcomerTable rows={filtered} today={view.today} canWrite={writable} checksKnown={known} busy={busy} selected={selection?.rowKey ?? null} onToggle={(row, item) => openDetails(row, item)} compact={compact} /> : <div className={styles.empty}><EyIcon name="search" size={28} /><strong>{rows.length ? "조건에 맞는 학생이 없습니다" : "최근 90일 내 등록된 관리 대상이 없습니다"}</strong><p>{rows.length ? "검색어나 필터를 변경해 보세요." : "대상 학생이 등록되면 관리 일정이 이곳에 표시됩니다."}</p>{filterActive && <button type="button" onClick={() => changeFilters({ ...EMPTY_FILTERS })}>필터 초기화</button>}</div>}
      </div>
      <footer className={styles.footer}><span><strong>{studentsIn(filtered)}명 · {filtered.length}행</strong> 표시 / 전체 {stats.students}명 · {stats.rows}행</span><span className={styles.notice} role="status" aria-live="polite">{notice || (writable ? "업무 클릭: 액션·결과 기록 / 완료 확인 · 이름 클릭: 학생 상세" : "조회 전용 · 완료 기록을 변경할 수 없습니다")}</span></footer>
    </section>

    <Sheet open={detailOpen && !!selectedRow} onOpenChange={setDetailOpen}>
      <SheetContent className={`${styles.detail} ${previousFonts ? styles.previousFonts : ""}`}>
        {selectedRow && <>
          <SheetHeader><SheetTitle className={styles.detailTitle}>{selectedRow.name} <span>{selectedRow.subject ? labelOf(selectedRow.subject) : "과목 미정"}</span></SheetTitle><SheetDescription>{schoolGradeLabel(selectedRow.school, selectedRow.grade)} · 등록일 {selectedRow.enrolledOn}</SheetDescription></SheetHeader>
          <div className={styles.detailBody}>
            <label className={styles.detailLabel}>관리 업무<select aria-label="상세 관리 업무" value={selectedItem.key} onChange={event => setSelection({ rowKey: selectedRow.rowKey, itemKey: event.target.value })}>{ONBOARDING_ITEMS.map(item => <option key={item.key} value={item.key}>{item.shortLabel}{item.optional ? " (선택)" : ""}</option>)}</select></label>
            <div className={styles.taskDetail}><h2>{selectedItem.label}</h2>{known ? <TaskBadge row={selectedRow} item={selectedItem} today={view.today} /> : <span>기록 확인 불가</span>}
              <dl><dt>예정일</dt><dd>{dueDateOf(selectedItem, selectedRow) ?? "날짜 미정"}</dd><dt>계산 기준</dt><dd>{selectedItem.anchor === "enrolled" ? "등록일" : "첫 수업일"} {selectedItem.offsetDays < 0 ? `${Math.abs(selectedItem.offsetDays)}일 전` : `${selectedItem.offsetDays}일 후`}</dd><dt>현재 상태</dt><dd>{known ? STATUS_STYLE[statusOf(selectedItem, selectedRow, selectedRow.checks[selectedItem.key], view.today)].label : "확인 불가"}{known && statusOf(selectedItem, selectedRow, selectedRow.checks[selectedItem.key], view.today) === "overdue" && ` · ${Math.abs(daysLeftOf(selectedItem, selectedRow, view.today) ?? 0)}일 지남`}</dd><dt>완료일</dt><dd>{known ? selectedRow.checks[selectedItem.key] ?? "완료 기록 없음" : "확인 불가"}</dd></dl>
              {selectedItem.optional && <p className={styles.muted}>선택 업무입니다. 기한 경과 · 3일 내 기한 및 필수 완료율 집계에 포함하지 않습니다.</p>}
              <CompletionForm key={`${selectedRow.rowKey}:${selectedItem.key}:${selectedRow.checks[selectedItem.key]??"open"}`} done={!!selectedRow.checks[selectedItem.key]} canWrite={writable} busy={busy.has(`${selectedRow.rowKey}|${selectedItem.key}`)} today={view.today} memo={selectedRow.checkDetails?.[selectedItem.key]?.memo} consultationId={selectedRow.checkDetails?.[selectedItem.key]?.consultationId} onSave={(done,completion,doneOn)=>void saveCheck(selectedRow,selectedItem,done,completion,doneOn)}/>
              {!writable && <p className={styles.muted}>현재 권한 또는 기록 조회 상태로는 변경할 수 없습니다.</p>}
              {failure?.rowKey === selectedRow.rowKey && <div className={styles.failure} role="alert"><span>{failure.message} 변경 사항을 되돌렸습니다.</span><button type="button" onClick={retry}>다시 시도</button></div>}
            </div>
            <div className={styles.progressDetail} title={RATE_HELP}><span>필수 업무 완료율</span><strong>{stat(selectedRow.progress.rate)}%</strong><progress max="100" value={known ? selectedRow.progress.rate : 0} aria-label="필수 업무 완료율" /><small>{known ? `${selectedRow.progress.doneCount} / ${selectedRow.progress.dueTotal}건 완료` : "체크 기록 확인 필요"}</small></div>
            <WindowLink className={styles.studentDetailLink} href={`/students/${selectedRow.studentId}?back=/newcomers`}>학생 상세 보기<EyIcon name="arrowRight" size={15} /></WindowLink>
            <WindowLink className={styles.studentDetailLink} href={`/students/${selectedRow.studentId}/care`}>입학 약속·담당 인수·이행 결과 보기 ↗</WindowLink>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  </div>;
}

function Metric({ icon, label, value, unit, note, tone = "blue", help, onClick, active, disabled }: {
  icon: AywaIconName; label: string; value: string; unit: string; note: string; tone?: string; help?: string;
  onClick?: () => void; active?: boolean; disabled?: boolean;
}) {
  const content = <><span className={styles.metricIcon}><EyIcon name={icon} size={21} /></span><div><span className={styles.metricLabel}>{label}</span><div className={styles.metricValue}>{value}<small>{unit}</small></div></div><span className={styles.metricNote}>{note}</span></>;
  return onClick ? <button type="button" className={styles.metric} data-tone={tone} data-metric={label} title={help} aria-pressed={!!active} disabled={disabled} onClick={onClick}>{content}</button> : <div className={styles.metric} data-tone={tone} data-metric={label} title={help}>{content}</div>;
}
