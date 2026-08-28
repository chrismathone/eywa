import { CalendarClock } from "@/components/icons/eywa-icon-compat";
import { scheduledChangeLabel, type ScheduledChange } from "@/features/enrollments/scheduled-changes";

/**
 * **예정된 변경** 배너 — 학생 상세·반 상세에서 탭 바로 위에 선다(원장 2026-08-28 지시·스케치).
 *
 * 왜 여기인가: 미래로 예약한 반이동·합류는 **오늘 화면에 흔적이 없어 잊힌다**. 실측 2026-08-29에
 * 미래 시작 수강 28건이 이미 DB에 있었는데 어느 화면에도 "예정"이라는 말이 없었다.
 *
 * 톤은 의미색 `info`(파랑) — 시스템이 잡아 둔 예약이라는 뜻이다(사람이 지금 해야 할 일이 아니다).
 * ⚠️ 문구는 전부 [scheduledChangeLabel](@/features/enrollments/scheduled-changes)에서 온다 —
 *    화면에서 문장을 새로 만들면 영문 키(`move`·`join`)가 새어 나간다.
 * ⚠️ 버튼은 **권한이 있을 때만** 준다. 강사(scoped)에게도 예정은 보여야 하므로 배너 자체는 숨기지 않는다.
 * ⚠️ 종료 예정(`canCancel:false`)에는 취소를 붙이지 않는다 — 퇴원 예정을 되살리는 버튼이 된다.
 */
export function ScheduledChangeBanner({
  changes,
  today,
  /** 학생 화면이면 반 이름을, 반 화면이면 학생 이름을 앞세운다(같은 값이 반복되지 않게). */
  subject,
  actions,
}: {
  changes: ScheduledChange[];
  today: string;
  subject: "class" | "student";
  /** 줄마다 오른쪽에 붙일 컨트롤(수정·취소). 권한 없으면 넘기지 않는다. */
  actions?: (change: ScheduledChange) => React.ReactNode;
}) {
  if (changes.length === 0) return null;
  return (
    <div className="border-blue/30 bg-blue-soft/50 rounded-xl border px-4 py-3">
      <p className="text-blue inline-flex items-center gap-1.5 text-[13px] font-bold">
        <CalendarClock className="size-4" aria-hidden="true" />
        예정된 변경 {changes.length > 1 ? `${changes.length}건` : null}
      </p>
      <ul className="mt-2 space-y-1.5">
        {changes.map((c) => (
          <li
            key={`${c.enrollmentId}:${c.kind}`}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
            <span className="text-foreground min-w-0 text-sm">
              {subject === "class" ? (
                <span className="font-semibold">{c.studentName}</span>
              ) : null}{" "}
              {scheduledChangeLabel(c, today)}
            </span>
            {actions ? <span className="flex shrink-0 items-center gap-1">{actions(c)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
