import { ParamLink } from "./param-link";
import { ChevronLeft, ChevronRight } from "@/components/icons/aywa-icon-compat";
import { addMonths, planMonthLabel, type PlanMonthSummary } from "@/features/timetable-dev/types";
import { PlanMonthActions } from "./plan-month-actions";
import { PlanSheetImportDialog } from "./plan-sheet-import-dialog";

/**
 * 시간표(개발중) **월 선택** 네비 — 본 시간표의 주간 이동(WeekNav) 자리를 대신한다.
 *
 * 🔴 계획(0232a `timetable_plan_slots`)의 앵커는 날짜가 아니라 **달**이다(9월·10월 시간표를 미리 만든다).
 *    그래서 이 화면엔 '주'가 없다 — 주 이동을 남겨 두면 눌러도 계획이 안 바뀌는 죽은 컨트롤이 된다.
 *
 * ⚠️ 링크는 전부 [ParamLink](./param-link.tsx) — `<Link>`를 쓰면 searchParam 전환마다 `loading.tsx`
 *    스켈레톤이 떠서 보이던 시간표가 지워졌다 다시 그려진다(그 파일 주석 참조).
 * ⚠️ 달 표기는 항상 `planMonthLabel()`("2026년 9월") — 화면에 `2026-09` 같은 raw 키를 노출하지 않는다.
 */
export function MonthNav({
  current,
  thisMonth,
  months,
  hasPlan,
  hrefForMonth,
  canManage,
}: {
  /** 보고 있는 계획 달(YYYY-MM). */
  current: string;
  /** 오늘이 속한 달(YYYY-MM) — '이번 달' 버튼의 목적지이자 URL 생략 기준. */
  thisMonth: string;
  /** 계획이 실제로 있는 달 목록(빈 달도 만들 수 있으니 slotCount 0도 정상). */
  months: readonly PlanMonthSummary[];
  /**
   * 이 달에 계획 칸이 있는지 — **목록에서 유추하지 않고 페이지가 실제 조회 결과로 준다**(월 목록과 칸
   * 조회가 서로 다른 쿼리라, 유추하면 둘이 어긋나는 순간 "계획 없음"인데 격자가 그려진다).
   */
  hasPlan: boolean;
  /** 달 → /timetable-dev?... (과목·구분·뷰·표시 설정 보존). */
  hrefForMonth: (month: string) => string;
  /** 계획 쓰기 권한(반 관리 = classes full). 없으면 만들기·삭제 버튼이 안 뜬다. */
  canManage: boolean;
}) {
  const isThisMonth = current === thisMonth;
  const nextMonth = addMonths(current, 1);
  const iconBtn =
    "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center rounded-full border p-1 transition";
  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-2 py-0.5 text-xs transition ${
      active
        ? "border-primary bg-primary text-primary-foreground font-medium"
        : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5 compact-chrome:hidden">달</span>
      <div className="flex items-center gap-0.5">
        <ParamLink href={hrefForMonth(addMonths(current, -1))} ariaLabel="이전 달" className={iconBtn}>
          <ChevronLeft size={13} strokeWidth={2.5} />
        </ParamLink>
        <ParamLink href={hrefForMonth(thisMonth)} className={`${chip(isThisMonth)} font-medium`}>
          이번 달
        </ParamLink>
        <ParamLink href={hrefForMonth(nextMonth)} ariaLabel="다음 달" className={iconBtn}>
          <ChevronRight size={13} strokeWidth={2.5} />
        </ParamLink>
      </div>
      <span className="text-text-dim text-xs font-medium whitespace-nowrap">
        {planMonthLabel(current)}
      </span>
      {!hasPlan ? (
        <span className="bg-amber-soft text-amber shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold whitespace-nowrap">
          계획 없음
        </span>
      ) : null}

      {/* 있는 달 — 몇 달을 만들어 뒀는지가 이 화면의 핵심 정보라 목록으로 보인다(칸 수는 미리보기 근거). */}
      {months.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {months.map((m) => (
            <ParamLink key={m.month} href={hrefForMonth(m.month)} className={chip(m.month === current)}>
              {planMonthLabel(m.month)}
              <span className="num ml-1 opacity-70">{m.slotCount}</span>
            </ParamLink>
          ))}
        </div>
      ) : null}

      <PlanMonthActions
        month={current}
        hasPlan={hasPlan}
        canManage={canManage}
      />
      {/* 시트에서 가져오기 — 원장 지시(2026-08-28): "URL 주거나 사본 업로드 중 빠른 쪽" → URL 붙여넣기.
          '현재 시간표 복사'는 이번 달을 복제할 뿐이라 **진짜 9월 자료를 넣는 유일한 길**이 이쪽이다.
          ⚠️ 조건부 마운트가 아니라 항상 마운트한다(다이얼로그는 자체 open 상태를 들고, 항상 마운트된
             다이얼로그의 성공 부수효과가 재오픈을 즉시 닫던 함정은 [[#67]] — 그 컴포넌트가 자기 트리거를
             그린다). 권한 없으면 컴포넌트가 스스로 트리거를 숨긴다(canManage). */}
      <PlanSheetImportDialog month={current} canManage={canManage} />
      {/* '다음 달 만들기'도 **시트에서** 가져온다(원장 지시 2026-08-31: *"다음달 만들기를 시트에서
          가져오는 형식이어야함 — 자동으로 연결된곳에서 가져오는것이 아닌"*).
          종전엔 이번 달 계획을 그대로 복제해서, 새 달을 만들어도 내용이 늘 같았다.
          같은 다이얼로그를 **대상 달만 다음 달로** 열어 준다(달 선택은 안에서 바꿀 수 있다). */}
      <PlanSheetImportDialog month={nextMonth} canManage={canManage} triggerLabel="다음 달 만들기" />
    </div>
  );
}
