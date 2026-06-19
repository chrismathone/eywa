/**
 * ② 지금 진행 콕핏 — 대형 학원에서 수업이 쏟아져도 컴팩트하게:
 *  · 진행 중 수업은 카드로(라이브 펄스, 최대 3 + 외 N)
 *  · 하루 밀도 타임라인 — 시간대별 수업 수를 과목색 누적 막대로(+'지금' 마커)
 *  · 다음 타임 — 곧 시작하는 수업만 과목색 칩으로
 *  · 과목 분포 요약 + 전체 시간표 링크
 */
import { Pill, type PillColor } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import type { TodaySlot } from "@/features/timetable/server/queries";
import { diffMinutes, shortTime } from "@/features/dashboard/subject-meta";
import { SUBJECT_BORDER, SUBJECT_ICON_BG, SUBJECT_SOLID, type SubjectMaps } from "@/features/owner/subjects";

const KO_TODAY = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
// 30분 단위 슬롯 인덱스 (h*2 + 0|1) — 막대를 더 정교하게.
const slotIdx = (t: string) => Number(t.slice(0, 2)) * 2 + (Number(t.slice(3, 5)) >= 30 ? 1 : 0);

type Bucket = { idx: number; total: number; segs: { color: PillColor; n: number }[]; past: boolean };

function buildDensity(slots: TodaySlot[], subjects: SubjectMaps) {
  const startIdx = Math.min(...slots.map((s) => slotIdx(s.startTime)));
  const endIdx = Math.max(...slots.map((s) => slotIdx(s.endTime)));
  const buckets: Bucket[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
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
  const active = [...slots].filter((s) => s.status !== "done").sort((a, b) => a.startTime.localeCompare(b.startTime));
  const span = endIdx - startIdx + 1;
  // '지금' 마커는 하루가 진행 중일 때만(끝난 수업 有 + 남은 수업 有) 그 경계(첫 남은 수업 좌측 모서리)에.
  // 시작 전(전부 예정)·종료 후엔 '다음' 섹션이 이미 알려주므로 마커 생략 → '지금/다음' 중복·혼동 방지.
  const showMarker = active.length > 0 && active.length < slots.length;
  const firstActiveIdx = active.length ? slotIdx(active[0].startTime) : endIdx + 1;
  return {
    buckets,
    max: Math.max(...buckets.map((b) => b.total), 1),
    minH: Math.floor(startIdx / 2),
    maxH: Math.ceil((endIdx + 1) / 2),
    markerPct: showMarker ? Math.max(0, Math.min(100, ((firstActiveIdx - startIdx) / span) * 100)) : null,
  };
}

export function NowCockpit({
  slots,
  subjects,
  unrecordedCount = 0,
}: {
  slots: TodaySlot[];
  subjects: SubjectMaps;
  unrecordedCount?: number;
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
    <section className="bg-card border-line shadow-card flex h-full flex-col overflow-hidden rounded-2xl border">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <p className="text-primary font-mono text-[11px] tracking-wider uppercase">지금 · {todayLabel}</p>
          <h2 className="text-foreground mt-1 text-[15px] font-bold">오늘의 일정</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {unrecordedCount > 0 ? (
            <WindowLink href="/attendance" title="출석부" ariaLabel="출석 미기록 수업 보기">
              <Pill color="amber">출석 미기록 {unrecordedCount}</Pill>
            </WindowLink>
          ) : null}
          {ongoing.length > 0 ? (
            <Pill color="primary">● 진행 중 {ongoing.length}건</Pill>
          ) : (
            <WindowLink href="/timetable" className="text-text-dim hover:text-foreground text-xs">시간표 →</WindowLink>
          )}
        </div>
      </header>

      {slots.length === 0 ? (
        <div className="text-text-dim flex flex-1 items-center justify-center px-5 py-12 text-sm">오늘은 예정된 수업이 없습니다</div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 px-5 pb-5">
          {ongoing.slice(0, 3).map((slot) => <OngoingCard key={slot.id} slot={slot} subjects={subjects} />)}
          {ongoing.length > 3 ? <p className="text-text-faint px-1 text-[11px]">외 {ongoing.length - 3}개 진행 중</p> : null}

          <DensityStrip slots={slots} subjects={subjects} />

          {nextClasses.length > 0 && nextStart ? <NextSlot time={nextStart} classes={nextClasses} subjects={subjects} /> : null}

          <div className="border-line mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {dist.map((d) => (
                <span key={d.label} className="text-text-dim inline-flex items-center gap-1 text-[11px]">
                  <span className={`${SUBJECT_SOLID[d.color]} size-2 rounded-[2px]`} />
                  {d.label} <span className="num text-foreground font-semibold">{d.n}</span>
                </span>
              ))}
            </div>
            <WindowLink href="/timetable" className="text-text-dim hover:text-foreground shrink-0 text-xs">전체 시간표 →</WindowLink>
          </div>
        </div>
      )}
    </section>
  );
}

function DensityStrip({ slots, subjects }: { slots: TodaySlot[]; subjects: SubjectMaps }) {
  const { buckets, max, minH, maxH, markerPct } = buildDensity(slots, subjects);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-text-faint font-mono text-[10px] tracking-wider uppercase">하루 밀도</p>
        <p className="text-text-faint text-[10px]">총 {slots.length}개 수업</p>
      </div>
      <div className="border-line relative mt-3 flex h-[58px] items-end gap-[2px] border-b">
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
      <div className="text-text-faint mt-1 flex justify-between font-mono text-[9px]">
        <span>{minH}시</span>
        <span>{maxH}시</span>
      </div>
    </div>
  );
}

function NextSlot({ time, classes, subjects }: { time: string; classes: TodaySlot[]; subjects: SubjectMaps }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="text-text-faint font-mono text-[10px] tracking-wider uppercase">다음</p>
        <p className="text-foreground num text-[13px] font-bold">{shortTime(time)}</p>
        <p className="text-text-faint text-[11px]">· {classes.length}개 수업</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {classes.slice(0, 12).map((s) => {
          return (
            <WindowLink
              key={s.id}
              href={`/classes/${s.classId}`}
              title={s.className}
              ariaLabel={`${s.className} 수업 상세 열기`}
              className={`${SUBJECT_ICON_BG[subjects.colorOf(s.subject)]} inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-shadow hover:shadow-sm`}
            >
              <span
                className="max-w-[8rem] truncate"
                title={`${s.className}${s.teacherName ? ` · ${s.teacherName}` : ""}${s.classroomName ? ` · ${s.classroomName}` : ""} · ${s.studentCount}명`}
              >
                {s.className}
              </span>
              <span className="num font-mono text-[9px] opacity-60">{s.studentCount}</span>
            </WindowLink>
          );
        })}
        {classes.length > 12 ? <span className="text-text-faint self-center text-[11px]">+{classes.length - 12}</span> : null}
      </div>
    </div>
  );
}

function OngoingCard({ slot, subjects }: { slot: TodaySlot; subjects: SubjectMaps }) {
  const duration = diffMinutes(slot.startTime, slot.endTime);
  return (
    <div className={`flex items-center gap-3.5 rounded-xl border-[1.5px] px-4 py-3.5 ${SUBJECT_BORDER[subjects.colorOf(slot.subject)]}`}>
      <div className="w-[52px] shrink-0 text-center">
        <p className="num text-primary text-[15px] font-extrabold leading-none">{shortTime(slot.startTime)}</p>
        <p className="text-text-faint mt-1 font-mono text-[10px]">{duration}분</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-extrabold">
            <WindowLink
              href={`/classes/${slot.classId}`}
              title={slot.className}
              className="text-foreground hover:text-primary hover:underline"
              ariaLabel={`${slot.className} 수업 상세 열기`}
            >
              {slot.className}
            </WindowLink>
          </h3>
          <Pill color="primary">진행 중</Pill>
        </div>
        <p className="text-text-dim mt-1 truncate text-[12px]">
          {slot.teacherName ? `${slot.teacherName} 강사` : "담임 미정"}
          {slot.classroomName ? ` · ${slot.classroomName}` : ""}
          {" · "}
          <span className="num">{slot.studentCount}명</span>
        </p>
      </div>
      <span className="animate-pulse bg-primary size-2.5 shrink-0 rounded-full" style={{ boxShadow: "0 0 0 4px rgba(26,95,60,0.15)" }} aria-hidden="true" />
    </div>
  );
}
