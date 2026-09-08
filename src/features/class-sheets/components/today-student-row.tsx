"use client";

/**
 * 오늘 보드의 **학생 한 줄** — 이름 + 출결 드롭다운 + 교시별 기록 팝오버 + 보고서 상태.
 * today-board.tsx에서 분리(한 파일 200줄 규칙) — 저장 경로·계약은 그대로다(#77: 출결은
 * setAttendanceCell/clearPresentAttendance 두 경로만, 보고서는 원스크린 링크만).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BasicAttendance } from "../lib/mark-cycle";
import { removeMakeupAttendee } from "../server/actions";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { TodayAttendancePills } from "./today-attendance-pills";
import { TodayMarkPopover, type MarkMap, type MarkSlot, type StudentMark } from "./today-mark-popover";
import type { TodayClassCard, TodayStudent } from "../server/today";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { studentNameParts } from "@/features/teacher-view/student-name";

export function StudentRow({
  card,
  student,
  date,
  slotLabels,
  marks,
  onMark,
  canEdit,
  att,
  onSet,
  onClear,
}: {
  card: TodayClassCard;
  student: TodayStudent;
  date: string;
  /** 그 반의 그날 교시(시각·라벨·폼) — 학생 기록은 교시별로 저장되고, JJ 교시엔 전용 칸이 붙는다. */
  slotLabels: MarkSlot[];
  marks: MarkMap;
  onMark: (slotStart: string, next: StudentMark | null) => void;
  /** 학생 기록 편집 가능 — 계획 편집과 **같은 게이트**(ecs full|scoped). */
  canEdit: boolean;
  att: { status: string | null; note: string | null };
  onSet: (status: BasicAttendance, note?: string | null) => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  // 🔴 영어 화면에서는 영어 이름이 주 이름 — 판정은 `studentNameParts` 한 곳이다(주간 시트와 같은 규칙).
  const names = studentNameParts(student.name, student.englishName, lang);
  return (
    // ⚠️ 이름 칸을 `1fr`로 두고 행을 화면 폭에 맡기면 넓은 창에서 이름은 왼쪽 끝, 컨트롤은 오른쪽 끝으로
    // **벌어져** 한 줄을 눈으로 잇기 어렵다(2026-08-07 실화면). 폭은 목록 컨테이너(`max-w`)가 잡고,
    // 행은 그 안을 채운다 — 그래야 밑줄도 컨트롤 있는 데까지만 그어진다.
    // 출결 칸 폭 = 알약 3개(출석·지각·결석)가 정확히 앉는 고정폭 — auto로 두면 읽기전용 행(배지 하나)과
    // 알약 행의 칸 폭이 달라져 열이 들쭉날쭉해진다.
    // 폭 9rem(144px) = 2026-09-08 v5 글자 기준 실측 — text-xs 14px 알약(2자 28 + px-1.5 12 + 비활성 border 2 = 42)
    // ×3 + gap-0.5×2 = 130px에 사유 점(+16)까지 146px 수용. 옛 7.25rem(116px)은 12px 시절 값이라 미기록 행이
    // 14px 넘쳐 옆 칸(TodayMarkPopover) 위로 올라왔다. 고정 트랙이라 넘치면 그대로 흘러나온다(이름 칸 1fr이 흡수).
    <div className="border-line grid grid-cols-[minmax(0,1fr)_9rem_auto_auto] items-center gap-2 border-b py-1.5 last:border-b-0">
      <span className="min-w-0 truncate text-sm">
        {/* 구조화 행 목록(Editorial 문법 ⑤) — 이름 bold 13.5px + 설명 dim 12.5px. */}
        {/* 🔴 이름 두 줄이 아니라 **주 이름 + 보조**를 한 줄에 잇는다(이 행은 높이가 촘촘하다).
            🔴 보조 이름은 **영어 화면에서만** 붙인다 — 한국어 화면은 원래 이름 하나만 있었고
               (주간 시트와 달리 이 행은 한 줄짜리 촘촘한 목록이다) 원장 지시는 영어 화면을 고치는
               것이라 한국어 화면이 덩달아 바뀌면 안 된다("ko는 글자까지 그대로"). */}
        <span className="text-foreground text-sm font-bold">{names.primary}</span>
        {lang === "en" && names.secondary ? (
          <span className="text-text-dim ml-1 text-xs">{names.secondary}</span>
        ) : null}
        {student.grade ? <span className="text-text-dim ml-1 text-xs">{student.grade}</span> : null}
      </span>
      <span>
        {/* 드롭다운 배제(원장 2026-08-11) — 1클릭 알약. 저장 경로(onSet/onClear)는 그대로다. */}
        <TodayAttendancePills
          status={att.status}
          note={att.note}
          studentName={names.primary}
          canMark={card.canMarkAttendance}
          onSet={onSet}
          onClear={onClear}
          onRemoveMakeup={
            student.isMakeup
              ? () => {
                  void removeMakeupAttendee({
                    classId: card.classId,
                    studentId: student.studentId,
                    date,
                  }).then((r) => {
                    if (!r.ok) {
                      toast.error(r.error);
                      return;
                    }
                    toast.success(t("today.makeup.removed"));
                    router.refresh();
                  });
                }
              : undefined
          }
        />
      </span>
      {/* 태도·특이사항 — 주간 시트의 두 칸을 **교시별로** 담은 팝오버(행을 넓히지 않으면서 같은 표를 고친다). */}
      <TodayMarkPopover
        classId={card.classId}
        date={date}
        studentId={student.studentId}
        studentName={names.primary}
        slots={slotLabels}
        marks={marks}
        canEdit={canEdit}
        onChange={onMark}
      />
      {/* 보고서는 **상태만** 보여주고 작성은 원스크린으로 — 발송 파이프라인(ClassNote)이 그쪽에 있다.
          여기서 다시 만들면 발송 게이트가 두 벌이 된다(#77 "행동을 재촉하는 이벤트는 그 행동의 기존 게이트를").
          배지는 **그 학생 보고서로 가는 링크**다(2026-08-07) — 상태를 보고 바로 손대는 게 자연스럽다. */}
      <Link
        href={`/onescreen?date=${date}&class=${card.classId}&student=${student.studentId}`}
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold whitespace-nowrap transition hover:opacity-80 ${
          student.reportSent
            ? TONE_SOFT.positive
            : student.reportWritten
              ? TONE_SOFT.caution
              : TONE_SOFT.inert
        }`}
        title={tf(
          student.reportSent
            ? "today.report.sent.title"
            : student.reportWritten
              ? "today.report.written.title"
              : "today.report.none.title",
          { name: names.primary },
        )}
      >
        {t(
          student.reportSent
            ? "today.report.sent"
            : student.reportWritten
              ? "today.report.written"
              : "today.report.none",
        )}
      </Link>
    </div>
  );
}
