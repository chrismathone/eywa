import type { SeatClassPlan } from "@/features/attendance/seat/server/jj-plan";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatPlacement } from "@/features/attendance/seat/placement";
import type { SeatKey } from "@/features/attendance/seat/seat";
import { SeatBoard, type SeatReadOnlyReason } from "./seat-board";
import { SeatJjNote } from "./seat-jj-table";
import { SEAT_ALL_PERIODS, SeatPeriodChips } from "./seat-period-chips";

/** 교시 판 한 장의 재료 — 서버가 하루치를 한 번씩 읽어 교시별로 나눠 넘긴다(전부 직렬화 가능한 값). */
export type SeatJjAllDayPeriod = {
  start: string;
  /** 칩 줄의 "N개 반" — 교시 칩과 같은 값. */
  classIds: string[];
  /** JJ 칸(듣기·단어·태도·특이사항)을 얹은 그 교시 명단. */
  rosters: SeatClassRoster[];
  prevAbsentByCell?: Readonly<Record<string, string>>;
  nextStartByStudent?: Readonly<Record<string, string>>;
  nextRoomByStudent?: Readonly<Record<string, string>>;
  lastByStudent?: Readonly<Record<string, true>>;
  placements: SeatPlacement[];
  /** 반 id → 그 교시 수업계획. 계획을 볼 수 있는 반만 키가 있다(서버 ECS 게이트). */
  plans: Record<string, SeatClassPlan>;
};

/**
 * **JJ실 '전체' 보기** — 그날 모든 교시를 위에서 아래로(원장 2026-09-18 *"펼치기"*: 랩실 '전체' 보기처럼 하루를
 * 한 번에 보고, 수업계획은 교시마다 접어 둔다).
 *
 * 🔑 교시 판은 **교시 하나 보기와 같은 `SeatBoard`**다 — 출결·듣기·단어·계획 저장이 한 벌이라 보기를 바꿔도 같은 말을
 *    한다. 다른 점은 둘뿐: 칩 줄·안내 한 줄을 위에 **한 번만** 그리고, 계획은 접힌 채 시작한다(`foldPlans`).
 * 🔴 **드래그 없음** — 교시를 옮기는 자리는 랩실뿐(`MOVABLE_SEATS`)이라 랩실 조각(`SeatAllDay`)의 드래그 컨텍스트를
 *    가져오지 않는다.
 * 🔴 **하루치를 한 번에 찍는 버튼은 없다** — 일괄 버튼은 교시 요약 줄 안에만(오클릭 한 번이 하루를 뭉갠다, 랩실과 같은 규약).
 * 🔴 교시 판은 **줄어들지 않는다**(`shrink-0`) — 판 루트가 `flex-1 min-h-0`라 그대로 두면 교시들이 화면 높이를 나눠
 *    가지며 각자 잘린다(랩실 '전체' 보기에서 난 제보, 2026-09-10). 넘치는 높이는 이 상자의 스크롤이 받는다.
 */
export function SeatJjAllDay({
  seat,
  date,
  periods,
  readOnly,
  readOnlyReason,
  hrefFor,
  planMeta,
}: {
  seat: SeatKey;
  date: string;
  periods: SeatJjAllDayPeriod[];
  readOnly: boolean;
  /** 보기만인 이유 — 교시 하나 보기와 같은 값(`SeatReadOnlyReason`). 생략 = 지난 날짜. */
  readOnlyReason?: SeatReadOnlyReason;
  hrefFor: string;
  /** 저널·presence 문서 키 — 교시 하나 보기와 같은 값(영어 시트와 같은 주차여야 서로를 본다). */
  planMeta: { tenantId: string; userId: string; weekMonday: string };
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SeatPeriodChips periods={periods} activeStart={SEAT_ALL_PERIODS} hrefFor={hrefFor} showAll />
      <SeatJjNote />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        {periods.map((p) => (
          <div key={`${seat}|${date}|${p.start}`} className="shrink-0">
            <SeatBoard
              seat={seat}
              date={date}
              periods={[]}
              showChips={false}
              activeStart={p.start}
              rosters={p.rosters}
              readOnly={readOnly}
              readOnlyReason={readOnlyReason}
              hrefFor={hrefFor}
              prevAbsentByCell={p.prevAbsentByCell}
              nextStartByStudent={p.nextStartByStudent}
              nextRoomByStudent={p.nextRoomByStudent}
              lastByStudent={p.lastByStudent}
              placements={p.placements}
              // 🔑 명단은 서버가 이미 교시 선택을 얹은 것이다(교시 하나 보기와 같은 `applySeatDayChoices`).
              choicesApplied
              foldPlans
              plans={Object.keys(p.plans).length > 0 ? { plans: p.plans, ...planMeta } : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
