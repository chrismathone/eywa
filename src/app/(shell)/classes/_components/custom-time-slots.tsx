"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { DAY_LABEL_KO, DAY_ORDER } from "@/features/classes/overlap";

export type CustomSlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherId?: string | null;
  classroomId?: string | null;
};

const inputClass =
  "border-border bg-card text-foreground rounded-md border px-2 py-1.5 text-sm";

/** 추가 상한 — 서버 파서 상한(80)보다 낮게 둬야 "추가는 됐는데 저장되면 사라지는" 행이 안 생긴다. */
const MAX_ROWS = 40;

/**
 * 자유 시각 수업 행 — **교시표에 없는 시각**의 유일한 입력·보존 경로.
 *
 * 🔴 왜 필요한가 두 가지:
 *  ① 방학 **오전 특강**(09~14시)은 평일 교시표(14:30~ / 영어 14:20~)에 칸이 없어 클릭그리드로는
 *     아예 만들 수 없었다 — 특강 토글을 켜도 스케줄 0개로 저장돼 시간표에 안 나온다(원장 요구 미달성).
 *  ② 기존 반에도 교시표 밖 시각의 슬롯이 실재한다(실측 injaewon 69행, 살아있는 8행 —
 *     '고등E_고2 심화' 토 14:20·15:40 등). 클릭그리드가 그 행을 못 그려서, 저장 한 번에 **영구 삭제**됐다.
 *     여기로 실어 보내야 재삽입에서 살아남는다.
 *
 * ⚠️ 제출 이름은 `custom_*` — 클릭그리드(`schedule_*`)와 **인덱스 공간을 공유하지 않는다**(그리드 선택
 *    수에 따라 번호가 밀리면 서로의 hidden을 덮어쓴다). 서버 `parseSchedules`가 두 네임스페이스를 합친다.
 * ⚠️ 교시별 부담임·강의실 오버라이드는 UI 없이 hidden으로 **그대로 통과**시킨다(기존 값 보존).
 */
export function CustomTimeSlots({ initial }: { initial: CustomSlot[] }) {
  const [rows, setRows] = useState<CustomSlot[]>(initial);

  const update = (i: number, patch: Partial<CustomSlot>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const add = () =>
    setRows((prev) =>
      prev.length >= MAX_ROWS
        ? prev
        : [
            ...prev,
            { dayOfWeek: "mon", startTime: "09:00", endTime: "12:00", teacherId: null, classroomId: null },
          ],
    );

  return (
    <div className="border-border space-y-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-xs font-medium">시각 직접 입력 (교시표에 없는 시간)</p>
        <button
          type="button"
          onClick={add}
          disabled={rows.length >= MAX_ROWS}
          {...(rows.length >= MAX_ROWS
            ? { title: `직접 입력은 ${MAX_ROWS}개까지 추가할 수 있습니다` }
            : {})}
          className="text-primary inline-flex items-center gap-0.5 text-xs hover:underline disabled:opacity-50 disabled:hover:no-underline"
        >
          <EyIcon name="plus" size={12} />
          시각 추가
        </button>
      </div>
      <p className="text-muted-foreground text-[11px] break-keep">
        방학 오전 특강처럼 교시표에 없는 시간대는 여기에 직접 입력합니다. 기존에 교시표 밖 시각으로
        저장된 수업도 여기에 나타납니다 — 지우면 저장 시 함께 삭제됩니다.
      </p>

      {rows.length === 0 ? null : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            // key에 인덱스를 쓴다 — 행에 안정적 id가 없고(신규 행 포함) 삭제 시 나머지가 재정렬된다.
            <li key={`custom-${i}`} className="flex flex-wrap items-center gap-1.5">
              <input type="hidden" name={`custom_teacher_${i}`} value={r.teacherId ?? ""} />
              <input type="hidden" name={`custom_classroom_${i}`} value={r.classroomId ?? ""} />
              <select
                name={`custom_day_${i}`}
                value={r.dayOfWeek}
                onChange={(e) => update(i, { dayOfWeek: e.target.value })}
                aria-label={`${i + 1}번째 직접 입력 수업 요일`}
                className={inputClass}
              >
                {DAY_ORDER.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABEL_KO[d]}
                  </option>
                ))}
              </select>
              <input
                type="time"
                name={`custom_start_${i}`}
                value={r.startTime}
                onChange={(e) => update(i, { startTime: e.target.value })}
                aria-label={`${i + 1}번째 직접 입력 수업 시작 시각`}
                className={inputClass}
              />
              <span className="text-text-faint text-xs" aria-hidden>
                ~
              </span>
              <input
                type="time"
                name={`custom_end_${i}`}
                value={r.endTime}
                onChange={(e) => update(i, { endTime: e.target.value })}
                aria-label={`${i + 1}번째 직접 입력 수업 종료 시각`}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`${i + 1}번째 직접 입력 수업 삭제`}
                className="text-text-dim hover:text-chart-4 inline-flex items-center rounded-lg p-1 transition"
              >
                <EyIcon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
