import type { AttendanceMatrix, AttendanceStatus } from "@/features/attendance/server/queries";
import type { TeacherMoney } from "@/features/attendance/server/teacher-money";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { DAY_TONE, STATUS_TEXT, cellDisplay } from "@/features/attendance/cell-display";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import { GridProvider } from "./grid-context";
import { MatrixRow, formatMoney, rowTotals } from "./matrix-row";

/** 표에 쌓이는 한 덩어리 = 한 반. 반별 보기는 1개, 강사 전체 보기는 그 강사의 모든 반. */
export type MatrixGroup = {
  classId: string;
  className: string;
  subjectLabel: string;
  matrix: AttendanceMatrix;
};

/** 그룹(반)의 시수 합 — 급여 계산의 기본 단위라 그룹 헤더에 그대로 노출한다. */
function groupUnits(matrix: AttendanceMatrix): number {
  const sum = matrix.students.reduce(
    (acc, s) => acc + rowTotals(matrix.marks[s.id] ?? {}, matrix.units[s.id] ?? {}).unitsTotal,
    0,
  );
  return Math.round(sum * 10) / 10;
}

/**
 * 출석부 매트릭스 표 — 반별 보기(그룹 1개)와 강사 전체 보기(그룹 N개)를 **하나의 표**로 그린다.
 * 강사 전체 보기는 반마다 그룹 머리행을 얹고 맨 아래 총합 행을 붙인다(급여 계산용 시수 합).
 */
export function MatrixTable({
  groups,
  days,
  holidays,
  showGroups,
  money,
  lockBefore,
}: {
  groups: MatrixGroup[];
  days: AttendanceMatrix["days"];
  /** "YYYY-MM-DD" → 휴일명(학원설정). 헤더는 빨간 날짜 + 툴팁, 본문은 회색(수업 없음). */
  holidays: Record<string, string>;
  /** 반 머리행·총합 행 표시(강사 전체 보기). */
  showGroups: boolean;
  /** 원장 전용 금액 열. null/undefined면 열 자체를 안 그린다(강사는 못 본다). */
  money?: TeacherMoney | null;
  /** 이 날짜 이전 칸은 강사가 수정 못 함(7일 창). null = 관리자 이상이라 제한 없음. */
  lockBefore?: string | null;
}) {
  // 헤더의 수업요일 하이라이트 = 표에 담긴 반들의 수업요일 합집합(강사 전체 보기는 반마다 다르다).
  const classDows = new Set(groups.flatMap((g) => g.matrix.classDows));
  const colSpan = days.length + 5 + (money ? 2 : 0);
  const totalUnits = Math.round(groups.reduce((acc, g) => acc + groupUnits(g.matrix), 0) * 10) / 10;
  const totalRecords = groups.reduce((acc, g) => acc + g.matrix.stats.totalRecords, 0);

  // ── 시트 격자 좌표 ── 이동·범위 선택이 **화면에 보이는 순서 그대로**를 따라야 하므로 렌더와 같은 순회로 만든다.
  const gridRows = groups.flatMap((g) => g.matrix.students.map((s) => rowKey(g.classId, s.id)));
  const gridCols = days.filter((d) => !d.placeholder).map((d) => d.date);
  const gridInitial: Record<string, { s: string; u: number | null }> = {};
  for (const g of groups) {
    for (const s of g.matrix.students) {
      const marks = g.matrix.marks[s.id] ?? {};
      const units = g.matrix.units[s.id] ?? {};
      for (const [date, st] of Object.entries(marks)) {
        gridInitial[cellKey(rowKey(g.classId, s.id), date)] = { s: st, u: units[date] ?? null };
      }
    }
  }

  return (
    <GridProvider rows={gridRows} cols={gridCols} initial={gridInitial} lockBefore={lockBefore ?? null}>
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <table className="w-full min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 border-b border-r px-2 py-1 text-left whitespace-nowrap">
              <span className="micro">이름</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-1.5 py-1 text-left whitespace-nowrap">
              <span className="micro">학년</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-1.5 py-1 text-left whitespace-nowrap">
              <span className="micro">학교</span>
            </th>
            {days.map((d) => {
              // 그 달에 없는 날 — 빈 여백(번호·요일 없음). 폭은 다른 날 칸과 동일(min-w)로 고정.
              if (d.placeholder) {
                return <th key={d.date} className="border-line bg-bg-soft/30 min-w-[30px] border-b border-r" aria-hidden />;
              }
              const holiday = holidays[d.date];
              const isClassDay = classDows.has(d.dow) && !holiday;
              // 배경 = 오늘 > 수업요일(민트) > 주말·휴일(회색) > 수업 없는 평일(흰색). 본문 셀과 같은 DAY_TONE.
              // 글자색 = 일요일·공휴일이면 빨강(달력 관행).
              const bg = d.isToday
                ? "bg-primary"
                : isClassDay
                  ? DAY_TONE.classDay
                  : d.isWeekend || holiday
                    ? DAY_TONE.weekend
                    : "bg-card";
              const fg = d.isToday
                ? "text-primary-foreground"
                : holiday || d.dow === 0
                  ? "text-danger"
                  : isClassDay
                    ? "text-foreground"
                    : d.isWeekend
                      ? "text-text-dim"
                      : "text-text-faint";
              return (
                <th
                  key={d.date}
                  title={holiday ?? undefined}
                  className={`border-line num min-w-[30px] border-b border-r px-0.5 py-1 text-center text-[10px] ${bg} ${fg}`}
                >
                  <div className="font-bold">{d.day}</div>
                  <div className="opacity-70">{d.label}</div>
                </th>
              );
            })}
            {money ? (
              <>
                <th
                  className="bg-bg-soft border-line border-b border-l px-2 py-2 text-right whitespace-nowrap"
                  title="그 학생의 이 달 청구서 총액(다른 과목 포함) — 반별 배분이 아닙니다"
                >
                  <span className="micro">청구</span>
                </th>
                <th className="bg-bg-soft border-line border-b px-2 py-2 text-right whitespace-nowrap">
                  <span className="micro">납입</span>
                </th>
              </>
            ) : null}
            {/* 시수 합 — 소비 상태(출석·지각·조퇴·보강) 셀의 배수 합(기본 1). 구 출석부 '합계' 관행. */}
            <th className="bg-bg-soft border-line sticky right-[64px] z-10 w-[52px] min-w-[52px] border-b border-l px-2 py-2 text-right whitespace-nowrap">
              <span className="micro">시수</span>
            </th>
            <th className="bg-bg-soft border-line sticky right-0 z-10 w-[64px] min-w-[64px] border-b px-2 py-2 text-right whitespace-nowrap">
              <span className="micro">출석률</span>
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.classId}>
            {showGroups ? (
              <tr className="bg-bg-soft">
                <td colSpan={colSpan} className="border-line border-y p-0">
                  {/* 가로 스크롤 중에도 반 이름이 보이도록 sticky left(구 출석부 그룹 헤더 관행). */}
                  <div className="sticky left-0 flex w-fit max-w-[calc(100vw-40px)] items-center gap-2 px-3 py-1.5">
                    <span className="text-foreground text-[12px] font-bold">{g.className}</span>
                    <span className="text-text-faint text-[11px]">{g.subjectLabel}</span>
                    <span className="text-text-dim text-[11px]">{g.matrix.students.length}명</span>
                    <span className="text-text-dim num text-[11px]">시수 {formatSessionUnits(groupUnits(g.matrix))}</span>
                  </div>
                </td>
              </tr>
            ) : null}
            {g.matrix.students.map((s) => (
              <MatrixRow
                key={`${g.classId}:${s.id}`}
                student={s}
                classId={g.classId}
                matrix={g.matrix}
                days={days}
                holidays={holidays}
                money={money ? money.byStudent[s.id] ?? null : undefined}
                lockBefore={lockBefore}
              />
            ))}
          </tbody>
        ))}
        <tfoot>
          {showGroups ? (
            <tr className="bg-bg-soft">
              <td colSpan={colSpan} className="border-line border-t p-0">
                <div className="sticky left-0 flex w-fit flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="text-foreground text-[12px] font-bold">합계</span>
                  <span className="text-text-dim text-[11px]">{groups.length}개 반</span>
                  <span className="text-foreground num text-[12px] font-bold">
                    시수 {formatSessionUnits(totalUnits)}
                  </span>
                  {money ? (
                    <>
                      {/* ⚠️ 합계는 **고유 학생 1회**만 더한다 — 한 학생이 여러 반에 나와도 청구서는 한 장이다. */}
                      <span className="text-text-dim num text-[11px]">
                        청구 {formatMoney(money.totals.billed)} · 납입 {formatMoney(money.totals.paid)}
                        <span className="text-text-faint ml-1">({money.totals.students}명 기준)</span>
                      </span>
                      {money.totals.sharedStudents > 0 ? (
                        <span
                          className="text-amber text-[11px]"
                          title="다른 과목·강사와 청구서를 함께 쓰는 학생입니다. 이 금액은 강사 몫이 아니라 학생 총액이라 그대로 급여 기준으로 쓰면 안 됩니다."
                        >
                          공유 {money.totals.sharedStudents}명 포함
                        </span>
                      ) : null}
                      {/* 강사 몫(정산액)은 반×강사 배분(회차 확정)이 있어야 나온다 — 없으면 0을 지어내지 않는다. */}
                      <span className="text-text-faint text-[11px]">
                        {money.splitRows === 0
                          ? "정산액 — 회차 확정이 없어 반별 배분을 낼 수 없습니다(수납관리 > 회차)"
                          : money.commissionRate === null
                            ? "정산액 — 배분율 미설정(수납관리 > 강사 정산)"
                            : `배분율 ${money.commissionRate}% · 정산액은 수납관리 > 강사 정산에서`}
                      </span>
                    </>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : null}
          <tr>
            {/* 범례 1행: 좌측 요약 노트 + 우측(ml-auto) 범례 나열(좁으면 가로 스크롤, 줄바꿈 X) */}
            <td colSpan={colSpan} className="bg-bg-soft border-line border-t px-3 py-2">
              <div className="flex items-center gap-2 overflow-x-auto text-[11px] [&>*]:shrink-0 [&_*]:whitespace-nowrap">
                {/* 조작법을 여기 한 줄로 — 시트처럼 쓰는 화면이라 "클릭해서 고르는 곳"으로 오해하면 느려진다. */}
                <span className="text-text-faint text-[11px]">
                  총 {totalRecords}회 기록 · 칸을 고르고 <b className="text-text-dim">숫자</b>를 치세요(0=결석, 1·1.5·2=출석
                  시수) · 방향키·Tab·Enter 이동 · Shift로 범위 · Ctrl+C/V · Ctrl+Z · 우하단 손잡이를 끌면 채우기 ·
                  지각·조퇴·보강·메모는 <b className="text-text-dim">더블클릭</b>
                </span>
                <span className="micro ml-auto">범례</span>
                {/* 범례 칩은 셀과 **같은 함수**로 그린다 — 색·숫자가 실제 셀과 어긋날 수 없게. */}
                {(["present", "late", "early_leave", "makeup", "absent"] as AttendanceStatus[]).map((s) => {
                  const chip = cellDisplay(s, null);
                  return (
                    <span key={s} className="text-text-dim inline-flex items-center gap-1">
                      <span
                        className={`inline-flex size-5 items-center justify-center rounded-sm text-[10px] font-bold ${chip.className}`}
                      >
                        {chip.text}
                      </span>
                      {STATUS_TEXT[s]}
                    </span>
                  );
                })}
                <span className="text-text-dim inline-flex items-center gap-1">
                  <span className={`border-line inline-block size-5 rounded-sm border ${DAY_TONE.classDay}`} />
                  등원요일
                </span>
                <span className="text-text-dim inline-flex items-center gap-1">
                  <span className={`border-line inline-block size-5 rounded-sm border ${DAY_TONE.weekend}`} />
                  주말·휴일
                </span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </DragScrollArea>
    </GridProvider>
  );
}
