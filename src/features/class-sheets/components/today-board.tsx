"use client";

/**
 * **오늘 ECS 보드** — 영어 강사의 원스크린(원장 지시 2026-08-07).
 *
 * 주간 시트가 "반 하나 × 주 하나"라면 여기는 "날짜 하나 × 내 반 전부"다. 그 날 수업이 있는 반만
 * 교시 순서로 쌓아, 강사가 **오늘 할 일**(계획이 비었나 · 출석을 찍었나 · 보고서를 썼나)을 한 화면에서 본다.
 *
 * 🔴 **출결 저장은 주간 시트와 글자 그대로 같은 두 경로**만 쓴다 —
 *    `setAttendanceCell`(출석/지각/결석, 출석부·원스크린 공용 게이트)과 `clearPresentAttendance`
 *    (0169a, plain present만). 여기서 새 저장 경로를 만들면 시수·급여가 읽는 값에 두 번째 진실이 생긴다(#77).
 * ⚠️ 지각·결석의 **사유·시수 편집은 여기에 없다** — 그건 출석부·주간 시트의 몫이다(ECS §E 규약 그대로).
 */
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { clearPresentAttendance } from "../server/actions";
import { AttendanceSelect, type BasicAttendance } from "./attendance-select";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { TodayPlanEditor } from "./today-plan-editor";
import type { TodayClassCard, TodayStudent } from "../server/today";

/** 낙관 갱신용 로컬 출결 상태 — `${classId}|${studentId}` → 상태·메모. */
type AttState = Record<string, { status: string | null; note: string | null }>;

function initialAtt(cards: TodayClassCard[]): AttState {
  const out: AttState = {};
  for (const c of cards) {
    for (const s of c.students) {
      out[`${c.classId}|${s.studentId}`] = { status: s.attendance, note: s.attendanceNote };
    }
  }
  return out;
}

/**
 * 상태 배지 — 시간표 주 네비의 '과거/미래 조회' 배지와 **같은 규약**(rounded-full · 10px · bold).
 * `done`이면 색을 빼 조용히 둔다(할 일이 남은 것만 앰버로 눈에 걸리게).
 */
function Badge({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
        done ? "bg-bg-soft text-text-dim" : "bg-amber-soft text-amber"
      }`}
    >
      {children}
    </span>
  );
}

/** 학생 한 줄 — 이름 + 출결 + 보고서 상태. */
function StudentRow({
  card,
  student,
  att,
  onSet,
  onClear,
}: {
  card: TodayClassCard;
  student: TodayStudent;
  att: { status: string | null; note: string | null };
  onSet: (status: BasicAttendance, note?: string | null) => void;
  onClear: () => void;
}) {
  return (
    // ⚠️ 이름 칸을 `1fr`로 두고 행을 화면 폭에 맡기면 넓은 창에서 이름은 왼쪽 끝, 컨트롤은 오른쪽 끝으로
    // **벌어져** 한 줄을 눈으로 잇기 어렵다(2026-08-07 실화면). 폭은 목록 컨테이너(`max-w`)가 잡고,
    // 행은 그 안을 채운다 — 그래야 밑줄도 컨트롤 있는 데까지만 그어진다.
    <div className="border-line grid grid-cols-[minmax(0,1fr)_5.75rem_auto] items-center gap-2 border-b py-1.5 last:border-b-0">
      <span className="min-w-0 truncate text-[13px]">
        {/* 구조화 행 목록(Editorial 문법 ⑤) — 이름 bold 13.5px + 설명 dim 12.5px. */}
        <span className="text-foreground text-[13.5px] font-bold">{student.name}</span>
        {student.grade ? <span className="text-text-dim ml-1 text-[12.5px]">{student.grade}</span> : null}
      </span>
      <span>
        <AttendanceSelect
          status={att.status}
          note={att.note}
          studentName={student.name}
          canMark={card.canMarkAttendance}
          onSet={onSet}
          onClear={onClear}
        />
      </span>
      {/* 보고서는 **상태만** 보여주고 작성은 원스크린으로 — 발송 파이프라인(ClassNote)이 그쪽에 있다.
          여기서 다시 만들면 발송 게이트가 두 벌이 된다(#77 "행동을 재촉하는 이벤트는 그 행동의 기존 게이트를"). */}
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
          student.reportSent
            ? "bg-primary-soft text-primary"
            : student.reportWritten
              ? "bg-amber-soft text-amber"
              : "bg-bg-soft text-text-dim"
        }`}
        title={
          student.reportSent
            ? "학부모에게 발송됨"
            : student.reportWritten
              ? "작성됨 · 아직 발송 전"
              : "아직 작성 전"
        }
      >
        {student.reportSent ? "발송" : student.reportWritten ? "작성" : "미작성"}
      </span>
    </div>
  );
}

/** 반 카드 하나 — 머리(시각·반명·요약) + 교시 계획 + 학생 목록. */
function ClassCard({
  card,
  weekMonday,
  date,
  att,
  setAtt,
  skillAreas,
  canWrite,
  userId,
  tenantId,
}: {
  card: TodayClassCard;
  weekMonday: string;
  date: string;
  att: AttState;
  setAtt: React.Dispatch<React.SetStateAction<AttState>>;
  skillAreas: SkillAreaSetting[];
  canWrite: boolean;
  userId: string;
  tenantId: string;
}) {
  const [open, setOpen] = useState(true);
  const marked = card.students.filter((s) => att[`${card.classId}|${s.studentId}`]?.status).length;
  const written = card.students.filter((s) => s.reportWritten).length;
  const planMissing = card.fill.total - card.fill.filled;

  function save(studentId: string, status: BasicAttendance, note?: string | null) {
    const key = `${card.classId}|${studentId}`;
    const before = att[key];
    setAtt((p) => ({ ...p, [key]: { status, note: note === undefined ? (before?.note ?? null) : note } }));
    void setAttendanceCell({
      classId: card.classId,
      studentId,
      sessionDate: date,
      status,
      ...(note === undefined ? {} : { note }),
    }).then((r) => {
      if ("error" in r) {
        setAtt((p) => ({ ...p, [key]: before ?? { status: null, note: null } }));
        toast.error(r.error);
      }
    });
  }

  function clear(studentId: string) {
    const key = `${card.classId}|${studentId}`;
    const before = att[key];
    if (!before?.status) return; // 이미 비어 있으면 왕복할 이유가 없다
    setAtt((p) => ({ ...p, [key]: { status: null, note: null } }));
    // 🔴 지우기는 0169a 한 경로만 — `setAttendanceCell({status:null})`은 그 칸의 **모든 정정 행**을
    //    지워 사유가 붙은 옛 행까지 앗아간다(시트에서 이미 되돌린 우회로다).
    void clearPresentAttendance({ classId: card.classId, studentId, date }).then((r) => {
      if (!r.ok) {
        setAtt((p) => ({ ...p, [key]: before }));
        toast.error(r.error);
      }
    });
  }

  return (
    <section className="bg-card shadow-card rounded-2xl">
      <header className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className="num text-foreground shrink-0 text-[15px] font-bold tabular-nums">
          {card.startsAt}
          {card.endsAt ? <span className="text-text-dim font-medium">~{card.endsAt}</span> : null}
        </span>
        <span className="text-foreground min-w-0 truncate text-[15px] font-bold">{card.className}</span>
        <span className="text-text-dim shrink-0 text-[12px]">{card.students.length}명</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* 상태 배지 = WeekNav '과거/미래 조회'와 **같은 규약**(rounded-full · 10px · bold).
              ⚠️ 색은 **못 한 일에만** 쓴다 — 다 한 줄까지 물들면 눈이 갈 곳을 잃는다. */}
          <Badge done={planMissing === 0} title="오늘 교시 중 수업계획이 채워진 교시">
            계획 {card.fill.filled}/{card.fill.total}
          </Badge>
          <Badge done={marked >= card.students.length} title="출결을 기록한 학생 수">
            출결 {marked}/{card.students.length}
          </Badge>
          <Badge done={written >= card.students.length} title="수업보고서를 작성한 학생 수">
            보고서 {written}/{card.students.length}
          </Badge>
          {/* 접기 = ECS 로스터 GroupToggle과 같은 어포던스(회전 셰브런, 테두리 없는 인라인 버튼). */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-text-dim hover:text-foreground inline-flex cursor-pointer items-center p-1 transition"
            aria-expanded={open}
            aria-label={`${card.className} ${open ? "접기" : "펼치기"}`}
            title={`${card.className} ${open ? "접기" : "펼치기"}`}
          >
            <EyIcon
              name="chevronRight"
              size={12}
              strokeWidth={2.5}
              className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        </span>
      </header>

      {open ? (
        // 계획은 읽는 칸, 학생은 손대는 칸이라 폭을 같게 줄 이유가 없다 — 학생 쪽을 조금 넓게.
        <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-w-0">
            {/* 계획은 **여기서 바로 고친다** — 주간 시트와 같은 저널·CAS·presence를 그대로 쓴다. */}
            <TodayPlanEditor
              classId={card.classId}
              className={card.className}
              weekMonday={weekMonday}
              slots={card.slots}
              skillAreas={skillAreas}
              canEdit={canWrite}
              userId={userId}
              tenantId={tenantId}
            />
            {/* 🔴 안 그린 기록은 **침묵하지 않는다** — "분명히 썼는데 안 보인다"를 막는 각주(주간 시트의
                '시간 변경된 기록 N건'과 같은 규약). 되돌릴 곳(주간 시트)까지 함께 가리킨다. */}
            {card.hiddenLines > 0 ? (
              <p className="text-text-dim mt-1 text-[12px]">
                이 화면에 안 나오는 기록 {card.hiddenLines}건 — 시간이 바뀌었거나 자리(LAB·JJ) 교시입니다. 주간
                시트에서 확인하세요.
              </p>
            ) : null}
            <Link
              href={`/ecs/${card.classId}?week=${weekMonday}`}
              className="text-primary mt-1 inline-block text-[13px] font-bold underline-offset-2 hover:underline"
            >
              주간 시트 열기 →
            </Link>
          </div>

          {/* 목록 폭을 여기서 묶는다(넓은 창에서 행이 끝없이 늘어나 밑줄만 길게 남는 것 방지). */}
          <div className="min-w-0 max-w-[26rem]">
            <p className="editorial-eyebrow mb-1.5">학생 · 출결 · 보고서</p>
            {card.students.length === 0 ? (
              <p className="text-text-faint text-[13px]">이 날 수강하는 학생이 없습니다</p>
            ) : (
              card.students.map((s) => (
                <StudentRow
                  key={s.studentId}
                  card={card}
                  student={s}
                  att={att[`${card.classId}|${s.studentId}`] ?? { status: null, note: null }}
                  onSet={(status, note) => save(s.studentId, status, note)}
                  onClear={() => clear(s.studentId)}
                />
              ))
            )}
            <Link
              href={`/onescreen?date=${date}`}
              className="text-primary mt-2 inline-block text-[13px] font-bold underline-offset-2 hover:underline"
            >
              수업보고서 쓰기 →
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function TodayBoard({
  cards,
  date,
  weekMonday,
  skillAreas,
  canWrite,
  userId,
  tenantId,
}: {
  cards: TodayClassCard[];
  date: string;
  weekMonday: string;
  skillAreas: SkillAreaSetting[];
  canWrite: boolean;
  userId: string;
  tenantId: string;
}) {
  const [att, setAtt] = useState<AttState>(() => initialAtt(cards));
  return (
    <div className="space-y-3">
      {cards.map((card) => (
        <ClassCard
          key={card.classId}
          card={card}
          weekMonday={weekMonday}
          date={date}
          att={att}
          setAtt={setAtt}
          skillAreas={skillAreas}
          canWrite={canWrite}
          userId={userId}
          tenantId={tenantId}
        />
      ))}
    </div>
  );
}
