"use client";

import { paymentRateDisplay } from "@/features/billing/calc";
import { processingSummary, startedNote } from "@/features/dashboard/overview/model";
import { careDue, careStages, composition, earlyMonthly } from "@/features/dashboard/instruments/derive";
import { MIX_SERIES, MIX_TONES, monthNo, num, percent, subjectStyle, yyMm } from "@/features/dashboard/instruments/labels";
import { onMonths } from "@/features/dashboard/instruments/details-shared";
import { EXIT_BASIS_TAG } from "@/features/withdrawals/exit-basis";
import { V } from "./engine";
import { Card, ChartTools, GaugeStats, Headline, PANEL_H, Stat, StatRow, VizSlot, useBoard, type TrendId } from "./parts";

const compose = { series: [...MIX_SERIES, "기타 과목", "미수강"], tones: [...MIX_TONES, "m-gray", "m-l1"] };
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))}`;

/** 탭에 세울 과목 이름 — 값이 있는 과목만. */
function useTabs(id: TrendId, compare: boolean) {
  const { extras } = useBoard();
  const source = { changes: extras.changes, billing: extras.billing, enrolledTrend: extras.enrolled, courseTrend: extras.courses }[id];
  if (!source) return { tabs: ["전체"], keyOf: () => null as string | null };
  const lines = extras.subjects.filter((s) => source[s.key]);
  return {
    tabs: ["전체", ...lines.map((s) => s.label), ...(compare && lines.length ? ["비교"] : [])],
    keyOf: (label: string) => lines.find((s) => s.label === label)?.key ?? null,
  };
}

export function StudentsCompCard() {
  const { v, title } = useBoard();
  const s = v.students?.data;
  const c = s ? composition(s) : null;
  return (
    <Card id="studentsComp" title={title("studentsComp", "재원생 구성")} note="현재 · 초·중·고 · 영어·동시수강·수학" sections={[v.students]} value={c ? { label: "전체 재원생", num: num(c.total), unit: "명" } : undefined}>
      {c ? <VizSlot h={PANEL_H} draw={(w, h) => V.stackRows(w, h, { rows: c.rows, ...compose, unit: "명", legendCount: 3, title: "재원생 구성" })} /> : null}
    </Card>
  );
}

export function AttendanceCard() {
  const { v, title } = useBoard();
  const a = v.attendance?.data;
  const holiday = v.holidayAttendance?.data ?? null;
  const p = v.processing?.data ? processingSummary(v.processing.data) : null;
  const parts: [string, number][] = a ? [["출석", a.present], ["결석", a.absent], ["지각", a.late], ["사유", a.excused], ["보강·조퇴", Math.max(0, a.total - a.present - a.absent - a.late - a.excused)]] : [];
  const left = p ? Math.max(0, p.expected - p.recorded) : 0;
  return (
    <Card id="attendance" title={title("attendance", "출결 현황")} note="오늘 · 학생·반·교시별 출결 칸" sections={[v.attendance, v.processing, v.holidayAttendance]}>
      {a && a.total > 0
        ? <VizSlot h={124} draw={(w, h) => V.ring(w, h, { parts, tones: ["m-char", "m-red", "m-yellow", "m-l2", "m-l1"], center: "출결 기록", unit: "칸", title: "오늘 출결" })} />
        : <p className="foot">{v.attendance?.error ? "출결 조회 실패" : holiday ? "휴원일 — 오늘 입력된 출결이 없습니다." : "오늘 출결 기록이 아직 없습니다."}</p>}
      {holiday ? (
        <StatRow>
          <Stat label="휴원일" value={holiday.name} />
          {holiday.counts ? <Stat label="입력된 출결" value={`${num(holiday.counts.students)}명 · ${num(holiday.counts.classes)}반`} /> : <Stat label="입력 현황" value="불러오지 못함" />}
        </StatRow>
      ) : p ? (
        <>
          <StatRow><Stat label="예정학생 미처리" value={`${num(left)}건`} /><Stat label="입력 중" value={`${num(p.partial)}반`} /></StatRow>
          <VizSlot h={12} draw={(w, h) => V.thinBar(w, h, { parts: [["기록", p.recorded], ["미처리", left]], tones: ["m-char", "m-pale"], unit: "건", title: "오늘 출결 입력" })} />
        </>
      ) : null}
    </Card>
  );
}

export function BillingMonthCard() {
  const { v, title, amounts, snapshot } = useBoard();
  const bill = v.billing?.data?.at(-1);
  const month = monthNo(snapshot.today);
  const rate = bill ? (amounts ? Math.round(Number(paymentRateDisplay(bill.paymentRate, bill.outstanding))) : percent(bill.paidCount, bill.totalCount)) : 0;
  const open = bill ? bill.unpaidCount + bill.partialCount : 0;
  return (
    <Card id="billingMonth" title={title("billingMonth", `${month}월 수납 현황`)} note="이번 달 청구서 · 취소 청구 제외" sections={[v.billing]}>
      {bill ? (
        <div className="gauge-card">
          <VizSlot h={PANEL_H} className="gauge-slot" draw={(w, h) => V.gauge(w, h, { value: rate, label: amounts ? "수납률" : "완납 비율", caption: amounts ? "수납률" : "완납 비율" })} />
          <GaugeStats rows={[["완납", `${num(bill.paidCount)}건`], ["부분납", `${num(bill.partialCount)}건`], ["미납", `${num(bill.unpaidCount)}건`, bill.unpaidCount > 0],
            amounts ? ["미수 잔액", V.money(bill.outstanding), bill.outstanding > 0] : ["미납·부분납 건수", `${num(open)}건`, open > 0]]} />
        </div>
      ) : null}
    </Card>
  );
}

export function NewcomerStagesCard() {
  const { v, title } = useBoard();
  const care = v.newcomers?.data;
  const rows = care ? careStages(care) : [];
  const due = care ? careDue(care) : null;
  return (
    <Card id="newcomerStages" title={title("newcomerStages", "신규생 단계별 관리")} note="등록 후 90일 · 재원·휴원 학생" sections={[v.newcomers]}>
      {care ? <VizSlot h={132} draw={(w, h) => V.stackRows(w, h, { rows, series: [...MIX_SERIES, "그 외"], tones: [...MIX_TONES, "m-gray"], unit: "명", title: "신규생 단계" })} /> : null}
      {care?.checksAvailable && due ? <StatRow><Stat label="기한 경과" value={`${num(due.overdue)}건`} alert /><Stat label="3일 내 기한" value={`${num(due.due)}건`} /></StatRow> : care ? <p className="foot">체크리스트를 불러오지 못했습니다.</p> : null}
    </Card>
  );
}

export function ChangesCard() {
  const { v, title, picks, kinds, snapshot, extras } = useBoard();
  const change = v.changes?.data;
  const { tabs, keyOf } = useTabs("changes", true);
  const keys = change?.map((r) => r.month) ?? [];
  const key = keyOf(picks.changes);
  const row = key ? extras.changes?.[key] : null;
  const enrolled = row ? onMonths(keys, row.enrolled) : (change?.map((r) => r.enrolled) ?? []);
  const withdrawn = row ? onMonths(keys, row.withdrawn) : (change?.map((r) => r.withdrawn) ?? []);
  const delta = (enrolled.at(-1) ?? 0) - (withdrawn.at(-1) ?? 0);
  const started = change ? startedNote(change) : null;
  // 비교 = 과목마다 순증 한 선. 등록·퇴원 두 막대를 과목 수만큼 세우면 읽을 수 없다.
  const compare = picks.changes === "비교";
  const lines = extras.subjects.filter((s) => extras.changes?.[s.key]);
  const netOf = (key: string, month: string) => { const r = extras.changes![key]!; return (r.enrolled[month] ?? 0) - (r.withdrawn[month] ?? 0); };
  const series = compare
    ? lines.map((s, i) => ({ name: s.label, values: keys.map((m) => netOf(s.key, m)), ...subjectStyle(s.key, i) }))
    : [{ name: "등록", values: enrolled, tone: "m-yellow", stroke: "stroke-yellow" }, { name: "퇴원", values: withdrawn, tone: "m-char" }];
  return (
    <Card id="changes" cls="span-2" title={title("changes", "등록 · 퇴원 추이")} note={`최근 6개월 · 당월은 오늘까지 · 퇴원은 ${EXIT_BASIS_TAG}${started ? ` · ${started}` : ""}`} sections={[v.changes]} tools={<ChartTools id="changes" tabs={tabs} lineOnly={compare} />}>
      {change ? (
        <>
          <Headline key={picks.changes} label={`${monthNo(snapshot.today)}월 순증${key ? ` · ${picks.changes}` : ""}`} value={`${signed(delta)}명`} alert={delta < 0} note={compare ? lines.map((s) => `${s.label} ${signed(netOf(s.key, keys.at(-1) ?? ""))}명`).join(" · ") : undefined} />
          <VizSlot h={154} draw={(w, h) => V.trend(w, h, { labels: keys.map(yyMm), series, unit: "명", valueLabels: "all", title: compare ? "과목별 순증" : "등록·퇴원 추이", kind: compare ? "line" : kinds.changes })} />
        </>
      ) : null}
    </Card>
  );
}

export function Billing6Card() {
  const { v, title, picks, kinds, snapshot, extras } = useBoard();
  const billing = v.billing?.data;
  const { tabs, keyOf } = useTabs("billing", true);
  if (!billing || billing.length < 2) return null;
  const keys = billing.map((r) => r.period);
  const net = billing.map((r) => r.totalBilled - r.totalDiscount);
  const bill = billing.at(-1)!;
  const key = keyOf(picks.billing);
  const values = key ? onMonths(keys, extras.billing?.[key] ?? {}) : net;
  const netNow = net.at(-1) ?? 0;
  const pickNow = values.at(-1) ?? 0;
  const compare = picks.billing === "비교";
  const lines = extras.subjects.filter((s) => extras.billing?.[s.key]);
  const series = compare
    ? lines.map((s, i) => ({ name: s.label, values: onMonths(keys, extras.billing![s.key]!), ...subjectStyle(s.key, i) }))
    : [{ name: "실청구", values, tone: "m-char" }];
  return (
    <Card id="billing6" cls="span-2" title={title("billing6", "6개월 청구 · 수납")} note="최근 6개월 · 청구월 기준 실청구액(청구 − 할인)" sections={[v.billing]} tools={<ChartTools id="billing" tabs={tabs} />}>
      <Headline key={picks.billing} label={`${monthNo(snapshot.today)}월 실청구${key ? ` · ${picks.billing}` : ""}`} value={V.money(compare ? netNow : pickNow)}
        note={compare ? lines.map((s) => `${s.label} ${V.money(extras.billing![s.key]![keys.at(-1) ?? ""] ?? 0)}`).join(" · ") : key ? `전체 ${V.money(netNow)}의 ${percent(pickNow, netNow)}%` : `수납 ${V.money(bill.totalCollected)} · 수납률 ${paymentRateDisplay(bill.paymentRate, bill.outstanding)}%`} />
      <VizSlot h={154} draw={(w, h) => V.trend(w, h, { labels: keys.map(yyMm), series, format: V.money, valueLabels: "all", title: "6개월 실청구", kind: kinds.billing })} />
    </Card>
  );
}

/** 달마다 막대 — 월초에도 지난달 값이 보인다. 이번 달 칸 = 머리 숫자. */
export function EarlyExitsCard() {
  const { v, title } = useBoard();
  const data = v.earlyExits?.data;
  const monthly = data ? earlyMonthly(data) : [];
  return (
    <Card id="earlyExits" title={title("earlyExits", "등록 후 3개월 내 퇴원")} note={`최근 6개월 · 등록일부터 90일 안에 퇴원 · 퇴원은 ${EXIT_BASIS_TAG}`} sections={[v.earlyExits]} value={data ? { label: "이번 달", num: num(monthly.at(-1)?.count ?? 0), unit: "명" } : undefined}>
      {data ? <VizSlot h={154} draw={(w, h) => V.trend(w, h, { labels: monthly.map((m) => yyMm(m.month)), series: [{ name: "3개월 내 퇴원", values: monthly.map((m) => m.count), tone: "m-char" }], unit: "명", kind: "bar", valueLabels: "all", title: "달마다 3개월 내 퇴원" })} /> : null}
    </Card>
  );
}

/** 재원생·강좌수 추이 — 구분·탭·모양이 같아야 해서 한 부품이다. */
function TrendCard({ id, base, unit, name, sectionKey, by }: { id: "enrolledTrend" | "courseTrend"; base: string; unit: string; name: string; sectionKey: "enrolledTrend" | "courseTrend"; by: "enrolled" | "courses" }) {
  const board = useBoard();
  const { v, title, picks, kinds, extras } = board;
  const section = v[sectionKey];
  const data = section?.data;
  const { tabs, keyOf } = useTabs(id, true);
  if (section && section.data === null && section.at !== null) return null; // 강사 범위 — 운영실과 같은 숨김
  const points = data?.monthly ?? [];
  const keys = points.map((p) => p.key);
  const total = points.map((p) => p.count);
  const pick = picks[id];
  const key = keyOf(pick);
  const lines = extras.subjects.filter((s) => extras[by]?.[s.key]);
  const series = pick === "비교"
    ? lines.map((s, i) => ({ name: s.label, values: onMonths(keys, extras[by]![s.key]!), ...subjectStyle(s.key, i) }))
    : [{ name, values: key ? onMonths(keys, extras[by]?.[key] ?? {}) : total, tone: "m-char" }];
  const now = total.at(-1) ?? 0;
  const pickNow = key ? (series[0]?.values.at(-1) ?? 0) : now;
  const yearly = data?.yearly.map((y, i, all) => `${y.label}${i === all.length - 1 ? "(오늘)" : " 말"} ${num(y.count)}${unit}`).join(" · ");
  const compareNote = lines.map((s) => `${s.label} ${num(extras[by]?.[s.key]?.[keys.at(-1) ?? ""] ?? 0)}${unit}`).join(" · ");
  const ym = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
  const history = data && "historyFrom" in data ? data.historyFrom : null;
  const from = history ? `${ym(history)}부터(앞쪽은 지난 기록)` : data?.monthlyFrom ? `${ym(data.monthlyFrom)}부터` : "최근 12개월";
  return (
    <Card id={id} cls={id === "enrolledTrend" ? "span-full xl-3" : "span-full"} title={title(id, base)} note={`${from} · 달마다 말일 기준(이번 달은 오늘) · ${id === "enrolledTrend" ? `휴원 제외 · 퇴원은 ${EXIT_BASIS_TAG}` : "학생마다 같은 과목은 1개"}`} sections={[section]} tools={<ChartTools id={id} tabs={tabs} />}>
      {data ? (
        <>
          <Headline key={pick} label={`오늘 ${name}${key ? ` · ${pick}` : ""}`} value={`${num(pickNow)}${unit}`} note={pick === "비교" ? compareNote : key ? `전체 ${num(now)}${unit} 중 ${percent(pickNow, now)}%` : yearly} />
          <VizSlot h={176} draw={(w, h) => V.trend(w, h, { labels: keys.map(yyMm), series, unit, valueLabels: "all", title: base, kind: kinds[id] })} />
        </>
      ) : null}
    </Card>
  );
}

export const EnrolledTrendCard = () => <TrendCard id="enrolledTrend" base="재원생 추이" unit="명" name="재원생" sectionKey="enrolledTrend" by="enrolled" />;
export const CourseTrendCard = () => <TrendCard id="courseTrend" base="강좌수 추이" unit="개" name="강좌수" sectionKey="courseTrend" by="courses" />;
