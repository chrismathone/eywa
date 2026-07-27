import { getStudentProgressAnalytics, type ProgressAnomaly, type TrackAnalytics } from "../server/queries";

// 진도 현황 패널 — 학생 상세 진도 탭 상단. 활성 컨테이너(현행/선행)별 현재위치·진도율·속도·또래 백분위·예측
// + 학생 단위 이상감지 카드. 데이터는 서버 쿼리(순수 analytics 산출). 진도 기록 없으면 안내문.

const TRACK_LABEL: Record<TrackAnalytics["track"], string> = { current: "현행 진도", ahead: "선행 진도" };
const MIN_POOL = 3; // 백분위 표본 최소치(미만이면 "표본 부족")

function fmtSpeed(n: number): string {
  return n > 0 ? `${n.toFixed(1)} 차시/수업일` : "표본 부족";
}

// 라벨은 알림 본문(events-core PROGRESS_ANOMALY_LABEL)과 같은 표현 — 벨에서 보고 온 사람이 같은 말을 봐야 한다.
function anomalyLabel(type: string): string {
  if (type === "jump_error") return "진도 점프";
  if (type === "overlap_error") return "선행·현행 겹침";
  return "진도 이상"; // 미지의 유형이라도 raw enum은 화면에 안 낸다
}

/** 감지 시각 — KST 날짜(전역 규약: 표시 타임존은 Asia/Seoul 고정). */
function fmtDetectedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/**
 * 이상 감지 카드 — 진도 이상 알림(벨)이 착지하는 화면. 유형만 던지지 말고 **무엇이 어떻게 이상한지**를
 * 적는다: 언제 · 어디서 어디로 · 몇 차시. 이게 있어야 어느 보고서의 진도를 고칠지 판단할 수 있다.
 * 위치를 모르면(커리큘럼 범위 밖·미기록) 그 줄만 생략 — 없는 사실을 지어내지 않는다.
 */
function AnomalyCard({ anomalies }: { anomalies: readonly ProgressAnomaly[] }) {
  return (
    <div className="border-danger/25 bg-danger-soft/40 rounded-2xl border p-4">
      <div className="flex items-center gap-2">
        <span className="bg-danger rounded-pill px-2 py-0.5 text-[10px] font-bold text-white">진도 확인 필요</span>
        <p className="text-foreground text-[13px] font-bold">최근 이상 감지 {anomalies.length}건</p>
      </div>
      <ul className="mt-2 space-y-1.5">
        {anomalies.map((a, i) => {
          const move =
            a.from && a.to ? `${a.from.grade} ${a.from.lesson} → ${a.to.grade} ${a.to.lesson}` : null;
          return (
            <li key={i} className="text-text-dim break-keep text-[12px] leading-snug">
              <span className="text-danger font-bold">{anomalyLabel(a.type)}</span>
              <span className="text-text-faint mx-1.5">·</span>
              <span className="num">{fmtDetectedAt(a.at)}</span>
              {move ? (
                <>
                  <span className="text-text-faint mx-1.5">·</span>
                  <span className="text-foreground">{move}</span>
                </>
              ) : null}
              {a.jumpSize != null && a.jumpSize > 0 ? (
                <span className="text-text-faint"> ({a.jumpSize}차시 건너뜀)</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-text-faint mt-2 text-[11px] leading-snug break-keep">
        아래 수업 진도 표에서 해당 날짜의 진도 입력이 맞는지 확인해 주세요. 선행을 시작했거나 교재를 건너뛴
        경우라면 정상입니다.
      </p>
    </div>
  );
}

function TrackCard({ t }: { t: TrackAnalytics }) {
  const top = t.percentile != null && t.poolSize >= MIN_POOL ? Math.max(0, 100 - t.percentile) : null;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
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
      {/* 이상 감지는 트랙 카드보다 위 — 진도 이상 알림을 타고 온 사람이 스크롤 없이 바로 본다. */}
      {data.anomalies.length ? <AnomalyCard anomalies={data.anomalies} /> : null}
      {data.tracks.length === 0 ? (
        <div className="bg-card border-line text-text-faint rounded-2xl border p-6 text-center text-sm">
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
