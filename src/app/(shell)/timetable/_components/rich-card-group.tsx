"use client";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { SUBJECT_SOLID } from "@/features/owner/subjects";
import { enumDayToKo, type DayOfWeek } from "@/features/timetable/lib/periods";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  AXIS_COLS,
  teacherColor,
  type GridStudent,
  type RichCardGroup,
  type RichClassCard,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import { ClassInfoCard, HoverCard, StudentInfoCard } from "./hover-cards";
import { timetableStudentTone, useTimetableColorMode, withdrawnTone } from "./timetable-color";

// 라벨열·카드가 공유하는 고정 섹션 높이(px) — 같은 y에서 행이 맞물려 "행=라벨, 열=수업" 스프레드시트 정렬.
const NAME_H = 40;
const TEACHER_H = 24;
const ROOM_H = 34;
const DAYHEAD_H = 22;
const PERIOD_H = 26;
// 학생 1행 높이 — 기본뷰 StudentRow 실측(13px × leading-tight + py-[3px] = 23.1px)에 맞춘 값.
// ⚠️ 서식을 기본뷰와 동일하게 두는 한 이 값도 함께 따라가야 한다(안 그러면 12행 프레임에서 행이 잘린다).
const STU_H = 24;
const LABEL_W = 58;
const CARD_W = 176;
// 명단 섹션 고정 행수(2026-07-06, 사용자 지정) — 그룹 내 최대 인원으로 늘리지 않는다.
// 예전엔 재원=무제한(flex-1)·대기/퇴원=그룹 max 동기화라 한 반(예: DP5 퇴원 10명)이 전 카드를
// 세로로 폭주시켰음. 이제 섹션 높이는 항상 이 행수로 고정, 넘치는 명단은 섹션 안에서 스크롤.
const ACTIVE_ROWS = 12;
const HOLD_ROWS = 3;
const WD_ROWS = 5;
const SECTION_PAD = 8; // p-1(4px) 상하

function abbrev(label: string): string {
  return label.length > 4 ? label.slice(0, 4) : label;
}

/** 통합뷰 한 섹션(시작 교시 그룹) — 가로 드래그 + 좌측 sticky 라벨열 + 반=열 카드. */
export function RichCardGroupBoard({
  group,
  subjectSoftClass,
  teacherColors,
}: {
  group: RichCardGroup;
  subjectSoftClass: string;
  teacherColors: TeacherColorMap;
}) {
  // 고정 행수(재원12·대기3·퇴원5) — 그룹 max와 무관하게 모든 그룹·카드 동일 프레임(시트처럼).
  const activeH = ACTIVE_ROWS * STU_H + SECTION_PAD;
  const holdH = HOLD_ROWS * STU_H + SECTION_PAD;
  const wdH = WD_ROWS * STU_H + SECTION_PAD;

  return (
    <DragScrollArea barX className="border-line border-t">
      <div className="flex w-max items-stretch">
        <LabelColumn group={group} activeH={activeH} holdH={holdH} wdH={wdH} />
        {group.cards.map((c) => (
          <ClassColumn
            key={c.classId}
            card={c}
            group={group}
            subjectSoftClass={subjectSoftClass}
            teacherColors={teacherColors}
            activeH={activeH}
            holdH={holdH}
            wdH={wdH}
          />
        ))}
      </div>
    </DragScrollArea>
  );
}

/** 좌측 고정 라벨열 — 카드와 동일 높이 섹션을 "라벨"로. */
function LabelColumn({
  group,
  activeH,
  holdH,
  wdH,
}: {
  group: RichCardGroup;
  activeH: number;
  holdH: number;
  wdH: number;
}) {
  const cell = "border-line text-text-dim flex items-center justify-center border-b text-[10px] font-bold";
  return (
    <div
      className="bg-bg-soft border-line sticky left-0 z-20 flex shrink-0 flex-col self-stretch border-r shadow-[4px_0_10px_-6px_rgba(29,29,31,0.18)]"
      style={{ width: LABEL_W }}
    >
      <div className={cell} style={{ height: NAME_H }}>수업명</div>
      <div className={cell} style={{ height: TEACHER_H }}>담임</div>
      <div className={cell} style={{ height: ROOM_H }}>강의실</div>
      <div className={cell} style={{ height: DAYHEAD_H }}>교시</div>
      {group.periodRows.map((p) => (
        <div
          key={p.order}
          className="border-line text-text-faint flex flex-col items-center justify-center border-b num leading-none"
          style={{ height: PERIOD_H }}
        >
          <span className="text-foreground text-[10px] font-bold">{p.label}</span>
          <span className="text-[7px]">{p.time}</span>
        </div>
      ))}
      <div className="text-primary border-line flex items-center justify-center border-b text-[10px] font-bold" style={{ height: activeH }}>
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
  teacherColors,
  activeH,
  holdH,
  wdH,
}: {
  card: RichClassCard;
  group: RichCardGroup;
  subjectSoftClass: string;
  teacherColors: TeacherColorMap;
  activeH: number;
  holdH: number;
  wdH: number;
}) {
  // ⚠️ 요일축은 **카드별 5칸 고정**(월~금 기준, `buildAxisDays`) — 열 수가 카드마다 다르면 한 칸
  //    너비도 달라져 시트처럼 안 읽힌다(원장 2026-07-27). 토요일은 "그 반이 안 쓰는 평일" 칸을
  //    대체해 들어오므로 2026-07-23 혼합 반 회귀도 없다. 축을 못 주는 구데이터만 그룹 축 폴백.
  const days: (DayOfWeek | null)[] = card.axisDays?.length
    ? card.axisDays
    : (card.days?.length ? card.days : group.days);
  const gridCols = { gridTemplateColumns: `repeat(${AXIS_COLS}, 1fr)` };
  // 반 헤더색 — ijw bgColor 우선(인라인), 없으면 과목색 클래스.
  const headerStyle = card.bgColor
    ? { background: card.bgColor, color: card.textColor ?? "#1d1d1f" }
    : undefined;
  // 담임색 — ijw 강사 저장색(users.bg_color, display_name·영문닉네임으로 해결). 없으면 plain.
  const damimColor = card.teacherName ? teacherColors[card.teacherName] : undefined;

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
            <span className="overflow-hidden whitespace-nowrap text-clip">{card.className}</span>
          </WindowLink>
        </HoverCard>
      </div>
      {/* 담임 — 저장된 강사색이 있으면 색칩, 없으면 plain */}
      <div className="border-line flex items-center justify-center border-b" style={{ height: TEACHER_H }}>
        {!card.teacherName ? (
          <span className="text-text-faint text-[11px]">-</span>
        ) : damimColor ? (
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-bold"
            style={{ background: damimColor.bg, color: damimColor.text }}
          >
            {card.teacherName}
          </span>
        ) : (
          <span className="text-foreground text-[11px] font-bold">{card.teacherName}</span>
        )}
      </div>
      {/* 강의실(요일별) */}
      <div className="border-line text-text-dim flex items-center justify-center border-b px-1 text-center text-[10px] leading-tight" style={{ height: ROOM_H }}>
        <span className="line-clamp-2" title={card.classroomLabel}>{card.classroomLabel}</span>
      </div>
      {/* 요일 헤더 — 항상 5칸(빈 칸은 라벨 없는 자리표시자, 열 너비 유지용) */}
      <div className="border-line grid border-b" style={{ ...gridCols, height: DAYHEAD_H }}>
        {days.map((d, i) => (
          <DayHead key={d ?? `pad-${i}`} day={d} />
        ))}
      </div>
      {/* 요일×교시 미니그리드 */}
      {group.periodRows.map((p) => (
        <div key={p.order} className="border-line grid border-b" style={{ ...gridCols, height: PERIOD_H }}>
          {days.map((d, i) => (
            <Cell key={d ?? `pad-${i}`} card={card} order={p.order} day={d} teacherColors={teacherColors} />
          ))}
        </div>
      ))}
      {/* 재원생 — 고정 12행, 넘치면 섹션 내부 스크롤(카드 높이 불변 = 이단 스크롤 방지).
          ⚠️ `text-[13px]` = 기본뷰 명단 컨테이너(class-cell)와 같은 글자 크기 — 행은 여기서 상속받는다. */}
      <div className="bg-card border-line overflow-y-auto border-b p-1 text-[13px]" style={{ height: activeH }}>
        {card.activeCount === 0 ? (
          <div className="text-text-faint py-2 text-center text-[10px]">-</div>
        ) : (
          card.active.map((s, i) => <RosterRow key={s.studentId ?? `a-${i}`} s={s} />)
        )}
      </div>
      {/* 대기 — 고정 3행 + 내부 스크롤 */}
      <div className="bg-rose-soft/30 border-line overflow-y-auto border-b p-1 text-[13px]" style={{ height: holdH }}>
        {card.hold.length === 0 ? (
          <div className="text-text-faint text-center text-[10px]">-</div>
        ) : (
          card.hold.map((s, i) => <RosterRow key={s.studentId ?? `h-${i}`} s={s} />)
        )}
      </div>
      {/* 퇴원 — 고정 5행 + 내부 스크롤. 재원/대기와 동일 서식, 진회색 배경+흰 글자 톤으로 구분 */}
      <div className="bg-bg-soft overflow-y-auto p-1 text-[13px]" style={{ height: wdH }}>
        {card.withdrawn.length === 0 ? (
          <div className="text-text-faint text-center text-[10px]">-</div>
        ) : (
          card.withdrawn.map((s, i) => <RosterRow key={s.studentId ?? `w-${i}`} s={s} />)
        )}
      </div>
    </div>
  );
}

function DayHead({ day }: { day: DayOfWeek | null }) {
  const weekend = day === "sat" || day === "sun";
  return (
    <div
      className={`border-line flex items-center justify-center border-r text-[10px] font-bold last:border-r-0 ${
        weekend ? "text-rose" : "text-text-dim"
      }`}
    >
      {day ? enumDayToKo(day) : null}
    </div>
  );
}

function Cell({
  card,
  order,
  day,
  teacherColors,
}: {
  card: RichClassCard;
  order: number;
  day: DayOfWeek | null;
  teacherColors: TeacherColorMap;
}) {
  const base = "border-line flex items-center justify-center border-r text-[10px] font-bold last:border-r-0";
  if (!day) return <div className={base} />;
  const c = card.cells[`${order}:${day}`];
  if (!c) return <div className={base} />;
  if (c.isLab) return <div className={`${base} bg-blue-soft text-blue`} title="LAB">LAB</div>;
  if (!c.label) return <div className={base} />;
  // 저장된 강사색(ijw) 우선 — 라벨(한글명·영문닉네임)이 users 맵에 있으면 그 hex. 없으면 라벨 해시색.
  const tc = teacherColors[c.label];
  if (tc)
    return (
      <div className={base} style={{ background: tc.bg, color: tc.text }} title={c.label}>
        {abbrev(c.label)}
      </div>
    );
  return (
    <div className={`${base} ${SUBJECT_SOLID[teacherColor(c.label)]} text-white`} title={c.label}>
      {abbrev(c.label)}
    </div>
  );
}

/**
 * 학생 행 — 신입=빨강·전입=초록·퇴원=진회색 배경+흰 볼드. 클릭=학생 창.
 *
 * 서식은 **기본뷰와 동일**(`이름/학교학년` 한 덩어리, 원장 지시 2026-07-27). 예전엔 통합뷰만
 * `justify-between`으로 이름은 왼쪽·메타는 오른쪽 끝에 작은 흐린 글씨로 떼어 놨고 영문명을
 * 괄호로 덧붙여, 같은 학생이 뷰마다 다르게 보였다. 이름 우선·메타는 뒤에 붙어 잘리는 규약으로 통일.
 * ⚠️ 영문명은 행에서 뺐지만 hover 카드(StudentInfoCard)엔 그대로 있어 정보 손실은 없다.
 */
function RosterRow({ s }: { s: GridStudent }) {
  const withdrawn = s.status === "withdrawn";
  const colorMode = useTimetableColorMode();
  // 재원/대기는 기본뷰와 **같은 tone 헬퍼**(색 강도 모드 반영). 예전엔 여기서 pastel 색을 손으로 박아
  // 뷰 설정 '색 강도'를 바꿔도 통합뷰만 안 따라왔다. 퇴원은 통합뷰에만 있는 섹션이라 전용 tone 유지.
  const tone = withdrawn ? withdrawnTone(colorMode) : timetableStudentTone(colorMode, s);
  const meta = schoolGradeLabel(s.school, s.grade);
  // 기본뷰 StudentRow와 같은 조립 — 이름이 먼저, 메타는 `/`로 붙어 좁으면 메타부터 잘린다(생략부호 없이 clip).
  const inner = (
    <>
      {s.name}
      {meta ? <span className="opacity-90">/{meta}</span> : null}
    </>
  );
  // ⚠️ 클래스 문자열도 기본뷰 StudentRow와 동일하게 유지할 것(px-2 py-[3px] leading-tight + hover:bg-bg-soft).
  //    글자 크기는 명단 컨테이너의 text-[13px]에서 상속 — 기본뷰 class-cell과 같은 값이다.
  const cls = `block overflow-hidden whitespace-nowrap text-clip px-2 py-[3px] leading-tight ${tone}`;
  const trigger = s.studentId ? (
    <WindowLink href={`/students/${s.studentId}`} title={s.name} ariaLabel={`${s.name} 학생 정보`} className={`${cls} hover:bg-bg-soft`}>
      {inner}
    </WindowLink>
  ) : (
    <div className={cls}>{inner}</div>
  );
  return (
    <HoverCard
      width={240}
      card={
        <StudentInfoCard
          name={s.name}
          englishName={s.englishName}
          grade={s.grade}
          school={s.school}
          status={s.status}
          isNew={s.isNew}
          isTransferredIn={s.isTransferredIn}
          enrollmentDate={s.enrollmentDate}
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
