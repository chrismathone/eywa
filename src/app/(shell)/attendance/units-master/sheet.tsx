"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmbedLink } from "@/components/embed-link";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { MasterClass, MasterStatus, MasterStudent, UnitsMaster } from "@/features/attendance/units-master";
import styles from "./sheet.module.css";

const num = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const labels: Record<MasterStatus, string> = { normal: "정상 진행", short: "부족", review: "입력 확인", complete: "월 시수 충족", excess: "초과", plannedExcess: "예정 초과", unconfirmed: "미확정" };
const tracks = { eie: "EiE · 40분 = 1U", bridge: "브릿지 · 40분 = 1U", hourly: "인재원 · 1시간 = 1U" };
const statuses: Record<string, string> = { present: "출석", late: "지각", early_leave: "조퇴", makeup: "보강", absent: "결석", excused: "공결", unmarked: "미입력" };
const attention = (s: MasterStudent) => !["normal", "complete"].includes(s.status);

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
  const base = useMemo(() => data.classes.filter((c) => (!track || c.track === track) && (!classId || c.id === classId))
    .map((c) => ({ ...c, students: c.students.filter((s) => `${c.name} ${s.name} ${s.school}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) }))
    .filter((c) => c.students.length), [data, track, classId, query]);
  const all = base.flatMap((c) => c.students);
  const groups = base.map((c) => ({ ...c, students: c.students.filter((s) => status === "all" || (status === "attention" ? attention(s) : status === "excess" ? ["excess", "plannedExcess"].includes(s.status) : s.status === status)) })).filter((c) => c.students.length);
  const selectedClass = selected ? data.classes.find((c) => c.id === selected.classId) : undefined;
  const student = selectedClass?.students.find((s) => s.id === selected?.studentId);
  const ownerName = (c: MasterClass, id: string) => c.teachers.find((t) => t.id === id)?.name ?? (["JJ", "LAB"].includes(id) ? id : "귀속 확인");
  const open = (c: MasterClass, s: MasterStudent) => setSelected({ classId: c.id, studentId: s.id });
  const tabs = [["all", "전체"], ["attention", "확인 필요"], ["short", "부족"], ["review", "입력 확인"], ["complete", "월 시수 충족"], ["excess", "초과"], ["unconfirmed", "미확정"]];
  function changeMonth(month: string) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return;
    const next = new URLSearchParams(params.toString()); next.set("month", month);
    setSelected(null);
    startTransition(() => router.push(`/attendance/units-master?${next}`));
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
  return <div className={styles.root} aria-busy={pending}>
    <header className={styles.header}>
      <div className={styles.title}><h1>영어 시수 마스터</h1><span>관리자 · 읽기 전용</span><button onClick={() => setGuide(true)}>집계 기준</button></div>
      <div className={styles.toolbar}>
        <label>조회 월 <input aria-label="조회 월" type="month" value={data.month} onChange={(e) => changeMonth(e.target.value)} /></label>
        <select aria-label="영어 유형" value={track} onChange={(e) => { setTrack(e.target.value); setClassId(""); }}><option value="">영어 전체</option><option value="hourly">인재원</option><option value="bridge">브릿지</option><option value="eie">EiE</option></select>
        <select aria-label="반" value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">전체 반</option>{data.classes.filter((c) => !track || c.track === track).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input aria-label="학생·학교·반 검색" placeholder="학생·학교·반 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <details className={styles.options}><summary>보기 옵션</summary><div>{Object.entries({ school: "학교·학년", future: "남은 예정", teachers: "강사별 시수", seats: "JJ·LAB" }).map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key as keyof typeof options]} onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))} />{label}</label>)}</div></details>
        <button onClick={download}>표 내려받기</button><button disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "불러오는 중…" : "새로고침"}</button>
        <EmbedLink href={`/attendance?subject=english&month=${data.month}`}>출석부</EmbedLink>
      </div>
      <div className={styles.tabs} aria-label="시수 상태 필터">{tabs.map(([id, label]) => <button key={id} aria-pressed={status === id} onClick={() => setStatus(id)}>{label} <b>{all.filter((s) => id === "all" || (id === "attention" ? attention(s) : id === "excess" ? ["excess", "plannedExcess"].includes(s.status) : s.status === id)).length}</b></button>)}</div>
    </header>
    <div className={styles.scroll}>
      <p className={styles.hint}>{data.asOf.replace("T", " ")} 기준 · {groups.length}개 반 / {groups.reduce((n, c) => n + c.students.length, 0)}줄 · 학생이나 합계를 누르면 상세 내역이 열립니다.</p>
      {groups.length === 0 ? <p className={styles.empty}>조건에 맞는 학생이 없습니다.</p> : groups.map((c) => {
        const columns = [...(options.teachers ? c.teachers : []), ...(options.seats ? [{ id: "JJ", name: "JJ" }, { id: "LAB", name: "LAB" }] : [])];
        const width = 180 + 96 + 108 + 90 + (options.future ? 100 : 0) + 150 + columns.length * 104;
        return <section key={c.id} className={styles.group} style={{ width }} aria-label={c.name}>
          <div className={styles.groupTitle}><strong>{c.name}</strong><span>{tracks[c.track]}</span><small>{c.from} ~ {c.to} · {c.students.length}명</small></div>
          <table className={styles.table}><caption className="sr-only">{c.name} 학생별 월 시수</caption><colgroup><col style={{ width: 180 }} /><col style={{ width: 96 }} /><col style={{ width: 108 }} /><col style={{ width: 90 }} />{options.future ? <col style={{ width: 100 }} /> : null}<col style={{ width: 150 }} />{columns.map((t) => <col key={t.id} style={{ width: 104 }} />)}</colgroup>
            <thead><tr><th scope="col">학생</th><th scope="col">월 발생<small>확정 시수</small></th><th scope="col" className={styles.actual}>실수업 합계<small>강사 + JJ + LAB</small></th><th scope="col">잔여</th>{options.future ? <th scope="col">남은 예정<small>시간표·보강</small></th> : null}<th scope="col">확인</th>{columns.map((t) => <th scope="col" key={t.id} className={["JJ", "LAB"].includes(t.id) ? styles.seat : ""}>{t.name}<small>실수업 U</small></th>)}</tr></thead>
            <tbody>{c.students.map((s) => <tr key={s.id}><th scope="row"><button onClick={() => open(c, s)}>{s.name}</button>{options.school ? <small>{s.school}</small> : null}</th><td>{s.target === null ? <small>{s.invoice === "ok" ? "미확정" : s.invoice === "void" ? "청구 취소" : "청구 없음"}</small> : num(s.target)}</td><td className={styles.actual}><button aria-label={`${s.name} 실수업 상세`} onClick={() => open(c, s)}>{num(s.actual)}</button></td><td>{num(s.remaining)}</td>{options.future ? <td title={s.review.length ? "집계 확인 사항이 있습니다. 상세를 확인해 주세요." : undefined}>{num(s.future)}</td> : null}<td className={styles.status}><span data-status={s.status}>{statusText(s)}</span>{s.missing > 0 ? <small>{num(s.missing)}U 미입력</small> : s.review.length ? <small>확인 사항 {s.review.length}건</small> : null}</td>{columns.map((t) => <td key={t.id} className={["JJ", "LAB"].includes(t.id) ? styles.seat : ""}>{num(s.owners[t.id]?.actual)}</td>)}</tr>)}</tbody>
          </table>
        </section>;
      })}
    </div>
    <footer className={styles.footer}>실수업 = 모든 강사 + JJ + LAB · 보강 포함 · *LAB 제외 <span>서로 다른 반의 U는 합산하지 않습니다.</span></footer>
    <Sheet open={!!student} onOpenChange={(value) => { if (!value) setSelected(null); }}>
      <SheetContent className={styles.drawer}>
        {student && selectedClass ? <>
          <SheetHeader><SheetTitle>{student.name} <small>{student.school}</small></SheetTitle><SheetDescription>{selectedClass.name} · {tracks[selectedClass.track]}<br />{selectedClass.periodLabel}</SheetDescription></SheetHeader>
          <div className={styles.summary}><div>월 발생<strong>{num(student.target)} U</strong></div><div>실수업<strong>{num(student.actual)} U</strong></div><div>잔여<strong>{num(student.remaining)} U</strong></div></div>
          <div className={styles.detailStatus}><b>{statusText(student)}</b><p>잔여 {num(student.remaining)}U · 남은 예정 {num(student.future)}U · 미입력 {num(student.missing)}U</p>{student.review.map((note) => <p key={note}>{note}</p>)}</div>
          <h2>담당별 월 배분과 실제 수업</h2>
          <table className={styles.detailTable}><thead><tr><th>담당</th><th>월 배분</th><th>실수업</th><th>잔여 배분</th></tr></thead><tbody>{Object.entries(student.owners).map(([id, v]) => <tr key={id}><th>{ownerName(selectedClass, id)}</th><td>{num(v.planned)}</td><td>{num(v.actual)}</td><td>{v.planned === null ? "확인 필요" : num(v.planned - v.actual)}</td></tr>)}</tbody></table>
          <p className={styles.hint}>담임에게 배분한 잔여 시수는 실제 출결이 있을 때만 실수업으로 인정합니다.</p>
          <div className={styles.title}><h2>출결 내역 {student.events.length}건</h2><EmbedLink href={`/attendance?class=${selectedClass.id}&month=${data.month}&subject=english&mode=class&q=${encodeURIComponent(student.name)}`}>원 출석부 열기</EmbedLink></div>
          <div className={styles.events}>{student.events.length ? student.events.map((e, i) => <div key={`${e.date}-${e.slot}-${i}`} data-excluded={e.excluded || undefined}><div><time>{e.date.slice(5)} {e.slot ?? "일별"}</time><b>{ownerName(selectedClass, e.owner)} · {statuses[e.status] ?? e.status}</b><strong>{num(e.units)}U</strong></div>{e.note ? <p>{e.note}</p> : null}</div>) : <p>저장된 출결 내역이 없습니다.</p>}</div>
        </> : null}
      </SheetContent>
    </Sheet>
    <Sheet open={guide} onOpenChange={setGuide}><SheetContent className={styles.drawer}><SheetHeader><SheetTitle>시수 마스터 집계 기준</SheetTitle><SheetDescription>한 줄은 학생 × 반 × 조회 월입니다.</SheetDescription></SheetHeader><div className={styles.guide}>
      <p><b>월 발생</b>은 회차 확정의 반 전체 시수입니다. 미확정 또는 일수 기준은 완료 여부를 판정하지 않습니다.</p>
      <p><b>실수업</b>은 모든 강사·JJ·LAB의 최신 출결을 한 번씩 합산합니다. 출석·지각·조퇴·보강은 입력한 시수, 결석·공결은 0U입니다. *LAB은 제외합니다.</p>
      <p><b>남은 예정</b>은 수강 기간·등원 요일·휴일을 반영한 시간표와 보강 예약입니다. 아직 끝나지 않은 오늘 수업도 포함하며 실제 이수로 세지 않습니다.</p>
      <p><b>입력 확인</b>은 지난 교시의 미입력, 담당 불명, 일별·교시 기록 겹침, 세션 날짜·배분 불일치를 뜻합니다. 숫자가 같아도 확인 사항이 있으면 충족으로 단정하지 않습니다.</p>
      <p><b>부족</b>은 남은 예정까지 진행해도 시수가 남는 경우입니다. 월말에는 실제 이수와 발생 시수의 차이를 확인할 수 있습니다.</p>
      <p>인재원 50분 교시는 1시간으로 인정합니다. 브릿지·EiE는 40분=1U, 60분=1.5U입니다. EiE 등록은 요일별 4회이며 날짜 배정이 맞지 않으면 확인 대상으로 표시합니다.</p>
    </div></SheetContent></Sheet>
  </div>;
}
