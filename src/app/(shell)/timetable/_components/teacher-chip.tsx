"use client";

import { useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import { readableTextColor } from "@/lib/color-utils";
import type { ClassDetailQuick } from "./class-cell";
import { ClassInfoCard, HoverCard } from "./hover-cards";
import { useClassVisible, useSearchTone } from "./search-context";
import { SEAT_PIN_MARK_CLASS } from "@/features/timetable/lib/seat-pin-mark";

// 강사뷰(10분 격자) 전용 칩 — 기본은 시트처럼 **반명+방만**, 클릭하면 그 자리에서 재원 학생
// 명단으로 전환(다시 클릭=복귀). 블록 높이는 고정(10분 축)이라 명단이 넘치면 블록 내부 스크롤.
// hover = 수업 정보 카드(시각·인원·담임 — body 포털이라 클리핑 무관), 학생 행 클릭 = 학생 창.
// (ClassCell을 안 쓰는 이유: 헤더가 WindowLink(반 창 이동)라 클릭 토글과 충돌 — 강사뷰는 읽기
// 전용 시트 미러라 전용 경량 칩이 맞다. 반 상세 진입은 기본뷰/통합뷰 소관.)

/** 학교+학년 압축("경명중"+"중1"→"경명중1") — class-cell의 metaLabel과 동일 규약. */
function metaLabel(school: string | null | undefined, grade: string | null | undefined): string {
  const sg = formatSchoolGrade(school, grade, { numberLast: true });
  return sg === "-" ? "" : sg;
}

export function TeacherChip({ slot, offAxisNote }: { slot: ClassDetailQuick; offAxisNote?: string | null }) {
  const [open, setOpen] = useState(false);
  const subjects = useSubjectMaps();
  // 학생 검색 — 걸린 반의 칩만 남는다. ⚠️ 훅은 조건 없이 전부 부른 **뒤에** 내보낸다(훅 규칙).
  //    강사뷰의 격자(10분 축·병합 셀)는 서버가 잡아 놓은 그대로 두고 **칩만** 사라진다 —
  //    축까지 접으면 "몇 시 자리인지"가 무너져 검색 결과의 위치를 못 읽는다.
  const visible = useClassVisible([slot.classId ?? slot.id]);
  const color = SUBJECT_SOFT[subjects.colorOf(slot.subject)];
  const headerStyle = slot.classBgColor
    ? { background: slot.classBgColor, color: slot.classTextColor ?? readableTextColor(slot.classBgColor) }
    : undefined;
  /**
   * 축 밖 표식(왼쪽 위 삼각형)의 **테두리 색** — 반 색이 무엇이든 표식이 보이게 하는 유일한 장치다.
   * 반 색이 지정돼 있으면 그 색에서 읽히는 색(흰색/검정)을, 없으면 과목 연한 틴트 위라 흰색을 쓴다
   * (연한 바탕에선 빨강이 이미 또렷해서 테두리는 경계만 만들면 된다).
   */
  const markEdgeColor = slot.classBgColor ? readableTextColor(slot.classBgColor) : "#ffffff";
  const active = slot.students.filter((s) => (s.status ?? "active") === "active");
  if (!visible) return null;

  return (
    // 블록(병합 셀) 전체를 채운다 — 시트 병합 셀처럼 접힘 상태에선 색면이 블록을 꽉 채우고
    // (반명은 상단), 펼침 상태에선 색 헤더 한 줄 + 아래 학생 명단. 레인 구조상 블록당 칩 1개.
    <div className="border-line relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border">
      {/* 🔺 축 밖 수업 표식 — 스프레드시트 메모처럼 **왼쪽 위 삼각형**(원장 2026-09-09: 오전 한 반 때문에
          축이 통째로 늘어나던 것을 2시로 끌어내리면서 *"왼쪽상단에 메모가 있다고 표시해놓고 실제 수업시간
          표시해줘"*). 🔴 이 칩은 그려진 자리가 **진짜 시각이 아니다** — 그 사실을 화면에 남기지 않으면
          시간표가 조용히 거짓말을 한다. 실제 시각은 삼각형 툴팁과 hover 카드(schedule)에 그대로 있다. */}
      {offAxisNote ? (
        // 🔴 **테두리를 두른다** — 종전엔 빨강 삼각형 하나였는데 반 색이 짙은 파랑이면 그 위에서 거의
        //    안 보였다(원장 2026-09-09: *"메모 색깔이 파란색이랑 겹쳐서 거의 안보여 … 혹시 나중에 반색상
        //    바꾸더라도 스마트하게"*). 색을 하나 더 고르는 대신 **바탕에서 읽히는 색**(`readableTextColor`,
        //    학원 브랜드색·반 색이 이미 쓰는 그 함수)으로 한 겹 깔고 그 위에 빨강을 얹는다 —
        //    어떤 반 색을 새로 넣어도 테두리가 알아서 흰색/검정으로 갈려 표식이 사라지지 않는다.
        // ⚠️ 뜻(경고)은 빨강이 그대로 들고 있다 — 테두리는 **보이게 하는 장치**지 다른 상태가 아니다.
        <span title={offAxisNote} aria-label={offAxisNote} className="absolute top-0 left-0 z-10">
          <span
            aria-hidden
            className="absolute top-0 left-0 size-0 border-r-[9px] border-t-[9px] border-r-transparent"
            style={{ borderTopColor: markEdgeColor }}
          />
          <span
            aria-hidden
            className="border-t-danger absolute top-0 left-0 size-0 border-t-[7px] border-r-[7px] border-r-transparent"
          />
        </span>
      ) : null}
      <HoverCard
        width={230}
        card={
          <ClassInfoCard
            className={slot.className}
            subject={slot.subject}
            teacherName={slot.teacherName}
            room={slot.classroomName}
            schedule={`${slot.startTime.slice(0, 5)}~${slot.endTime.slice(0, 5)}`}
            counts={{ active: active.length, hold: 0, withdrawn: 0 }}
            pendingHandover={slot.pendingHandover ?? null}
          />
        }
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={open ? "반명으로" : "학생 명단"}
          className={`block w-full cursor-pointer px-1.5 py-1 text-left transition hover:brightness-95 ${slot.classBgColor ? "" : color} ${
            open ? "border-line shrink-0 border-b" : "min-h-0 flex-1 overflow-hidden"
          }`}
          style={headerStyle}
        >
          {open ? (
            /* 펼침 헤더 — 명단 공간 확보를 위해 한 줄(반명+인원). */
            <div className="flex items-baseline justify-between gap-1">
              <span className="overflow-hidden text-xs leading-tight font-bold whitespace-nowrap text-clip">
                {slot.className}
              </span>
              <span className="num shrink-0 text-xs opacity-75">{active.length}</span>
            </div>
          ) : (
            /* 접힘 — 블록이 세로로 여유로우니 시트처럼 반명(줄바꿈 허용) 위 / 강의실 아랫줄.
               한 줄에 욱여넣어 반명이 잘리던 것 해소(2026-07-06 사용자 지적). */
            <div className="text-center">
              <span className="block text-xs leading-tight font-bold break-keep">{slot.className}</span>
              {slot.classroomName ? (
                <span className="mt-0.5 block text-xs opacity-75">{slot.classroomName}</span>
              ) : null}
            </div>
          )}
        </button>
      </HoverCard>
      {/* 학생 명단(토글) — 시트 통합 탭의 반별 명단처럼 이름 세로 나열. 블록 잔여 높이를 채우고 넘치면 스크롤. */}
      {open ? (
        <div className="tt-cell-scroll bg-card divide-line/40 min-h-0 flex-1 divide-y overflow-y-auto text-xs">
          {active.length === 0 ? (
            <div className="text-text-faint px-1.5 py-0.5">재원생 없음</div>
          ) : (
            active.map((s, i) => <ChipStudentRow key={s.enrollmentId ?? `s-${i}`} student={s} />)
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 칩 안 학생 한 줄 — 검색에 걸리면 표식(기본뷰 StudentRow·통합뷰 RosterRow와 **같은 함수**).
 * ⚠️ `.map` 안에서 훅을 부를 수 없어 컴포넌트로 뺀다.
 */
function ChipStudentRow({ student }: { student: ClassDetailQuick["students"][number] }) {
  const tone = useSearchTone(student, "text-foreground");
  const meta = metaLabel(student.school, student.grade);
  const inner = (
    <>
      {/* 자리(랩실) 교시 고정 — 기본뷰·통합뷰와 **같은 서식 상수**. 강사뷰 칩은 재원만 세우므로 퇴원 갈래가 없다. */}
      {student.seatPinNote ? (
        <span className={SEAT_PIN_MARK_CLASS} title={student.seatPinNote}>
          {student.name}
        </span>
      ) : (
        student.name
      )}
      {/* 기본뷰 StudentRow와 동일한 톤(opacity-90) — 뷰마다 메타 진하기가 다르면 같은 학생이 달리 보인다. */}
      {meta ? <span className="opacity-90">/{meta}</span> : null}
    </>
  );
  const rowCls = `block overflow-hidden whitespace-nowrap text-clip px-1.5 py-[2px] leading-tight ${tone}`;
  return student.studentId ? (
    <WindowLink
      href={`/students/${student.studentId}`}
      title={student.name}
      ariaLabel={`${student.name} 학생 정보`}
      className={`${rowCls} hover:bg-bg-soft`}
    >
      {inner}
    </WindowLink>
  ) : (
    <div className={rowCls}>{inner}</div>
  );
}
