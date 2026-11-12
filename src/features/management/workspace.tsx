"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import v from "@/components/analytics/analytics.module.css";
import type { ManagementSnapshot, ReportIndexRow } from "./model";
import type { AiReview } from "./ai-answer";
import { ReviewPanel } from "./review-panel";
import { CollectionPanel } from "./collection-panel";
import { AccountingPanel } from "./accounting-panel";
import { AiReviewPanel } from "./ai-panel";
import { ManagementVisualSummary, featuredMetricIds } from "./visual-summary";
import s from "./workspace.module.css";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { PeriodNav } from "@/components/period-nav";
import { FilterSelect } from "@/components/filter-select";
import { Toolbar } from "@/components/toolbar";
import { monthLabel } from "@/lib/date-kst";

const number = (n: number | null, digits = 0) => n === null ? "자료 필요" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const won = (n: number | null) => n === null ? "자료 필요" : `${number(n)}원`;

/**
 * 경영 분석(원장 전용) — aywa-next(375d27df4)의 실제 기능을 계기판 화면에 옮긴 것. 값은 이 지점 DB에서 읽는다(`server/query.ts`).
 * 파일 가져오기·대조·확인 기록·AI 검토는 각 패널이 `/api/management/*`로 보낸다. 그래프 JSON 내려받기는 통합 지식그래프 쪽 일이다.
 */
export function ManagementWorkspace({ data, reportIndex, months, aiReview, aiEnabled, accountingImport, collectorAvailable }: { data: ManagementSnapshot; reportIndex: readonly ReportIndexRow[]; months: readonly string[]; aiReview: AiReview | null; aiEnabled: boolean; accountingImport: boolean; collectorAvailable: boolean }) {
  // 운영 분석 월 = 수납 월 이동과 같은 모양(PeriodNav + 라벨 자리 월 드롭다운). 목록 = 페이지가 넘긴 선택지(오름차순) · 끝에서 화살표 잠금.
  // 파라미터가 없으면 이번 달(page.tsx 기본값)이라 드롭다운의 '기본 달' = 이번 달.
  // 이번 달 = **서버가 준 목록의 끝**(page.tsx: 최근 36개월이 늘 들어가고 미래 월은 빠진다 → 끝 = 서버 기준 이번 달).
  // 클라 렌더에서 kstMonth()를 다시 부르면 월말 자정 무렵 서버와 값이 갈려 하이드레이션이 깨진다(React #418).
  const at = months.indexOf(data.month), nowMonth = months.at(-1) ?? data.month, monthHref = (m: string) => `?month=${m}`;
  const visibleSources = data.sources.filter((source) => accountingImport || !/ECOUNT/i.test(source.name));
  return <div className="space-y-5">
    <PageHeader title="경영 분석" description="운영 현황부터 수익 구조까지. 지표를 살펴보고 근거와 다음 할 일을 연결하세요."/>
    <Toolbar>
      <BackLink href="/dashboard" label="대시보드"/>
      <PeriodNav label={monthLabel(data.month)} prevHref={monthHref(months[Math.max(0, at - 1)] ?? data.month)} nextHref={monthHref(months[Math.min(months.length - 1, at + 1)] ?? data.month)}
        currentHref={monthHref(nowMonth)} prevDisabled={at <= 0} nextDisabled={at < 0 || at >= months.length - 1} currentTitle="눌러서 이번 달로"
        relation={data.month < nowMonth ? "past" : data.month > nowMonth ? "future" : "current"} prevAriaLabel="이전 달" nextAriaLabel="다음 달" labelWidth={132}
        labelControl={<FilterSelect paramName="month" value={data.month} allValue={nowMonth} allLabel={monthLabel(nowMonth)} ariaLabel="운영 분석 월" cap={200} className="h-full w-full"
          options={[...months].reverse().filter(m => m !== nowMonth).map(m => ({ value: m, label: monthLabel(m) }))}
          triggerClassName="num flex h-full w-full items-center justify-center gap-1 px-1 text-(length:--control-label) leading-none font-bold whitespace-nowrap hover:bg-bg-soft focus-visible:outline-2 focus-visible:outline-primary"/>}/>
    </Toolbar>
    <div className={`${s.page} ${v.dashboard}`}>
    <nav className={v.sourceNav} aria-label="경영 분석 영역"><a href="#operations">운영·매출</a><a href="#collection">자료 수집함</a><a href="#reviews">원본 대사·확인 업무</a><a href="#accounting">회계·채용</a><a href="#people">강사·상담 경로</a><Link href={`/dashboard/management/knowledge?month=${data.month}`}>통합 지식그래프 ↗</Link>{aiEnabled ? <a href="#knowledge">AI 검토</a> : null}<a href="#sources">데이터 연결</a></nav>
    <section id="operations"><div className={s.sectionTitle}><h2>{data.month} 운영 지표</h2><span>기준일 {data.asOf} · 과거 기록은 현재 저장 상태 기준</span></div>
      <ManagementVisualSummary data={data}/>
      <h3 className={s.subheading}>상세 경영 지표</h3>
      <div className={s.cards}>{data.metrics.filter(m => !featuredMetricIds(data.metrics).includes(m.id)).map(m => <article className={s.card} key={m.id} id={`metric-${m.id}`}><Link href={m.href}>{m.label} ↗</Link><strong>{number(m.value, m.unit === "%" ? 1 : 0)}{m.value !== null ? <small>{m.unit}</small> : null}</strong><details><summary>산출 근거</summary><p>{m.definition}</p><p>{m.source}</p></details></article>)}</div>
      <article className={s.panel}><h3>청구액이 달라진 이유를 나누어 보기</h3>{data.bridge ? <><div className={s.bridge}><div><span>전월 대비 실청구액</span><strong className={data.bridge.delta < 0 ? s.warnText : undefined}>{won(data.bridge.delta)}</strong></div><div><span>청구 학생 수 변화분</span><strong>{won(data.bridge.studentsEffect)}</strong></div><div><span>학생당 실청구 변화분</span><strong>{won(data.bridge.perStudentEffect)}</strong></div></div><p>두 변화분의 합은 전체 증감과 같습니다. 할인·수강과목·교재비·환불 구성을 확인해야 실제 원인을 알 수 있습니다. 현재 월은 미마감 자료일 수 있습니다.</p></> : <p>전월과 이번 달에 청구 학생이 모두 있어야 증감을 나눌 수 있습니다.</p>}<Link href="/billing/stats">청구 상세에서 확인 →</Link></article>
    </section>
    <CollectionPanel key={`collection:${data.month}`} month={data.month} collectorAvailable={collectorAvailable} ecountAllowed={accountingImport}/>
    <ReviewPanel batches={data.reviewBatches} month={data.month}/>
    <AccountingPanel key={`accounting:${data.month}`} data={data} reportIndex={reportIndex} importAllowed={accountingImport}/>
    <section id="people" className={s.columns}><article className={s.panel}><h2>강사별 담당 규모</h2><p>현재 담당 반 기준입니다. 담당 변경 이력·학생의 출발 성적·수업 기간을 보정하기 전에는 강사의 성과 점수로 사용하지 않습니다.</p><div className={s.tableScroll}><table><thead><tr><th>강사</th><th>수강 학생</th><th>수강 건수</th></tr></thead><tbody>{data.teachers.filter(t => t.courses > 0).map(t => <tr key={t.id}><td>{t.label}</td><td>{t.students}명</td><td>{t.courses}건</td></tr>)}</tbody></table></div><Link href="/staff">강사·담당 반 확인 →</Link><p><Link href="/class-review/knowledge">강사별 기록·성과·배정 여력 →</Link></p></article>
      <article className={s.panel}><h2>유입경로별 상담</h2><p>{data.month} 상담 접수 건수입니다. 학생이 연결된 상담은 등록 확정과 같지 않으며, 광고의 순증 효과로 해석할 수 없습니다.</p><table><thead><tr><th>기록된 경로</th><th>상담 건수</th><th>학생 연결</th></tr></thead><tbody>{data.channels.map(c => <tr key={c.label}><td>{c.label}</td><td>{c.inquiries}</td><td>{c.registered}</td></tr>)}</tbody></table>{!data.channels.length ? <p>선택 월의 유입경로 기록이 없습니다.</p> : null}<h3>광고 효과 측정에 필요한 다음 기록</h3><p>전단지·현수막·엘리베이터별 캠페인, 기간, 비용, 대상 학교·지역, QR·전용 문의 경로, 최초·보조 유입을 함께 기록해야 합니다.</p><Link href="/enrollment">신규 상담에서 확인 →</Link></article></section>
    <section id="knowledge" className={s.panel}><div className={s.sectionTitle}><h2>근거를 연결하는 경영 지식그래프</h2><Link className={s.secondary} href={`/dashboard/management/knowledge?month=${data.month}`}>통합 지식그래프 열기 ↗</Link></div><div className={s.graph} aria-label="경영 지식그래프 연결 구조"><span>MakeEdu 학생 ID</span><b>→</b><span>에이와 학생</span><b>→</b><span>수강 · 반 · 강사</span><b>→</b><span>청구 · 경영 지표</span>{accountingImport ? <><b>←</b><span>ECOUNT 기간 손익</span></> : null}</div><p>원본 ID·기간·산식을 함께 보관합니다. 그래프의 연결은 원인으로 확정된 관계가 아닙니다.</p>
      {aiEnabled ? <AiReviewPanel key={`ai:${data.month}`} month={data.month} metrics={data.metrics} initial={aiReview}/> : null}
    </section>
    <section id="sources" className={s.panel}><h2>데이터 연결 상태</h2><table><thead><tr><th>소스</th><th>상태</th><th>확인 사항</th></tr></thead><tbody>{visibleSources.map(x => <tr key={x.name}><td>{x.name}</td><td>{x.state}{x.updatedAt ? <small>{new Date(x.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small> : null}</td><td>{x.note}</td></tr>)}</tbody></table></section>
    </div>
  </div>;
}

