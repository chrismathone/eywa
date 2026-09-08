// 출석부 셀 표기 — 숫자 + 배경색. 순수 함수(Vitest).
//
// 2026-07-21 원장 규칙(구 출석부 표기 관행):
//   출석·지각·조퇴·보강 = **시수 숫자**(기본 1, 배수면 1.5·2), 결석 = **0**.
//   색은 전부 **배경색**으로 — 출석 민트 / 지각 주황 / 결석 빨강 / 조퇴 파랑 / 보강 보라.
// ⚠️ O·X·L 같은 글자 표기로 되돌리지 말 것(원장 지시로 폐기).

import { COUNTABLE_STATUSES, formatSessionUnits } from "./session-units";
// 화면 문구는 사전 단일 소스 — 인자를 안 주면 한국어라 기존 호출부는 그대로다.
import { sheetT } from "@/features/teacher-view/i18n";
import { ATT_VIVID } from "./status-color";

export type AttendanceMark = "present" | "absent" | "late" | "excused" | "makeup" | "early_leave";

/**
 * 한 날짜에 남은 **교시별 유효 기록** 하나(0196a).
 * `slot`이 null이면 교시가 없던 옛 기록(= 그날 전체) — 섞여 있어도 그대로 한 건으로 센다.
 */
export type SlotMark = { slot: string | null; status: AttendanceMark; units: number | null };

/**
 * 상태별 배경(+글자색) = **쨍한 파스텔 원색**(`--att-*`, globals.css).
 * 2026-07-21 원장 교정: *"형광색은 날짜가 아니라 학생 출결 1의 배경 · 색도 더 쨍하게"* —
 * 앱 표준 -soft 토큰(12~13% 틴트)으로는 31칸 격자에서 결석·지각이 안 튀었다.
 * ⚠️ 색을 다시 -soft 틴트로 낮추지 말 것. 이 팔레트는 출석부 전용이며 다른 화면에 쓰지도 말 것.
 */
export const STATUS_TONE: Record<AttendanceMark, string> = ATT_VIVID;

/**
 * 날짜 성격 배경 — 헤더·본문이 **같은 상수**를 써야 열이 위아래로 어긋나지 않는다.
 * · 수업하는 요일(기록 전) = 아주 옅은 민트(출석 민트의 옅은 버전 — "찍어야 할 칸"이지 출결 표시가 아니다)
 * · 수업 없는 평일 = 흰색  · 주말 = 회색  · **학원 휴일(휴강) = 옅은 붉은색**
 * ⚠️ 여기(날짜)에 쨍한 색을 주면 출결 표시와 헷갈린다 — 쨍한 색은 STATUS_TONE(1의 배경)만.
 */
export const DAY_TONE = {
  classDay: "bg-att-classday",
  weekend: "bg-att-weekend",
  /**
   * 재원 기간 밖(아직 안 왔거나 이미 나간 날) — 구 출석부의 빗금 자리.
   * 사선 무늬는 31칸 격자에서 눈이 아파 **한 톤 낮은 회색 + 옅은 글자**로 대신한다.
   * ⚠️ 주말 회색보다 진해야 한다 — 같은 회색이면 "쉬는 날"과 "소속 아님"이 구분되지 않는다.
   */
  outside: "bg-att-outside",
  /**
   * 학원 휴일(휴강) — 원장 2026-09-07 *"공휴일(휴강)은 셀을 구분시켜줘"*.
   *
   * 🔴 종전엔 **주말과 같은 회색**이라 "쉬는 날"이라는 것만 알 뿐 *왜* 쉬는지가 안 보였다(달력에서
   *    공휴일은 늘 붉게 적히는데 여기선 글자만 빨갛고 배경은 주말과 똑같았다).
   * ⚠️ 출결 danger(결석)보다 **훨씬 옅어야** 한다 — 쨍하면 "결석이 깔린 열"로 읽힌다.
   *    날짜 성격은 옅게, 쨍한 색은 STATUS_TONE만(이 블록 맨 위 경고와 같은 규칙).
   * ⚠️ 판정 자료는 **학원설정 `operations.holidays`** 하나뿐이다(법정공휴일 ≠ 학원 휴원일 — 이 학원은
   *    실제로 공휴일에 수업한 날이 있다). 캘린더 탭 내장 표를 여기 끌어오지 말 것.
   */
  holiday: "bg-att-holiday",
} as const;

/**
 * 고정 표 헤더의 높이 — **이 두 값은 반드시 같아야 한다.**
 *
 * 🔴 방향키로 위로 이동하면 `scrollIntoView({block:"nearest"})`가 활성 칸을 스크롤포트 **맨 위**에 붙이는데,
 *    그 자리는 sticky 헤더가 덮고 있다 → 활성 칸이 헤더 뒤로 **통째로 사라진다**(2026-08-06 실측: 37px 겹침,
 *    화면상 "방향키를 눌렀는데 커서가 없어짐"). `scroll-margin-top`을 헤더 높이만큼 주면 브라우저가 그만큼
 *    더 스크롤해 칸을 **헤더 바로 아래**에 세운다.
 * ⚠️ 헤더 높이를 바꾸면 `CELL_SCROLL_MARGIN`도 같이 바꿀 것. Tailwind가 스캔하도록 **리터럴 문자열**로 둔다
 *    (템플릿 조합 `scroll-mt-[${n}px]`은 JIT가 못 잡아 클래스가 생성되지 않는다).
 */
export const HEAD_ROW_H = "h-[38px]";
export const CELL_SCROLL_MARGIN = "scroll-mt-[38px]";

/**
 * 이름 칸 표식(신입·퇴원·반이동) — **출석부 화면과 인쇄물이 같은 색·같은 크기**를 써야 한다.
 * (원래 matrix-row.tsx 지역 상수였는데, 급여명세서 별지가 같은 표를 그리게 되면서 여기로 올렸다.
 *  두 벌로 두면 화면과 종이의 '퇴원' 표시가 서로 달라진다.)
 * ⚠️ 출결 팔레트(`--att-*`)를 쓰지 않는다 — 그 색은 칸의 출결 값 전용이라 이름 옆에 쓰면 뜻이 겹친다.
 */
/* v4: Tailwind 기본 팔레트(emerald/rose/violet-100)에서 앱 토큰으로 — **뜻과 색상 계열은 그대로다.**
   신입=green · 퇴원=rose · 반이동=purple.

   ⚠️ 퇴원을 한때 중립 회색으로 바꿨다가 **되돌렸다**(2026-08-18). 캐논의 `inert`(종료=색을 뺀다)를
   그대로 적용한 건데, 두 가지가 틀렸다:
     ① 이 셋은 **한 세트**(생애주기 사건)라 서로 구분돼야 하는데 하나만 무채색이면 세트에서 빠진다.
     ② 같은 표에 주말 회색(`--att-weekend` #dfdfe6)이 깔려 있어 대비가 **1.13**이었다(실측) —
        회색 배지가 회색 칸 옆에 서서 "표식이 있다"는 사실 자체가 안 보인다.
   🔑 `inert`는 **목록에서 지나간 행을 죽일 때** 쓰는 톤이지, **주의를 끌려고 붙인 배지**에 쓸 톤이 아니다.
   (rose가 캐논상 '상담·학부모'이긴 하나 이 칸엔 상담 배지가 없어 뜻이 겹치지 않는다.) */
export const BADGE_TONE: Record<"new" | "left" | "transferIn" | "transferOut", string> = {
  new: "bg-green-soft text-green",
  left: "bg-rose-soft text-rose",
  transferIn: "bg-purple-soft text-purple",
  transferOut: "bg-purple-soft text-purple",
};

/** 표식 공통 크기 — 신입·퇴원·반이동·「단가」 전부 이 하나(크기 제각각 금지, 원장 2026-08-10). */
export const BADGE_BASE = "shrink-0 rounded-sm px-1 text-xs leading-[14px] font-bold";

export const STATUS_TEXT: Record<AttendanceMark, string> = {
  present: "출석",
  absent: "결석",
  excused: "결석",
  late: "지각",
  early_leave: "조퇴",
  makeup: "보강",
};

/**
 * 같은 표기의 **영어판** — 강사뷰 영어 화면(원장 2026-09-04 *"강사가 접근 가능한 모든 메뉴를 전환"*).
 *
 * 🔴 **한글 맵 바로 옆에 둔다** — 나누면 상태가 늘 때 한쪽만 채워지고 raw enum이 화면에 샌다.
 * ⚠️ ECS `ATTENDANCE_LABEL`과 **일부러 다르다**: 여기서는 공결도 `Absent`로 접는다(시수 0을
 *    말하는 표기라 한국어 쪽이 이미 그렇게 접고 있다). 두 표를 합치지 말 것.
 */
export const STATUS_TEXT_EN: Record<AttendanceMark, string> = {
  present: "Present",
  absent: "Absent",
  excused: "Absent",
  late: "Late",
  early_leave: "Left early",
  makeup: "Makeup",
};

/** 화면에 적을 상태 표기. 인자를 안 주면 한국어(기존 호출부는 한 글자도 안 바뀐다). */
export function statusTextOf(mark: AttendanceMark, lang: "ko" | "en" = "ko"): string {
  return lang === "en" ? STATUS_TEXT_EN[mark] : STATUS_TEXT[mark];
}

/** 결석은 시수를 소비하지 않으므로 0. 나머지는 시수(미입력·이상값=1). 급여로 흘러가는 그 숫자다. */
export function consumedUnits(status: AttendanceMark, units: number | null | undefined): number {
  if (status === "absent" || status === "excused") return 0;
  const u = units ?? 1;
  return Number.isFinite(u) && u > 0 ? u : 1;
}

/** 결석은 시수를 소비하지 않으므로 언제나 0. 나머지는 시수(미입력=1). */
export function markNumber(status: AttendanceMark, units: number | null | undefined): string {
  return formatSessionUnits(consumedUnits(status, units));
}

/** 대표 상태 우선순위 — 소비 상태끼리 비교할 때 **눈에 띄어야 할 쪽**이 이긴다(지각 > 조퇴 > 보강 > 출석). */
const SEVERITY: Record<AttendanceMark, number> = {
  absent: 0,
  excused: 0,
  late: 4,
  early_leave: 3,
  makeup: 2,
  present: 1,
};

/** 줄무늬 배경용 CSS 변수(globals.css `--att-*`) — 클래스로는 두 색을 한 칸에 못 칠한다. */
const STATUS_VAR: Record<AttendanceMark, string> = {
  present: "--att-present",
  absent: "--att-absent",
  excused: "--att-absent",
  late: "--att-late",
  early_leave: "--att-leave",
  makeup: "--att-makeup",
};

export type DayRollup = {
  /** 대표 상태(가장 무거운 것) — 칸 글자색·단색 배경. */
  status: AttendanceMark;
  /** 그날 소비 시수 **합**(결석은 0). 칸에 적히는 숫자이자 행 시수 합의 재료. */
  units: number;
  /** 유효 기록 수 = 그날 찍힌 교시 수. 1이면 종전과 완전히 같다. */
  count: number;
  /** 색이 서로 다른 기록이 섞였나 — 줄무늬로 그린다(결석·사유결석은 같은 색이라 섞인 게 아니다). */
  mixed: boolean;
  /** 교시 순서(오전→오후, 교시 없는 옛 기록이 맨 앞). */
  slots: SlotMark[];
};

/** 0.1 단위 반올림 — 1.5를 여러 번 더할 때 생기는 부동소수 꼬리를 자른다(totals.ts와 같은 규약). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 하루치 교시 기록들을 **한 칸**으로 접는다(출석부는 학생×날짜 격자라 칸이 하나뿐이다).
 *
 * 🔴 숫자는 **합**이다 — 하루 2교시를 들으면 2. 회차 소비·급여가 세는 값(session_term_attendance,
 *    0198a)과 같아야 한다. 대표 1건의 시수만 적으면 화면이 급여보다 적게 말한다.
 * ⚠️ 접는 것은 **표시**뿐이다. 기록은 교시별로 그대로 있고, 교시별 수정은 영어 수업 시트(ECS)가 맡는다.
 */
export function rollupDay(slots: readonly SlotMark[]): DayRollup | null {
  if (slots.length === 0) return null;
  // 교시 순서 = 시각 오름차순. 교시 없는 옛 기록(null)은 맨 앞.
  const ordered = [...slots].sort((a, b) => (a.slot ?? "").localeCompare(b.slot ?? ""));
  // 🔴 대표는 **소비 상태 중에서** 고른다(하나라도 들었으면 결석을 대표로 세우지 않는다).
  //    이유는 표시가 아니라 **합계**다: 행 시수 합(countCells)은 대표 상태가 소비 상태일 때만
  //    시수를 더하므로, 출석+결석인 날의 대표를 결석으로 두면 화면 합계가 급여보다 1시수 적어진다.
  //    빠진 교시는 색이 갈린 **줄무늬**와 툴팁이 드러낸다 — 숨기는 게 아니다.
  const consumedSlots = ordered.filter((s) => COUNTABLE_STATUSES.has(s.status));
  const pool = consumedSlots.length > 0 ? consumedSlots : ordered;
  let status = pool[0]!.status;
  let units = 0;
  for (const s of pool) {
    if (SEVERITY[s.status] > SEVERITY[status]) status = s.status;
  }
  for (const s of ordered) {
    units += consumedUnits(s.status, s.units);
  }
  // '섞임' 판정은 상태 키가 아니라 **색**으로 — absent/excused는 같은 빨강이라 줄무늬로 나눌 게 없다.
  const mixed = new Set(ordered.map((s) => STATUS_VAR[s.status])).size > 1;
  return { status, units: round1(units), count: ordered.length, mixed, slots: ordered };
}

/** 섞인 날의 배경 — 교시 순서대로 색을 나눠 칠한다. 칸 하나가 곧 "그날 몇 교시였는지"를 말한다. */
function slotStripes(slots: readonly SlotMark[]): string {
  const n = slots.length;
  const stops = slots.map((s, i) => {
    const from = round1((i / n) * 100);
    const to = round1(((i + 1) / n) * 100);
    return `var(${STATUS_VAR[s.status]}) ${from}% ${to}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** 툴팁 한 줄 — "12:30 출석 1 · 14:10 결석 0". 교시가 없던 옛 기록은 시각 없이 상태만. */
export function slotBreakdown(slots: readonly SlotMark[], lang: "ko" | "en" = "ko"): string {
  return slots
    .map((s) => {
      const time = s.slot ? `${s.slot.slice(0, 5)} ` : "";
      return `${time}${statusTextOf(s.status, lang)} ${markNumber(s.status, s.units)}`;
    })
    .join(" · ");
}

export type CellDisplay = {
  text: string;
  className: string;
  style?: { background?: string; backgroundImage?: string };
};

/**
 * **이 표가 세지 않는 교시**만 있는 칸의 빗금 — 값은 없지만 기록은 있다는 표시.
 *
 * 🔴 왜 빗금인가: 강사 전체 보기는 그 강사의 교시만 세므로(queries `scopeTeacherId`), 남의 교시·자리(JJ)만
 *    있는 날은 값이 없다. 그런데 월간 출석부는 집계 화면이 아니라 **입력 격자**라, 그냥 빈칸으로 두면
 *    사람이 거기 다시 찍어 숨어 있던 남의 기록을 덮는다(범위 Delete면 통째 삭제). 빗금 + 툴팁이
 *    "여긴 기록이 있고, 다만 당신 몫이 아니다"를 말해 준다(#103과 같은 결 — 문을 잠그지는 않는다).
 * ⚠️ `background`가 아니라 `backgroundImage`다 — 배경**색**(요일 민트·주말 회색)은 클래스가 계속 그린다.
 */
export const GHOST_HATCH =
  "repeating-linear-gradient(45deg, var(--line-strong) 0 2px, transparent 2px 6px)";

/**
 * 빗금 칸(이 표의 몫이 아닌 칸)에서 입력을 막을 때의 **사유 한 문장** — 격자·행·팝오버가 같은 말을 쓴다.
 * 문장을 두 벌 만들면 같은 칸이 화면마다 다른 이유를 대게 된다.
 *
 * ⚠️ **"선생님 교시가 없는 날"이라고 쓰지 말 것** — 그 강사가 그날 유효 슬롯을 **갖고 있는데** 아직
 *    자기 교시만 안 찍힌 상태(부분 입력 중)도 여기로 온다(실측 2026-08-18 하루에 30칸). 그렇게 쓰면
 *    시간표를 아는 강사가 "내 교시 있는데?"라고 신고하게 된다.
 * ⚠️ **"다른 교시 것"이라고도 쓰지 말 것**(2026-08-19) — 사유가 하나 더 늘었다: **담임이 되기 전**
 *    기록(전임이 넣은 것)도 여기로 온다. 그건 교시 문제가 아니다.
 *    참인 것은 **"이 화면의 몫이 아니다"** 뿐이다.
 */
export const NOT_MINE_MESSAGE =
  "이 날 찍힌 기록이 이 화면의 몫이 아니라 여기서는 못 고칩니다 — 반별 보기에서 고치세요";

/**
 * 세지 않는 기록 툴팁 — "이 선생님 몫으로 세지 않는 기록 · 16:20 출석 1 · 18:20 출석 1".
 * ⚠️ **사유를 단정하지 않는다** — 자리(JJ·랩)일 수도, 다른 선생님 교시일 수도, 교시를 안 남긴 옛
 *    기록이라 담당을 못 가르는 경우일 수도, **담임이 되기 전 기록**(2026-08-19)일 수도 있다.
 *    넷 다 참인 문장만 쓴다 — 그래서 "교시"라고도 못 박지 않는다(담임 이전 기록은 교시 문제가 아니다).
 */
export function ghostBreakdown(others: readonly SlotMark[], lang: "ko" | "en" = "ko"): string {
  return `${sheetT(lang, "att.cell.ghostPrefix")}${slotBreakdown(others, lang)}`;
}

/**
 * 셀 한 칸의 배경 = 그 날의 성격(원장 규칙 2026-07-21): **수업하는 요일 민트 · 수업 없는 평일 흰색 · 주말 회색**.
 * @param attendDay 그 학생이 그 요일에 등원하는지(수업요일 하이라이트)
 * @param muted 주말·공휴일 등 수업이 없는 날(회색)
 */
export function cellDisplay(
  status: AttendanceMark | null,
  units: number | null | undefined,
  opts: {
    attendDay?: boolean;
    muted?: boolean;
    outside?: boolean;
    day?: DayRollup | null;
    /** 이 표가 세지 않는 교시만 있는 칸(자리·남의 교시) — 값은 없고 빗금만(GHOST_HATCH 주석). */
    ghost?: boolean;
    /**
     * 학원 휴일(휴강)인 날 — 주말 회색과 **갈라서** 칠한다(2026-09-07).
     * ⚠️ `muted`보다 **먼저** 본다: 휴일은 muted의 한 갈래로 넘어오는데, 뒤에 두면 회색이 이긴다.
     * 🔴 값이 있으면 값이 먼저다(위 규칙 그대로) — 휴일에 실제로 수업했으면 그 기록이 보여야 한다.
     */
    holiday?: boolean;
  } = {},
): CellDisplay {
  // 하루에 교시가 둘 이상 찍힌 칸(0196a) — 숫자는 **합**, 색이 갈리면 교시 순서대로 줄무늬.
  // ⚠️ 대표 상태가 결석이어도 숫자는 0이 아니다(한 교시라도 들었으면 그 시수가 살아 있어야 한다).
  const day = opts.day;
  if (day && day.count > 1) {
    return {
      text: formatSessionUnits(day.units),
      className: STATUS_TONE[day.status],
      ...(day.mixed ? { style: { background: slotStripes(day.slots) } } : {}),
    };
  }
  // 🔴 기록이 있으면 재원 기간 밖이라도 **값이 먼저**다 — 퇴원 뒤 보강 출석이 실제로 있고,
  //    그걸 회색으로 덮으면 급여에 잡히는 시수가 화면에서 사라진다(구 출석부도 값을 그렸다).
  if (status) return { text: markNumber(status, units), className: STATUS_TONE[status] };
  // 값이 없는 칸 — 요일 성격만 그린다. 이 표가 세지 않는 교시가 남아 있으면 그 위에 빗금을 얹어
  // "빈칸이 아니라 남의 몫"임을 드러낸다(배경색은 그대로 두고 backgroundImage만 겹친다).
  const hatch = opts.ghost ? { style: { backgroundImage: GHOST_HATCH } } : {};
  if (opts.outside) return { text: "", className: `text-text-faint ${DAY_TONE.outside}`, ...hatch };
  if (opts.holiday) return { text: "·", className: `text-text-faint ${DAY_TONE.holiday}`, ...hatch };
  if (opts.muted) return { text: "·", className: `text-text-faint ${DAY_TONE.weekend}`, ...hatch };
  if (opts.attendDay) return { text: "·", className: `text-text-faint ${DAY_TONE.classDay}`, ...hatch };
  return { text: "·", className: "text-text-faint", ...hatch };
}
