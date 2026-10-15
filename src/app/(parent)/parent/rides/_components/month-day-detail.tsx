"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatKoreanDate } from "@/lib/date-kst";
import type { DirMark, MonthDay } from "@/features/shuttle/parent-month";
import { MARK } from "./month-marks";

/** 칸·상세에 적는 수업 한 줄 — 과목 · 반 이름 · 시작 · 끝("HH:MM"). */
export type CellClass = { label: string; className: string; start: string; end: string };

/** 아이들도 보는 화면이라 12시간제 — "16:20" → "오후 4:20". */
const clock12 = (hm: string) => {
  const h = Number(hm.slice(0, 2));
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${hm.slice(3, 5)}`;
};

/**
 * 월별 달력에서 날짜를 **두 번 누르면** 뜨는 그날 상세(사용자 2026-10-02) — 한 번 누르기는 고르기(수정용)라
 * 보기만 하는 창을 따로 둔다. 재료는 달력이 이미 가진 것뿐이라 서버를 다시 부르지 않는다.
 * 🔑 수업(과목 · 반 · 시각)과 셔틀(등원 · 하원 표시)을 한 장에. 노선·정류장까지 보거나 고치려면 아래 버튼으로 간다.
 */
export function MonthDayDetail({
  day,
  classes,
  past,
  sheetHref,
  editable,
  onClose,
}: {
  day: MonthDay;
  classes: CellClass[];
  /** 오늘 이전 날짜인가 — 셔틀 표시가 없을 때의 문구를 가른다. */
  past: boolean;
  /** 등하원 상세(노선 · 수정) 주소. */
  sheetHref: string;
  editable: boolean;
  onClose: () => void;
}) {
  const shuttle = (mark: DirMark) => (mark ? MARK[mark].label : past ? "기록 없음" : "평소대로");
  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{formatKoreanDate(day.date)}</DialogTitle>
          <DialogDescription>{day.holiday ? `학원이 쉬어요 · ${day.holiday}` : "그날 수업과 셔틀이에요."}</DialogDescription>
        </DialogHeader>

        {day.holiday ? null : (
          <div className="flex flex-col gap-3">
            <section>
              <h3 className="text-sm font-bold">수업</h3>
              {classes.length === 0 ? (
                <p className="text-text-dim mt-1 text-sm">수업이 없는 날이에요.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1.5">
                  {classes.map((c) => (
                    <li key={`${c.className}|${c.start}`} className="bg-green-soft rounded-lg px-3 py-2">
                      <p className="num text-base font-bold">
                        {clock12(c.start)} ~ {clock12(c.end)}
                      </p>
                      <p className="text-sm break-keep">
                        <b className="text-green">{c.label}</b>
                        {c.className && c.className !== c.label ? ` · ${c.className}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-sm font-bold">셔틀</h3>
              {day.absent ? (
                <p className="text-danger mt-1 text-sm font-bold">결석 — 등원·하원 모두 타지 않아요.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  <li>
                    <span className="text-text-dim">등원</span> <b>{shuttle(day.in)}</b>
                  </li>
                  <li>
                    <span className="text-text-dim">하원</span> <b>{shuttle(day.out)}</b>
                  </li>
                </ul>
              )}
            </section>
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="border-line flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-bold">
            닫기
          </button>
          {day.holiday ? null : (
            <a href={sheetHref} className="bg-primary text-primary-foreground flex h-11 flex-1 items-center justify-center rounded-lg text-sm font-bold">
              {editable ? "등하원 수정하기" : "등하원 자세히"}
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
