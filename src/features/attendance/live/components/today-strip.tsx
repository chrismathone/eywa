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
import { getLiveBoard } from "../server/queries";
import { StripSlot } from "./strip-slot";

export async function TodayAttendanceStrip() {
  const board = await getLiveBoard(kstToday()).catch(() => null);
  if (!board?.canEdit) return null;

  // 시작한 교시(grace 포함 — 수업이 시작됐으면 찍을 수 있다) 중 아직 빈 칸이 남은 것만.
  const slots = board.teachers
    .flatMap((t) => t.slots)
    .filter((s) => s.phase !== "before" && s.recordedCount < s.students.length);
  if (slots.length === 0) return null;

  const missing = slots.reduce((n, s) => n + (s.students.length - s.recordedCount), 0);

  return (
    <section className="border-amber/40 bg-amber/5 space-y-2 rounded-2xl border p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-amber-strong text-sm font-bold">오늘 출석 미입력</h2>
        <span className="num text-text-dim text-xs">
          {slots.length}개 교시 · {missing}명
        </span>
        <Link
          href="/attendance/live"
          className="text-primary ml-auto text-xs font-semibold hover:underline"
        >
          오늘 출결 자세히
        </Link>
      </header>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
            pendingNames={slot.students.filter((s) => s.status == null).map((s) => s.studentName)}
          />
        ))}
      </div>
    </section>
  );
}
