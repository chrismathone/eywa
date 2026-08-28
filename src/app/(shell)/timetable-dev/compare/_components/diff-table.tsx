import { Pill } from "@/components/atoms/pill";
import { TONE_ACCENT_BAR, TONE_COLOR } from "@/lib/design/semantic-color";
import { enumDayToKo } from "@/features/timetable/lib/periods";
import { hhmm, type PlanSlot } from "@/features/timetable-dev/types";
import {
  PLAN_DIFF_KIND_LABEL,
  PLAN_DIFF_TONE,
  describePlanChange,
  formatPlanFieldValue,
  type PlanDiffRow,
  type PlanNameResolver,
} from "@/features/timetable-dev/lib/compare";

/** 이름 미상 표기 — 화면에 uuid를 흘리지 않기 위한 마지막 방어선(CLAUDE.md: raw 키 노출 금지). */
const UNKNOWN = "이름 미상";

/** 추가·삭제된 칸의 한 줄 요약 — "뭐가 생겼는지/없어졌는지"를 강사·강의실·교시로 말한다. */
function slotSummary(slot: PlanSlot, resolve: PlanNameResolver): string {
  const parts: string[] = [];
  const teacher = slot.slotTeacherLabel?.trim() || (slot.teacherId ? resolve("teacher", slot.teacherId) : null);
  const room = slot.slotRoomLabel?.trim() || (slot.classroomId ? resolve("classroom", slot.classroomId) : null);
  if (slot.periodLabel?.trim()) parts.push(slot.periodLabel.trim());
  if (teacher) parts.push(`강사 ${teacher}`);
  if (room) parts.push(`강의실 ${room}`);
  if (slot.mergeGroup) parts.push(formatPlanFieldValue("mergeGroup", slot.mergeGroup));
  return parts.length ? parts.join(" · ") : "추가 정보 없음";
}

/**
 * 비교 결과 목록.
 *
 * ⚠️ 좁은 화면에서 표가 넘치면 **이 컨테이너 안에서만** 가로로 스크롤한다(본문 가로 스크롤 금지).
 *    카드 테두리가 `border`가 아니라 그림자 링이라 스크롤 컨테이너에 안쪽 여백을 주지 않으면
 *    좌우 세로선이 잘려 "테두리가 깨져 보인다"([[#114]]) → `px-1`.
 * ⚠️ `overflow-x`는 `auto`다 — `scroll`로 두면 넘치지 않아도 트랙을 예약해 가짜 스크롤바가 생긴다([[#87]]).
 */
export function DiffTable({
  rows,
  totalCount,
  classNames,
  resolve,
  beforeLabel,
  afterLabel,
}: {
  /** 이미 필터·정렬·상한이 적용된 행. */
  rows: PlanDiffRow[];
  /** 필터를 통과한 **진짜** 건수(상한 전). 배열 길이를 건수로 쓰지 않는다([[#89]]). */
  totalCount: number;
  classNames: Map<string, string>;
  resolve: PlanNameResolver;
  beforeLabel: string;
  afterLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-text-dim px-1 py-10 text-center text-[13px]">
        이 조건에 해당하는 칸이 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-1 overflow-x-auto px-1">
        {/* 표 이름은 `<caption class="sr-only">`이 아니라 aria-label로 — sr-only는 position:absolute라
            positioned 부모가 없으면 스크롤 컨테이너를 뚫고 나가 가짜 스크롤바를 만든다([[#79]]). */}
        <table
          className="w-full min-w-[680px] border-collapse text-[13px]"
          aria-label={`${beforeLabel}과 ${afterLabel}의 시간표 계획 비교 결과`}
        >
          <thead>
            {/* 열 제목은 가운데, 열 구분선은 한 단계 옅게(--line-faint) — 표 규약(2026-08-05). */}
            <tr className="border-line text-text-dim border-b text-[12px] font-semibold [&>*:not(:first-child)]:border-line-faint [&>*:not(:first-child)]:border-l">
              <th scope="col" className="px-3 py-2 text-center">
                구분
              </th>
              <th scope="col" className="px-3 py-2 text-center">
                반
              </th>
              <th scope="col" className="px-3 py-2 text-center">
                요일
              </th>
              <th scope="col" className="px-3 py-2 text-center">
                시간
              </th>
              <th scope="col" className="px-3 py-2 text-center">
                내용
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = PLAN_DIFF_TONE[row.kind];
              const slot = row.after ?? row.before;
              // 끝시각이 바뀐 칸은 '뒤 달' 기준으로 보여주고, 무엇이 바뀌었는지는 내용 칸이 말한다.
              const endTime = slot ? hhmm(slot.endTime) : "";
              return (
                <tr
                  key={`${row.classId}|${row.dayOfWeek}|${row.startTime}`}
                  className="border-line-faint border-b [&>td:not(:first-child)]:border-line-faint [&>td:not(:first-child)]:border-l"
                >
                  {/* 의미 띠는 **셀에** 건다 — `<tr>`에 걸면 border-collapse에서 셀 테두리와 겹치고,
                      같은 요소의 `border-<color>` 단축과 `border-l-<color>` 장축이 순서 싸움을 한다([[#66]]). */}
                  <td className={`border-l-2 px-3 py-2 text-center align-top ${TONE_ACCENT_BAR[tone]}`}>
                    <Pill color={TONE_COLOR[tone]}>{PLAN_DIFF_KIND_LABEL[row.kind]}</Pill>
                  </td>
                  <td className="text-foreground px-3 py-2 align-top font-semibold break-keep">
                    {classNames.get(row.classId) ?? UNKNOWN}
                  </td>
                  <td className="px-3 py-2 text-center align-top whitespace-nowrap">
                    {enumDayToKo(row.dayOfWeek)}
                  </td>
                  <td className="text-text-dim px-3 py-2 text-center align-top whitespace-nowrap">
                    <span className="num">
                      {row.startTime}
                      {endTime ? `~${endTime}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top break-keep">
                    {row.kind === "changed" ? (
                      <ul className="flex flex-col gap-0.5">
                        {row.changes.map((c) => {
                          const d = describePlanChange(c, resolve);
                          return (
                            <li key={String(c.field)}>
                              <span className="text-text-dim">{d.label}:</span>{" "}
                              <span className="text-foreground font-medium">{d.text}</span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : row.kind === "same" ? (
                      <span className="text-text-faint">두 달이 같음</span>
                    ) : (
                      <span className="text-text-dim">
                        {slot ? slotSummary(slot, resolve) : "추가 정보 없음"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalCount > rows.length ? (
        <p className="text-text-dim px-1 text-[12px]">
          {/* 표시 상한 — 위 요약 카드의 숫자는 상한과 무관한 전체 건수다([[#89]]). */}
          전체 <span className="num font-semibold">{totalCount}</span>건 중 앞{" "}
          <span className="num font-semibold">{rows.length}</span>건만 표시했습니다. 범위 칩으로 좁혀
          보세요.
        </p>
      ) : null}
    </div>
  );
}
