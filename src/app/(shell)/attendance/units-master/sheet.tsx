"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmbedLink } from "@/components/embed-link";
import { PeriodNav } from "@/components/period-nav";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ChevronDown, ChevronRight, Search } from "@/components/icons/eywa-icon-compat";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON, TOOLBAR_SEARCH_BOX, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { MasterClass, MasterStatus, MasterStudent, UnitsMaster } from "@/features/attendance/units-master";
import styles from "./sheet.module.css";

const num = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const labels: Record<MasterStatus, string> = { normal: "정상 진행", short: "부족", review: "입력 확인", complete: "월 시수 충족", excess: "초과", plannedExcess: "예정 초과", unconfirmed: "미확정" };
const tracks = { eie: "EiE · 40분 = 1U", bridge: "브릿지 · 40분 = 1U", hourly: "인재원 · 1시간 = 1U" };
const statuses: Record<string, string> = { present: "출석", late: "지각", early_leave: "조퇴", makeup: "보강", absent: "결석", excused: "공결", unmarked: "미입력" };
const attention = (s: MasterStudent) => !["normal", "complete"].includes(s.status);
const toolbarButton = `${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`;
const filters = [["all", "전체"], ["attention", "확인 필요"], ["short", "부족"], ["review", "입력 확인"], ["complete", "월 시수 충족"], ["excess", "초과"], ["unconfirmed", "미확정"]];
const matchesStatus = (s: MasterStudent, status: string) => status === "all" || (status === "attention" ? attention(s) : status === "excess" ? ["excess", "plannedExcess"].includes(s.status) : s.status === status);
const units = (n: number | null | undefined) => n == null ? "—" : `${num(n)} U`;

function adjacentMonth(month: string, offset: number) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7);
}

function statusText(s: MasterStudent) {
  if (s.status === "short") return `부족 ${num((s.remaining ?? 0) - s.future)}U`;
  if (s.status === "excess") return `초과 ${num(-(s.remaining ?? 0))}U`;
  if (s.status === "plannedExcess") return `예정 초과 ${num(s.future - (s.remaining ?? 0))}U`;
  if (s.status === "unconfirmed" && s.invoice !== "ok") return s.invoice === "void" ? "청구 취소" : "청구 없음";
  return labels[s.status];
}

export function UnitsMasterSheet({ data }: { data: UnitsMaster }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [track, setTrack] = useState("");
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<{ classId: string; studentId: string } | null>(null);
  const [options, setOptions] = useState({ school: true, future: true, teachers: true, seats: true });
  const [guide, setGuide] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const base = useMemo(() => data.classes.filter((c) => (!track || c.track === track) && (!classId || c.id === classId))
    .map((c) => ({ ...c, students: c.students.filter((s) => `${c.name} ${s.name} ${s.school}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) }))
    .filter((c) => c.students.length), [data, track, classId, query]);
  const all = useMemo(() => base.flatMap((c) => c.students), [base]);
  const groups = useMemo(() => base.map((c) => ({ ...c, students: c.students.filter((s) => matchesStatus(s, status)) })).filter((c) => c.students.length), [base, status]);
  const teacherCount = options.teachers ? Math.max(0, ...data.classes.map((c) => c.teachers.length)) : 0;
  const teacherSlots = Array.from({ length: teacherCount }, (_, i) => i);
  const mainColumns = 5 + Number(options.school) + Number(options.future);
  const tableWidth = 112 + (options.school ? 88 : 0) + 88 + 104 + 72 + (options.future ? 88 : 0) + 144 + teacherCount * 104 + (options.seats ? 144 : 0);
  const allCollapsed = groups.length > 0 && groups.every((c) => collapsed.has(c.id));
  const selectedClass = selected ? data.classes.find((c) => c.id === selected.classId) : undefined;
  const student = selectedClass?.students.find((s) => s.id === selected?.studentId);
  const ownerName = (c: MasterClass, id: string) => c.teachers.find((t) => t.id === id)?.name ?? (["JJ", "LAB"].includes(id) ? id : "귀속 확인");
  const open = (c: MasterClass, s: MasterStudent) => setSelected({ classId: c.id, studentId: s.id });
  function monthHref(month: string) {
    const next = new URLSearchParams(params.toString()); next.set("month", month);
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
    const rows: (string | number)[][] = [["반", "학생", "학교·학년", "월 발생 U", "실수업 U", "잔여 U", "남은 예정 U", "상태", "담당별 실수업 U"]];
    for (const c of groups) for (const s of c.students) rows.push([c.name, s.name, s.school, s.target ?? "미확정", s.actual, s.remaining ?? "", s.future, statusText(s),
      Object.entries(s.owners).map(([id, v]) => `${ownerName(c, id)} ${num(v.actual)}`).join(" / ")]);
    const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `영어_시수마스터_${data.month}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="flex h-full min-h-0 flex-col gap-2 pb-2 text-sm" aria-busy={pending}>
    <h1 className="sr-only">영어 시수 마스터</h1>
    <header className="flex shrink-0 flex-col gap-2 px-1 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect ariaLabel="영어 유형" valuePrefix="유형" value={track} onValueChange={(value) => { setTrack(value); setClassId(""); }} triggerClassName={TOOLBAR_SELECT}
          options={[{ value: "", label: "영어 전체" }, { value: "hourly", label: "인재원" }, { value: "bridge", label: "브릿지" }, { value: "eie", label: "EiE" }]} />
        <SearchableSelect ariaLabel="반" valuePrefix="반" value={classId} onValueChange={setClassId} className="max-w-64" triggerClassName={TOOLBAR_SELECT}
          options={[{ value: "", label: "전체 반" }, ...data.classes.filter((c) => !track || c.track === track).map((c) => ({ value: c.id, label: c.name }))]} />
        <PeriodNav label={`${data.month.slice(0, 4)}년 ${Number(data.month.slice(5))}월`}
          prevHref={monthHref(adjacentMonth(data.month, -1))} nextHref={monthHref(adjacentMonth(data.month, 1))} currentHref={monthHref(data.asOf.slice(0, 7))}
          relation={data.month === data.asOf.slice(0, 7) ? "current" : data.month < data.asOf.slice(0, 7) ? "past" : "future"}
          prevAriaLabel="이전 달" nextAriaLabel="다음 달" pending={pending}
          onNavigate={(href) => { setSelected(null); startTransition(() => router.push(href)); }} />
        <label className={TOOLBAR_SEARCH_BOX}><Search className="size-4 shrink-0" aria-hidden="true" /><input className="w-44 min-w-0 bg-transparent outline-none" aria-label="학생·학교·반 검색" placeholder="학생·학교·반 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className={toolbarButton} onClick={() => setGuide(true)}>집계 기준</button>
          <button className={toolbarButton} onClick={download}>표 내려받기</button>
          <button className={toolbarButton} disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "불러오는 중…" : "새로고침"}</button>
          <EmbedLink className={toolbarButton} href={`/attendance?subject=english&month=${data.month}`}>출석부</EmbedLink>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="시수 상태 필터">
        {filters.map(([id, label]) => <button className={`${TOOLBAR_CHIP} ${status === id ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF} gap-1.5`} key={id} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}<b className="num">{all.filter((s) => matchesStatus(s, id)).length}</b></button>)}
        <div className="ml-auto flex items-center gap-2">
          <details className={styles.options}><summary className={`${toolbarButton} gap-1`}>보기 옵션<ChevronDown className="size-3" /></summary><div className="border-line bg-card absolute right-0 top-full z-40 mt-1 min-w-44 rounded-lg border p-2 shadow-lg">{Object.entries({ school: "학교·학년", future: "남은 예정", teachers: "강사별 시수", seats: "JJ·LAB" }).map(([key, label]) => <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-soft" key={key}><input className="accent-primary" type="checkbox" checked={options[key as keyof typeof options]} onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))} />{label}</label>)}</div></details>
          <button className={toolbarButton} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((c) => c.id)))}>{allCollapsed ? "전체 펼치기" : "전체 접기"}</button>
        </div>
      </div>
    </header>
    <div className={styles.scroll} style={{ width: tableWidth + 2, maxWidth: "100%" }}>
      <table className={styles.table} style={{ width: tableWidth }}>
        <caption className="sr-only">영어 학생별 월 시수 · 단위 U</caption>
        <colgroup><col style={{ width: 112 }} />{options.school ? <col style={{ width: 88 }} /> : null}<col style={{ width: 88 }} /><col style={{ width: 104 }} /><col style={{ width: 72 }} />{options.future ? <col style={{ width: 88 }} /> : null}<col style={{ width: 144 }} />{teacherSlots.map((i) => <col key={i} style={{ width: 104 }} />)}{options.seats ? <><col style={{ width: 72 }} /><col style={{ width: 72 }} /></> : null}</colgroup>
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
            <td className={styles.status}><button onClick={() => open(c, s)}><span data-status={s.status}>{statusText(s)}</span>{s.missing > 0 ? <span className="block font-medium">{num(s.missing)}U 미입력</span> : s.review.length ? <span className="block font-medium">확인 사항 {s.review.length}건</span> : null}</button></td>
            {teacherSlots.map((i) => <td key={i}>{units(c.teachers[i] ? s.owners[c.teachers[i].id]?.actual : null)}</td>)}
            {options.seats ? <><td>{units(s.owners.JJ?.actual)}</td><td>{units(s.owners.LAB?.actual)}</td></> : null}
          </tr>) : null}
        </tbody>)}
        {groups.length === 0 ? <tbody><tr><td colSpan={mainColumns + teacherCount + (options.seats ? 2 : 0)} className={styles.empty}>조건에 맞는 학생이 없습니다.</td></tr></tbody> : null}
      </table>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
      <span><b>{groups.length}</b>개 반 · <b>{groups.reduce((n, c) => n + c.students.length, 0)}</b>줄</span>
      <span>실수업 = 모든 강사 + JJ + LAB · 보강 포함 · *LAB 제외</span>
      <span className="ml-auto">{data.asOf.replace("T", " ")} 기준 · 읽기 전용</span>
    </footer>
    <Sheet open={!!student} onOpenChange={(value) => { if (!value) setSelected(null); }}>
      <SheetContent className="overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {student && selectedClass ? <>
          <SheetHeader className="p-0 pr-10"><SheetTitle className="font-bold">{student.name} <span className="text-sm font-medium">{student.school}</span></SheetTitle><SheetDescription>{selectedClass.name} · {tracks[selectedClass.track]}<br />{selectedClass.periodLabel}</SheetDescription></SheetHeader>
          <table className={styles.detailTable}><thead><tr><th scope="col">월 발생</th><th scope="col">실수업 합계</th><th scope="col">잔여</th></tr></thead><tbody><tr><td className={styles.total}>{units(student.target)}</td><td className={styles.total}>{units(student.actual)}</td><td>{units(student.remaining)}</td></tr></tbody></table>
          <div className="space-y-1 text-xs"><b>{statusText(student)}</b><p>남은 예정 {num(student.future)}U · 미입력 {num(student.missing)}U</p>{student.review.map((note) => <p key={note}>{note}</p>)}</div>
          <section className="space-y-2">
            <h2 className="text-sm font-bold">담당별 월 배분과 실제 수업</h2>
            <table className={styles.detailTable}><thead><tr><th scope="col">담당</th><th scope="col">월 배분</th><th scope="col">실수업</th><th scope="col">잔여 배분</th></tr></thead><tbody>{Object.entries(student.owners).map(([id, v]) => <tr key={id}><th scope="row">{ownerName(selectedClass, id)}</th><td>{units(v.planned)}</td><td className={styles.total}>{units(v.actual)}</td><td>{v.planned === null ? "확인 필요" : units(v.planned - v.actual)}</td></tr>)}</tbody></table>
            <p className="text-xs">담임에게 배분한 잔여 시수는 실제 출결이 있을 때만 실수업으로 인정합니다.</p>
          </section>
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">출결 내역 {student.events.length}건</h2><EmbedLink className={toolbarButton} href={`/attendance?class=${selectedClass.id}&month=${data.month}&subject=english&mode=class&q=${encodeURIComponent(student.name)}`}>원 출석부 열기</EmbedLink></div>
            <div className={styles.events}>{student.events.length ? student.events.map((e, i) => <div key={`${e.date}-${e.slot}-${i}`} data-excluded={e.excluded || undefined}><div><time>{e.date.slice(5)} {e.slot ?? "일별"}</time><b>{ownerName(selectedClass, e.owner)} · {statuses[e.status] ?? e.status}</b><strong>{units(e.units)}</strong></div>{e.note ? <p>{e.note}</p> : null}</div>) : <p>저장된 출결 내역이 없습니다.</p>}</div>
          </section>
        </> : null}
      </SheetContent>
    </Sheet>
    <Sheet open={guide} onOpenChange={setGuide}><SheetContent className="overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"><SheetHeader className="p-0 pr-10"><SheetTitle className="font-bold">시수 마스터 집계 기준</SheetTitle><SheetDescription>한 줄은 학생 × 반 × 조회 월입니다.</SheetDescription></SheetHeader><div className="space-y-4 text-sm">
      <p><b>월 발생</b>은 회차 확정의 반 전체 시수입니다. 미확정 또는 일수 기준은 완료 여부를 판정하지 않습니다.</p>
      <p><b>실수업</b>은 모든 강사·JJ·LAB의 최신 출결을 한 번씩 합산합니다. 출석·지각·조퇴·보강은 입력한 시수, 결석·공결은 0U입니다. *LAB은 제외합니다.</p>
      <p><b>남은 예정</b>은 수강 기간·등원 요일·휴일을 반영한 시간표와 보강 예약입니다. 아직 끝나지 않은 오늘 수업도 포함하며 실제 이수로 세지 않습니다.</p>
      <p><b>입력 확인</b>은 지난 교시의 미입력, 담당 불명, 일별·교시 기록 겹침, 세션 날짜·배분 불일치를 뜻합니다. 숫자가 같아도 확인 사항이 있으면 충족으로 단정하지 않습니다.</p>
      <p><b>부족</b>은 남은 예정까지 진행해도 시수가 남는 경우입니다. 월말에는 실제 이수와 발생 시수의 차이를 확인할 수 있습니다.</p>
      <p>인재원 50분 교시는 1시간으로 인정합니다. 브릿지·EiE는 40분=1U, 60분=1.5U입니다. EiE 등록은 요일별 4회이며 날짜 배정이 맞지 않으면 확인 대상으로 표시합니다.</p>
    </div></SheetContent></Sheet>
  </div>;
}
