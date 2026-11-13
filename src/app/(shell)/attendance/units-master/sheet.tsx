"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmbedLink } from "@/components/embed-link";
import { PeriodNav } from "@/components/period-nav";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ChevronDown, ChevronRight, Search } from "@/components/icons/aywa-icon-compat";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON, TOOLBAR_SEARCH_BOX, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { masterMatchesFilter, masterNeedsInput, masterPriority, type MasterClass, type MasterStudent, type UnitsMaster } from "@/features/attendance/units-master";
import { MasterStudentDetail, TRACK_LABELS as tracks, numberLabel as num, unitsLabel as units, statusLabel as statusText, ownerLabel as ownerName } from "./student-detail";
import styles from "./sheet.module.css";
import { useModuleOn } from "@/features/owner/operations-context";

const toolbarButton = `${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`;
const filters = [["all", "전체"], ["attention", "확인 필요"], ["short", "부족"], ["review", "입력 확인"], ["complete", "월 시수 충족"], ["excess", "초과"], ["unconfirmed", "미확정"]];

function adjacentMonth(month: string, offset: number) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function UnitsMasterSheet({ data, initialSubject }: { data: UnitsMaster; initialSubject?: string }) {
  const eieOn = useModuleOn("eie");
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState(initialSubject === "math" || initialSubject === "english" ? initialSubject : "");
  const [track, setTrack] = useState("");
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("priority");
  const [selected, setSelected] = useState<{ classId: string; studentId: string } | null>(null);
  const [options, setOptions] = useState({ school: true, future: true, teachers: true, seats: true });
  const [guide, setGuide] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 1440));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (wide && selected) container.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [wide, selected]);
  const visibleClasses = useMemo(() => data.classes.filter((c) => eieOn || c.track !== "eie"), [data.classes, eieOn]);
  const base = useMemo(() => visibleClasses.filter((c) => (!subject || c.subject === subject) && (!track || c.track === track) && (!classId || c.id === classId))
    .map((c) => ({ ...c, students: c.students.filter((s) => `${c.name} ${s.name} ${s.school}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) }))
    .filter((c) => c.students.length), [visibleClasses, subject, track, classId, query]);
  const all = useMemo(() => base.flatMap((c) => c.students), [base]);
  const groups = useMemo(() => {
    const shown = base.map((c) => ({ ...c, students: c.students.filter((s) => masterMatchesFilter(s, status))
      .sort((a, b) => (sort === "priority" ? masterPriority(a) - masterPriority(b) || b.missing - a.missing : 0) || a.name.localeCompare(b.name, "ko")) })).filter((c) => c.students.length);
    if (sort === "priority") shown.sort((a, b) => Math.min(...a.students.map(masterPriority)) - Math.min(...b.students.map(masterPriority)) || a.name.localeCompare(b.name, "ko"));
    return shown;
  }, [base, status, sort]);
  const teacherCount = options.teachers ? Math.max(0, ...groups.map((c) => c.teachers.length)) : 0;
  const teacherSlots = Array.from({ length: teacherCount }, (_, i) => i);
  const mainColumns = 5 + Number(options.school) + Number(options.future);
  const tableWidth = 136 + (options.school ? 104 : 0) + 88 + 104 + 80 + (options.future ? 96 : 0) + 168 + teacherCount * 104 + (options.seats ? 144 : 0);
  const allCollapsed = groups.length > 0 && groups.every((c) => collapsed.has(c.id));
  const selectedClass = selected ? visibleClasses.find((c) => c.id === selected.classId) : undefined;
  const student = selectedClass?.students.find((s) => s.id === selected?.studentId);
  const visibleStudents = useMemo(() => groups.flatMap((c) => c.students.map((s) => ({ c, s }))), [groups]);
  const position = visibleStudents.findIndex(({ c, s }) => c.id === selected?.classId && s.id === selected?.studentId);
  const open = (c: MasterClass, s: MasterStudent) => {
    setSelected({ classId: c.id, studentId: s.id });
    setCollapsed((previous) => { if (!previous.has(c.id)) return previous; const next = new Set(previous); next.delete(c.id); return next; });
  };
  const details = student && selectedClass ? <MasterStudentDetail classInfo={selectedClass} student={student} month={data.month} position={position} count={visibleStudents.length}
    onPrevious={position > 0 ? () => { const row = visibleStudents[position - 1]; open(row.c, row.s); } : undefined}
    onNext={position >= 0 && position < visibleStudents.length - 1 ? () => { const row = visibleStudents[position + 1]; open(row.c, row.s); } : undefined}
    onClose={wide ? () => setSelected(null) : undefined} /> : null;
  function monthHref(month: string) {
    const next = new URLSearchParams(params.toString()); next.set("month", month);
    if (subject) next.set("subject", subject); else next.delete("subject");
    return `/attendance/units-master?${next}`;
  }
  function toggleClass(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function download() {
    const rows: (string | number)[][] = [["과목", "반", "학생", "학교·학년", "월 발생 U", "실수업 U", "잔여 U", "남은 예정 U", "미입력 U", "상태", "확인 사항", "담당별 실수업 U"]];
    for (const c of groups) for (const s of c.students) rows.push([c.subject === "math" ? "수학" : "영어", c.name, s.name, s.school, s.target ?? "미확정", s.actual, s.remaining ?? "", s.future, s.missing, statusText(s), s.review.join(" / "),
      Object.entries(s.owners).map(([id, v]) => `${ownerName(c, id)} ${num(v.actual)}`).join(" / ")]);
    const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `시수마스터_${data.month}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div ref={container} className="flex h-full min-h-0 flex-col gap-2 pb-2 text-sm" aria-busy={pending}>
    <h1 className="sr-only">시수 마스터</h1>
    <header className="flex shrink-0 flex-col gap-2 px-1 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect ariaLabel="과목" valuePrefix="과목" value={subject} onValueChange={(value) => { setSubject(value); setTrack(""); setClassId(""); setSelected(null); }} triggerClassName={TOOLBAR_SELECT}
          options={[{ value: "", label: "전체" }, { value: "math", label: "수학" }, { value: "english", label: "영어" }]} />
        {subject !== "math" ? <SearchableSelect ariaLabel="영어 유형" valuePrefix="유형" value={track} onValueChange={(value) => { setTrack(value); if (value) setSubject("english"); setClassId(""); setSelected(null); }} triggerClassName={TOOLBAR_SELECT}
          options={[{ value: "", label: "영어 전체" }, { value: "hourly", label: "인재원" }, { value: "bridge", label: "브릿지" }, ...(eieOn ? [{ value: "eie", label: "EiE" }] : [])]} />
        : null}
        <SearchableSelect ariaLabel="반" valuePrefix="반" value={classId} onValueChange={(value) => { setClassId(value); setSelected(null); }} className="max-w-64" triggerClassName={TOOLBAR_SELECT}
          options={[{ value: "", label: "전체 반" }, ...visibleClasses.filter((c) => (!subject || c.subject === subject) && (!track || c.track === track)).map((c) => ({ value: c.id, label: c.name }))]} />
        <PeriodNav label={`${data.month.slice(0, 4)}년 ${Number(data.month.slice(5))}월`}
          prevHref={monthHref(adjacentMonth(data.month, -1))} nextHref={monthHref(adjacentMonth(data.month, 1))} currentHref={monthHref(data.asOf.slice(0, 7))}
          relation={data.month === data.asOf.slice(0, 7) ? "current" : data.month < data.asOf.slice(0, 7) ? "past" : "future"}
          prevAriaLabel="이전 달" nextAriaLabel="다음 달" pending={pending}
          onNavigate={(href) => { setSelected(null); startTransition(() => router.push(href)); }} />
        <label className={TOOLBAR_SEARCH_BOX}><Search className="size-4 shrink-0" aria-hidden="true" /><input className="w-44 min-w-0 bg-transparent outline-none" aria-label="학생·학교·반 검색" placeholder="학생·학교·반 검색" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }} /></label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className={toolbarButton} onClick={() => setGuide(true)}>집계 기준</button>
          <button className={toolbarButton} onClick={download}>표 내려받기</button>
          <button className={toolbarButton} disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "불러오는 중…" : "새로고침"}</button>
          <EmbedLink className={toolbarButton} href={`/attendance?month=${data.month}${subject ? `&subject=${subject}` : ""}`}>출석부</EmbedLink>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="시수 상태 필터">
        {filters.map(([id, label]) => <button className={`${TOOLBAR_CHIP} ${status === id ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF} gap-1.5`} key={id} aria-pressed={status === id}
          title={id === "review" ? "미확정 학생도 출결 미입력·확인 사항이 있으면 포함합니다." : undefined}
          onClick={() => { setStatus(id); setSelected(null); }}>{label}<b className="num">{all.filter((s) => masterMatchesFilter(s, id)).length}</b></button>)}
        <div className="ml-auto flex items-center gap-2">
          <SearchableSelect ariaLabel="정렬" value={sort} onValueChange={setSort} triggerClassName={TOOLBAR_SELECT}
            options={[{ value: "priority", label: "확인 우선" }, { value: "name", label: "이름순" }]} />
          <details className={styles.options}><summary className={`${toolbarButton} gap-1`}>보기 옵션<ChevronDown className="size-3" /></summary><div className="border-line bg-card absolute right-0 top-full z-40 mt-1 min-w-44 rounded-lg border p-2 shadow-lg">{Object.entries({ school: "학교·학년", future: "남은 예정", teachers: "강사별 시수", seats: "JJ·LAB" }).map(([key, label]) => <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-soft" key={key}><input className="accent-primary" type="checkbox" checked={options[key as keyof typeof options]} onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))} />{label}</label>)}</div></details>
          <button className={toolbarButton} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((c) => c.id)))}>{allCollapsed ? "전체 펼치기" : "전체 접기"}</button>
        </div>
      </div>
    </header>
    <div className={`${styles.body} ${wide && details ? styles.withDetail : ""}`}>
    <div className={styles.scroll}>
      <table className={styles.table} style={{ width: "100%", minWidth: tableWidth }}>
        <caption className="sr-only">학생별 월 시수 · 단위 U</caption>
        <colgroup><col style={{ width: 136 }} />{options.school ? <col style={{ width: 104 }} /> : null}<col style={{ width: 88 }} /><col style={{ width: 104 }} /><col style={{ width: 80 }} />{options.future ? <col style={{ width: 96 }} /> : null}<col style={{ width: 168 }} />{teacherSlots.map((i) => <col key={i} style={{ width: 104 }} />)}{options.seats ? <><col style={{ width: 72 }} /><col style={{ width: 72 }} /></> : null}</colgroup>
        <thead><tr>
          <th scope="col" className={styles.name}>이름</th>{options.school ? <th scope="col">학교·학년</th> : null}
          <th scope="col" title="회차 확정의 반 전체 시수">월 발생</th><th scope="col" title="모든 강사 + JJ + LAB">실수업 합계</th><th scope="col">잔여</th>
          {options.future ? <th scope="col" title="시간표와 보강 예약">남은 예정</th> : null}<th scope="col">확인</th>
          {teacherCount > 0 ? <th scope="colgroup" colSpan={teacherCount}>강사별 실수업</th> : null}{options.seats ? <><th scope="col">JJ</th><th scope="col">LAB</th></> : null}
        </tr></thead>
        {groups.map((c) => <tbody key={c.id} aria-label={c.name}>
          <tr className={styles.group}>
            <th colSpan={mainColumns} scope="rowgroup">
              <button className={styles.groupToggle} aria-expanded={!collapsed.has(c.id)} onClick={() => toggleClass(c.id)}>
                <ChevronRight className={`size-3 shrink-0 ${collapsed.has(c.id) ? "" : "rotate-90"}`} /><b>{c.name}</b><span>{tracks[c.track]}</span><span>{c.students.length}명</span>
                <span className="ml-auto">{c.from.slice(5).replace("-", "/")}~{c.to.slice(5).replace("-", "/")}</span>
              </button>
            </th>
            {teacherSlots.map((i) => <th scope="col" key={i} title={c.teachers[i]?.name}>{c.teachers[i]?.name ?? "—"}</th>)}
            {options.seats ? <><th scope="col">JJ</th><th scope="col">LAB</th></> : null}
          </tr>
          {!collapsed.has(c.id) ? c.students.map((s) => <tr key={s.id} data-student-row data-selected={selected?.classId === c.id && selected.studentId === s.id || undefined}>
            <th scope="row" className={styles.name}><button onClick={() => open(c, s)}>{s.name}</button></th>
            {options.school ? <td className={styles.school}>{s.school || "—"}</td> : null}
            <td className={styles.total}>{s.target === null ? <span className="font-medium">{s.invoice === "ok" ? "미확정" : s.invoice === "void" ? "청구 취소" : "청구 없음"}</span> : units(s.target)}</td>
            <td className={styles.total}><button aria-label={`${s.name} 실수업 상세`} onClick={() => open(c, s)}>{units(s.actual)}</button></td>
            <td>{units(s.remaining)}</td>{options.future ? <td title={s.review.length ? "집계 확인 사항이 있습니다. 상세를 확인해 주세요." : undefined}>{units(s.future)}</td> : null}
            <td className={styles.status}><button onClick={() => open(c, s)}><span data-status={masterNeedsInput(s) ? "review" : s.status}>{statusText(s)}</span>{s.missing > 0 ? <span className="block font-medium">{num(s.missing)}U 미입력</span> : s.review.length ? <span className="block font-medium">확인 사항 {s.review.length}건</span> : null}</button></td>
            {teacherSlots.map((i) => <td key={i}>{units(c.teachers[i] ? s.owners[c.teachers[i].id]?.actual : null)}</td>)}
            {options.seats ? <><td>{units(s.owners.JJ?.actual)}</td><td>{units(s.owners.LAB?.actual)}</td></> : null}
          </tr>) : null}
        </tbody>)}
        {groups.length === 0 ? <tbody><tr><td colSpan={mainColumns + teacherCount + (options.seats ? 2 : 0)} className={styles.empty}>조건에 맞는 학생이 없습니다.</td></tr></tbody> : null}
      </table>
    </div>
    {wide && details ? <aside className={styles.detailPane} aria-label="학생 시수 상세">{details}</aside> : null}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
      <span><b>{groups.length}</b>개 반 · <b>{groups.reduce((n, c) => n + c.students.length, 0)}</b>줄</span>
      <span>실수업 = 모든 강사 + JJ + LAB · 보강 포함 · *LAB 제외</span>
      <EmbedLink href={`/billing?tab=sessions&panel=verify&period=${data.month}${subject ? `&subject=${subject}` : ""}`} className="text-primary underline-offset-2 hover:underline">달력월 청구 시수 대조</EmbedLink>
      <span className="ml-auto">{data.asOf.replace("T", " ")} 기준 · 읽기 전용</span>
    </footer>
    <Sheet open={!!student && !wide} onOpenChange={(value) => { if (!value) setSelected(null); }}>
      <SheetContent className="overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="sr-only"><SheetTitle>학생 시수 상세</SheetTitle><SheetDescription>학생의 발생 시수와 실제 수업, 확인할 출결을 봅니다.</SheetDescription></SheetHeader>
        {details}
      </SheetContent>
    </Sheet>
    <Sheet open={guide} onOpenChange={setGuide}><SheetContent className="overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"><SheetHeader className="p-0 pr-10"><SheetTitle className="font-bold">시수 마스터 집계 기준</SheetTitle><SheetDescription>한 줄은 학생 × 반 × 조회 월입니다.</SheetDescription></SheetHeader><div className="space-y-4 text-sm">
      <p><b>월 발생</b>은 회차 확정의 반 전체 시수입니다. 미확정 또는 일수 기준은 완료 여부를 판정하지 않습니다.</p>
      <p><b>실수업</b>은 모든 강사·JJ·LAB의 최신 출결을 한 번씩 합산합니다. 출석·지각·조퇴·보강은 입력한 시수, 결석·공결은 0U입니다. *LAB은 제외합니다.</p>
      <p><b>남은 예정</b>은 수강 기간·등원 요일·휴일을 반영한 시간표와 보강 예약입니다. 아직 끝나지 않은 오늘 수업도 포함하며 실제 이수로 세지 않습니다.</p>
      <p><b>입력 확인</b>은 지난 교시의 미입력, 담당 불명, 일별·교시 기록 겹침, 세션 날짜·배분 불일치를 뜻합니다. 숫자가 같아도 확인 사항이 있으면 충족으로 단정하지 않습니다.</p>
      <p>미확정 학생의 입력 확인 사항도 따로 셉니다. ‘입력 확인’과 ‘미확정’에는 같은 학생이 함께 포함될 수 있습니다. ‘확인 우선’은 입력 문제와 부족·초과가 있는 학생부터 보여 줍니다.</p>
      <p><b>부족</b>은 남은 예정까지 진행해도 시수가 남는 경우입니다. 월말에는 실제 이수와 발생 시수의 차이를 확인할 수 있습니다.</p>
      <p>수학은 55분 교시=0.5U, 2교시=1U, 3교시=1.5U입니다. 인재원 영어의 50분 교시는 1시간으로 인정합니다. 브릿지는 40분=1U, 60분=1.5U입니다.{eieOn ? " EiE도 40분=1U, 60분=1.5U이며 요일별 4회 날짜 배정을 확인합니다." : ""}</p>
      <p>운영 시수는 반별 세션 기간으로 봅니다. 회차 확정의 청구 시수 대조는 달력월 기준이며, *LAB 포함 여부도 달라 합계가 다를 수 있습니다.</p>
    </div></SheetContent></Sheet>
  </div>;
}
