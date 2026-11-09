import { accountingTotals, periodBounds, revenueBridge, type AccountingLine, type InvoiceSummary, type ManagementSnapshot, type Metric, type StoredReport } from "./model";
import { reportedFinancialView, type ReportedFinancials } from "./reported-financials";
import type { ReviewBatch } from "./reviews";

/**
 * 경영 분석 시안의 예시 값 — 🔴 DB를 읽지 않는다(이 화면이 쓰던 management_* 표가 이 DB에 없다).
 * 이름·숫자는 지어낸 값이다. 달마다 조금씩 달라지게 월 번호로 결정적으로 만든다(새로고침해도 같다).
 */
export const SAMPLE_MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"] as const;
export const SAMPLE_DEFAULT_MONTH = "2026-10";
const CLOSED_THROUGH = "2026-10";

const hash = (seed: string) => Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(seed.charCodeAt(i % seed.length) * (i + 7)) % 16]).join("");
const round = (n: number, unit = 10_000) => Math.round(n / unit) * unit;

const TEACHERS = [
  { id: "t-kimhaneul", label: "김하늘", students: 58, courses: 71 },
  { id: "t-leedoyun", label: "이도윤", students: 52, courses: 60 },
  { id: "t-parkseojun", label: "박서준", students: 47, courses: 55 },
  { id: "t-choiyuna", label: "최유나", students: 44, courses: 49 },
  { id: "t-jungminho", label: "정민호", students: 39, courses: 43 },
  { id: "t-hanjiwoo", label: "한지우", students: 33, courses: 36 },
  { id: "t-ohserin", label: "오세린", students: 27, courses: 29 },
  { id: "t-yoontaeo", label: "윤태오", students: 18, courses: 19 },
];
const CHANNELS = [
  { label: "지인 소개", inquiries: 14, registered: 9 },
  { label: "학원 설명회", inquiries: 6, registered: 4 },
  { label: "블로그", inquiries: 8, registered: 3 },
  { label: "전단지", inquiries: 5, registered: 1 },
  { label: "아파트 현수막", inquiries: 3, registered: 1 },
  { label: "유입경로 미기재", inquiries: 4, registered: 1 },
];

function summary(students: number, perStudent: number, paidRatio: number): InvoiceSummary {
  const net = round(students * perStudent), discount = round(net * 0.06), gross = net + discount, collected = round(net * paidRatio);
  return { count: Math.round(students * 1.3), gross, discount, net, collected, outstanding: net - collected, students, perStudent: net / students };
}

function ledgerLines(f: number): AccountingLine[] {
  const rows: [string, AccountingLine["category"], number][] = [
    ["수강료수입", "revenue", 148_900_000], ["임대수입", "revenue", 3_500_000],
    ["강사 급여", "labor", 38_200_000], ["경영팀 급여", "labor", 9_600_000], ["아르바이트 급여", "labor", 4_100_000],
    ["임원 급여", "labor", 6_000_000], ["퇴직급여", "labor", 2_300_000], ["4대 보험료", "labor", 4_450_000], ["복리후생비", "labor", 1_180_000],
    ["광고선전비", "marketing", 3_200_000], ["지급임차료", "rent", 18_500_000],
    ["차량유지비(할부 포함)", "operating", 4_870_000], ["교재·소모품비", "operating", 11_240_000], ["수도광열비", "operating", 3_960_000],
    ["지급수수료", "operating", 6_150_000], ["감가상각비", "operating", 5_400_000], ["기타 운영비", "operating", 9_800_000],
    ["이자비용", "nonoperating", 1_870_000],
  ];
  return rows.map(([account, category, amount], i) => ({ key: `row-${i + 1}`, account, category, amount: round(amount * f), sourceCell: `손익계산서!C${i + 6}` }));
}

function reportFor(month: string, f: number): StoredReport {
  const b = periodBounds(month), lines = ledgerLines(f);
  const sum = (c: string[]) => lines.filter(l => c.includes(l.category)).reduce((s, l) => s + l.amount, 0);
  const revenue = sum(["revenue"]), cost = sum(["labor", "marketing", "rent", "operating"]);
  return {
    id: `report-${month}`, version: 2, updated_at: `${month}-28T09:30:00.000Z`,
    document: {
      company: "(예시) 하늘학원", start: b.start, end: b.end, sourceName: `ECOUNT_월별손익_${month}.xlsx`, sourceHash: hash(`pl-${month}`), lines,
      reportedRevenue: revenue, reportedOperatingCost: cost, reportedOperatingProfit: revenue - cost,
      scopeConfirmed: true, complete: month <= CLOSED_THROUGH, sourceKind: "profit_loss",
    },
  };
}

function financialsFor(month: string, report: StoredReport): ReportedFinancials {
  const t = accountingTotals(report.document), line = (name: string) => report.document.lines.find(l => l.account === name)?.amount ?? 0;
  const nonOperatingCost = line("이자비용"), nonOperatingIncome = round(320_000), profit = t.revenue - t.cost;
  return {
    basis: "ecount_report", company: report.document.company, closedThrough: CLOSED_THROUGH, confirmedAt: `${month}-28T10:00:00.000Z`,
    scopeNote: "임대수입을 포함한 전체 매출 기준입니다. 학원 단독 수익성은 사업별 비용 배부 후 판단합니다.",
    reference: `ECOUNT 월별손익분석 ${month}`, revenue: t.revenue, cost: t.cost, profit, ledgerRevenue: t.revenue, ledgerCost: t.cost,
    nonOperatingIncome, nonOperatingCost, profitBeforeTax: profit + nonOperatingIncome - nonOperatingCost,
    labor: { management: line("경영팀 급여"), partTime: line("아르바이트 급여"), instructors: line("강사 급여"), executives: line("임원 급여"), bonus: 0, retirement: line("퇴직급여"), insurance: line("4대 보험료"), welfare: line("복리후생비") },
    vehicleInstallments: round(1_450_000), vehicleKind: "purchase_principal_and_interest", adjustmentStatus: "pending", costAccountCount: 16, costAccountHash: hash(`cost-${month}`),
  };
}

function batchesFor(month: string, current: InvoiceSummary, financials: ReportedFinancials): ReviewBatch[] {
  const observedAt = `${month}-28T10:00:00.000Z`;
  return [
    {
      id: `batch-ecount-${month}`, source: "ecount", month, created_at: observedAt,
      evidence: {
        source: "ecount", month, sourceName: `ECOUNT_월별손익분석_${month}.xlsx`, sourceHash: hash(`ec-${month}`), comparedHash: hash(`ecc-${month}`), observedAt,
        summary: "보고서 매출·영업비용과 원장 분류 합계가 일치합니다. 차량 할부금의 원금·이자 구분이 남아 있습니다.",
        reportedFinancials: financials,
        facts: [
          { label: "보고서 매출", sourceValue: financials.revenue, aywaValue: financials.ledgerRevenue, unit: "원", reference: "손익계산서 매출 합계" },
          { label: "보고서 영업비용", sourceValue: financials.cost, aywaValue: financials.ledgerCost, unit: "원", reference: "손익계산서 영업비용 합계" },
        ],
        issues: [
          { key: "vehicle-installment", title: "차량 할부금 원금·이자 구분", detail: "차량 구입 원금과 이자가 한 계정에 함께 기재되어 있습니다.", nextAction: "상환명세서로 원금·이자를 나누고 감가상각 내역을 확인합니다." },
        ],
      },
      events: [
        { batch_id: `batch-ecount-${month}`, issue_key: "vehicle-installment", version: 1, status: "waiting", owner: "이도윤", due_date: `${month}-30`, note: "리스사에 상환명세서 요청함. 회신 대기.", created_at: `${month}-28T11:20:00.000Z` },
      ],
    },
    {
      id: `batch-makeedu-${month}`, source: "makeedu", month, created_at: observedAt,
      evidence: {
        source: "makeedu", month, sourceName: `MakeEdu_수납통합내역_${month}.xlsx`, sourceHash: hash(`me-${month}`), comparedHash: hash(`mec-${month}`), observedAt,
        summary: "청구 학생 수와 실청구액이 일치하고, 수납액에서 2명분 차이가 있습니다.",
        facts: [
          { label: "청구 학생 수", sourceValue: current.students, aywaValue: current.students, unit: "명", reference: "학생별 청구 합계" },
          { label: "실청구액", sourceValue: current.net, aywaValue: current.net, unit: "원", reference: "청구액 − 할인" },
          { label: "수납액", sourceValue: current.collected + 640_000, aywaValue: current.collected, unit: "원", reference: "청구월 기준 수납" },
        ],
        issues: [
          { key: "collected-gap", title: "수납액 64만 원 차이", detail: "원본에는 납부로, 에이와에는 미납으로 남은 청구서가 2건 있습니다.", nextAction: "두 학생의 납부일·결제 수단을 원본에서 대조합니다." },
        ],
      },
      events: [],
    },
  ];
}

export function sampleManagement(month: string): ManagementSnapshot {
  const i = Math.max(0, SAMPLE_MONTHS.indexOf(month as typeof SAMPLE_MONTHS[number]));
  const f = 0.94 + i * 0.015, prevF = 0.94 + Math.max(0, i - 1) * 0.015;
  const b = periodBounds(month), asOf = month === "2026-11" ? "2026-11-09" : b.end;
  const current = summary(Math.round(404 * f), 338_000 * (1 + i * 0.004), month === "2026-11" ? 0.71 : 0.97);
  const previous = summary(Math.round(404 * prevF), 338_000 * (1 + Math.max(0, i - 1) * 0.004), 0.98);
  const report = reportFor(month, f), financials = financialsFor(month, report);
  const reviewBatches = batchesFor(month, current, financials), reportedFinancials = reportedFinancialView(reviewBatches, month);
  const accounting = accountingTotals(report.document);
  const active = Math.round(386 * f), dual = Math.round(active * 0.31);
  const metrics: Metric[] = [
    { id: "net_billed", label: "실청구액", value: current.net, unit: "원", definition: "청구월 기준 청구액−할인. 무효 청구 제외. 회계 매출·입금일 현금흐름과 구분", source: "예시 청구 원장", href: "/billing" },
    { id: "collected", label: "해당 청구분 누적 수납", value: current.collected, unit: "원", definition: "선택 월 청구서의 현재까지 수납액. 이번 달 입금 합계가 아님", source: "예시 청구 원장", href: "/billing/stats" },
    { id: "outstanding", label: "미수 잔액", value: current.outstanding, unit: "원", definition: "완납·환불·무효 판정을 적용한 남은 금액", source: "예시 수납관리", href: "/billing" },
    { id: "charged_students", label: "청구 학생 수", value: current.students, unit: "명", definition: "해당 월 양의 실청구가 있는 학생 중복 제거", source: "청구서·학생 ID", href: "/billing/stats" },
    { id: "per_student", label: "청구 학생당 실청구액", value: current.perStudent, unit: "원", definition: "실청구액÷청구 학생 수. 기준일 재원생당 매출과 구분", source: "실청구액·청구 학생 수", href: "/billing/stats" },
    { id: "active_students", label: "기준일 수강 학생", value: active, unit: "명", definition: `${asOf}에 유효한 수강이 있는 학생. 보강용 반·휴강·테스트 학생 제외`, source: "학생·수강·반", href: "/students" },
    { id: "active_courses", label: "기준일 수강 건수", value: Math.round(active * 1.34), unit: "건", definition: "학생별 수강 관계 건수. 개설 반 수와 구분", source: "수강", href: "/timetable" },
    { id: "dual_ratio", label: "영어·수학 동시수강률", value: dual / active * 100, unit: "%", definition: "기준일 영어·수학을 함께 듣는 학생÷기준일 수강 학생", source: "유효 수강 관계", href: "/students/stats" },
    { id: "withdrawals", label: "퇴원 기록 인원", value: 6 + (i % 3), unit: "명", definition: "학생 프로필 퇴원일 기준. 과목 종료·반 이동과 구분", source: "학생 퇴원일", href: "/withdrawals" },
    { id: "withdrawal_rate", label: "월초 수강 집단 퇴원율", value: (5 + (i % 3)) / active * 100, unit: "%", definition: "월초 수강 집단 중 기준일까지 퇴원일이 기록된 비율. 월중 신규생 제외", source: "수강·퇴원일", href: "/withdrawals" },
    { id: "operating_margin", label: "ECOUNT 기재 영업이익률", value: reportedFinancials?.margin ?? null, unit: "%", definition: "보고서 기재 영업손익÷보고서 매출. 마감 월만 계산. 차량 원금·이자 조정 전 수치", source: "ECOUNT 손익계산서", href: `/dashboard/management?month=${month}#accounting` },
    { id: "labor_ratio", label: "보고서 매출 대비 인건비율", value: reportedFinancials?.laborRatio ?? null, unit: "%", definition: "급여·상여·퇴직·복리후생·4대보험 계정 합계÷같은 월 매출. 미마감 월 보류", source: "ECOUNT 원장 계정 분류", href: `/dashboard/management?month=${month}#accounting` },
  ];
  const nodes = [
    { id: "tenant:sample", type: "Academy", label: "(예시) 하늘학원", source: "예시" },
    ...TEACHERS.map(t => ({ id: `teacher:${t.id}`, type: "Instructor", label: t.label, source: "예시" })),
    ...metrics.map(m => ({ id: `metric:${m.id}`, type: "Metric", label: m.label, source: m.source, value: m.value, period: month })),
    ...Array.from({ length: 360 }, (_, n) => ({ id: `student:s${n}`, type: "Student", label: `학생 ${n + 1}`, source: "예시" })),
  ];
  return {
    month, asOf, observedAt: `${asOf}T09:00:00.000Z`, metrics, current, previous, bridge: revenueBridge(previous, current),
    reports: [report], accounting, reportedFinancials,
    teachers: TEACHERS.map(t => ({ ...t, students: Math.round(t.students * f), courses: Math.round(t.courses * f) })),
    channels: CHANNELS.map(c => ({ ...c, inquiries: c.inquiries + (i % 2), registered: c.registered })),
    graph: { schemaVersion: "aywa-management-v1", observedAt: `${asOf}T09:00:00.000Z`, nodes, edges: Array.from({ length: 1240 + i * 30 }, (_, n) => ({ from: "tenant:sample", relation: "measured_by", to: nodes[n % nodes.length]!.id, basis: "예시" })) },
    reviewBatches,
    sources: [
      { name: "MakeEdu", state: "이관 자료 조회", updatedAt: `${asOf}T06:10:00.000Z`, note: "표시 시각은 원본에서 마지막 수집된 시각이며 실시간 동기화가 아닙니다" },
      { name: "ECOUNT", state: "1개 기간 · 대사 검토 0개", updatedAt: report.updated_at, note: "손익 엑셀·원장 CSV의 파일명·기간·계정 금액을 보관합니다" },
      { name: "에이와 수업·상담", state: "현재 기록 조회", updatedAt: `${asOf}T09:00:00.000Z`, note: "기존 업무 기록과 원본 ID로 연결합니다" },
      { name: "Drive · Notion · Slack", state: "연결 범위 설정 필요", updatedAt: null, note: "대상 폴더·채널을 정한 뒤 읽기 전용으로 수집합니다" },
    ],
  };
}
