/**
 * ② 지금 진행 콕핏 — 대형 학원에서 수업이 쏟아져도 컴팩트하게:
 *  · 진행 중 수업은 **과목별로 묶어** 전부 나열(과목 헤더 + 컴팩트 행, 라이브 펄스)
 *  · 하루 밀도 타임라인 — 시간대별 수업 수를 과목색 누적 막대로(+'지금' 마커)
 *  · 다음 타임 — 곧 시작하는 수업만 과목색 칩으로
 *  · 과목 분포 요약 + 전체 시간표 링크
 */
import { Pill, type PillColor } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { TodaySlot } from "@/features/timetable/server/queries";
import { groupOngoingBySubject } from "@/features/dashboard/ongoing";
import { shortTime } from "@/features/dashboard/subject-meta";
import { SUBJECT_ICON_BG, SUBJECT_SOLID, type SubjectMaps } from "@/features/owner/subjects";
import { kstMinutesOfDay } from "@/lib/date-kst";

const KO_TODAY = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  timeZone: "Asia/Seoul",
});
// 30분 단위 슬롯 인덱스 (h*2 + 0|1) — 막대를 더 정교하게.
const slotIdx = (t: string) => Number(t.slice(0, 2)) * 2 + (Number(t.slice(3, 5)) >= 30 ? 1 : 0);

type Bucket = { idx: number; total: number; segs: { color: PillColor; n: number }[]; past: boolean };

function buildDensity(slots: TodaySlot[], subjects: SubjectMaps) {
  const startIdx = Math.min(...slots.map((s) => slotIdx(s.startTime)));
  const lastEndMinutes = Math.max(...slots.map((s) => timeMinutes(s.endTime)));
  // 종료 시각은 축의 오른쪽 경계이지 새 30분 버킷이 아니다. 09:00~10:00만 있으면
  // 09:00·09:30 두 칸으로 끝나야 하며 10:00 빈 칸을 하나 더 만들지 않는다.
  const endIdxExclusive = Math.max(startIdx + 1, Math.ceil(lastEndMinutes / 30));
  const buckets: Bucket[] = [];
  for (let i = startIdx; i < endIdxExclusive; i++) {
    const inB = slots.filter((s) => slotIdx(s.startTime) === i);
    const byColor = new Map<PillColor, number>();
    for (const s of inB) {
      const c = subjects.colorOf(s.subject);
      byColor.set(c, (byColor.get(c) ?? 0) + 1);
    }
    buckets.push({
      idx: i,
      total: inB.length,
      segs: [...byColor].map(([color, n]) => ({ color, n })),
      past: inB.length > 0 && inB.every((s) => s.status === "done"),
    });
  }
  const markerPct = densityMarkerPercent(slots, kstMinutesOfDay());
  const axis = densityAxisLabels(slots);
  return {
    buckets,
    max: Math.max(...buckets.map((b) => b.total), 1),
    startLabel: axis.start,
    endLabel: axis.end,
    markerPct: markerPct === null ? null : Math.max(0, Math.min(100, markerPct)),
  };
}

/** 실제 KST 시각을 하루 밀도 축의 위치로 바꾼다. 첫 미완료 수업 시각을 '지금'으로 오인하지 않는다. */
export function densityMarkerPercent(
  slots: readonly Pick<TodaySlot, "startTime" | "endTime">[],
  nowMinutes: number,
): number | null {
  if (slots.length === 0) return null;
  const firstStart = Math.min(...slots.map((slot) => timeMinutes(slot.startTime)));
  const lastEnd = Math.max(...slots.map((slot) => timeMinutes(slot.endTime)));
  if (nowMinutes < firstStart || nowMinutes > lastEnd) return null;
  const span = lastEnd - firstStart;
  return span > 0 ? ((nowMinutes - firstStart) / span) * 100 : 0;
}

export function densityAxisLabels(
  slots: readonly Pick<TodaySlot, "startTime" | "endTime">[],
): { start: string; end: string } {
  if (slots.length === 0) return { start: "", end: "" };
  const format = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  return {
    start: format(Math.min(...slots.map((slot) => timeMinutes(slot.startTime)))),
    end: format(Math.max(...slots.map((slot) => timeMinutes(slot.endTime)))),
  };
}

function timeMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function NowCockpit({
  slots,
  subjects,
  unrecordedCount = 0,
  attendanceProcessingUnavailable = false,
  canOpenClasses,
  canOpenTimetable,
}: {
  slots: TodaySlot[];
  subjects: SubjectMaps;
  unrecordedCount?: number;
  attendanceProcessingUnavailable?: boolean;
  canOpenClasses: boolean;
  canOpenTimetable: boolean;
}) {
  const ongoing = slots.filter((s) => s.status === "ongoing");
  const upcoming = slots.filter((s) => s.status !== "ongoing" && s.status !== "done");
  const todayLabel = KO_TODAY.format(new Date());

  const nextStart = upcoming.length ? [...upcoming].sort((a, b) => a.startTime.localeCompare(b.startTime))[0].startTime : null;
  const nextClasses = nextStart ? slots.filter((s) => s.startTime === nextStart) : [];

  const dist = (() => {
    const m = new Map<string, { label: string; color: PillColor; n: number }>();
    for (const s of slots) {
      const label = subjects.labelOf(s.subject);
      const e = m.get(label) ?? { label, color: subjects.colorOf(s.subject), n: 0 };
      e.n += 1;
      m.set(label, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  })();

  return (
    <section className="bg-card border-line shadow-card flex h-full flex-col overflow-hidden rounded-2xl border" aria-labelledby="today-schedule-title">
      <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4 pb-3">
        <div>
          <p className="text-primary font-mono text-[11px] tracking-wider uppercase">지금 · {todayLabel}</p>
          <h3 id="today-schedule-title" className="text-foreground mt-1 text-[15px] font-bold">오늘의 일정</h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {attendanceProcessingUnavailable ? (
            <WindowLink
              href="/attendance"
              title="출석부"
              ariaLabel="출결 처리 현황을 원본 화면에서 확인"
              className="focus-visible:ring-primary/35 inline-flex min-h-7 items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
            >
              <Pill color="amber">출결 현황 확인 불가</Pill>
            </WindowLink>
          ) : unrecordedCount > 0 ? (
            <WindowLink
              href="/attendance"
              title="출석부"
              ariaLabel="출석 미기록 수업 보기"
              className="focus-visible:ring-primary/35 inline-flex min-h-7 items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
            >
              <Pill color="amber">출석 미기록 {unrecordedCount}</Pill>
            </WindowLink>
          ) : null}
          {ongoing.length > 0 ? (
            <Pill color="primary">● 진행 중 {ongoing.length}건</Pill>
          ) : canOpenTimetable ? (
            <WindowLink
              href="/timetable"
              className="text-text-dim hover:text-foreground focus-visible:ring-primary/35 inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              시간표 <EyIcon name="arrowRight" size={12} />
            </WindowLink>
          ) : null}
        </div>
      </header>

      {slots.length === 0 ? (
        <div className="text-text-dim flex flex-1 items-center justify-center px-5 py-12 text-sm">오늘은 예정된 수업이 없습니다</div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 px-5 pb-4">
          {ongoing.length > 0 ? (
            <OngoingBySubject slots={slots} subjects={subjects} canOpenClasses={canOpenClasses} />
          ) : (
            <p className="text-text-dim border-line rounded-xl border border-dashed px-4 py-3 text-center text-[12px]">
              지금 진행 중인 수업이 없습니다
            </p>
          )}

          <DensityStrip slots={slots} subjects={subjects} />

          {nextClasses.length > 0 && nextStart ? (
            <NextSlot time={nextStart} classes={nextClasses} subjects={subjects} canOpenClasses={canOpenClasses} />
          ) : null}

          <div className="border-line mt-auto flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {dist.map((d) => (
                <span key={d.label} className="text-text-dim inline-flex items-center gap-1 text-[11px]">
                  <span className={`${SUBJECT_SOLID[d.color]} size-2 rounded-[2px]`} />
                  {d.label} <span className="num text-foreground font-semibold">{d.n}</span>
                </span>
              ))}
            </div>
            {canOpenTimetable ? (
              <WindowLink
                href="/timetable"
                className="text-text-dim hover:text-foreground focus-visible:ring-primary/35 inline-flex min-h-7 shrink-0 items-center rounded-md px-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                전체 시간표 <EyIcon name="arrowRight" size={12} />
              </WindowLink>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function DensityStrip({ slots, subjects }: { slots: TodaySlot[]; subjects: SubjectMaps }) {
  const { buckets, max, startLabel, endLabel, markerPct } = buildDensity(slots, subjects);
  const accessibleSummary = buckets
    .filter((bucket) => bucket.total > 0)
    .map((bucket) => `${Math.floor(bucket.idx / 2)}시 ${bucket.idx % 2 ? "30분" : "정각"} ${bucket.total}개`)
    .join(", ");

  return (
    <figure
      role="img"
      aria-label={`수업 시작 분포. ${accessibleSummary || "예정된 시작 수업 없음"}.${
        markerPct === null ? " 현재 시각은 표시 범위 밖입니다." : " 세로선은 현재 KST 시각입니다."
      }`}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-text-dim font-mono text-[10px] tracking-wider uppercase">하루 밀도</p>
        <p className="text-text-dim text-[10px]">총 {slots.length}개 수업</p>
      </div>
      <div className="border-line relative mt-2 flex h-[44px] items-end gap-[2px] border-b" aria-hidden="true">
        {buckets.map((b) => (
          <div
            key={b.idx}
            className="flex flex-1 flex-col-reverse overflow-hidden rounded-t-[2px]"
            title={`${Math.floor(b.idx / 2)}:${b.idx % 2 ? "30" : "00"} · ${b.total}개 수업`}
            style={{ height: `${(b.total / max) * 100}%`, minHeight: b.total ? 2 : 0 }}
          >
            {b.segs.map((seg) => (
              <span key={seg.color} className={`${SUBJECT_SOLID[seg.color]} ${b.past ? "opacity-30" : ""}`} style={{ height: `${(seg.n / b.total) * 100}%` }} />
            ))}
          </div>
        ))}
        {markerPct !== null ? (
          <span className="bg-foreground/75 absolute -top-1 -bottom-1 z-10 w-px" style={{ left: `${markerPct}%` }} aria-hidden="true">
            <span className="bg-foreground text-background absolute -top-[13px] left-1/2 -translate-x-1/2 rounded-[3px] px-1 py-px font-mono text-[8px] leading-none font-bold whitespace-nowrap">지금</span>
          </span>
        ) : null}
      </div>
      <div className="text-text-dim mt-1 flex justify-between font-mono text-[9px]">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </figure>
  );
}

function NextSlot({
  time,
  classes,
  subjects,
  canOpenClasses,
}: {
  time: string;
  classes: TodaySlot[];
  subjects: SubjectMaps;
  canOpenClasses: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="text-text-faint font-mono text-[10px] tracking-wider uppercase">다음</p>
        <p className="text-foreground num text-[13px] font-bold">{shortTime(time)}</p>
        <p className="text-text-faint text-[11px]">· {classes.length}개 수업</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {classes.slice(0, 12).map((slot) => (
          <NextClassChip key={slot.id} slot={slot} subjects={subjects} canOpen={canOpenClasses} />
        ))}
        {classes.length > 12 ? <span className="text-text-faint self-center text-[11px]">+{classes.length - 12}</span> : null}
      </div>
    </div>
  );
}

function NextClassChip({ slot, subjects, canOpen }: { slot: TodaySlot; subjects: SubjectMaps; canOpen: boolean }) {
  const className = `${SUBJECT_ICON_BG[subjects.colorOf(slot.subject)]} inline-flex items-baseline gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-shadow`;
  const title = `${slot.className}${slot.teacherName ? ` · ${slot.teacherName}` : ""}${slot.classroomName ? ` · ${slot.classroomName}` : ""} · ${slot.studentCount}명`;
  const content = (
    <>
      <span className="max-w-[8rem] min-w-0" title={title}>
        <span className="block truncate">{slot.className}</span>
      </span>
      <span className="num font-mono text-[9px] opacity-60">{slot.studentCount}</span>
    </>
  );

  return canOpen ? (
    <WindowLink
      href={`/classes/${slot.classId}`}
      title={slot.className}
      ariaLabel={`${slot.className} 수업 상세 열기`}
      className={`${className} hover:shadow-sm`}
    >
      {content}
    </WindowLink>
  ) : (
    <span className={className}>{content}</span>
  );
}

/** 진행 중 수업을 과목별로 묶어 나열(과목 헤더 + 컴팩트 행). 그룹당 5행까지 보이고 넘치면 스크롤. */
function OngoingBySubject({
  slots,
  subjects,
  canOpenClasses,
}: {
  slots: TodaySlot[];
  subjects: SubjectMaps;
  canOpenClasses: boolean;
}) {
  const groups = groupOngoingBySubject(slots, subjects);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.subject}>
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className={`${SUBJECT_SOLID[g.color]} size-2.5 self-center rounded-[3px]`} aria-hidden="true" />
            <span className="text-foreground text-[13px] font-bold">{g.label}</span>
            <span className="text-text-faint num font-mono text-[11px]">{g.slots.length}개 진행 중</span>
          </div>
          {/* max-h-32 ≈ 행(≈31.5px)×4 + 간격 — 5개째부터 스크롤(전역 디자인 스크롤바, 카드 축소). */}
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {g.slots.map((s) => <OngoingRow key={s.id} slot={s} canOpen={canOpenClasses} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 진행 중 수업 한 줄 — 시간대·반이름·강사/강의실·인원 + 라이브 펄스. 반 상세로 드릴인. */
function OngoingRow({ slot, canOpen }: { slot: TodaySlot; canOpen: boolean }) {
  const content = (
    <>
      <span className="num text-primary w-[86px] shrink-0 text-[11px] font-bold">
        {shortTime(slot.startTime)}~{shortTime(slot.endTime)}
      </span>
      {/* 13/11px 한 줄 = baseline 정렬. truncate는 flex 자식에 두면 baseline이 박스 하단으로 합성 → 내부 block span으로. */}
      <span className="text-foreground group-hover:text-primary min-w-0 flex-1 text-[13px] font-semibold">
        <span className="block truncate">{slot.className}</span>
      </span>
      <span className="text-text-dim hidden max-w-[9rem] shrink-0 text-[11px] sm:inline">
        <span className="block truncate">
          {slot.teacherName ?? "담임 미정"}
          {slot.classroomName ? ` · ${slot.classroomName}` : ""}
        </span>
      </span>
      <span className="num text-text-faint shrink-0 text-[11px]">{slot.studentCount}명</span>
      <span
        className="animate-pulse bg-primary size-1.5 shrink-0 self-center rounded-full motion-reduce:animate-none"
        aria-hidden="true"
      />
    </>
  );

  return canOpen ? (
    <WindowLink
      href={`/classes/${slot.classId}`}
      title={slot.className}
      ariaLabel={`${slot.className} 수업 상세 열기`}
      className="group hover:bg-bg-soft flex items-baseline gap-2.5 rounded-md px-2 py-1.5 transition-colors"
    >
      {content}
    </WindowLink>
  ) : (
    <div className="group flex items-baseline gap-2.5 rounded-md px-2 py-1.5">{content}</div>
  );
}
