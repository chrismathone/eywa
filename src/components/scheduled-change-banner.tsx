import { CalendarClock } from "@/components/icons/aywa-icon-compat";
import { scheduledChangeLabel, type ScheduledChange } from "@/features/enrollments/scheduled-changes";
import {
  scheduledMakeupLabel,
  scheduledMakeupTitle,
  type ScheduledMakeupLine,
} from "@/features/attendance/makeup-reservation";
import { DEFAULT_SHEET_LANG, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/** 배너 한 줄 — 수강 변경(수정·취소 대상) 또는 보강 예약(읽기 전용). 날짜 하나로 함께 줄 세운다. */
type BannerRow =
  | { key: string; date: string; change: ScheduledChange }
  | { key: string; date: string; makeup: ScheduledMakeupLine };

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
 * ⚠️ 보강 예약(0264a)도 같은 줄기에 선다 — 읽기 전용이라 버튼이 없다(아래 `makeups` 주석).
 */
export function ScheduledChangeBanner({
  changes,
  today,
  /** 학생 화면이면 반 이름을, 반 화면이면 학생 이름을 앞세운다(같은 값이 반복되지 않게). */
  subject,
  actions,
  makeups = [],
  lang = DEFAULT_SHEET_LANG,
}: {
  changes: ScheduledChange[];
  today: string;
  subject: "class" | "student";
  /** 줄마다 오른쪽에 붙일 컨트롤(수정·취소). 권한 없으면 넘기지 않는다. */
  actions?: (change: ScheduledChange) => React.ReactNode;
  /**
   * 앞으로 잡힌 **보강 예약**(0264a) — 학생 상세만 넘긴다(원장 2026-09-14).
   * 🔴 수강 변경과 **한 배열로 합치지 않는다**: 저쪽은 `enrollmentId`가 곧 쓰기 대상이고 수정·취소가 붙지만
   *    예약은 읽기 전용이다(고치는 자리는 출석부 칸). 예약만 있어도 배너는 선다.
   */
  makeups?: readonly ScheduledMakeupLine[];
  /** 강사뷰 화면 언어. 안 주면 한국어라 아직 안 배선된 호출부는 한 글자도 안 바뀐다. */
  lang?: SheetLang;
}) {
  if (changes.length === 0 && makeups.length === 0) return null;
  // 🔑 **날짜순 한 줄기** — 이 배너가 답하는 질문은 "무엇이 언제 오나"다. 종류별로 묶으면 9/17 보강이
  //    10/3 종료 아래로 내려가 순서가 거짓이 된다.
  const rows: BannerRow[] = [
    ...changes.map((c) => ({ key: `c:${c.enrollmentId}:${c.kind}`, date: c.date, change: c })),
    ...makeups.map((m) => ({ key: `m:${m.id}`, date: m.makeupDate, makeup: m })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="border-blue/30 bg-blue-soft/50 rounded-xl border px-4 py-3">
      <p className="text-blue inline-flex items-center gap-1.5 text-sm font-bold">
        <CalendarClock className="size-4" aria-hidden="true" />
        {sheetT(lang, "sched.title")}{" "}
        {rows.length > 1 ? sheetTf(lang, "sched.count", { n: rows.length }) : null}
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {"change" in r ? (
              <>
                <span className="text-foreground min-w-0 text-sm">
                  {subject === "class" ? (
                    <span className="font-semibold">{r.change.studentName}</span>
                  ) : null}{" "}
                  {scheduledChangeLabel(r.change, today, lang)}
                </span>
                {actions ? (
                  <span className="flex shrink-0 items-center gap-1">{actions(r.change)}</span>
                ) : null}
              </>
            ) : (
              <span className="text-foreground min-w-0 text-sm" title={scheduledMakeupTitle(r.makeup)}>
                {scheduledMakeupLabel(r.makeup, today, lang)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
