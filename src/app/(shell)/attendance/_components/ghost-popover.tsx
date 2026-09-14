"use client";

import type { AttendanceStatus } from "@/features/attendance/server/queries";
import { STATUS_TONE, statusTextOf } from "@/features/attendance/cell-display";
// 화면 언어 — 상태 이름은 `statusTextOf`(한글 맵 옆) 단일 소스, 안내 문구는 사전.
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { STATUS_OPTIONS, popoverPosition, type PopoverAnchor } from "./cell-popover";

/**
 * 강사 전체 보기 **빗금 칸**(다른 선생님 교시 기록만 있는 칸)의 우클릭 팝오버 — **상태만** 고른다.
 *
 * 🔴 원장 2026-09-14: *"그냥 그 날의 해당 담당 출석으로 전부 이전시켜. 다른 사람이 대신 찍었어도."* +
 *    *"대신 다른 사람이 출결하면 메모에 남겨."* — 서버는 그 교시 행에 상태만 쓰고(시수 불변) 메모에 `대신 입력` 한 줄을
 *    붙인다(`ghost-transfer.ts`). 그래서 **시수·메모 입력칸과 '지우기'를 두지 않는다** — 두면 친 값이 조용히 버려지고,
 *    남의 기록 삭제는 막기로 했다(기본값).
 * ⚠️ 저장은 격자와 **같은 문**(`onPick` → grid-context `transferGhost` → writeOne)을 지난다 — 여기서 서버를 직접 부르면
 *    잠금·빗금 판정·낙관값·알림을 한 벌 더 짜게 되고 둘이 갈린다(#77).
 */
export function GhostTransferPopover({
  status,
  note,
  anchor,
  onPick,
  onClose,
}: {
  /** 그 교시 기록의 지금 대표 상태(굵게 표시) — 모르면 null. */
  status: string | null;
  /**
   * 그 교시 기록의 메모(결석 사유) — **읽기로만** 보여 준다. 종전 빗금 칸 팝오버가 사유를 보여 줬던 것을 잃지 않게
   * (실측 78칸이 "병결"·"가족여행", 적대 리뷰 2026-09-14). 빈 문자열이면 줄을 안 그린다.
   */
  note: string;
  anchor: PopoverAnchor;
  onPick: (status: AttendanceStatus) => void;
  onClose: () => void;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={t("att.pop.aria")}
        // ⚠️ role="dialog"는 격자 키 가로채기 방지 신호이기도 하다(grid-context 가드) — 칸 팝오버와 같은 껍데기.
        className="bg-card border-line fixed z-50 flex w-44 flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
        style={popoverPosition(anchor)}
      >
        <p className="text-text-dim px-2 py-1 text-xs leading-tight break-keep">{t("att.ghostPop.hint")}</p>
        {note ? (
          <p className="text-foreground px-2 pb-1 text-xs leading-tight break-keep">{tf("att.pop.note", { note })}</p>
        ) : null}
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => {
              onPick(o);
              onClose();
            }}
            className={`hover:bg-bg-soft flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition ${
              status === o ? "font-bold" : ""
            }`}
          >
            {statusTextOf(o, lang)}
            <span className={`border-line size-4 shrink-0 rounded-sm border ${STATUS_TONE[o]}`} aria-hidden />
          </button>
        ))}
      </div>
    </>
  );
}
