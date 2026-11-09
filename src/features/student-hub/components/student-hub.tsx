import { EmbedLink as Link } from "@/components/embed-link";
import { getStudentHub } from "../server/query";
import { LiveSectionView } from "@/features/student-contribution/components/live-section-view";
import { kstShortStamp } from "@/lib/date-kst";
import a from "@/components/analytics/analytics.module.css";
import s from "./student-hub.module.css";
import { StudentVisuals } from "./student-visuals";

const groups = [
  { id: "promises", label: "입학·약속·할 일", keys: ["intake", "commitments", "followUps"] },
  { id: "learning", label: "학습·수업·등원", keys: ["classes", "attendance", "learning-plan", "grades", "progress", "textbooks", "videos", "shuttle", "reservations", "makeups"] },
  { id: "communication", label: "소통·관계·재원 이력", keys: ["consultations", "field-observations", "memos", "family", "parentMessages", "studentStatus", "enrollmentHistory"] },
  { id: "billing", label: "수납·참여", keys: ["billing"] },
];
const stateLabels: Record<string, string> = { ready: "연결됨", partial: "일부 확인", forbidden: "열람 제한", failed: "조회 실패", schema_missing: "연결 전", off: "사용 안 함", unavailable: "확인 필요", pending: "준비 중", empty: "저장 분석 없음", stale: "분석 갱신 필요" };

export async function StudentHub({ studentId, month }: { studentId: string; month?: string }) {
  const data = await getStudentHub(studentId, month);
  if (!data) return <p role="status">이 학생의 통합 기록을 열람할 수 없습니다.</p>;
  const base = `/students/${studentId}`;
  const grouped = new Set(groups.flatMap((group) => group.keys));
  const other = data.sections.filter((s) => !grouped.has(s.key));
  const readable = data.sections.filter((s) => s.state === "ready" || s.state === "partial");
  const analysisKinds = { rule: "기록 기반 계산", ai: "저장된 AI 분석" };
  return <div className={`${a.dashboard} ${s.page}`} aria-label="학생 통합보기">
    <section className={s.hero}>
      <div className={s.heroTop}>
        <div><div className={s.eyebrow}>원생 · 학생 통합보기</div><h2>{data.student.name} 학생 통합보기</h2>
          <p>입학 때의 요구부터 수업·소통·수납·분석과 후속 업무까지, 이 학생에게 연결된 자료를 함께 확인합니다.</p>
          <div className={s.stamp}>{kstShortStamp(data.checkedAt)} 조회 · {readable.length}개 자료 영역 · 분석 {data.analyses.length}건</div></div>
        <div className={s.heroLinks}><Link href={base} className={s.heroAction}>학생 상세로</Link><Link href={`${base}/care`} className={s.heroAction}>약속·이행 관리 ↗</Link></div>
      </div>
    </section>
      <nav aria-label="학생 통합보기 구역" className={s.sourceNav}>
        {[{ id: "analysis", label: "분석·판단" }, ...groups, { id: "coverage", label: "자료 연결 상태" }].filter((g) => g.id !== "billing" || data.billingAllowed).map((g) => <a key={g.id} href={`#student-hub-${g.id}`} >{g.label}</a>)}
      </nav>
      <details className={s.profile}><summary>학생·보호자 기본정보</summary><dl>
        {[["학교·학년", [data.student.school, data.student.grade].filter(Boolean).join(" · ")], ["원생번호", data.student.studentCode], ["영문명", data.student.englishName], ["클래스노트 이름", data.student.classnoteName], ["학생 연락처", data.student.studentPhone], ["보호자", data.student.parentName], ["보호자 연락처", data.student.parentPhone], ["입학일", data.student.enrolledAt], ["퇴원일", data.student.withdrawnAt]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "기록 없음"}</dd></div>)}
      </dl><Link href={`${base}?tab=overview`} className={s.link}>프로필·기존 요약 전체 보기</Link></details>

    <section id="student-hub-analysis" className={s.block} aria-labelledby="hub-analysis-title">
      <div className={s.blockHead}><div><h2 id="hub-analysis-title" className={s.sectionHeading}>이 학생, 한눈에 보기</h2><p className={s.muted}>선택 월 분석과 최신 원본 기록 · 전체 이력은 각 원본에서 확인</p></div>
        <form className={s.toolbar} action={`${base}/hub`}><label htmlFor="hub-month">분석 월</label><input id="hub-month" name="month" type="month" defaultValue={data.month}/><button type="submit">조회</button></form></div>
      <StudentVisuals data={data}/>
      <h2 className={s.sectionHeading}>분석·판단과 근거</h2>
      <div className={s.analysisGrid}>
        {data.analyses.map((a) => <article key={a.id} className={s.analysisCard}><div className={s.analysisHead}><h3>{a.title}</h3><span className={s.chip}>{analysisKinds[a.basis]}</span>{a.state !== "ready" && <span className={s.warn}>{a.state === "historical" ? "과거 분석 · 현재 상황 재확인" : "일부 자료 기준"}</span>}</div>
          <p className={s.body}>{a.body}</p><div className={s.analysisFoot}><span>{a.generatedAt ? kstShortStamp(a.generatedAt) : "생성 시점 미확인"}</span><Link className={s.link} href={a.href}>근거·후속 업무 확인</Link></div></article>)}
      </div>
      {!data.analyses.length && <p className={s.emptyCard}>현재 확인할 수 있는 분석이 없습니다. 아래 원본 기록과 자료 연결 상태를 먼저 확인해 주세요.</p>}
      {!!data.monthly.length && <details className={s.card}><summary>월별 운영 기여·학습 참여 분석 이력</summary>
        <p className={s.muted}>원수치·정정분에 현재 배점을 적용한 점수입니다. 학생별 수익이나 퇴원 확률을 뜻하지 않습니다.</p>
        <div className={s.scroll}><table className={s.table}><thead><tr><th>월</th><th>운영 기여</th><th>학습·참여</th><th>상태</th><th>근거</th></tr></thead><tbody>{[...data.monthly].reverse().map((m) => <tr key={m.month}><th>{m.month}</th><td>{m.operations.toLocaleString()}점</td><td>{m.participation.toLocaleString()}점</td><td>{m.partial ? "일부 확인" : "집계됨"}</td><td><Link href={`${base}?tab=contribution&month=${m.month}`} className={s.link}>계산식·설명회·소개 기록</Link></td></tr>)}</tbody></table></div>
      </details>}
    </section>

    {groups.map((group) => { const sections = data.sections.filter((s) => group.keys.includes(s.key));
      if (!sections.length || (group.id === "billing" && !data.billingAllowed)) return null;
      return <section key={group.id} id={`student-hub-${group.id}`} className={s.block}><h2 className={s.sectionHeading}>{group.label}</h2><div className={s.sectionGrid}>{sections.map((section) => <LiveSectionView key={section.key} section={section} />)}</div></section>;
    })}
    {!!other.length && <section className={s.block}><h2 className={s.sectionHeading}>추가 연결 기록</h2><div className={s.sectionGrid}>{other.map((s) => <LiveSectionView key={s.key} section={s} />)}</div></section>}
    <section id="student-hub-coverage" className={s.card}><h2 className={s.sectionHeading}>자료 연결 상태</h2><p className={s.muted}>연결되지 않은 자료나 조회 실패는 ‘기록 없음’으로 처리하지 않습니다.</p>
      <ul className={s.coverage}>{data.coverage.map((c) => <li key={c.key}><div><strong>{c.label}</strong><span data-state={c.state}>{stateLabels[c.state] ?? "확인 필요"}</span></div><p>{c.note}</p></li>)}</ul>
    </section>
  </div>;
}
