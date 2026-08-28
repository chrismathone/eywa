import { ArrowRight, CalendarClock } from "@/components/icons/eywa-icon-compat";

/**
 * 시간표 가져오기가 **예약해 둔 담임 변경** 배너 — 읽기 전용.
 *
 * 원장 2026-08-28: 예약된 담임 변경은 반 상세에서 보이기로 했다. 위 `HandoverBanner`(수동 인수인계)와
 * 나란히 서지만 **버튼이 없다**:
 *  · 적용은 기한이 된 날 cron이 한다(`/api/cron/apply-due-class-updates`) — 사람이 누를 일이 없다.
 *  · 취소는 시간표 툴바의 "N/N 시간표 적용 예정" 배지의 ×가 한다 — 배치·반이동까지 **한 덩이**라
 *    반 하나만 되돌리면 배치와 명단이 어긋난다.
 * 그래서 여기에 '적용'·'취소'를 붙이지 말 것(붙이면 반쪽만 되돌아간다).
 *
 * ⚠️ 톤은 인수인계(브랜드 네이비)와 **다르게** 파랑 — 사람이 잡은 약속과 시스템 예약을 눈으로 가른다.
 */
export function ScheduledTeacherBanner({
  currentTeacherName,
  teacherName,
  effectiveDate,
}: {
  currentTeacherName: string | null;
  teacherName: string | null;
  effectiveDate: string;
}) {
  return (
    <div className="border-blue/30 bg-blue-soft/50 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-blue inline-flex items-center gap-1.5 text-[13px] font-bold">
          <CalendarClock className="size-4" aria-hidden="true" />
          시간표 예약 — 담임 변경 예정
        </p>
        <p className="text-foreground mt-1 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{currentTeacherName ?? "미정"}</span>
          <ArrowRight className="text-text-faint size-3.5" aria-hidden="true" />
          <span className="text-blue font-bold">{teacherName ?? "—"}</span>
          <span className="text-text-dim num text-xs">· 적용일 {effectiveDate}</span>
        </p>
        <p className="text-text-dim mt-0.5 text-xs">
          그날 자동으로 바뀝니다. 되돌리려면 시간표 화면의 적용 예정 배지에서 취소하세요.
        </p>
      </div>
    </div>
  );
}
