import type { AttendanceStatus } from "@/features/attendance/server/queries";
import {
  DAY_TONE,
  GHOST_HATCH,
  TODAY_HEAD,
  cellDisplay,
  rollupDay,
  statusTextOf,
} from "@/features/attendance/cell-display";
import { RESERVED_CELL_CLASS } from "@/features/attendance/makeup-reservation";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

const STATUSES: AttendanceStatus[] = ["present", "late", "early_leave", "makeup", "absent"];

const SWATCH = "border-line inline-block size-5 shrink-0 rounded-sm border";
const CHIP = "inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-xs font-bold";
const ITEM = "text-text-dim inline-flex shrink-0 items-center gap-1";

/**
 * 교시가 섞인 날의 줄무늬 견본 — 격자 칸과 **같은 두 함수**(`rollupDay` → `cellDisplay`)로 만든다.
 * 한 교시 출석 + 한 교시 결석(격자에서 가장 흔한 섞임)이라 칸엔 합계 `1`이 적힌다.
 * ⚠️ 줄무늬는 배경색 클래스가 아니라 **인라인 `background`**다(`cell-display.ts` `slotStripes`) — 칩도 `style`로 얹는다.
 */
const MIXED_SAMPLE = cellDisplay("present", 1, {
  day: rollupDay([
    { slot: "15:00", status: "present", units: 1 },
    { slot: "17:00", status: "absent", units: null },
  ]),
});

/**
 * 월별 출석부 **범례** — 격자 **위** 한 줄(원장 2026-09-14 *"범례 가장 위로"*).
 *
 * 🔴 왜 표 위인가: 그전엔 표 맨 아래(`<tfoot>`)에 있어 수십 행을 끝까지 내려야 보였다 — 칸 색을 읽으려는
 *    사람이 정작 칸을 볼 때는 범례가 화면 밖이었다. 표 위 한 줄은 스크롤과 무관하게 격자 바로 위에 선다.
 *    같은 날 걷어낸 '학원 휴일 9/24 추석 연휴 · …' 안내 줄 자리이고, 원장이 짚은 **툴바와 표 머리 사이
 *    빈 공간**(*"이 사이 빈공간"*)을 이 줄이 채운다.
 * 🔴 **격자의 칠을 세운다**(원장 *"이런 미등원도 범례 추가"* → *"이런것들"*) —
 *    출결 다섯 + 교시가 섞인 날의 줄무늬 + 날짜 성격 넷(등원요일·주말·학원 휴일·미등원) + 오늘 열 머리(남색)
 *    + 강사 전체 보기의 빗금 + 보강 예약(0264a — 어느 보기·어느 달에나 칸이 설 수 있어 늘 세운다).
 *    ⚠️ 일부러 뺀 것: 흰 칸(수업 없는 평일 — 기본 배경이라 설명이 소음). 격자에 새 칠을 더하면 여기도 함께 볼 것.
 * 🔴 칩을 세우는 기준은 **이 화면에 그 칠이 나올 수 있는가**(구조)다 — 이 달에 실제로 나왔는가(데이터)가 아니다.
 *    · 줄무늬·학원 휴일·미등원은 어느 보기·어느 달에나 나올 수 있어 늘 세운다(데이터로 가리면 칩이 달마다 들락거린다).
 *    · 빗금은 강사 전체 보기에서만, 오늘 열 머리는 **보고 있는 달에 오늘이 있을 때만** 격자에 생긴다 —
 *      그 밖에선 화면에 있을 수 없는 칠이라 세우지 않는다.
 * 🔴 빗금 낱말은 **"이 화면 몫 아님"** — "다른 선생님 교시"라고 쓰지 말 것. 빗금은 자리(JJ·랩실) 기록·교시를
 *    안 남긴 옛 기록·담임이 되기 전 기록에도 나온다(`cell-display.ts` `NOT_MINE_MESSAGE` 주석과 같은 규칙 —
 *    적대적 리뷰 2026-09-14가 잡았다).
 * 🔴 칩은 **셀·머리와 같은 함수·같은 상수**로 그린다(`cellDisplay`·`rollupDay`·`DAY_TONE`·`TODAY_HEAD`·`GHOST_HATCH`) —
 *    색을 여기 다시 적으면 셀 색을 바꾸는 날(같은 날의 톤업처럼) 범례만 옛 색으로 남는다.
 * ⚠️ **서버 컴포넌트**다(훅 없음) — 화면 언어는 페이지가 prop으로 내려준다(`matrix-table.tsx`와 같은 규약).
 */
export function AttendanceLegend({
  lang = "ko",
  showGhost,
  showToday,
}: {
  lang?: SheetLang;
  /**
   * 빗금(이 화면 몫이 아닌 기록) 칩 — **강사 전체 보기에서만** 격자에 나오므로 그때만 세운다.
   * 반별 보기에 세우면 화면에 없는 칠을 설명하는 범례가 된다.
   */
  showGhost: boolean;
  /**
   * 오늘 열 머리(남색) 칩 — 격자에 **오늘 열이 있을 때만** 세운다(지난·다음 달엔 남색 머리가 없다).
   * 판정은 표와 같은 날짜 목록(`days[].isToday`)으로 페이지가 한다.
   */
  showToday: boolean;
}) {
  const t = (key: Parameters<typeof sheetT>[1]) => sheetT(lang, key);
  return (
    <div className="flex shrink-0 items-center gap-x-3 overflow-x-auto px-1 pb-1.5 text-xs [&_*]:whitespace-nowrap">
      <span className="micro shrink-0">{t("att.legend")}</span>
      {STATUSES.map((s) => {
        const chip = cellDisplay(s, null);
        return (
          <span key={s} className={ITEM}>
            <span className={`${CHIP} ${chip.className}`}>{chip.text}</span>
            {statusTextOf(s, lang)}
          </span>
        );
      })}
      <span className={ITEM}>
        <span className={`${CHIP} ${MIXED_SAMPLE.className}`} style={MIXED_SAMPLE.style}>
          {MIXED_SAMPLE.text}
        </span>
        {t("att.legend.mixed")}
      </span>
      {/* 보강 예약(0264a) — 칸과 **같은 서식 상수**(makeup-reservation.ts 단일 소스). 어느 보기·어느 달에나 칸이 설 수 있어 늘 세운다. */}
      <span className={ITEM}>
        <span className={`inline-block size-5 shrink-0 rounded-sm ${RESERVED_CELL_CLASS}`} aria-hidden />
        {t("att.cell.reserved")}
      </span>
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
      {showToday ? (
        <span className={ITEM}>
          <span className={`${SWATCH} ${TODAY_HEAD.bg}`} />
          {t("att.legend.today")}
        </span>
      ) : null}
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
