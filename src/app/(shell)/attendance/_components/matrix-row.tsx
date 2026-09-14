import type { AttendanceMatrix, AttendanceStatus, MatrixStudent } from "@/features/attendance/server/queries";
import type { StudentMoney } from "@/features/attendance/server/teacher-money";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { formatDows } from "@/features/attendance/calendar";
// 🔴 서버 컴포넌트라 훅을 못 쓴다 — 언어는 `MatrixTable`이 prop으로 내려준다.
import { badgeLabelOf, badgeTitle, isEnrolledOn } from "@/features/attendance/enrollment-span";
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import { BADGE_BASE, BADGE_TONE, notMineCell } from "@/features/attendance/cell-display";
import { countMarks } from "@/features/attendance/grid/totals";
import { rowKey } from "@/features/attendance/grid/model";
import { formatMoney } from "@/features/attendance/money-format";
import { AttendanceCell } from "./attendance-cell";
import { RowTotalCells } from "./live-totals";

/**
 * 출석부 매트릭스의 학생 행 하나 — 반별 보기와 강사 전체 보기가 **같은 행 컴포넌트**를 쓴다.
 * (렌더를 두 벌 만들면 급여 계산에 쓰는 숫자가 화면마다 갈린다.)
 */
export function MatrixRow({
  student,
  classId,
  matrix,
  days,
  holidays,
  money,
  lockBefore,
  classLabel,
  tierMissing,
  tierLabel,
  lang = "ko",
}: {
  /** 화면 언어 — 표가 내려준다(서버 컴포넌트라 훅을 못 쓴다). 안 주면 한국어. */
  lang?: SheetLang;
  student: MatrixStudent;
  /** 이 행이 속한 반 — 셀 저장 대상. 강사 전체 보기에선 행마다 다르다. */
  classId: string;
  /** 반 이름 — 반이동 툴팁("가반 → 나반")에만 쓴다. 없으면 중립 표기로 떨어진다. */
  classLabel?: string;
  matrix: AttendanceMatrix;
  days: AttendanceMatrix["days"];
  holidays: Record<string, string>;
  /** 원장 전용 금액 열(강사 전체 보기). undefined = 열 자체 없음. */
  money?: StudentMoney | null;
  /** 이 날짜 **이전**은 강사가 수정 못 함(7일 창). null = 제한 없음(관리자 이상). */
  lockBefore?: string | null;
  /** 단가(수업 티어) 미지정 — 정산액에서 빠진 학생. 이름 칸 「단가」 라벨로 드러낸다. */
  tierMissing?: boolean;
  /** 이 학생의 단가 티어 라벨(원장 전용 금액 열이 있을 때만) — 학교·학년 열 아랫줄에 표시. */
  tierLabel?: string | null;
}) {
  const marks = matrix.marks[student.id] ?? {};
  const units = matrix.units[student.id] ?? {};
  const attendDows = new Set(student.attendDows);
  const attendLabel = formatDows(student.attendDows);

  return (
    <tr className="hover:bg-bg-soft/40">
      {/* 이름 **위**, 등원요일 **아래** — 같은 반이라도 학생마다 오는 요일이 다르다(분리등원).
          한 줄에 이어 붙이면 이름 열이 이름+요일만큼 넓어져야 해 날짜 칸을 잡아먹는다(원장 2026-08-06:
          "세로폭은 조금 더 키우더라도 요일을 이름 아래로"). 행이 한 줄 높아지는 건 감수한 트레이드오프.
          ⚠️ 열 폭이 고정(colgroup)이라 넘치는 글자는 잘린다 — 원문은 `title`에 남긴다. */}
      {/* 단가 미지정(정산 제외)은 「단가」 라벨 **하나로만** 표시 — 셀 배경까지 칠하면 이중 표기로
          읽힌다(원장 2026-08-10: "배경색 노란건 지워"). 설명은 라벨 툴팁이 담당. */}
      <td className="border-line text-foreground sticky left-0 z-10 border-b border-r bg-card px-2 py-1">
        <span className="flex items-center gap-1">
          <span className="min-w-0 truncate text-xs leading-tight font-bold" title={student.name}>
            {student.name}
          </span>
        </span>
        {/* 🔴 **모든 라벨이 아랫줄**(등원요일 옆) — 신입·퇴원·반이동까지 내렸다(원장 2026-09-14
            *"반이동 퇴원 라벨을 위치이동시켜서 이름 더 잘보이게. 이름이 짤리는건 최악"*). 첫 줄에 두면
            뱃지 둘("반이동"+"퇴원" ≈ 80px)이 132px 열의 절반을 먹어 이름이 "김…"으로 잘렸다(실측).
            이제 첫 줄은 이름뿐이라 열 폭(148px)을 통째로 쓴다. 아랫줄은 요일 두 글자뿐이라 자리가 남고,
            모자라면 요일(`min-w-0 truncate`)이 줄임표로 양보한다 — 「단가」가 쓰던 문법 그대로. */}
        {attendLabel || tierMissing || student.badges.length > 0 ? (
          <span className="flex items-center gap-1">
            {attendLabel ? (
              <span
                className="text-text-faint min-w-0 truncate text-xs leading-tight font-medium"
                title={sheetTf(lang, "att.row.attendDows", { dows: attendLabel })}
              >
                {attendLabel}
              </span>
            ) : null}
            {/* 라벨 묶음은 **한 번만** 우측 정렬한다(ml-auto가 둘이면 뒤엣것이 자리를 또 밀어 사이가 벌어진다).
                크기·색은 화면과 인쇄물 단일 소스(BADGE_BASE·BADGE_TONE). */}
            {student.badges.length > 0 || tierMissing ? (
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {student.badges.map((b) => (
                  <span
                    key={`${b.kind}-${b.date}`}
                    title={badgeTitle(b, classLabel ?? sheetT(lang, "att.row.thisClass"), lang)}
                    className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}
                  >
                    {badgeLabelOf(b.kind, lang)}
                  </span>
                ))}
                {tierMissing ? (
                  <span
                    className={`${BADGE_BASE} bg-amber-300 text-amber-950`}
                    title={sheetTf(lang, "att.row.noTierTitle", { name: student.name })}
                  >
                    {sheetT(lang, "att.row.noTier")}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </td>
      {/* 학교·학년 = 표시 표준 압축("경명여중2", school-grade.ts) — 두 열로 나누던 것을 합쳐 날짜 칸에
          폭을 돌려준다(원장 2026-08-10). 원문(학교·학년 따로)은 title에 남긴다. */}
      <td className="border-line text-text-dim border-b border-r px-1.5 py-1 text-xs">
        <span
          className="block truncate"
          title={[student.school, student.grade].filter(Boolean).join(" · ") || undefined}
        >
          {schoolGradeLabel(student.school, student.grade) || "—"}
        </span>
        {/* 단가 티어(라벨만, 금액 아님) — 열의 남는 폭을 채운다(원장 2026-08-10). 원장 전용 금액 열이 있을 때만. */}
        {tierLabel ? (
          <span
            className="text-text-faint block truncate text-xs leading-tight"
            title={sheetTf(lang, "att.row.tierTitle", { tier: tierLabel })}
          >
            {tierLabel}
          </span>
        ) : null}
      </td>
      {days.map((d) => {
        // 그 달에 없는 날(placeholder) — 빈 칸(입력 불가). 폭은 다른 칸과 동일(min-w)로 고정.
        if (d.placeholder) {
          return <td key={d.date} className="border-line bg-bg-soft/20 min-w-[30px] border-b border-r" aria-hidden />;
        }
        const holiday = holidays[d.date];
        // 그 날 이 반 소속이 아니었나 — 8월 5일에 그만둔 학생의 나머지 26칸을 "수업하는 날"로
        // 그리면 표가 거짓말을 한다. ⚠️ **표시만** 바꾼다(입력은 그대로) — 퇴원 뒤 보강 출석이 실제로 있다.
        const outside = !isEnrolledOn(d.date, student.spans);
        // 이 표의 몫이 아닌 칸(값 없음 + 남의 교시만) — 잠금과 **같은 통로**로 사유를 알린다.
        // 그래야 팝오버·커서·툴팁이 격자(writeOne/writeMany)와 같은 말을 한다(#77: 표면마다 딴말 금지).
        const otherSlots = matrix.ghosts[student.id]?.[d.date];
        // 🔴 값이 **파생(수업보고서)뿐**인 칸도 몫이 아니다 — 실제 행이 자리·남의 교시뿐이라 서버가 거절한다
        //    (리뷰 2026-09-12). 판정은 격자(`buildGridSource`)와 **같은 함수** 한 곳.
        const notMine = notMineCell({
          hasValue: !!marks[d.date],
          derivedValue: !!matrix.derived[student.id]?.[d.date],
          others: otherSlots,
        });
        // 등원요일 = 그 학생이 실제로 오는 날(분리등원 반영) — 공휴일은 휴원이라 제외.
        const attend = attendDows.has(d.dow) && !holiday && !outside;
        // 배경(음영·틴트)은 셀을 꽉 채우는 AttendanceCell 버튼이 그린다 — td는 relative 무대만
        // 제공한다(고정 크기 칩에 배경을 주면 셀을 못 채운다, gotcha #66).
        return (
          <td key={d.date} className="border-line relative min-w-[30px] border-b border-r p-0 text-center align-middle">
            <AttendanceCell
              studentId={student.id}
              classId={classId}
              sessionDate={d.date}
              initialStatus={(marks[d.date] as AttendanceStatus | undefined) ?? null}
              note={matrix.notes[student.id]?.[d.date] ?? null}
              initialUnits={units[d.date] ?? null}
              attendDay={attend}
              muted={!!holiday || (!attend && d.isWeekend)}
              // 휴일은 주말과 **다른 색**으로(2026-09-07) — muted와 함께 넘겨 셀이 갈라 칠한다.
              holiday={!!holiday}
              outside={outside}
              /* 🔴 문장이 아니라 **사유 코드**만 넘긴다 — 잠긴 칸마다 157B 문장을 서버가 만들어
                 내려보내면 그게 그대로 RSC 페이로드 곱이 된다(강사 전체 보기는 잠긴 칸이 수천 개).
                 문장은 칸이 grid-context의 `lockNoteOf`로 편다(판정·문구는 그대로 한 곳). */
              lockedReason={
                lockBefore && d.date < lockBefore ? "past" : notMine ? "notMine" : null
              }
              derived={!!matrix.derived[student.id]?.[d.date]}
              daySlots={matrix.slots[student.id]?.[d.date]}
              otherSlots={otherSlots}
              sharedDay={!!matrix.dayAxis[student.id]?.[d.date]}
              // 보강 예약(0264a) — 값이 없는 칸에 '보강 예약' 네 글자로 선다. 이름·반은 예약 창 머리에 쓴다.
              reservation={matrix.reservations?.[student.id]?.[d.date] ?? null}
              studentName={student.name}
              className={classLabel}
            />
          </td>
        );
      })}
      {money !== undefined ? (
        <>
          {/* 청구·납입은 **학생 단위 총액**(다른 과목 포함) — 반 몫이 아니다. 여러 강사에 걸친 학생은 '공유' 표식. */}
          {/* '공유' 행 라벨은 제거(원장 2026-08-10) — 공유 규모는 합계 줄의 "공유 N명 포함"이 계속 알린다. */}
          <td className="border-line text-text-dim num border-b border-l px-2 py-1 text-right text-xs whitespace-nowrap">
            {formatMoney(money?.billed ?? null)}
          </td>
          <td className="border-line text-foreground num border-b px-2 py-1 text-right text-xs whitespace-nowrap">
            {formatMoney(money?.paid ?? null)}
          </td>
        </>
      ) : null}
      {/* 시수·출석률은 **입력을 즉시 따라간다**(클라 집계) — 서버 값은 첫 렌더 폴백. */}
      <RowTotalCells row={rowKey(classId, student.id)} fallback={countMarks(marks, units)} />
    </tr>
  );
}
