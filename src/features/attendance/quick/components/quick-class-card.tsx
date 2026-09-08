"use client";
/**
 * '출결 모드'의 **반 카드** — 머리(반 이름·시각·강의실·일괄 출결) + 학생 칩 격자.
 *
 * 🔴 칸 색·라벨은 좌석표와 **같은 단일 소스**(`SEAT_MARK_TONE`/`SEAT_MARK_LABEL`/`seatHoverTitle`)다.
 *    여기서 새 색 맵을 만들면 같은 학생이 화면마다 다른 색으로 보인다(팔레트 v4 캐논).
 * 🔴 **접기 토글과 '일괄 출결'은 서로 다른 버튼**이다 — 머리 전체를 하나의 버튼으로 만들면 일괄 버튼이
 *    버튼 안의 버튼이 되어(HTML 위반) 폰에서 어느 쪽이 눌렸는지가 브라우저마다 달라진다.
 * ⚠️ 터치 타겟은 44px(`min-h-11`) 이상 — 원장 지시가 "모바일 위주"다. 이름 글자는 **칩 폭에 비례**한다
 *    (`fluidNameFontSize`, 격자형 이름 칸 규약 2026-09-04 — 하한·상한은 name-fit.ts에만 적는다).
 */
import { ChevronDown, ChevronRight } from "@/components/icons/eywa-icon-compat";
import { fluidNameFontSize, NAME_FILL_MAX_PX, NAME_FILL_MIN_PX } from "@/features/attendance/seat/name-fit";
import { seatHoverTitle, SEAT_MARK_TONE } from "@/features/attendance/live/mark-state";
// 화면 언어(강사 미니셸) — 반 이름·강의실·학생 이름은 각각의 **단일 소스**를 통과시킨다.
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
import { classNameFor } from "@/features/teacher-view/class-name";
import { roomNameFor } from "@/features/teacher-view/room-name";
import { studentDisplayName } from "@/features/teacher-view/student-name";
import type { QuickClass } from "../board";

export function QuickClassCard({
  klass,
  collapsed,
  canEdit,
  bulkCount,
  bulkBusy,
  onToggle,
  onBulk,
  onPick,
}: {
  klass: QuickClass;
  collapsed: boolean;
  /** 출결 쓰기 권한(7일 창 포함) — 없으면 칩은 표시 전용이다(서버 거절 전에 화면이 먼저 밝힌다). */
  canEdit: boolean;
  /** '일괄 출결'이 실제로 보낼 칸 수(`bulkPlan`) — 라벨 숫자와 대상이 반드시 같아야 한다. */
  bulkCount: number;
  bulkBusy: boolean;
  onToggle: () => void;
  onBulk: () => void;
  onPick: (studentId: string) => void;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const recorded = klass.students.filter((s) => s.status != null).length;
  const total = klass.students.length;
  const roomName = roomNameFor(klass.roomName, lang);
  return (
    <section className="bg-card shadow-card rounded-2xl px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="hover:bg-bg-soft -mx-1 flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-xl px-1 text-left"
        >
          <span className="text-text-faint shrink-0" aria-hidden>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
          <span className="min-w-0">
            <span className="text-foreground block truncate text-base font-bold">
              {classNameFor(klass.className, lang)}
              {klass.band === "now" ? (
                <span className="bg-green-soft text-green ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold">
                  {t("quick.card.now")}
                </span>
              ) : null}
            </span>
            <span className="text-text-dim block truncate text-xs">
              <span className="num">
                {klass.firstStart}
                {klass.firstEnd ? `~${klass.firstEnd}` : ""}
              </span>
              {roomName ? ` · ${roomName}` : ""}
              {` · ${t("quick.card.recorded")} `}
              <span className="num">
                {recorded}/{total}
              </span>
            </span>
          </span>
        </button>
        {canEdit ? (
          <button
            type="button"
            onClick={onBulk}
            disabled={bulkCount === 0 || bulkBusy}
            title={t("quick.bulk.title")}
            className="bg-primary text-primary-foreground min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold whitespace-nowrap disabled:opacity-40"
          >
            {t("quick.bulk")} <span className="num">{bulkCount}</span>
          </button>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {klass.students.map((s) => {
            // 영어 모드에서 영어 이름을 가진 학생은 **그 이름이 주 이름**이다(표시 전용 단일 소스).
            const shownName = studentDisplayName(s.studentName, s.englishName, lang);
            // 🔴 이름 글자는 **칩 폭에 비례**한다(원장 2026-09-04) — 고정 px 사다리는 넓은 창에서 안 커진다.
            //    하한·상한은 name-fit.ts 한 곳(폰 90px 칸 → ~24px 3글자·20px 접미사 이름).
            const nameSize = fluidNameFontSize(shownName, { minPx: NAME_FILL_MIN_PX.quickTile, maxPx: NAME_FILL_MAX_PX });
            const label = seatHoverTitle({
              studentName: shownName,
              schoolGrade: s.schoolGrade,
              mark: s.mark,
              note: s.note,
              lang,
            });
            return (
              <button
                key={s.studentId}
                type="button"
                disabled={!canEdit}
                onClick={() => onPick(s.studentId)}
                title={label}
                aria-label={label}
                // 이름이 칸을 채운다(원장 2026-09-04 *"출결에도 학생 이름이 최대한 꽉 차게"*): 칩이 `@container`, 글자는 칩 폭 비례
                // (name-fit.ts `fluidNameFontSize`). 세로 여백 4px(24px 글자 + 8 = 32 < 터치 타겟 44 — 높이는 min-h가 지킨다).
                className={`@container flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl px-1 py-1 leading-tight font-bold ${SEAT_MARK_TONE[s.mark]} ${
                  canEdit ? "active:opacity-80" : "cursor-default"
                }`}
              >
                <span className="w-full truncate text-center leading-none" style={{ fontSize: nameSize }}>
                  {shownName}
                </span>
                {s.note ? (
                  <span className="w-full truncate text-xs font-medium opacity-80">{s.note}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
