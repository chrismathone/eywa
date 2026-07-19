import { getStudentProgressAnalytics, type TrackAnalytics } from "../server/queries";

// 진도 현황 패널 — 학생 상세 진도 탭 상단. 활성 컨테이너(현행/선행)별 현재위치·진도율·속도·또래 백분위·예측·이상감지.
// 데이터는 서버 쿼리(순수 analytics 산출). 진도 기록 없으면 안내문.

const TRACK_LABEL: Record<TrackAnalytics["track"], string> = { current: "현행 진도", ahead: "선행 진도" };
const MIN_POOL = 3; // 백분위 표본 최소치(미만이면 "표본 부족")

function fmtSpeed(n: number): string {
  return n > 0 ? `${n.toFixed(1)} 차시/수업일` : "표본 부족";
}

function anomalyLabel(type: string): string {
  if (type === "jump_error") return "진도 점프 감지";
  if (type === "overlap_error") return "선행·현행 겹침";
  return type;
}

function TrackCard({ t }: { t: TrackAnalytics }) {
  const top = t.percentile != null && t.poolSize >= MIN_POOL ? Math.max(0, 100 - t.percentile) : null;
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${
              t.track === "ahead" ? "bg-amber-soft text-amber" : "bg-primary-soft text-primary"
            }`}
          >
            {TRACK_LABEL[t.track]}
          </span>
          {t.gradeScope ? <span className="text-text-faint text-[11px]">{t.gradeScope}</span> : null}
        </div>
        <span className="text-text-faint text-[11px]">{t.chapterCount}개 기록</span>
      </div>

      {/* 현재 위치 */}
      {t.current ? (
        <div className="mb-3">
          <p className="text-text-faint text-[11px]">현재 위치</p>
          <p className="text-foreground text-[15px] font-bold">
            {t.current.grade} · {t.current.lesson}
          </p>
          <p className="text-text-faint text-[11px]">{t.current.unit}</p>
          <div className="bg-bg-soft relative mt-1.5 h-1.5 w-full overflow-hidden rounded-pill">
            <div className="bg-primary absolute inset-y-0 left-0 rounded-pill" style={{ width: `${t.progressPct}%` }} />
          </div>
          <p className="text-text-faint mt-0.5 text-[10px]">전체 커리큘럼의 {t.progressPct}%</p>
        </div>
      ) : null}

      {/* 지표 3셀 */}
      <div className="border-line grid grid-cols-3 divide-x rounded-md border text-center">
        <div className="px-2 py-2">
          <p className="text-text-faint text-[10px]">수업당 속도</p>
          <p className="text-foreground text-[13px] font-bold">{fmtSpeed(t.speedPerLessonDay)}</p>
        </div>
        <div className="px-2 py-2">
          <p className="text-text-faint text-[10px]">또래 대비</p>
          <p className="text-primary text-[13px] font-bold">
            {top != null ? `상위 ${top}%` : "표본 부족"}
          </p>
        </div>
        <div className="px-2 py-2">
          <p className="text-text-faint text-[10px]">90일 예측</p>
          <p className="text-foreground text-[13px] font-bold">
            {t.predictions.find((p) => p.days === 90)?.grade || "—"}
          </p>
        </div>
      </div>

      {/* 예측 상세 */}
      {t.predictions.length ? (
        <div className="text-text-dim mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {t.predictions.map((p) => (
            <span key={p.days}>
              {p.days}일 후 <b className="text-foreground">{p.grade}</b> {p.lesson}
            </span>
          ))}
        </div>
      ) : null}

      {/* 이상 감지 */}
      {t.anomalies.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {t.anomalies.map((a, i) => (
            <span key={i} className="bg-danger rounded-pill px-2 py-0.5 text-[10px] font-bold text-white">
              {anomalyLabel(a.type)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export async function ProgressContainerPanel({ studentId }: { studentId: string }) {
  const data = await getStudentProgressAnalytics(studentId);

  return (
    <div className="space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-foreground text-base font-bold">진도 분석</h2>
        <p className="text-text-faint text-[11px]">원스크린 진도 기록 기반 자동 산출</p>
      </header>
      {data.tracks.length === 0 ? (
        <div className="bg-card border-line text-text-faint rounded-md border p-6 text-center text-sm">
          아직 진도 기록이 없습니다. 원스크린에서 진도를 입력·저장하면 자동으로 분석됩니다.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.tracks.map((t) => (
            <TrackCard key={t.track} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
