import "server-only";
/**
 * 강사 홈 상단 **오늘 출석 스트립** — 이 기능이 실제로 습관을 바꾸는 지점.
 *
 * 🔴 화면을 하나 더 만드는 것만으로는 안 바뀐다(실측: 강사 절반이 밤·새벽에 몰아 찍는다 — 김동후는
 *    기록 시각 중앙값이 **01:49**). 새 메뉴를 만들어도 그들은 그 메뉴를 밤에 연다. 그래서 출석을
 *    **이미 매일 여는 화면(원스크린·ECS)의 맨 위**에 얹는다 — 수업 직후에 눈에 들어오는 자리다.
 *
 * 규칙:
 *  · **지금 해야 할 것만** 보인다(시작한 교시 중 미입력이 남은 것). 다 찍었으면 스트립 자체가 사라진다.
 *  · 정상 수업은 「전원 출석」 한 번(실측상 결석은 하루 6~10건뿐).
 *  · 예외가 있으면 '자세히'로 오늘 출결 화면(교시 카드)으로 간다.
 * ⚠️ 이 컴포넌트는 원스크린·ECS의 **첫 페인트를 막으면 안 된다** — 소비처가 Suspense로 감싼다(B7).
 *    전원이 매일 여는 hot path라 조회 실패가 화면을 죽이지 않게 스스로 삼킨다(빈 스트립 = 평소와 같은 화면).
 */
import Link from "next/link";
import { kstToday } from "@/lib/date-kst";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/observability/report-error";
import { groupAdjacentSlots } from "../seating";
import { isSpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { getLiveBoard, loadRequestMarks } from "../server/queries";
// 강사뷰 화면 언어(2026-09-03) — 서버 컴포넌트라 context를 못 읽어 직접 판정한다(요청 캐시라 왕복 공유).
import { sheetT, sheetTf } from "@/features/teacher-view/i18n";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { StripSlot } from "./strip-slot";

export async function TodayAttendanceStrip({ className }: { className?: string } = {}) {
  // 🔴 **내 수업만**(selfOnly) — 관리자 계열도 여기선 자기 반만 본다. 안 그러면 원스크린을 여는 것만으로
  //    전체 보드를 읽고(느려짐), 남의 반에 「전원 출석」이 붙는다. 전체는 /attendance/live에서 본다.
  // ⚠️ 실패는 삼키되 **소리 없이 삼키지 않는다**(#89) — 이 스트립은 실패하면 그냥 안 보이므로, 조회가
  //    매번 깨져도 화면은 평소와 똑같아 아무도 눈치채지 못한다(기능이 죽은 채로 몇 주가 간다).
  const today = kstToday();
  // 🔴 언어도 **같은 `Promise.all`에** 넣는다(B4) — 앞에 따로 await하면 보드 조회 앞에 왕복이 하나
  //    더 줄지어 서고, 이 스트립은 강사가 매일 여는 hot path다. 서로 의존이 없다.
  //    (관리자·한국어 사용자는 `getShellView()`에서 조회 없이 즉시 'ko'로 떨어진다.)
  const [board, deskRequested, lang] = await Promise.all([
    getLiveBoard(today, true).catch((e: unknown) => {
      reportError(e, { scope: "attendance.todayStrip" });
      return null;
    }),
    // '데스크 요청함' 표식 — 실패해도 버튼이 다시 보일 뿐이다(서버 dedup이 중복 발송을 막는다).
    loadRequestMarks(today, "attendance_desk_confirm_request").catch(() => new Set<string>()),
    getTeacherViewLang(),
  ]);
  if (!board?.canEdit) return null;

  // 시작한 교시(grace 포함 — 수업이 시작됐으면 찍을 수 있다) 중 아직 빈 칸이 남은 것만.
  const slots = groupAdjacentSlots(board.teachers.flatMap((t) => t.slots)).filter(
    (s) =>
      s.phase !== "before" &&
      s.recordedCount < s.students.length &&
      !isSpecialSlotLabel(s.slotTeacherLabel),
  );
  if (slots.length === 0) return null;

  const missing = slots.reduce((n, s) => n + (s.students.length - s.recordedCount), 0);

  return (
    <section className={cn("border-amber/40 bg-amber/5 space-y-2 rounded-2xl border p-3", className)}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-amber text-sm font-bold">{sheetT(lang, "strip.title")}</h2>
        {/* 🔴 수가 든 문구는 **문장 전체**를 사전에서 받는다 — 조각으로 이으면 영어 어순이 무너진다. */}
        <span className="num text-text-dim text-xs">
          {sheetTf(lang, "strip.count", { slots: slots.length, students: missing })}
        </span>
        <Link
          href="/attendance/live"
          className="text-primary ml-auto text-xs font-semibold hover:underline"
        >
          {sheetT(lang, "strip.detailLink")}
        </Link>
      </header>
      {/* 열 수는 고정이 아니라 **한 줄 카드가 들어가는 폭(34rem)** 기준 auto-fill — 카드가 이름·시각·
          명단·버튼 3개를 한 줄에 눕히므로(원장 "1개열"), 고정 3열이면 보통 노트북에서 카드가 ~400px로
          좁아져 결국 버튼이 둘째 줄로 떨어진다(적대 리뷰 2026-08-18). min(…,100%)은 모바일 오버플로 가드. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(34rem,100%),1fr))] gap-2">
        {slots.map((slot) => (
          <StripSlot
            key={slot.key}
            date={board.date}
            classId={slot.classId}
            className={slot.className}
            slotStart={slot.slotStart}
            saveSlot={slot.saveSlot}
            periodLabel={slot.periodLabel}
            pendingIds={slot.students.filter((s) => s.status == null).map((s) => s.studentId)}
            pendingStudents={slot.students.filter((s) => s.status == null).map((s) => ({ name: s.studentName, englishName: s.englishName }))}
            deskRequested={deskRequested.has(`${slot.classId}|${slot.saveSlot ?? ""}`)}
          />
        ))}
      </div>
    </section>
  );
}
