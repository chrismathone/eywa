import type { AttendanceStatus } from "@/features/attendance/server/queries";
import { DAY_TONE, GHOST_HATCH, cellDisplay, statusTextOf } from "@/features/attendance/cell-display";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

const STATUSES: AttendanceStatus[] = ["present", "late", "early_leave", "makeup", "absent"];

const SWATCH = "border-line inline-block size-5 shrink-0 rounded-sm border";
const ITEM = "text-text-dim inline-flex shrink-0 items-center gap-1";

/**
 * 월별 출석부 **범례** — 격자 **위** 한 줄(원장 2026-09-14 *"범례 가장 위로"*).
 *
 * 🔴 왜 표 위인가: 그전엔 표 맨 아래(`<tfoot>`)에 있어 수십 행을 끝까지 내려야 보였다 — 칸 색을 읽으려는
 *    사람이 정작 칸을 볼 때는 범례가 화면 밖이었다. 표 위 한 줄은 스크롤과 무관하게 격자 바로 위에 선다.
 *    같은 날 걷어낸 '학원 휴일 9/24 추석 연휴 · …' 안내 줄 자리이고, 원장이 짚은 **툴바와 표 머리 사이
 *    빈 공간**(*"이 사이 빈공간"*)을 이 줄이 채운다.
 * 🔴 **격자의 칸 칠을 세운다**(원장 *"이런 미등원도 범례 추가"* → *"이런것들"*) —
 *    출결 다섯 + 날짜 성격 넷(등원요일·주말·학원 휴일·미등원) + 강사 전체 보기의 빗금.
 *    ⚠️ 일부러 뺀 것: 흰 칸(수업 없는 평일 — 기본 배경이라 설명이 소음) · 오늘 열 머리(남색 — 위치 표시) ·
 *       한 날에 교시가 섞인 칸의 줄무늬. 격자에 새 칠을 더하면 여기도 함께 볼 것.
 * 🔴 빗금 낱말은 **"이 화면 몫 아님"** — "다른 선생님 교시"라고 쓰지 말 것. 빗금은 자리(JJ·랩실) 기록·교시를
 *    안 남긴 옛 기록·담임이 되기 전 기록에도 나온다(`cell-display.ts` `NOT_MINE_MESSAGE` 주석과 같은 규칙 —
 *    적대적 리뷰 2026-09-14가 잡았다).
 * 🔴 칩은 **셀과 같은 함수·같은 상수**로 그린다(`cellDisplay`·`DAY_TONE`·`GHOST_HATCH`) — 색을 여기 다시
 *    적으면 셀 색을 바꾸는 날(같은 날의 톤업처럼) 범례만 옛 색으로 남는다.
 * ⚠️ **서버 컴포넌트**다(훅 없음) — 화면 언어는 페이지가 prop으로 내려준다(`matrix-table.tsx`와 같은 규약).
 */
export function AttendanceLegend({
  lang = "ko",
  showGhost,
}: {
  lang?: SheetLang;
  /**
   * 빗금(이 화면 몫이 아닌 기록) 칩 — **강사 전체 보기에서만** 격자에 나오므로 그때만 세운다.
   * 반별 보기에 세우면 화면에 없는 칠을 설명하는 범례가 된다.
   */
  showGhost: boolean;
}) {
  const t = (key: Parameters<typeof sheetT>[1]) => sheetT(lang, key);
  return (
    <div className="flex shrink-0 items-center gap-x-3 overflow-x-auto px-1 pb-1.5 text-xs [&_*]:whitespace-nowrap">
      <span className="micro shrink-0">{t("att.legend")}</span>
      {STATUSES.map((s) => {
        const chip = cellDisplay(s, null);
        return (
          <span key={s} className={ITEM}>
            <span
              className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-xs font-bold ${chip.className}`}
            >
              {chip.text}
            </span>
            {statusTextOf(s, lang)}
          </span>
        );
      })}
      <span className={ITEM}>
        <span className={`${SWATCH} ${DAY_TONE.classDay}`} />
        {t("att.legend.classDay")}
      </span>
      <span className={ITEM}>
        <span className={`${SWATCH} ${DAY_TONE.weekend}`} />
        {t("att.legend.off")}
      </span>
      <span className={ITEM}>
        <span className={`${SWATCH} ${DAY_TONE.holiday}`} />
        {t("att.legend.holiday")}
      </span>
      <span className={ITEM}>
        <span className={`${SWATCH} ${DAY_TONE.outside}`} />
        {t("att.legend.outside")}
      </span>
      {showGhost ? (
        <span className={ITEM}>
          {/* 빗금은 배경**색**이 아니라 무늬라 셀처럼 backgroundImage로 얹는다(cell-display.ts GHOST_HATCH 주석). */}
          <span className={`${SWATCH} bg-white`} style={{ backgroundImage: GHOST_HATCH }} />
          {t("att.legend.ghost")}
        </span>
      ) : null}
    </div>
  );
}
