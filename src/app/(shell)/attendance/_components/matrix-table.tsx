import type { AttendanceMatrix, AttendanceStatus } from "@/features/attendance/server/queries";
import type { TeacherMoney } from "@/features/attendance/server/teacher-money";
import { DAY_TONE, HEAD_ROW_H, STATUS_TEXT, cellDisplay } from "@/features/attendance/cell-display";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import { countMarks, sumCounts, type Counted } from "@/features/attendance/grid/totals";
import { ClassGroupBody, CollapseAllButton } from "./class-group";
import { LiveRecords, LiveUnits } from "./live-totals";
import { MatrixRow, formatMoney } from "./matrix-row";

/**
 * sticky 헤더의 선 — `border-collapse` 표에선 테두리 소유권이 **표**에 있어 sticky 셀만 남고 선은 밀려 사라진다(#71).
 * box-shadow도 병합모드 th에선 불안정 → **셀 자식 가상요소 1px 실선**으로 그린다(셀과 함께 고정).
 * ⚠️ sticky 셀은 그 자체가 positioned라 이게 기준이 된다 — `relative`를 덧붙이면 position이 덮여 sticky가 깨진다.
 */
const HEAD_UNDERLINE =
  "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line after:content-['']";
/** 가로 스크롤에도 남아야 하는 세로 divider(좌/우 고정 열의 경계). */
const EDGE_RIGHT = "before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-line before:content-['']";
const EDGE_LEFT = "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-line before:content-['']";
/**
 * 헤더 z단계 — 본문 셀의 선택 오버레이·채우기 손잡이가 z-20~40을 쓰므로(attendance-cell) 헤더는 **그 위**여야
 * 스크롤로 밀려 들어온 칸이 헤더를 뚫고 나오지 않는다. 좌우까지 고정된 모서리 칸은 한 단계 더 위.
 */
const HEAD_Z = "z-50";
const HEAD_CORNER_Z = "z-[60]";

/**
 * 열 폭 — **고정**이다(px). 자동 폭이면 열 너비가 **내용**에서 나오므로, 반을 접어 그 반의 긴 학교 이름이
 * 사라지는 순간 이름·학교 열이 줄고 표 전체가 출렁인다(원장 지적 2026-08-06: "접을 때마다 열너비가 변경").
 * `table-fixed` + `<colgroup>`으로 폭을 내용에서 떼어내면 접든 펼치든 같은 자리에 선다.
 *
 * ⚠️ 날짜 칸만 폭을 **안 준다**(auto) — 남는 가로 폭을 날짜 칸들이 똑같이 나눠 갖는다. 표에 `minWidth`를
 *    걸어 두므로 아무리 좁아져도 한 칸 30px 아래로는 안 내려간다(좁으면 가로 스크롤).
 * ⚠️ 시수·출석률에 폭을 주는 건 sticky `right-[64px]`이 **출석률 폭과 짝**이기 때문 — 이 값이 늘면 두 열이 겹친다.
 * ⚠️ 폭을 넘는 글자는 잘리고 `title`에 원문이 남는다(`truncate`) — 넓히면 그만큼 날짜 칸이 줄어든다.
 */
const COL_W = { name: 116, grade: 48, school: 120, money: 76, units: 52, rate: 64, day: 30 } as const;

/** 표에 쌓이는 한 덩어리 = 한 반. 반별 보기는 1개, 강사 전체 보기는 그 강사의 모든 반. */
export type MatrixGroup = {
  classId: string;
  className: string;
  subjectLabel: string;
  matrix: AttendanceMatrix;
};

/** 그룹(반)의 집계 — 시수는 급여 계산의 기본 단위라 그룹 헤더에 그대로 노출한다. */
function groupCount(matrix: AttendanceMatrix): Counted {
  return sumCounts(
    matrix.students.map((s) => countMarks(matrix.marks[s.id] ?? {}, matrix.units[s.id] ?? {})),
  );
}

/**
 * 격자 좌표·초기값 — 이동·범위 선택이 **화면에 보이는 순서 그대로**를 따라야 하므로 렌더와 같은 순회로 만든다.
 * ⚠️ `cols`는 보이는 날짜뿐이지만(2주 보기는 14칸) `initial`은 **그 달 전체**를 싣는다 — 합계(시수·출석률)는
 *    보이는 열이 아니라 월 전체 기준이라, 안 보이는 날의 기록도 저장소에 있어야 한다.
 */
export function buildGridSource(
  groups: MatrixGroup[],
  days: AttendanceMatrix["days"],
  /** 화면에 그릴 **정렬된 순서**. 방향키·범위 선택이 이 배열의 인덱스로 움직이므로 렌더와 반드시 같아야 한다. */
  ordered: readonly { classId: string; studentId: string }[],
) {
  const rows = ordered.map((r) => rowKey(r.classId, r.studentId));
  const cols = days.filter((d) => !d.placeholder).map((d) => d.date);
  const initial: Record<string, { s: string; u: number | null }> = {};
  // 하루에 교시가 둘 이상인 칸만(0196a) — 한 칸에 친 숫자가 그날 **몇 건**을 고치는지.
  const slotCounts: Record<string, number> = {};
  for (const g of groups) {
    for (const s of g.matrix.students) {
      const marks = g.matrix.marks[s.id] ?? {};
      const units = g.matrix.units[s.id] ?? {};
      const slots = g.matrix.slots[s.id] ?? {};
      for (const [date, st] of Object.entries(marks)) {
        const key = cellKey(rowKey(g.classId, s.id), date);
        initial[key] = { s: st, u: units[date] ?? null };
        const n = slots[date]?.length ?? 1;
        if (n > 1) slotCounts[key] = n;
      }
    }
  }
  return { rows, cols, initial, slotCounts };
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
  ordered,
}: {
  groups: MatrixGroup[];
  days: AttendanceMatrix["days"];
  /** 정렬된 행 순서(sort-rows.ts). 반별이 아니면 반 머리행 없이 이 순서 그대로 한 덩어리로 그린다. */
  ordered: readonly { classId: string; studentId: string }[];
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
  const totalCount = sumCounts(groups.map((g) => groupCount(g.matrix)));
  // 표 최소 폭 = 고정 열 합 + 날짜 칸 최소치. 화면이 이보다 넓으면 남는 폭은 날짜 칸이 나눠 갖는다.
  const tableMinWidth =
    COL_W.name +
    COL_W.grade +
    COL_W.school +
    days.length * COL_W.day +
    (money ? COL_W.money * 2 : 0) +
    COL_W.units +
    COL_W.rate;

  return (
    // 격자가 **화면의 유일한 세로 스크롤**이다(scrollY) — 그래야 `thead sticky top-0`이 실제로 붙고
    // 스크롤바도 하나만 생긴다. 높이는 부모(page.tsx의 `min-h-0 flex-1`)가 정해 준다 — 상수·vh 계산 없음.
    <DragScrollArea scrollY className="bg-card shadow-card h-full rounded-2xl">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: tableMinWidth }}>
        {/* 열 폭의 단일 소스 — 셀의 `w-*`가 아니라 여기가 정한다(table-fixed). 접기와 무관하게 불변. */}
        <colgroup>
          <col style={{ width: COL_W.name }} />
          <col style={{ width: COL_W.grade }} />
          <col style={{ width: COL_W.school }} />
          {days.map((d) => (
            <col key={d.date} />
          ))}
          {money ? (
            <>
              <col style={{ width: COL_W.money }} />
              <col style={{ width: COL_W.money }} />
            </>
          ) : null}
          <col style={{ width: COL_W.units }} />
          <col style={{ width: COL_W.rate }} />
        </colgroup>
        <thead>
          {/* 높이 고정 — 칸의 scroll-margin-top과 짝을 이룬다(cell-display.ts `HEAD_ROW_H` 주석). */}
          <tr className={HEAD_ROW_H}>
            <th
              className={`bg-bg-soft sticky top-0 left-0 ${HEAD_CORNER_Z} ${HEAD_UNDERLINE} ${EDGE_RIGHT} px-2 py-1 text-left whitespace-nowrap`}
            >
              {/* 반 접기가 있는 보기에서만 — 별도 줄 없이 이름 열 머리에 얹는다. */}
              {showGroups ? <CollapseAllButton classIds={groups.map((g) => g.classId)} /> : null}
              <span className="micro">이름</span>
            </th>
            <th
              className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1.5 py-1 text-left whitespace-nowrap`}
            >
              <span className="micro">학년</span>
            </th>
            <th
              className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-r px-1.5 py-1 text-left whitespace-nowrap`}
            >
              <span className="micro">학교</span>
            </th>
            {days.map((d) => {
              // 그 달에 없는 날 — 빈 여백(번호·요일 없음). 폭은 다른 날 칸과 동일(min-w)로 고정.
              if (d.placeholder) {
                // ⚠️ 불투명이어야 한다(#74) — sticky 헤더가 반투명이면 밑으로 지나가는 학생 행이 비쳐 보인다.
                return (
                  <th
                    key={d.date}
                    className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} min-w-[30px] border-r`}
                    aria-hidden
                  />
                );
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
                  className={`border-line num sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} min-w-[30px] border-r px-0.5 py-1 text-center text-[10px] ${bg} ${fg}`}
                >
                  <div className="font-bold">{d.day}</div>
                  <div className="opacity-70">{d.label}</div>
                </th>
              );
            })}
            {money ? (
              <>
                <th
                  className={`bg-bg-soft border-line sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} border-l px-2 py-2 text-right whitespace-nowrap`}
                  title="그 학생의 이 달 청구서 총액(다른 과목 포함) — 반별 배분이 아닙니다"
                >
                  <span className="micro">청구</span>
                </th>
                <th className={`bg-bg-soft sticky top-0 ${HEAD_Z} ${HEAD_UNDERLINE} px-2 py-2 text-right whitespace-nowrap`}>
                  <span className="micro">납입</span>
                </th>
              </>
            ) : null}
            {/* 시수 합 — 소비 상태(출석·지각·조퇴·보강) 셀의 배수 합(기본 1). 구 출석부 '합계' 관행. */}
            <th
              className={`bg-bg-soft sticky top-0 right-[64px] ${HEAD_CORNER_Z} ${HEAD_UNDERLINE} ${EDGE_LEFT} w-[52px] min-w-[52px] px-2 py-2 text-right whitespace-nowrap`}
            >
              <span className="micro">시수</span>
            </th>
            <th
              className={`bg-bg-soft sticky top-0 right-0 ${HEAD_CORNER_Z} ${HEAD_UNDERLINE} w-[64px] min-w-[64px] px-2 py-2 text-right whitespace-nowrap`}
            >
              <span className="micro">출석률</span>
            </th>
          </tr>
        </thead>
        {/* 반별이 아닌 정렬(가나다·학년·담임순)은 **반 구분을 없애고** 정렬된 순서 그대로 한 덩어리로.
            행마다 classId를 들고 있어 저장 대상 반은 그대로 유지된다(칸을 쳐도 옳은 반에 기록된다). */}
        {showGroups ? null : (
          <tbody>
            {ordered.map((r) => {
              const g = groups.find((x) => x.classId === r.classId);
              const s = g?.matrix.students.find((x) => x.id === r.studentId);
              if (!g || !s) return null;
              return (
                <MatrixRow
                  key={`${g.classId}:${s.id}`}
                  student={s}
                  classId={g.classId}
                  matrix={g.matrix}
                  days={days}
                  holidays={holidays}
                  money={money ? money.byStudent[s.id] ?? null : undefined}
                  lockBefore={lockBefore}
                  classLabel={g.className}
                />
              );
            })}
          </tbody>
        )}
        {!showGroups ? null : groups.map((g) => {
          const rows = g.matrix.students.map((s) => (
            <MatrixRow
              key={`${g.classId}:${s.id}`}
              student={s}
              classId={g.classId}
              matrix={g.matrix}
              days={days}
              holidays={holidays}
              money={money ? money.byStudent[s.id] ?? null : undefined}
              lockBefore={lockBefore}
              classLabel={g.className}
            />
          ));
          return (
            <ClassGroupBody
              key={g.classId}
              classId={g.classId}
              colSpan={colSpan}
              summary={
                <>
                  <span className="text-foreground text-[12px] font-bold">{g.className}</span>
                  <span className="text-text-faint text-[11px]">{g.subjectLabel}</span>
                  <span className="text-text-dim text-[11px]">{g.matrix.students.length}명</span>
                  <span className="text-text-dim num text-[11px]">
                    시수{" "}
                    <LiveUnits
                      rows={g.matrix.students.map((s) => rowKey(g.classId, s.id))}
                      fallback={groupCount(g.matrix)}
                    />
                  </span>
                </>
              }
            >
              {rows}
            </ClassGroupBody>
          );
        })}
        <tfoot>
          {/* ⚠️ 합계는 **반이 여럿이면 항상** 그린다 — `showGroups`(반 머리행 여부)에 묶으면 가나다·학년·
              담임순으로 바꾸는 순간 시수 총합·정산 안내가 통째로 사라진다(적대 리뷰 2026-08-06). */}
          {groups.length > 1 ? (
            <tr className="bg-bg-soft">
              <td colSpan={colSpan} className="border-line border-t p-0">
                <div className="sticky left-0 flex w-fit flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="text-foreground text-[12px] font-bold">합계</span>
                  <span className="text-text-dim text-[11px]">{groups.length}개 반</span>
                  <span className="text-foreground num text-[12px] font-bold">
                    시수 <LiveUnits fallback={totalCount} />
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
                  총 <LiveRecords fallback={totalCount} />회 기록 · 칸을 고르고{" "}
                  <b className="text-text-dim">숫자</b>를 치세요(0=결석, 1·1.5·2=출석
                  시수) · 방향키·Tab·Enter 이동 · Shift로 범위 · Ctrl+C/V · Ctrl+Z · 우하단 손잡이를 끌면 채우기 ·
                  {/* ⚠️ 요소와 텍스트를 줄바꿈으로 나누면 사이 공백이 사라진다 — `{" "}`로 명시. */}
                  지각·조퇴·보강·메모는 <b className="text-text-dim">우클릭</b>{" "}
                  (7일 지난 칸도 메모는 고칠 수 있습니다)
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
  );
}
