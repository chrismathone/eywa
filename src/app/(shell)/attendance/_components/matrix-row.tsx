import type { AttendanceMatrix, AttendanceStatus, MatrixStudent } from "@/features/attendance/server/queries";
import type { StudentMoney } from "@/features/attendance/server/teacher-money";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { formatDows } from "@/features/attendance/calendar";
import {
  BADGE_LABEL,
  badgeTitle,
  isEnrolledOn,
  type LifecycleBadge,
} from "@/features/attendance/enrollment-span";
import { countMarks } from "@/features/attendance/grid/totals";
import { rowKey } from "@/features/attendance/grid/model";
import { AttendanceCell } from "./attendance-cell";
import { RowTotalCells } from "./live-totals";

/**
 * 표식 색 — 신입은 눈에 띄게(초록), 퇴원은 경고(빨강), 반이동은 중립적 이동(보라).
 * ⚠️ 출결 팔레트(`--att-*`)를 쓰지 않는다 — 그 색은 칸의 출결 값 전용이라 이름 옆에 쓰면 뜻이 겹친다.
 */
const BADGE_TONE: Record<LifecycleBadge["kind"], string> = {
  new: "bg-emerald-100 text-emerald-800",
  left: "bg-rose-100 text-rose-700",
  transferIn: "bg-violet-100 text-violet-800",
  transferOut: "bg-violet-100 text-violet-800",
};

/** 이름 칸 라벨 공통 크기 — 신입·퇴원·반이동·「단가」 전부 이 하나를 쓴다(크기 제각각 금지, 원장 2026-08-10). */
const BADGE_BASE = "shrink-0 rounded-sm px-1 text-[9px] leading-[14px] font-bold";

/** 금액 표시 — 0원과 '자료 없음'을 구분한다(청구서가 없는 달은 "—"). */
export function formatMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("ko-KR");
}

/** 잠긴 칸 툴팁 — 서버 응답과 같은 취지의 한글 문장(raw 코드 노출 금지). */
function lockedMessage(date: string, lockBefore: string): string {
  return `${date} 출결은 수정 기간(7일)이 지나 고칠 수 없습니다 — ${lockBefore} 이후만 수정 가능, 그 전은 관리자에게 요청하세요`;
}

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
}: {
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
          <span className="min-w-0 truncate text-[12px] leading-tight font-bold" title={student.name}>
            {student.name}
          </span>
          {/* 신입·퇴원·반이동 — 그 달에 경계가 있는 학생만. 대부분의 행엔 아무것도 안 붙는다.
              🔴 모든 라벨은 **우측 정렬**(원장 2026-08-10 "모든 라벨들 우정렬. 자리 부족하면 왼쪽으로")
                 — 셀 오른쪽 끝에 붙어 왼쪽으로 자라고(ml-auto + shrink-0), 자리가 부족하면
                 이름(`min-w-0 truncate`)이 줄임표로 양보한다. 아랫줄 「단가」 라벨과 같은 문법. */}
          {student.badges.length > 0 ? (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {student.badges.map((b) => (
                <span
                  key={`${b.kind}-${b.date}`}
                  title={badgeTitle(b, classLabel ?? "이 반")}
                  className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}
                >
                  {BADGE_LABEL[b.kind]}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        {/* 「단가 미지정」 뱃지는 **아랫줄**(등원요일 옆) — 첫 줄에 붙이면 신입 뱃지와 겹칠 때
            이름이 "김.."으로 잘린다(실측 2026-08-10). 아랫줄은 요일 두 글자뿐이라 자리가 남는다. */}
        {attendLabel || tierMissing ? (
          <span className="flex items-center gap-1">
            {attendLabel ? (
              <span
                className="text-text-faint min-w-0 truncate text-[10px] leading-tight font-medium"
                title={`등원 ${attendLabel}`}
              >
                {attendLabel}
              </span>
            ) : null}
            {tierMissing ? (
              // 라벨은 짧게 「단가」 + 우측 정렬(ml-auto) — 셀 오른쪽 끝. 크기는 신입·퇴원과 동일(BADGE_BASE).
              <span
                className={`${BADGE_BASE} ml-auto bg-amber-300 text-amber-950`}
                title={`${student.name} — 단가(수업 티어) 미지정이라 정산액에서 빠져 있습니다. 수강의 티어를 지정하면 계산에 들어갑니다`}
              >
                단가
              </span>
            ) : null}
          </span>
        ) : null}
      </td>
      {/* 학교·학년 = 표시 표준 압축("경명여중2", school-grade.ts) — 두 열로 나누던 것을 합쳐 날짜 칸에
          폭을 돌려준다(원장 2026-08-10). 원문(학교·학년 따로)은 title에 남긴다. */}
      <td className="border-line text-text-dim border-b border-r px-1.5 py-1 text-[11px]">
        <span
          className="block truncate"
          title={[student.school, student.grade].filter(Boolean).join(" · ") || undefined}
        >
          {schoolGradeLabel(student.school, student.grade) || "—"}
        </span>
        {/* 단가 티어(라벨만, 금액 아님) — 열의 남는 폭을 채운다(원장 2026-08-10). 원장 전용 금액 열이 있을 때만. */}
        {tierLabel ? (
          <span className="text-text-faint block truncate text-[10px] leading-tight" title={`단가 티어 ${tierLabel}`}>
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
              outside={outside}
              locked={lockBefore && d.date < lockBefore ? lockedMessage(d.date, lockBefore) : null}
              derived={!!matrix.derived[student.id]?.[d.date]}
              daySlots={matrix.slots[student.id]?.[d.date]}
            />
          </td>
        );
      })}
      {money !== undefined ? (
        <>
          {/* 청구·납입은 **학생 단위 총액**(다른 과목 포함) — 반 몫이 아니다. 여러 강사에 걸친 학생은 '공유' 표식. */}
          {/* '공유' 행 라벨은 제거(원장 2026-08-10) — 공유 규모는 합계 줄의 "공유 N명 포함"이 계속 알린다. */}
          <td className="border-line text-text-dim num border-b border-l px-2 py-1 text-right text-[11px] whitespace-nowrap">
            {formatMoney(money?.billed ?? null)}
          </td>
          <td className="border-line text-foreground num border-b px-2 py-1 text-right text-[11px] whitespace-nowrap">
            {formatMoney(money?.paid ?? null)}
          </td>
        </>
      ) : null}
      {/* 시수·출석률은 **입력을 즉시 따라간다**(클라 집계) — 서버 값은 첫 렌더 폴백. */}
      <RowTotalCells row={rowKey(classId, student.id)} fallback={countMarks(marks, units)} />
    </tr>
  );
}
