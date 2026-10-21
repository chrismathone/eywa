"use client";

import { useId, useMemo, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { cn } from "@/lib/utils";
import { SHUTTLE_INPUT, SHUTTLE_ROW } from "@/features/shuttle/control-size";
import { DIRECTION_LABEL } from "@/features/shuttle/types";
import { searchRides, type RideHit } from "@/features/shuttle/today/ride-search";
import type { VehicleGroup } from "@/features/shuttle/today/today-board";

/**
 * 학생 찾아가기 — 이름을 치고 고르면 그 학생의 호차·회차로 가서 그 줄을 비춘다(사용자 2026-10-20
 * *"아이들 검색을 통해 해당 아이열을 빠르게 셀랙해서 갈수있도록"*). 판정은 순수 [`searchRides`](@/features/shuttle/today/ride-search).
 *
 * 🔴 **목록을 거르지 않는다** — 고른 뒤엔 검색어를 지운다(걸린 채 남으면 다음 사람이 "왜 이 아이만 보이지"가 된다).
 * 🔴 검색어는 저장하지 않는다(출석부 검색과 같은 규약 — 뷰 세팅이 아니다).
 * ⚠️ 결과 목록은 툴바 레일 **밖**에 둔다 — 폰의 `.toolbar-rail`은 overflow가 잘려 겹판이 안 보인다([[#128]] 계열).
 */
export function RideJump({ groups, onPick }: { groups: readonly VehicleGroup[]; onPick: (hit: RideHit) => void }) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchRides(groups, q), [groups, q]);

  function pick(hit: RideHit | undefined) {
    if (!hit) return;
    onPick(hit);
    setQ("");
    setActive(0);
  }

  return (
    <div className="relative w-full sm:w-80">
      <label className="relative block">
        <span className="sr-only">학생 찾기</span>
        <EyIcon name="search" size={16} className="text-text-faint pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(hits[active]);
            } else if (e.key === "Escape") {
              setQ("");
            }
          }}
          placeholder="학생 이름으로 찾기"
          aria-label="학생 찾기"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          role="combobox"
          className={cn(SHUTTLE_INPUT, "w-full pl-8")}
        />
      </label>
      {q.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="bg-card border-line absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border p-1 shadow-lg"
        >
          {hits.length === 0 ? (
            <li className="text-text-dim px-3 py-2 text-sm">오늘 타는 학생 중에 없습니다.</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.rowKey} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(h)}
                  className={cn(
                    SHUTTLE_ROW,
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-left text-sm",
                    i === active ? "bg-muted" : "",
                  )}
                >
                  <span className="font-bold whitespace-nowrap">{h.studentName}</span>
                  {h.schoolGrade && <span className="text-text-dim text-xs whitespace-nowrap">{h.schoolGrade}</span>}
                  <span className="text-text-dim min-w-0 flex-1 truncate">{h.stopName}</span>
                  <span className="text-text-dim shrink-0 whitespace-nowrap">
                    {h.vehicleName} · <span className="num">{h.time || "—"}</span> {DIRECTION_LABEL[h.ioKind]}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
