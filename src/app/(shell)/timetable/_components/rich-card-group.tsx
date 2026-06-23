"use client";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { SUBJECT_SOLID } from "@/features/owner/subjects";
import { enumDayToKo, type DayOfWeek } from "@/features/timetable/lib/periods";
import {
  teacherColor,
  type GridStudent,
  type RichCardGroup,
  type RichClassCard,
} from "@/features/timetable/lib/class-grid";
import { ClassInfoCard, HoverCard, StudentInfoCard } from "./hover-cards";

// 라벨열·카드가 공유하는 고정 섹션 높이(px) — 같은 y에서 행이 맞물려 "행=라벨, 열=수업" 스프레드시트 정렬.
const NAME_H = 40;
const TEACHER_H = 24;
const ROOM_H = 34;
const DAYHEAD_H = 22;
const PERIOD_H = 26;
const STU_H = 20; // 학생 1행
const LABEL_W = 58;
const CARD_W = 176;

function abbrev(label: string): string {
  return label.length > 4 ? label.slice(0, 4) : label;
}

/** 통합뷰 한 섹션(시작 교시 그룹) — 가로 드래그 + 좌측 sticky 라벨열 + 반=열 카드. */
export function RichCardGroupBoard({
  group,
  subjectSoftClass,
}: {
  group: RichCardGroup;
  subjectSoftClass: string;
}) {
  const holdH = group.holdRows * STU_H + 6;
  const wdH = group.withdrawnRows * STU_H + 6;

  return (
    <DragScrollArea barX className="border-line border-t">
      <div className="flex w-max items-stretch">
        <LabelColumn group={group} holdH={holdH} wdH={wdH} />
        {group.cards.map((c) => (
          <ClassColumn
            key={c.classId}
            card={c}
            group={group}
            subjectSoftClass={subjectSoftClass}
            holdH={holdH}
            wdH={wdH}
          />
        ))}
      </div>
    </DragScrollArea>
  );
}

/** 좌측 고정 라벨열 — 카드와 동일 높이 섹션을 "라벨"로. */
function LabelColumn({ group, holdH, wdH }: { group: RichCardGroup; holdH: number; wdH: number }) {
  const cell = "border-line text-text-dim flex items-center justify-center border-b text-[10px] font-bold";
  return (
    <div
      className="bg-bg-soft border-line sticky left-0 z-20 flex shrink-0 flex-col self-stretch border-r shadow-[4px_0_10px_-6px_rgba(13,17,16,0.18)]"
      style={{ width: LABEL_W }}
    >
      <div className={cell} style={{ height: NAME_H }}>수업명</div>
      <div className={cell} style={{ height: TEACHER_H }}>담임</div>
      <div className={cell} style={{ height: ROOM_H }}>강의실</div>
      <div className={cell} style={{ height: DAYHEAD_H }}>교시</div>
      {group.periodRows.map((p) => (
        <div
          key={p.order}
          className="border-line text-text-faint flex flex-col items-center justify-center border-b font-mono leading-none"
          style={{ height: PERIOD_H }}
        >
          <span className="text-foreground text-[10px] font-bold">{p.label}</span>
          <span className="text-[7px]">{p.time}</span>
        </div>
      ))}
      <div className="text-primary flex flex-1 items-center justify-center border-b border-line text-[10px] font-bold" style={{ minHeight: 60 }}>
        재원
      </div>
      <div className={`${cell} text-rose`} style={{ height: holdH }}>대기</div>
      <div className="border-line text-text-dim flex items-center justify-center text-[10px] font-bold" style={{ height: wdH }}>
        퇴원
      </div>
    </div>
  );
}

/** 반=열 카드 — 헤더(반명·담임·강의실) + 요일×교시 미니그리드 + 재원/대기/퇴원. */
function ClassColumn({
  card,
  group,
  subjectSoftClass,
  holdH,
  wdH,
}: {
  card: RichClassCard;
  group: RichCardGroup;
  subjectSoftClass: string;
  holdH: number;
  wdH: number;
}) {
  const days = group.days;
  const gridCols = { gridTemplateColumns: `repeat(${days.length}, 1fr)` };
  // 반 헤더색 — ijw bgColor 우선(인라인), 없으면 과목색 클래스.
  const headerStyle = card.bgColor
    ? { background: card.bgColor, color: card.textColor ?? "#1a1f1c" }
    : undefined;

  return (
    <div className="border-line flex shrink-0 flex-col border-r" style={{ width: CARD_W }}>
      {/* 수업명 (클릭=반 창) — 헤더색은 래퍼 div(WindowLink는 style 미지원). */}
      <div
        className={`border-line border-b ${card.bgColor ? "" : subjectSoftClass}`}
        style={{ height: NAME_H, ...headerStyle }}
      >
        <HoverCard
          width={230}
          card={
            <ClassInfoCard
              className={card.className}
              subject={card.subject}
              teacherName={card.teacherName}
              room={card.classroomLabel}
              counts={{ active: card.activeCount, hold: card.hold.length, withdrawn: card.withdrawn.length }}
            />
          }
        >
          <WindowLink
            href={`/classes/${card.classId}`}
            title={card.className}
            ariaLabel={`${card.className} 반 정보`}
            className="flex h-full w-full items-center justify-center px-1 text-center text-[13px] font-bold transition hover:brightness-95"
          >
            <span className="truncate">{card.className}</span>
          </WindowLink>
        </HoverCard>
      </div>
      {/* 담임 */}
      <div className="border-line text-foreground flex items-center justify-center border-b text-[11px] font-semibold" style={{ height: TEACHER_H }}>
        {card.teacherName ?? "-"}
      </div>
      {/* 강의실(요일별) */}
      <div className="border-line text-text-dim flex items-center justify-center border-b px-1 text-center text-[10px] leading-tight" style={{ height: ROOM_H }}>
        <span className="line-clamp-2" title={card.classroomLabel}>{card.classroomLabel}</span>
      </div>
      {/* 요일 헤더 */}
      <div className="border-line grid border-b" style={{ ...gridCols, height: DAYHEAD_H }}>
        {days.map((d) => (
          <DayHead key={d} day={d} />
        ))}
      </div>
      {/* 요일×교시 미니그리드 */}
      {group.periodRows.map((p) => (
        <div key={p.order} className="border-line grid border-b" style={{ ...gridCols, height: PERIOD_H }}>
          {days.map((d) => (
            <Cell key={d} card={card} order={p.order} day={d} />
          ))}
        </div>
      ))}
      {/* 재원생 */}
      <div className="bg-card flex-1 border-b border-line p-1" style={{ minHeight: 60 }}>
        {card.activeCount === 0 ? (
          <div className="text-text-faint py-2 text-center text-[10px]">-</div>
        ) : (
          card.active.map((s, i) => <RosterRow key={s.studentId ?? `a-${i}`} s={s} />)
        )}
      </div>
      {/* 대기 */}
      <div className="bg-rose-soft/30 border-line border-b p-1" style={{ height: holdH }}>
        {card.hold.length === 0 ? (
          <div className="text-text-faint text-center text-[10px]">-</div>
        ) : (
          card.hold.map((s, i) => <RosterRow key={s.studentId ?? `h-${i}`} s={s} />)
        )}
      </div>
      {/* 퇴원 — 재원/대기와 동일 서식(이름·영문·학교/학년), 취소선·dim 톤으로 구분 */}
      <div className="bg-bg-soft p-1" style={{ height: wdH }}>
        {card.withdrawn.length === 0 ? (
          <div className="text-text-faint text-center text-[10px]">-</div>
        ) : (
          card.withdrawn.map((s, i) => <RosterRow key={s.studentId ?? `w-${i}`} s={s} />)
        )}
      </div>
    </div>
  );
}

function DayHead({ day }: { day: DayOfWeek }) {
  const weekend = day === "sat" || day === "sun";
  return (
    <div
      className={`border-line flex items-center justify-center border-r text-[10px] font-bold last:border-r-0 ${
        weekend ? "text-rose" : "text-text-dim"
      }`}
    >
      {enumDayToKo(day)}
    </div>
  );
}

function Cell({ card, order, day }: { card: RichClassCard; order: number; day: DayOfWeek }) {
  const c = card.cells[`${order}:${day}`];
  const base = "border-line flex items-center justify-center border-r text-[10px] font-bold last:border-r-0";
  if (!c) return <div className={base} />;
  if (c.isLab) return <div className={`${base} bg-blue-soft text-blue`} title="LAB">LAB</div>;
  if (!c.label) return <div className={base} />;
  return (
    <div className={`${base} ${SUBJECT_SOLID[teacherColor(c.label)]} text-white`} title={c.label}>
      {abbrev(c.label)}
    </div>
  );
}

/** 학생 행 — 신입=빨강·전입=초록·퇴원=취소선/dim, 이름(영문), 학교/학년. 클릭=학생 창. */
function RosterRow({ s }: { s: GridStudent }) {
  const withdrawn = s.status === "withdrawn";
  const tone = withdrawn
    ? "bg-card border-line text-text-dim border"
    : s.isNew
      ? "bg-danger-soft text-danger"
      : s.isTransferredIn
        ? "bg-primary-soft text-primary"
        : "text-foreground";
  const meta = [s.school, s.grade].filter(Boolean).join(" ");
  const name = s.englishName ? `${s.name} (${s.englishName})` : s.name;
  const inner = (
    <>
      <span className={`truncate ${withdrawn ? "line-through" : ""}`}>{name}</span>
      {meta ? <span className="text-text-faint shrink-0 font-mono text-[9px]">{meta}</span> : null}
    </>
  );
  const cls = `flex items-baseline justify-between gap-1 rounded-[3px] px-1 text-[10px] leading-[18px] ${tone}`;
  const trigger = s.studentId ? (
    <WindowLink href={`/students/${s.studentId}`} title={s.name} ariaLabel={`${s.name} 학생 정보`} className={`${cls} hover:brightness-95`}>
      {inner}
    </WindowLink>
  ) : (
    <div className={cls}>{inner}</div>
  );
  return (
    <HoverCard
      width={220}
      card={
        <StudentInfoCard
          name={s.name}
          englishName={s.englishName}
          grade={s.grade}
          school={s.school}
          status={s.status}
          isNew={s.isNew}
          isTransferredIn={s.isTransferredIn}
          attendanceDays={s.attendanceDays}
          endDate={s.endDate}
          textbook={s.latestTextbook}
          report={s.latestReport}
        />
      }
    >
      {trigger}
    </HoverCard>
  );
}
