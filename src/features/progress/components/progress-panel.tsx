import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { teacherOwnsStudent } from "@/features/onescreen/server/scope";
import { canResolveProgressAnomaly } from "../anomaly-gate";
import { getStudentProgressAnalytics, type ProgressAnomaly, type TrackAnalytics } from "../server/queries";
import { AnomalyResolveButton } from "./anomaly-resolve-button";

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
 * 한 건의 설명문 — 언제 · 어디서 어디로 · 몇 차시. 위치를 모르면 그 조각만 뺀다(없는 사실 안 지어냄).
 * `muted` = 확인 완료 목록용(전체를 흐리게, 강조 없음).
 */
function AnomalyLine({ a, muted }: { a: ProgressAnomaly; muted?: boolean }) {
  const move = a.from && a.to ? `${a.from.grade} ${a.from.lesson} → ${a.to.grade} ${a.to.lesson}` : null;
  return (
    <span className={`break-keep text-xs leading-snug ${muted ? "text-text-faint" : "text-text-dim"}`}>
      <span className={muted ? "" : "text-danger font-bold"}>{anomalyLabel(a.type)}</span>
      <span className="text-text-faint mx-1.5">·</span>
      <span className="num">{fmtDetectedAt(a.at)}</span>
      {move ? (
        <>
          <span className="text-text-faint mx-1.5">·</span>
          <span className={muted ? "" : "text-foreground"}>{move}</span>
        </>
      ) : null}
      {a.jumpSize != null && a.jumpSize > 0 ? (
        <span className="text-text-faint"> ({a.jumpSize}차시 건너뜀)</span>
      ) : null}
      {/* 확인 주체 — 사람이 누른 것(0151a)과 시스템 자동 확인(2026-08-20 같은 선생님 규칙)을 구분한다.
          자동 확인분에 "확인자 미상"이라고 적으면 누가 껐는지 영영 알 수 없는 기록처럼 보인다. */}
      {muted && a.resolvedAt ? (
        <span className="ml-1.5">
          — {a.autoResolvedLabel ?? `${a.resolvedByName ?? "확인자 미상"} 확인`} · {fmtDetectedAt(a.resolvedAt)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 이상 감지 카드 — 진도 이상 알림(벨)이 착지하는 화면. 유형만 던지지 말고 **무엇이 어떻게 이상한지**를
 * 적는다: 언제 · 어디서 어디로 · 몇 차시. 이게 있어야 어느 보고서의 진도를 고칠지 판단할 수 있다.
 * 각 줄에 "이상 없음" 버튼(0151a) — 진도 점프의 상당수는 정상(선행 시작·교재 건너뜀·반 이동)이라 끌 수
 * 있어야 한다. 끌 수 없는 경고는 결국 통째로 무시된다.
 */
function AnomalyCard({ anomalies, canResolve }: { anomalies: readonly ProgressAnomaly[]; canResolve: boolean }) {
  return (
    <div className="border-danger/25 bg-danger-soft/40 rounded-2xl border p-4">
      <div className="flex items-center gap-2">
        <span className="bg-danger rounded-pill px-2 py-0.5 text-xs font-bold text-white">진도 확인 필요</span>
        <p className="text-foreground text-sm font-bold">최근 이상 감지 {anomalies.length}건</p>
      </div>
      <ul className="mt-2 space-y-1.5">
        {anomalies.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AnomalyLine a={a} />
            {canResolve ? <AnomalyResolveButton eventId={a.id} resolved={false} /> : null}
          </li>
        ))}
      </ul>
      <p className="text-text-faint mt-2 text-xs leading-snug break-keep">
        진도 점프는 <b>같은 선생님이 쓴 직전 진도와 비교</b>합니다 — 담당이 다른 진도(부담임 등)와는
        비교하지 않으므로 경고하지 않습니다. 아래 수업 진도 표에서 해당 날짜의 진도 입력이 맞는지 확인해
        주세요. 선행을 시작했거나 교재를 건너뛴 경우라면 정상입니다 — <b>이상 없음</b>을 누르면 이 학생의
        진도 경고(원스크린 배지 포함)가 꺼집니다.
      </p>
    </div>
  );
}

/**
 * 확인 완료 목록 — 접어 두되 **지우지는 않는다**. 누가 언제 정상이라고 판단했는지가 남아야 나중에
 * 되짚을 수 있고, 오판이면 되돌릴 수 있어야 한다.
 */
function ResolvedAnomalies({ anomalies, canResolve }: { anomalies: readonly ProgressAnomaly[]; canResolve: boolean }) {
  return (
    <details className="border-line bg-bg-soft/40 rounded-2xl border px-4 py-2.5">
      <summary className="text-text-dim cursor-pointer text-xs">
        이상 없음으로 확인한 기록 <b className="text-foreground">{anomalies.length}</b>건
        <span className="text-text-faint ml-1.5">(사람이 확인한 것 + 같은 선생님 진도 기준 자동 확인)</span>
      </summary>
      <ul className="mt-2 space-y-1.5">
        {anomalies.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AnomalyLine a={a} muted />
            {canResolve ? <AnomalyResolveButton eventId={a.id} resolved /> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function TrackCard({ t }: { t: TrackAnalytics }) {
  const top = t.percentile != null && t.poolSize >= MIN_POOL ? Math.max(0, 100 - t.percentile) : null;
  return (
    // @container — 아래 본문 2열 분기는 **창 폭이 아니라 이 카드 폭** 기준. 트랙이 1개면 카드가 전폭이라
    // 창이 좁아도 2열이 되고, 2개면 반폭이라 넓은 창에서만 2열이 된다(트랙 수 × 창 폭 조합을 한 규칙으로).
    <div className="bg-card border-line shadow-card @container rounded-2xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-pill px-2 py-0.5 text-xs font-bold ${
              t.track === "ahead" ? "bg-amber-soft text-amber" : "bg-primary-soft text-primary"
            }`}
          >
            {TRACK_LABEL[t.track]}
          </span>
          {t.gradeScope ? <span className="text-text-faint text-xs">{t.gradeScope}</span> : null}
        </div>
        <span className="text-text-faint text-xs">{t.chapterCount}개 기록</span>
      </div>

      <div className="@2xl:grid @2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] @2xl:items-start @2xl:gap-x-5">
        {/* 현재 위치 */}
        {t.current ? (
          <div className="mb-3 @2xl:mb-0">
            <p className="text-text-faint text-xs">현재 위치</p>
            <p className="text-foreground text-base font-bold break-keep">
              {t.current.grade} · {t.current.lesson}
            </p>
            <p className="text-text-faint text-xs break-keep">{t.current.unit}</p>
            <div className="bg-bg-soft relative mt-1.5 h-1.5 w-full overflow-hidden rounded-pill">
              <div
                className="bg-primary absolute inset-y-0 left-0 rounded-pill"
                style={{ width: `${t.progressPct}%` }}
              />
            </div>
            <p className="text-text-faint mt-0.5 text-xs">전체 커리큘럼의 {t.progressPct}%</p>
          </div>
        ) : null}

        <div>
          {/* 지표 3셀 */}
          <div className="border-line grid grid-cols-3 divide-x rounded-md border text-center">
            <div className="px-2 py-2">
              <p className="text-text-faint text-xs">수업당 속도</p>
              <p className="text-foreground text-sm font-bold">{fmtSpeed(t.speedPerLessonDay)}</p>
            </div>
            <div className="px-2 py-2">
              <p className="text-text-faint text-xs">또래 대비</p>
              <p className="text-primary text-sm font-bold">{top != null ? `상위 ${top}%` : "표본 부족"}</p>
            </div>
            <div className="px-2 py-2">
              <p className="text-text-faint text-xs">90일 예측</p>
              <p className="text-foreground text-sm font-bold">
                {t.predictions.find((p) => p.days === 90)?.grade || "—"}
              </p>
            </div>
          </div>

          {/* 예측 상세 */}
          {t.predictions.length ? (
            <div className="text-text-dim mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {t.predictions.map((p) => (
                <span key={p.days}>
                  {p.days}일 후 <b className="text-foreground">{p.grade}</b> {p.lesson}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export async function ProgressContainerPanel({ studentId }: { studentId: string }) {
  const data = await getStudentProgressAnalytics(studentId);
  const open = data.anomalies.filter((a) => a.resolvedAt === null);
  const resolved = data.anomalies.filter((a) => a.resolvedAt !== null);
  // 버튼 노출 판정 = 서버 액션과 **같은 순수 게이트·같은 사람**(#77). 강사(scoped)는 담당 학생일 때만.
  // 강사뷰면 검증된 대상 강사의 담당으로 본다 — 실제 계정 id로 보면 대상 강사 학생인데 버튼이 안 섰다.
  const user = await getCurrentUser({ teacherView: true });
  const level = user ? await accessLevelTenant(user.systemRole, "students") : "none";
  const supabase = await createClient();
  const owns =
    user && level === "scoped" ? await teacherOwnsStudent(supabase, user.id, studentId) : false;
  const canResolve = canResolveProgressAnomaly(level, owns);

  return (
    <div className="space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-foreground text-base font-bold">진도 분석</h2>
        <p className="text-text-faint text-xs">원스크린 진도 기록 기반 자동 산출</p>
      </header>
      {/* 이상 감지는 트랙 카드보다 위 — 진도 이상 알림을 타고 온 사람이 스크롤 없이 바로 본다. */}
      {open.length ? <AnomalyCard anomalies={open} canResolve={canResolve} /> : null}
      {resolved.length ? <ResolvedAnomalies anomalies={resolved} canResolve={canResolve} /> : null}
      {data.tracks.length === 0 ? (
        <div className="bg-card border-line text-text-faint rounded-2xl border p-6 text-center text-sm">
          아직 진도 기록이 없습니다. 원스크린에서 진도를 입력·저장하면 자동으로 분석됩니다.
        </div>
      ) : (
        // auto-fit — 트랙이 1개면 전폭(md:grid-cols-2는 빈 오른쪽 반을 예약해 낭비였다), 2개면 폭이 되는
        // 창에서만 나란히, 좁으면 접힘. 트랙 수를 세어 클래스를 분기하지 않아도 된다.
        // 하한 420px = 지표 3셀이 한 줄로 버티는 최소치(340이면 344px 카드가 나와 "29.5 차시/수업일"이 2줄).
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-3">
          {data.tracks.map((t) => (
            <TrackCard key={t.track} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
