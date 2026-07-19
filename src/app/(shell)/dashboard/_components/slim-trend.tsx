/**
 * 최근 7일 카드 — **학생 증감(신규/퇴원/순, 전체+과목별)이 주역** + 출석·수납 sparkline 보조.
 * (원장 요청 2026-07-11: 학생 증감을 전체/과목별로 표시 → 슬림 스트립을 비중 있는 카드로 승격.)
 */
import { Sparkline } from "./sparkline";
import { trendDelta } from "@/features/dashboard/metrics";
import type { TrendPoint, EnrollmentChangeSummary, SubjectChange } from "@/features/dashboard/server/queries";
import type { SubjectMaps } from "@/features/owner/subjects";

export function SlimTrend({
  data,
  change,
  subjects,
  visible,
}: {
  data: TrendPoint[];
  change: EnrollmentChangeSummary;
  subjects: SubjectMaps;
  visible: { attendance: boolean; billing: boolean; enrollment: boolean };
}) {
  const panelCount = Number(visible.enrollment) + Number(visible.attendance) + Number(visible.billing);
  if (panelCount === 0) return null;
  if (data.length === 0 && (!visible.enrollment || (change.newCount === 0 && change.withdrawnCount === 0))) return null;
  const attendance = data.map((point) => ({ date: point.date, value: point.attendance }));
  const payment = data.map((point) => ({ date: point.date, value: point.payment }));
  const range = data.length ? `${data[0].date} – ${data[data.length - 1].date}` : `최근 ${change.days}일`;
  const panelGrid =
    panelCount >= 3 ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]" : panelCount === 2 ? "lg:grid-cols-2" : "grid-cols-1";

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-primary text-[11px] font-semibold">최근 추세</p>
          <h2 className="text-foreground mt-0.5 text-[15px] font-bold">학원 펄스</h2>
        </div>
        <span className="text-text-dim text-[11px]">최근 {change.days}일 · {range}</span>
      </header>
      {/* 전체 폭을 3개 지표 패널로 채운다(우측 빈 공간 제거): 학생증감(1.5fr) + 출석률·수납률(각 1fr).
          items-stretch로 세 패널 높이 일치, 트렌드 패널의 sparkline이 flex-1로 커져 높이를 채운다.
          트렌드 데이터가 없으면(초기) 학생증감만 전폭. */}
      {data.length > 0 ? (
        <div className={`grid gap-4 lg:items-stretch ${panelGrid}`}>
          {visible.enrollment ? <StudentChange change={change} subjects={subjects} /> : null}
          {visible.attendance ? <TrendRow label="출석률" points={attendance} colorVar="--color-chart-2" /> : null}
          {visible.billing ? <TrendRow label="수납률" points={payment} colorVar="--color-chart-3" /> : null}
        </div>
      ) : (
        visible.enrollment ? <StudentChange change={change} subjects={subjects} /> : null
      )}
    </section>
  );
}

/** 학생 증감 — 신규/퇴원/순 큰 숫자 + 과목별 칩(라벨은 학원설정 한글, raw 키 금지). */
function StudentChange({ change, subjects }: { change: EnrollmentChangeSummary; subjects: SubjectMaps }) {
  const { newCount, withdrawnCount, net, bySubject } = change;
  const netTone = net > 0 ? "text-primary" : net < 0 ? "text-danger" : "text-text-dim";
  const noChange = newCount === 0 && withdrawnCount === 0;
  return (
    <div className="border-line flex h-full flex-col rounded-xl border px-4 py-3">
      <span className="text-text-faint text-[11px] font-medium">학생 증감</span>
      {noChange ? (
        <div className="text-text-dim mt-2 flex flex-1 items-center text-[12px]">최근 {change.days}일 변동 없음</div>
      ) : (
        <>
          <div className="mt-1.5 flex items-end gap-4">
            <div>
              <span className="text-text-dim text-[11px]">신규</span>{" "}
              <span className="num text-primary text-[18px] font-extrabold">+{newCount}</span>
            </div>
            <div>
              <span className="text-text-dim text-[11px]">퇴원</span>{" "}
              <span className="num text-danger text-[18px] font-extrabold">−{withdrawnCount}</span>
            </div>
            <div className="ml-auto text-right">
              <span className="text-text-dim text-[11px]">순증감</span>{" "}
              <span className={`num text-[22px] font-extrabold ${netTone}`}>
                {net > 0 ? "+" : net < 0 ? "−" : ""}
                {Math.abs(net)}
              </span>
            </div>
          </div>
          {bySubject.length > 0 ? <SubjectChangeChart bySubject={bySubject} subjects={subjects} /> : null}
        </>
      )}
    </div>
  );
}

/** 과목별 증감 발산형 막대 — 퇴원(왼쪽·빨강) ┃ 신규(오른쪽·녹색), 중앙축 기준. 최대값으로 스케일. */
function SubjectChangeChart({
  bySubject,
  subjects,
}: {
  bySubject: SubjectChange[];
  subjects: SubjectMaps;
}) {
  const max = Math.max(1, ...bySubject.flatMap((s) => [s.newCount, s.withdrawnCount]));
  return (
    <div className="border-line mt-2 flex flex-col gap-1.5 border-t pt-2.5">
      <div className="text-text-faint mb-0.5 flex items-center text-[9px]">
        <span className="flex-1 text-right">← 퇴원</span>
        <span className="mx-2 w-8 shrink-0" />
        <span className="flex-1">신규 →</span>
      </div>
      {bySubject.map((s) => (
        <div key={s.subject} className="flex items-center gap-1 text-[10px]">
          {/* 퇴원: 숫자 + 빨강 막대(오른쪽 정렬 = 중앙축 쪽으로 자람) */}
          <span className="text-danger num w-7 shrink-0 text-right">{s.withdrawnCount ? `−${s.withdrawnCount}` : ""}</span>
          <div className="flex flex-1 justify-end">
            <div
              className="bg-danger/75 h-2.5 rounded-l-[2px]"
              style={{ width: `${(s.withdrawnCount / max) * 100}%` }}
              title={`${subjects.labelOf(s.subject)} 퇴원 ${s.withdrawnCount}`}
            />
          </div>
          {/* 중앙 라벨 축 */}
          <span className="text-text-dim w-8 shrink-0 text-center font-medium">{subjects.labelOf(s.subject)}</span>
          {/* 신규: 녹색 막대(왼쪽 정렬 = 중앙축에서 자람) + 숫자 */}
          <div className="flex flex-1">
            <div
              className="bg-primary h-2.5 rounded-r-[2px]"
              style={{ width: `${(s.newCount / max) * 100}%` }}
              title={`${subjects.labelOf(s.subject)} 신규 ${s.newCount}`}
            />
          </div>
          <span className="text-primary num w-7 shrink-0">{s.newCount ? `+${s.newCount}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function TrendRow({
  label,
  points,
  colorVar,
}: {
  label: string;
  points: Array<{ date: string; value: number | null }>;
  colorVar: string;
}) {
  // null은 원천 행 없음, 0은 실제 0%다. Sparkline에는 null 위치를 그대로 넘겨 결측 구간을 잇지 않는다.
  const values = points.map((point) => point.value);
  const recordedValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const hasData = recordedValues.length > 0;
  const last = recordedValues[recordedValues.length - 1] ?? 0;
  const delta = trendDelta(recordedValues);
  const deltaText = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt`;
  const lastRecordedIndex = points.findLastIndex(
    (point) => point.value !== null && Number.isFinite(point.value),
  );
  const asOf =
    lastRecordedIndex >= 0 && lastRecordedIndex < points.length - 1
      ? `${points[lastRecordedIndex].date} 기준`
      : null;
  const accessibleSummary = points
    .map((point) => `${point.date} ${point.value === null ? "데이터 없음" : `${point.value}%`}`)
    .join(", ");
  return (
    // 세로 패널: 라벨·증감 → 큰 값 → sparkline(flex-1로 남은 높이 채움). 전폭 3패널에서 옆 학생증감과 높이 맞춤.
    <div className="border-line relative flex flex-col rounded-xl border px-3 py-2.5">
      {/* relative 필수 — sr-only는 absolute라 positioned 부모가 없으면 main의 클리핑을 뚫고 문서를 늘린다(gotchas #79). */}
      <p className="sr-only">{label} 날짜별 값: {accessibleSummary}</p>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium" style={{ color: `var(${colorVar})` }}>
          {label}
        </span>
        {hasData ? (
          <span className={`shrink-0 font-mono text-[10px] ${delta >= 0 ? "text-primary" : "text-danger"}`}>
            {deltaText}
          </span>
        ) : null}
      </div>
      {hasData ? (
        <>
          <div className="num text-foreground mt-0.5 text-[20px] font-extrabold leading-none">
            {Math.round(last)}
            <span className="text-text-dim text-[12px] font-medium">%</span>
          </div>
          {asOf ? <div className="text-text-faint mt-1 font-mono text-[10px]">{asOf}</div> : null}
          {/* absolute: SVG를 흐름에서 빼 종횡비 높이 부풀림 차단 → 패널 높이는 옆 학생증감이 결정(컴팩트). */}
          <div className="relative mt-2 min-h-[40px] flex-1">
            <div className="absolute inset-0">
              <Sparkline data={values} colorVar={colorVar} height={44} strokeWidth={2} />
            </div>
          </div>
        </>
      ) : (
        <div className="text-text-dim mt-2 flex min-h-[40px] flex-1 items-center justify-center text-center text-[11px]">
          최근 7일 데이터가 아직 없습니다
        </div>
      )}
    </div>
  );
}
