"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmbedLink as Link } from "@/components/embed-link";
import { Button } from "@/components/ui/button";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { ContributionHeader } from "./contribution-shell";
import { refreshContribution } from "../server/actions";
import type { LoyaltyRankingData } from "../server/ranking-query";
import type { RankedStudent } from "../model/loyalty-ranking";
import { RANKING_KEYS, RANKING_LABELS, type RankingKey } from "../model/ranking-config";
import styles from "./loyalty-ranking.module.css";

const n = (v: number | null | undefined, digits = 1) => v == null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const colors = { tenure: "#2563eb", payment: "#0f8c7a", family: "#a85ed3", seminar: "#dd8c17", attendance: "#e05d7b", school: "#468cb3" };
const units = { tenure: "가산개월", payment: "가산원", family: "가족 과목개월", seminar: "회", attendance: "점", school: "지수" };
function rawRecord(r: RankedStudent, k: RankingKey) {
  const f = r.facts;
  if (k === "family") return r.family.state === "ready" ? `본인 포함 ${r.family.activeCount}명` : "연결 확인";
  if (!f) return "집계 필요";
  if (k === "tenure") return `${n(f.billing.months)}개월 · ${n(f.billing.subjectMonths)}과목개월`;
  if (k === "payment") return `${n(f.billing.paid / 10000)}만원 순납부`;
  if (k === "seminar") return f.seminar.attended === null ? "명단 확인" : `참석 확인 ${f.seminar.attended}회`;
  if (k === "attendance") return r.attendanceAllowed ? `기록 ${f.attendance.recorded}/${f.attendance.scheduled}교시` : "열람 제한";
  return !r.schoolAllowed ? "열람 제한" : f.school.current === null ? "학교 성적 미입력" : `최근 ${n(f.school.current)}점 · 향상 ${f.school.improvement === null ? "미확인" : `${f.school.improvement > 0 ? "+" : ""}${n(f.school.improvement)}%p`}`;
}
export function LoyaltyRanking({ data }: { data: LoyaltyRankingData }) {
  const [metric, setMetric] = useState<"total" | RankingKey>("total"), [search, setSearch] = useState("");
  const [grade, setGrade] = useState(""), [subject, setSubject] = useState(""), [familyOnly, setFamilyOnly] = useState(false), [completeOnly, setCompleteOnly] = useState(false);
  const [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null), [busy, start] = useTransition(), [message, setMessage] = useState("");
  const router = useRouter();
  const grades = [...new Set(data.rows.map(r => r.grade).filter((g): g is string => !!g))].sort((a,b)=>a.localeCompare(b,"ko"));
  const standings = useMemo(() => {
    const rows = [...data.rows].sort((a,b) => ((metric === "total" ? b.score : b.metrics[metric].value) ?? -1) - ((metric === "total" ? a.score : a.metrics[metric].value) ?? -1) || a.name.localeCompare(b.name,"ko"));
    const positions = new Map<string, number | null>(); let previous: number | null = null, position = 0;
    rows.forEach((r,i) => { const value = metric === "total" ? r.score : r.metrics[metric].value; if (value !== previous) position = i + 1; positions.set(r.id, value === null ? null : position); previous = value; });
    return { rows, positions };
  }, [data.rows, metric]);
  const filtered = standings.rows.filter(r => `${r.name} ${r.school ?? ""}`.includes(search.trim()) && (!grade || r.grade === grade) && (!subject || r.subjects.includes(subject))
    && (!familyOnly || (r.family.activeCount ?? 0) >= 2) && (!completeOnly || r.complete));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20))), shown = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const detail = data.rows.find(r => r.id === selected);
  const measured = data.rows.filter(r => r.score !== null), complete = measured.filter(r => r.complete);
  const choose = (key: "total" | RankingKey) => { setMetric(key); setPage(1); };
  const openRecord = (id: string) => { setSelected(selected === id ? null : id); if (selected !== id) requestAnimationFrame(() => document.getElementById("loyalty-student-record")?.scrollIntoView({ block: "start" })); };
  const refresh = () => start(async () => { const result = await refreshContribution(); setMessage(result.error ?? result.message ?? ""); router.refresh(); });
  return <div className={styles.root}>
    <ContributionHeader title="학생 로열티 기록실" description="학생 한 명의 기록을 여섯 가지 관점으로. 종합 순위와 항목별 기록을 함께 비교하세요."
      active="ranking" canConfigure={data.canConfigure} actions={data.canWrite && <Button disabled={busy} onClick={refresh}>{busy ? "기록 집계 중…" : "최신 기록 집계"}</Button>} />
    <section className={styles.hero} aria-label="로열티 랭킹 개요">
      <div><span className={styles.kicker}>AYWA · LOYALTY RECORDS</span><h2>꾸준한 선택이 만드는<br /><em>우리 학원의 로열티.</em></h2><p>기간 · 납부 · 가족 · 참여 · 출결 · 성적</p></div>
      <div className={styles.heroStats}><div><strong>{data.rows.length}<small>명</small></strong><span>{data.scoped ? "열람 범위 내 재원생" : "전체 재원생"}</span></div><div><strong>{complete.length}<small>명</small></strong><span>평가 항목 확인 완료</span></div><div><strong>100<small>점</small></strong><span>종합 만점 · 가족 기본 40점</span></div></div>
    </section>
    <div className={styles.status} role="status"><span>조회 기준 {data.today} · 마지막 집계 {data.refreshedAt ? new Date(data.refreshedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}) : "집계 전"}</span><span>{message || (data.missing ? `${data.missing}명 새 기록 집계 필요` : "누적 수강·납부 / 2026년부터 출결·성적 / 연결된 설명회 명단")}</span></div>
    {data.scoped && <p className={styles.notice}>본인이 열람할 수 있는 학생끼리 비교합니다. 전체 학원 순위와 다르며, 가족 정보는 담당 범위 보호를 위해 표시하지 않습니다.</p>}
    <section className={styles.leaders} aria-label="항목별 기록 선두">{RANKING_KEYS.map(k => {
      const list = data.rows.filter(r => r.metrics[k].value !== null).sort((a,b)=>b.metrics[k].value! - a.metrics[k].value! || a.name.localeCompare(b.name,"ko"));
      const first = list[0], tied = first ? list.filter(r=>r.metrics[k].value===first.metrics[k].value).length : 0;
      return <button key={k} type="button" className={styles.leader} style={{borderTopColor:colors[k]}} onClick={()=>choose(k)} aria-pressed={metric===k}>
        <div><span style={{color:colors[k]}}>{RANKING_LABELS[k]}</span><small>{data.config.weights[k]}점 배점</small></div><span className={styles.leaderRank}>{first && first.metrics[k].value! > 0 ? "01" : "—"}</span>
        <strong>{first && first.metrics[k].value! > 0 ? `${first.name}${tied>1?` 외 ${tied-1}명`:""}` : "기록 확인 중"}</strong>
        <b>{first && first.metrics[k].value! > 0 ? n(first.metrics[k].value) : "—"}<small>{units[k]}</small></b><span className={styles.caption}>측정 {list.length} / {data.rows.length}명 · 항목 순위 보기 ↗</span>
      </button>;
    })}</section>
    <details className={styles.rules}><summary>100점 배점 · 가산식 · 순위 산정 기준</summary><div className={styles.weightBar}>{RANKING_KEYS.filter(k=>data.config.weights[k]>0).map(k=><span key={k} style={{flex:data.config.weights[k],background:colors[k]}} title={`${RANKING_LABELS[k]} ${data.config.weights[k]}점`}>{data.config.weights[k]}</span>)}</div>
      <ul><li>기간 가산 = 유효 수강개월 + (과목개월 − 수강개월) × {data.config.extraSubjectBonus*100}% + 동시수강개월 × {data.config.concurrentBonus*100}%.</li>
        <li>납부 가산 = 월별 순수업료 × [1 + 추가 과목 수 × {data.config.extraSubjectBonus*100}% + 2과목 이상일 때 {data.config.concurrentBonus*100}%]의 합. 실제 낸 금액은 따로 표시합니다.</li>
        <li>가족 기록 = 본인의 누적 과목개월 × 현재 함께 재원 중인 형제자매 수(본인 제외). 현재 가족 수를 적용하는 평가식이며 과거 가족 동시 재원기간은 아닙니다.</li>
        <li>기간·납부·가족·설명회는 같은 비교 집단의 최고 기록을 각 항목 만점으로 환산합니다. 출결·성적은 100점 척도입니다. 학생 구성이 바뀌면 환산 점수도 달라집니다.</li>
        <li>출결: 정상 출석 1, 지각·조퇴 0.5, 결석 0. 예정 수업의 미입력이 있으면 판정 보류합니다. 학교 성적: {data.config.gradeMode === "current" ? "과목별 최근 학교시험 평균" : data.config.gradeMode === "both" ? "최근 성적과 향상 지수를 각 50% 반영" : "같은 연도·과목·시험종류 최근 2회 향상도"}. 향상 +20%p 이상이면 향상 지수 100입니다.</li>
        <li>미확인 항목은 0점 확정하지 않습니다. 확인된 점수의 합으로 잠정 순위를 표시하고, 미확인 항목이 모두 만점일 때의 상한을 함께 보여줍니다. 완전한 비교는 모든 항목 확인 후 가능합니다.</li>
        <li>1~5등급은 20% 간격, 동점은 공동 순위·동점 그룹 끝 백분위로 표시합니다. 5명 미만·전원 동점은 등급을 보류합니다. 검색·과목 필터는 비교 집단을 바꾸지 않습니다. 학생의 교육적 가치나 지도 우선순위를 평가하는 점수는 아닙니다.</li></ul>
      {data.canConfigure && <Link href="/student-contribution/settings">배점·가산율·성적 반영 방식 설정 →</Link>}
    </details>
    <section className={styles.board} aria-label="학생별 로열티 랭킹">
      <nav className={styles.tabs} aria-label="랭킹 항목"><button type="button" aria-pressed={metric==="total"} onClick={()=>choose("total")}>종합 랭킹</button>{RANKING_KEYS.map(k=><button type="button" key={k} aria-pressed={metric===k} onClick={()=>choose(k)}>{RANKING_LABELS[k]}</button>)}</nav>
      <div className={styles.filters}><input aria-label="학생 이름 또는 학교 검색" placeholder="학생 이름 · 학교 검색" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
        <select aria-label="학년" value={grade} onChange={e=>{setGrade(e.target.value);setPage(1);}}><option value="">전체 학년</option>{grades.map(g=><option key={g}>{g}</option>)}</select>
        <select aria-label="수강 이력 과목" value={subject} onChange={e=>{setSubject(e.target.value);setPage(1);}}><option value="">전체 수강 과목 이력</option>{data.subjects.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <label><input type="checkbox" checked={familyOnly} onChange={e=>{setFamilyOnly(e.target.checked);setPage(1);}} />형제자매 재원</label><label><input type="checkbox" checked={completeOnly} onChange={e=>{setCompleteOnly(e.target.checked);setPage(1);}} />확인 완료만</label>
      </div>
      <p className={styles.tableNote}>표시 {filtered.length}명 / 비교 {data.rows.length}명 · {metric === "total" ? "확인 점수 기준 잠정 순위 포함" : `${RANKING_LABELS[metric]} 기록 높은 순`} · 학생의 ‘기록 보기’를 누르면 계산 근거가 열립니다.</p>
      <div className={styles.tableScroll}><table><caption className="sr-only">학생 로열티 순위와 여섯 가지 평가 기록</caption><thead><tr><th scope="col">순위</th><th scope="col">학생</th><th scope="col" aria-sort={metric==="total"?"descending":undefined}><button onClick={()=>choose("total")}>종합 점수 ↓</button></th>{RANKING_KEYS.map(k=><th key={k} scope="col" aria-sort={metric===k?"descending":undefined}><button onClick={()=>choose(k)}>{RANKING_LABELS[k]} {metric===k?"↓":"↕"}</button></th>)}</tr></thead>
        <tbody>{shown.map(r=><tr key={r.id} data-selected={selected===r.id}><td className={styles.rank}>{standings.positions.get(r.id) ?? "—"}</td><td className={styles.student}><Link href={`/student-contribution/${r.id}`}>{r.name}</Link><small>{schoolGradeLabel(r.school,r.grade)||"학교·학년 미입력"}</small><button type="button" aria-expanded={selected===r.id} aria-controls="loyalty-student-record" onClick={()=>openRecord(r.id)}>기록 보기 {selected===r.id?"−":"+"}</button></td>
          <td><strong className={styles.score}>{n(r.score)}</strong><small>{r.score === null ? "집계 필요" : r.complete ? "확인 완료" : `잠정 · 가능 ${n(r.score)}~${n(r.upper)}`}</small><span className={styles.band}>{r.band ? `${r.band}등급 · 상위 ${n(r.top)}%` : "등급 보류"}</span><small>확인 {r.known}/{r.enabled}항목</small></td>
          {RANKING_KEYS.map(k=><td key={k} data-active={metric===k}><b>{n(r.metrics[k].value)}</b><small>{units[k]}</small><small>{rawRecord(r,k)}</small><span style={{color:colors[k]}}>{r.metrics[k].points === null ? "미확인" : `${n(r.metrics[k].points)} / ${data.config.weights[k]}점`}</span></td>)}
        </tr>)}</tbody></table>{!shown.length && <p className={styles.empty}>조건에 맞는 학생이 없습니다.</p>}</div>
      <div className={styles.pager}><Button variant="outline" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>이전</Button><span>{currentPage} / {Math.max(1,Math.ceil(filtered.length/20))} 페이지</span><Button variant="outline" disabled={currentPage*20>=filtered.length} onClick={()=>setPage(currentPage+1)}>다음</Button></div>
    </section>
    <section id="loyalty-student-record" className={styles.detail} aria-live="polite"><h2>{detail ? `${detail.name} · 로열티 기록 카드` : "학생별 기록 카드"}</h2>{detail ? <>
      <p>{detail.family.state === "ready" ? `현재 함께 재원: ${detail.family.members.filter(m=>m.active).map(m=>m.name).join(" · ") || "없음"}` : "가족 연결 확인 필요"} · 자료 기준 {detail.facts?.asOf ?? "집계 필요"}</p>
      <div className={styles.detailGrid}>{RANKING_KEYS.map(k=><article key={k}><h3 style={{color:colors[k]}}>{RANKING_LABELS[k]}</h3><strong>{n(detail.metrics[k].value)} <small>{units[k]}</small></strong><p>{rawRecord(detail,k)}</p><p>{detail.metrics[k].note}</p><div className={styles.meter} role="img" aria-label={`${RANKING_LABELS[k]} ${n(detail.metrics[k].points)} / ${data.config.weights[k]}점`}><span style={{width:`${data.config.weights[k] ? (detail.metrics[k].points ?? 0)/data.config.weights[k]*100 : 0}%`,background:colors[k]}} /></div></article>)}</div>
      {detail.facts && <p>동시수강 {detail.facts.billing.concurrentMonths}개월 · 출결: 정상 {detail.facts.attendance.present}, 지각 {detail.facts.attendance.late}, 조퇴 {detail.facts.attendance.early}, 결석 {detail.facts.attendance.absent}교시 · 학교시험 비교 {detail.facts.school.pairs}쌍</p>}
      <div className={styles.links}><Link href={`/student-contribution/${detail.id}`}>누적 기록·지식그래프 →</Link><Link href={`/student-contribution/${detail.id}/factors`}>42개 정밀 팩터 확인 →</Link><Link href={`/students/${detail.id}?tab=grades`}>학교 성적 기록 →</Link><Link href={`/students/${detail.id}?tab=attendance`}>출결 기록 →</Link></div>
    </> : <p>위 순위표에서 학생의 ‘기록 보기’를 선택하세요.</p>}</section>
  </div>;
}
