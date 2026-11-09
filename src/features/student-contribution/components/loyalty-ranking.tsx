"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmbedLink as Link } from "@/components/embed-link";
import { Button } from "@/components/ui/button";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { ContributionHeader } from "./contribution-shell";
import { refreshContribution } from "../server/actions";
import type { LoyaltyRankingData } from "../server/ranking-query";
import { PART_KEYS as RANKING_KEYS, PART_LABELS, type PartKey as RankingKey } from "../model/loyalty-parts";
import styles from "./loyalty-ranking.module.css";
import { TierStars } from "./relative-score";
import { OverlayGuide } from "@/components/overlay-guide";
import { saveLoyaltyColumnOrder } from "../server/ranking-prefs-actions";
import type { TierName } from "../model/relative-score";

/** 1st · 2nd · 3rd · 4th — 숫자는 크게, 꼬리는 작게(워터마크). */
const ordinalTail = (k: number) => (k % 100 >= 11 && k % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][k % 10] ?? "th"));
const Ordinal = ({ k }: { k: number }) => <>{k}<small>{ordinalTail(k)}</small></>;
/** 가족 1등이 한 가족이면 '정채민 남매' — 가장 나이 많은 학생 이름 + 남자끼리 형제 · 여자끼리 자매 · 섞이면 남매(성별을 모르면 형제자매). */
type Person = { id: string; name: string; grade: string | null; gender?: string | null; birthDate?: string | null; family: { members: { id: string }[] } };
const gradeAge = (g: string | null) => { const m = g?.match(/^(초|중|고)(\d)/); return m ? ({ 초: 0, 중: 6, 고: 9 } as const)[m[1] as "초" | "중" | "고"] + Number(m[2]) : -1; };
function familyName(group: readonly Person[]): string | null {
  if (group.length < 2) return null;
  const ids = new Set(group[0]!.family.members.map(m => m.id));
  if (!group.every(p => ids.has(p.id))) return null;
  const oldest = [...group].sort((a, b) => (a.birthDate && b.birthDate ? a.birthDate.localeCompare(b.birthDate) : gradeAge(b.grade) - gradeAge(a.grade)))[0]!;
  const g = new Set(group.map(p => p.gender));
  const kind = g.has(null) || g.has(undefined) ? "형제자매" : g.size === 1 ? (g.has("female") ? "자매" : "형제") : "남매";
  return `${oldest.name} ${kind}`;
}
const n = (v: number | null | undefined, digits = 1) => v == null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
// 시안: 계기판 색 — 차콜 · 노랑 · 회색 단계(빨강은 주의에만 남긴다).
const colors: Record<RankingKey, string> = { tuition: "#fdb811", subject: "#363c41", tenure: "#5b6469", referral: "#c28700", participation: "#7a8388", family: "#a3abae" };

export function LoyaltyRanking({ data }: { data: LoyaltyRankingData }) {
  const [metric, setMetric] = useState<"total" | RankingKey>("total"), [search, setSearch] = useState("");
  const [grade, setGrade] = useState(""), [subject, setSubject] = useState(""), [familyOnly, setFamilyOnly] = useState(false);
  const [page, setPage] = useState(1), [busy, start] = useTransition(), [message, setMessage] = useState("");
  const router = useRouter();
  // 점수 칸 순서 — 제목 칸을 끌어 옮긴다(계정에 저장). 순위·학생·종합 칸은 고정.
  const [cols, setCols] = useState<RankingKey[]>(data.columnOrder);
  const [dragCol, setDragCol] = useState<RankingKey | null>(null), [overCol, setOverCol] = useState<RankingKey | null>(null);
  const moveCol = (from: RankingKey, to: RankingKey) => {
    if (from === to) return;
    const next = cols.filter(k => k !== from); next.splice(next.indexOf(to) + (cols.indexOf(from) < cols.indexOf(to) ? 1 : 0), 0, from);
    setCols(next); void saveLoyaltyColumnOrder(next).catch(() => undefined);
  };
  const grades = [...new Set(data.rows.map(r => r.grade).filter((g): g is string => !!g))].sort((a,b)=>a.localeCompare(b,"ko"));
  // 필터(학년·과목·형제자매·확인 완료) = 비교 집단 — 순위·별 등급·1~5등·항목별 1등을 이 안에서 다시 매긴다(원장 2026-11-09).
  // 이름 검색은 찾기만 한다(검색한 학생이 1등이 되지 않게 순위는 그대로).
  const cohort = useMemo(() => data.rows.filter(r => (!grade || r.grade === grade) && (!subject || r.subjects.includes(subject))
    && (!familyOnly || (r.family.activeCount ?? 0) >= 2)), [data.rows, grade, subject, familyOnly]);
  const filtering = cohort.length !== data.rows.length;
  // 별 9등급도 비교 집단 안에서(수능식 누적 4·11·23·40·60·77·89·96·100% · 5명 미만·전원 동점은 보류).
  const bands = useMemo(() => {
    const scored = cohort.filter(r => r.score !== null), n = scored.length, out = new Map<string, number | null>();
    const differentiated = new Set(scored.map(r => r.score)).size > 1;
    for (const r of scored) {
      const better = scored.filter(o => o.score! > r.score!).length, equals = scored.filter(o => o.score === r.score).length;
      const top = (better + equals) / n * 100;
      out.set(r.id, n >= 5 && differentiated ? [4, 11, 23, 40, 60, 77, 89, 96, 100].findIndex(c => top <= c) + 1 || 9 : null);
    }
    return out;
  }, [cohort]);
  const standings = useMemo(() => {
    const rows = [...cohort].sort((a,b) => ((metric === "total" ? b.score : (b.parts[metric] ?? null)) ?? -1) - ((metric === "total" ? a.score : (a.parts[metric] ?? null)) ?? -1) || a.name.localeCompare(b.name,"ko"));
    const positions = new Map<string, number | null>(); let previous: number | null = null, position = 0;
    rows.forEach((r,i) => { const value = metric === "total" ? r.score : (r.parts[metric] ?? null); if (value !== previous) position = i + 1; positions.set(r.id, value === null ? null : position); previous = value; });
    return { rows, positions };
  }, [cohort, metric]);
  const filtered = standings.rows.filter(r => `${r.name} ${r.school ?? ""}`.includes(search.trim()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20))), shown = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  // 시안: 종합 1~5등 — 표의 정렬(metric)과 무관하게 종합 점수로. 같은 점수는 같은 등수.
  const topFive = useMemo(() => {
    const rows = cohort.filter(r => r.score !== null).sort((a,b) => b.score! - a.score! || a.name.localeCompare(b.name,"ko"));
    // 등수 = 나보다 점수가 높은 학생 수 + 1(같은 점수는 같은 등수).
    return rows.slice(0, 5).map((r) => ({ r, position: rows.filter(o => o.score! > r.score!).length + 1 })).filter(x => x.position <= 5);
  }, [cohort]);
  const choose = (key: "total" | RankingKey) => { setMetric(key); setPage(1); };
  const refresh = () => start(async () => { const result = await refreshContribution(); setMessage(result.error ?? result.message ?? ""); router.refresh(); });
  return <div className={styles.root}>
    <ContributionHeader title="학생 로열티 기록실" description="학생 한 명의 기록을 여섯 가지 관점으로. 종합 순위와 항목별 기록을 함께 비교하세요."
      active="ranking" canConfigure={data.canConfigure} actions={data.canWrite && <Button disabled={busy || !!data.refreshedTodayAt} title={data.refreshedTodayAt ? "최신 기록 집계는 하루 1회입니다" : undefined} onClick={refresh}>{busy ? "기록 집계 중…" : data.refreshedTodayAt ? `오늘 ${data.refreshedTodayAt} 집계함` : "최신 기록 집계"}</Button>} />
    <section className={styles.hero} aria-label="로열티 랭킹 개요">
      <div className={styles.heroLine}><h2>꾸준한 선택이 만드는 <em>우리 학원의 로열티</em></h2><p>기간 · 납부 · 가족 · 참여 · 출결 · 성적</p></div>
      <div className={styles.heroStats}><div><strong>{cohort.length}<small>명</small></strong><span>{filtering ? `필터 기준 · 전체 ${data.rows.length}명 중` : data.scoped ? "열람 범위 내 재원생" : "전체 재원생"}</span></div></div>
    </section>
    <div className={styles.status} role="status"><span>조회 기준 {data.today} · 마지막 집계 {data.refreshedAt ? new Date(data.refreshedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}) : "집계 전"}</span><span>{message || (data.missing ? `${data.missing}명 새 기록 집계 필요` : "누적 수강·납부 / 2026년부터 출결·성적 / 연결된 설명회 명단")}</span></div>
    {data.scoped && <p className={styles.notice}>본인이 열람할 수 있는 학생끼리 비교합니다. 전체 학원 순위와 다르며, 가족 정보는 담당 범위 보호를 위해 표시하지 않습니다.</p>}
    {topFive.length ? <section className={styles.topFive} aria-label="종합 순위 1~5등">
      <h3 className={`${styles.sectionTitle} ${styles.topTitle}`}>종합 순위 <small>1~5등</small></h3>
      <ol>{topFive.map(({ r, position }) => <li key={r.id}><Link href={`/student-contribution/${r.id}`} className={styles.topCard}>
        <span className={styles.topRank} aria-hidden><Ordinal k={position} /></span>
        <span className={styles.topPlace}>{position}등</span>
        <span className={styles.nameLine}><strong>{r.name}</strong><small>{schoolGradeLabel(r.school,r.grade)||"학교·학년 미입력"}</small></span>
        <b>{n(r.score)}<small>점</small></b>
      </Link></li>)}</ol>
    </section> : null}
    <h3 className={styles.sectionTitle}>항목별 1등</h3>
    <section className={styles.leaders} aria-label="항목별 기록 선두">{RANKING_KEYS.map(k => {
      const list = cohort.filter(r => (r.parts[k] ?? null) !== null).sort((a,b)=>(b.parts[k] ?? 0) - (a.parts[k] ?? 0) || a.name.localeCompare(b.name,"ko"));
      const first = list[0], tied = first ? list.filter(r=>(r.parts[k] ?? null)===(first.parts[k] ?? null)).length : 0;
      return <button key={k} type="button" className={styles.leader} onClick={()=>choose(k)} aria-pressed={metric===k}>
        <div><span className={styles.leaderItem}><i style={{background:colors[k]}} aria-hidden />{PART_LABELS[k]}</span></div>{first && (first.parts[k] ?? null)! > 0 ? <span className={styles.leaderRank} aria-hidden><Ordinal k={1} /></span> : null}
        <span className={styles.nameLine}><strong>{first && (first.parts[k] ?? null)! > 0 ? (tied > 1 ? familyName(list.filter(r=>(r.parts[k] ?? null)===(first.parts[k] ?? null))) ?? `${first.name} 외 ${tied-1}명` : first.name) : "기록 확인 중"}</strong>{first && (first.parts[k] ?? null)! > 0 && tied <= 1 ? <small>{schoolGradeLabel(first.school,first.grade)}</small> : null}</span>
        <b>{first && (first.parts[k] ?? null)! > 0 ? n(first.parts[k] ?? null) : "—"}<small>점</small></b>
      </button>;
    })}</section>
    <section className={styles.board} aria-label="학생별 로열티 랭킹">
      <div className={styles.filters}><input aria-label="학생 이름 또는 학교 검색" placeholder="학생 이름 · 학교 검색" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
        <select aria-label="학년" value={grade} onChange={e=>{setGrade(e.target.value);setPage(1);}}><option value="">전체 학년</option>{grades.map(g=><option key={g}>{g}</option>)}</select>
        <select aria-label="수강 이력 과목" value={subject} onChange={e=>{setSubject(e.target.value);setPage(1);}}><option value="">전체 수강 과목 이력</option>{data.subjects.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <label><input type="checkbox" checked={familyOnly} onChange={e=>{setFamilyOnly(e.target.checked);setPage(1);}} />형제자매 재원</label>
      <OverlayGuide className={styles.rulesGuide} align="end" label="가산점 · 순위 산정 기준"><div className={styles.rules}>
      <ul><li>점수 = 학생 상세 화면의 로열티 점수 그대로입니다(활동 누적 + 가족 가점). 바꾸거나 환산하지 않습니다.</li>
        <li>가족 가점 = 형제 수 기본 가점(2남매 +{data.familyRate?.two ?? 100} · 3남매 +{data.familyRate?.three ?? 250} · 4남매 이상 +{data.familyRate?.fourPlus ?? 400}) + 형제마다 본인과 함께 다닌 기간(둘 중 늦은 등록일부터) 합 1개월당 +{data.familyRate?.perTogetherMonth ?? 2}점. 형제가 많고 오래 다닐수록 더 받습니다.</li>
        <li>표의 점수 칸(수업료 · 수강 · 장기재원 · 소개 · 학습참여 · 가족 가점)을 더하면 종합 점수입니다. 각 칸 = 누적 실적 × 배점 설정의 현재 배점. 칸 제목을 끌어 순서를 바꿀 수 있습니다.</li>
        <li>아직 확인되지 않은 기록은 0으로 치지 않습니다.</li>
        <li>별 9등급(반 개 포함)은 수능식 누적 상위 4·11·23·40·60·77·89·96·100%입니다. 동점은 공동 순위입니다. 5명 미만·전원 동점이면 등급을 보류합니다. 검색·과목 필터는 비교 집단을 바꾸지 않습니다.</li></ul>
      {data.canConfigure && <Link href="/student-contribution/settings">항목 켜기·끄기 · 성적 반영 방식 설정 →</Link>}
    </div></OverlayGuide></div>
      <p className={styles.tableNote}>표시 {filtered.length}명 / 비교 {cohort.length}명{filtering ? " (필터 안에서 다시 매긴 순위)" : ""} · {metric === "total" ? "로열티 점수 순" : `${PART_LABELS[metric]} 높은 순`} · 이름을 누르면 상세(계산 근거)가 열립니다.</p>
      <div className={styles.tableScroll}><table><caption className="sr-only">학생 로열티 순위와 여섯 가지 평가 기록</caption><colgroup><col className={styles.colRank} /><col className={styles.colStudent} /><col className={styles.colTotal} />{cols.map(k=><col key={k} />)}</colgroup><thead><tr><th scope="col" className={styles.rankHead}>순위 / 전체 {cohort.length}명</th><th scope="col" className={styles.studentHead}>학생 · 학교학년</th><th scope="col" aria-sort={metric==="total"?"descending":undefined}><button onClick={()=>choose("total")}>종합 점수 ↓</button></th>{cols.map(k=><th key={k} scope="col" aria-sort={metric===k?"descending":undefined} draggable onDragStart={e=>{setDragCol(k);e.dataTransfer.effectAllowed="move";}} onDragOver={e=>{if(dragCol){e.preventDefault();setOverCol(k);}}} onDragLeave={()=>setOverCol(c=>c===k?null:c)} onDrop={e=>{e.preventDefault();if(dragCol)moveCol(dragCol,k);setDragCol(null);setOverCol(null);}} onDragEnd={()=>{setDragCol(null);setOverCol(null);}} className={`${styles.dragCol} ${dragCol===k?styles.dragging:""} ${overCol===k&&dragCol!==k?styles.dropTarget:""}`} title="끌어서 칸 순서를 바꿀 수 있습니다"><button onClick={()=>choose(k)}>{PART_LABELS[k]} {metric===k?"↓":"↕"}</button></th>)}</tr></thead>
        <tbody>{shown.map(r=><tr key={r.id}><td className={styles.rank}>{standings.positions.get(r.id) ?? "—"}</td>
          <td className={styles.student}><Link href={`/student-contribution/${r.id}`}>{r.name}</Link><small>{schoolGradeLabel(r.school,r.grade)||"학교·학년 미입력"}</small></td>
          <td className={styles.totalCell}><TierStars tier={bands.get(r.id) ? (`${bands.get(r.id)}등급` as TierName) : null} /><strong className={styles.score}>{n(r.score)}</strong></td>
          {cols.map(k=><td key={k} data-active={metric===k}>{n(r.parts[k] ?? null)}</td>)}
        </tr>)}</tbody></table>{!shown.length && <p className={styles.empty}>조건에 맞는 학생이 없습니다.</p>}</div>
      <div className={styles.pager}><Button variant="outline" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>이전</Button><span>{currentPage} / {Math.max(1,Math.ceil(filtered.length/20))} 페이지</span><Button variant="outline" disabled={currentPage*20>=filtered.length} onClick={()=>setPage(currentPage+1)}>다음</Button></div>
    </section>
    {/* 시안: 학생 기록은 이름을 눌러 상세 화면에서 본다(목록 아래 기록 카드는 걷었다). */}
  </div>;
}
