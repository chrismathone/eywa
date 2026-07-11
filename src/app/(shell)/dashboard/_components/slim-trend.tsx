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
}: {
  data: TrendPoint[];
  change: EnrollmentChangeSummary;
  subjects: SubjectMaps;
}) {
  if (data.length === 0 && change.newCount === 0 && change.withdrawnCount === 0) return null;
  const attendance = data.map((p) => p.attendance);
  const payment = data.map((p) => p.payment);
  const range = data.length ? `${data[0].date} – ${data[data.length - 1].date}` : `최근 ${change.days}일`;

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-foreground text-[15px] font-bold">최근 {change.days}일</h2>
        <span className="text-text-faint font-mono text-[10px]">{range}</span>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-stretch">
        <StudentChange change={change} subjects={subjects} />
        {data.length > 0 ? (
          <div className="grid content-center gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <TrendRow label="출석률" values={attendance} colorVar="--color-chart-2" />
            <TrendRow label="수납률" values={payment} colorVar="--color-chart-3" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** 학생 증감 — 신규/퇴원/순 큰 숫자 + 과목별 칩(라벨은 학원설정 한글, raw 키 금지). */
function StudentChange({ change, subjects }: { change: EnrollmentChangeSummary; subjects: SubjectMaps }) {
  const { newCount, withdrawnCount, net, bySubject } = change;
  const netTone = net > 0 ? "text-primary" : net < 0 ? "text-danger" : "text-text-dim";
  const noChange = newCount === 0 && withdrawnCount === 0;
  return (
    <div className="border-line flex flex-col rounded-xl border px-4 py-3">
      <span className="text-text-faint font-mono text-[10px] tracking-wider uppercase">학생 증감</span>
      {noChange ? (
        <div className="text-text-faint mt-2 flex flex-1 items-center text-[12px]">최근 {change.days}일 변동 없음</div>
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

function TrendRow({ label, values, colorVar }: { label: string; values: number[]; colorVar: string }) {
  // 창에 실데이터가 없으면(전부 0) 가짜 "0% 평탄선" 대신 정직하게 '기록 없음'.
  const hasData = values.some((v) => v > 0);
  const last = values[values.length - 1] ?? 0;
  const delta = trendDelta(values);
  const deltaText = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt`;
  return (
    <div className="border-line flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <div className="w-[52px] shrink-0">
        <div className="font-mono text-[10px] tracking-wider uppercase" style={{ color: `var(${colorVar})` }}>
          {label}
        </div>
        {hasData ? (
          <div className="num text-foreground text-[18px] font-extrabold leading-none">
            {Math.round(last)}
            <span className="text-text-dim text-[11px] font-medium">%</span>
          </div>
        ) : (
          <div className="text-text-faint text-[11px] leading-none">기록 없음</div>
        )}
      </div>
      {hasData ? (
        <>
          <div className="h-9 flex-1">
            <Sparkline data={values} colorVar={colorVar} height={36} strokeWidth={2} />
          </div>
          <span className={`shrink-0 font-mono text-[10px] ${delta >= 0 ? "text-primary" : "text-danger"}`}>
            {deltaText}
          </span>
        </>
      ) : (
        <div className="text-text-faint flex h-9 flex-1 items-center text-[11px]">최근 7일 데이터가 아직 없습니다</div>
      )}
    </div>
  );
}
