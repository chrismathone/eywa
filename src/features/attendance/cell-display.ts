// 출석부 셀 표기 — 숫자 + 배경색. 순수 함수(Vitest).
//
// 2026-07-21 원장 규칙(구 출석부 표기 관행):
//   출석·지각·조퇴·보강 = **시수 숫자**(기본 1, 배수면 1.5·2), 결석 = **0**.
//   색은 전부 **배경색**으로 — 출석 민트 / 지각 주황 / 결석 빨강 / 조퇴 파랑 / 보강 보라.
// ⚠️ O·X·L 같은 글자 표기로 되돌리지 말 것(원장 지시로 폐기).

import { COUNTABLE_STATUSES, formatSessionUnits } from "./session-units";
// 화면 문구는 사전 단일 소스 — 인자를 안 주면 한국어라 기존 호출부는 그대로다.
import { sheetTf } from "@/features/teacher-view/i18n";
import { ATT_VIVID } from "./status-color";
import { round1 } from "@/lib/guards";

export type AttendanceMark = "present" | "absent" | "late" | "excused" | "makeup" | "early_leave";

/**
 * 한 날짜에 남은 **교시별 유효 기록** 하나(0196a).
 * `slot`이 null이면 교시가 없던 옛 기록(= 그날 전체) — 섞여 있어도 그대로 한 건으로 센다.
 */
export type SlotMark = {
  slot: string | null;
  status: AttendanceMark;
  units: number | null;
  /**
   * 강사 보기의 세지 않는 교시(`ghosts`) 중 **자리(JJ·랩실)** 행 — 강사 보기 저장은 이 행을 안 건드린다(원장 2026-09-12).
   * 그래서 "함께 바뀝니다"·지우기 막힘의 셈(`sharedOtherSlots`)에서 빠진다. 표시(빗금·툴팁)엔 그대로 나온다.
   * 자리일 때만 붙는다(나머지는 키 없음 — 강사 보기 칸 수천 개의 페이로드).
   */
  seat?: true;
  /**
   * 세지 않는 교시(`ghosts`)를 **누가 찍었나** — 입력자 표시 이름(원장 2026-09-15 *"이 화면 몫 아닌 출석부 체크를
   * 누가 했는지 마우스 올리면 알아볼 수 있게"*). 🔴 **귀속이 아니라 입력자**다(`recorded_by` — 데스크가 대신
   * 찍으면 데스크 이름이다, `teacher-axis.ts`). 모르면 키 없음(옛 기록엔 비어 있다 · 칸 수천 개의 페이로드).
   */
  by?: string;
  /** 그 입력의 시각(KST `9/8 16:25`) — `by`와 같은 자리에서만 붙는다. */
  at?: string;
  /**
   * 세지 않는 교시 중 **담임이 되기 전 기록**(화면만 `homeroomSince`로 빼고, 저장은 몫으로 본다 — `buildScopeOwner`).
   * 🔴 이 칸은 저장이 제 몫 경로(시수까지)를 타므로 빗금 칸 입력(상태만 옮기기)을 열면 안 된다 — 격자가 막는다.
   */
  pre?: true;
};

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
 * 오늘 열 **머리** 칠 — 본문 칸엔 없고 날짜 머리에만 선다(지금 위치 표시).
 * 🔴 격자 머리(`matrix-table.tsx`)와 범례(`attendance-legend.tsx`)가 **이 상수 하나**를 읽는다 — 범례에 색을
 *    다시 적으면 머리 색을 바꾸는 날 범례만 옛 색으로 남는다(DAY_TONE과 같은 이유).
 */
export const TODAY_HEAD = { bg: "bg-primary", fg: "text-primary-foreground" } as const;

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
   (rose가 캐논상 '상담·학부모'이긴 하나 이 칸엔 상담 배지가 없어 뜻이 겹치지 않는다.)

   종강(2026-09-14) = 캐논 `inert`(TONE_SOFT.inert와 같은 값). 위 되돌림과 **축이 다르다** — 종강생은 같은 과목
   다른 반을 계속 다니므로 주의를 끌 사건이 아니라 "이 반만 끝났다"는 사실 표시다. 그래서 퇴원(rose)보다 **조용해야**
   맞고, 글자는 진한 잉크라 회색 칸 옆에서도 읽힌다. ⚠️ 퇴원 쪽을 이 회색으로 맞추지 말 것(위 ①② 그대로).
   🔴 안쪽 테두리(`ring-inset ring-line`)를 빼지 말 것 — MCS 고정열은 그 달에 나간 학생 칸 바탕이 `bg-bg-soft`라(종강생 =
   그 달에 나간 학생이라 늘 겹친다) 테두리가 없으면 뱃지 틀이 사라지고 맨 글자만 남는다(리뷰 2026-09-14, 대비 1.00).
   `ring-inset`이라 크기는 그대로다. */
export const BADGE_TONE: Record<"new" | "left" | "transferIn" | "transferOut" | "classEnded", string> = {
  new: "bg-green-soft text-green",
  left: "bg-rose-soft text-rose",
  transferIn: "bg-purple-soft text-purple",
  transferOut: "bg-purple-soft text-purple",
  classEnded: "bg-bg-soft text-text-dim ring-1 ring-inset ring-line",
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

/**
 * 하루치 교시 기록들을 **한 칸**으로 접는다(출석부는 학생×날짜 격자라 칸이 하나뿐이다).
 *
 * 🔴 숫자는 **시수 합**이다 — 하루 2교시를 들으면 2. 급여가 세는 값과 같아야 한다
 *    (대표 1건의 시수만 적으면 화면이 급여보다 적게 말한다).
 * 🔴 **회차 소비(session_term_attendance)와는 일부러 다르다** — 0263a부터 회차는 '하루 = 1회'라
 *    이 칸(시수 합)과 어긋나는 것이 정상이다. 두 값이 다르다고 한쪽을 맞추지 말 것
 *    (CLAUDE.md "이름 셋을 구분할 것": 시수 ≠ 회차).
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

/**
 * 빗금 칸 카드의 **교시별 줄** — `16:20 출석 1 · 김동후 입력 9/8 16:25`(원장 2026-09-15).
 *
 * 🔴 입력자·시각은 **모르면 그 조각만 빠진다**(지어내지 않는다) — 옛 기록엔 `recorded_by`가 없다.
 * ⚠️ **사유를 단정하지 않는다** — 자리(JJ·랩)일 수도, 다른 선생님 교시일 수도, 교시를 안 남긴 옛 기록이라
 *    담당을 못 가르는 경우일 수도, 담임이 되기 전 기록일 수도 있다. 카드의 라벨(`att.legend.ghost`)이 그 넷에
 *    모두 참인 말이고, 여기서는 **무엇이 찍혔는지**만 편다.
 */
export function ghostSlotLines(others: readonly SlotMark[], lang: "ko" | "en" = "ko"): string[] {
  return others.map((s) => {
    const time = s.slot ? `${s.slot.slice(0, 5)} ` : "";
    const head = `${time}${statusTextOf(s.status, lang)} ${markNumber(s.status, s.units)}`;
    const by = s.by?.trim() ? sheetTf(lang, "att.cell.ghostBy", { name: s.by.trim() }) : "";
    const tail = [by, s.at?.trim() ?? ""].filter((x) => x !== "").join(" ");
    return tail === "" ? head : `${head} · ${tail}`;
  });
}

export type CellDisplay = {
  text: string;
  className: string;
  style?: { background?: string; backgroundImage?: string };
  /** 글자를 흐리게 — 빗금 칸의 남의 교시 값(이 표 몫이 아니다). */
  faded?: true;
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
/**
 * 격자가 입력을 막는 칸의 **사유 코드**(`buildGridSource` → grid-context `notMine`) — true = 이 화면 몫 아님(종전) ·
 * `"seat"` = 자리(JJ·랩실) 기록뿐.
 * ⚠️ **날짜로는 막지 않는다** — 강사 보기도 모든 날짜 칸이 열려 있다(원장 2026-09-17 저녁 *"다른 요일도 보강 등으로 수업할 수
 *    있으니까 숫자 입력가능하게"*). 제 교시 기록이 없는 칸도 열린다(저장이 제 행을 새로 만든다).
 */
export type NotMineReason = true | "seat";

export const NOT_MINE_MESSAGE =
  "이 날 찍힌 기록이 이 화면의 몫이 아니라 여기서는 못 고칩니다 — 반별 보기에서 고치세요";

/**
 * 세지 않는 교시 중 **이 칸을 고치면 함께 바뀌는** 것 — 자리(JJ·랩실, `seat`)는 뺀다.
 * 🔴 원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."* — 강사 보기 저장은 자리 행을 안 건드린다(`splitOutSeatRows`).
 *    격자의 "함께 바뀝니다"·지우기 막힘(`alsoWrites`)과 칸 툴팁·팝오버가 **이 한 함수로** 센다 — 따로 세면 같은 칸이
 *    표면마다 다른 건수를 말한다(#77).
 */
export function sharedOtherSlots(others: readonly SlotMark[] | undefined): SlotMark[] {
  return others ? others.filter((o) => !o.seat) : [];
}

/**
 * 이 칸이 **이 표의 몫이 아닌가**(격자 잠금·빗금 사유) — 격자(`buildGridSource`)와 행(`matrix-row`)이 같은 답을 쓴다.
 *
 * 🔴 본래는 "값이 없고 세지 않는 교시만 있는 칸"(빗금)이다. 여기에 **값이 파생뿐인 칸**을 더한다(리뷰 2026-09-12):
 *    수업보고서 파생은 "내 몫 수기 기록이 없는 등원일"을 메우므로 **실제 행이 자리·남의 교시뿐인 칸도 '출석'으로
 *    채운다**. 그 칸은 값이 보여 격자가 통과시키는데 서버엔 제 몫 행이 0이라 `NOT_MINE_MESSAGE`로 거절된다 —
 *    누르고 나서 실패 토스트를 보느니 **누르기 전에** 같은 사유로 막는 게 정직하다.
 * ⚠️ 반별 보기는 `others`가 항상 비어 있어 **항상 null**이다(종전과 완전히 같다).
 * 🔴 2026-09-14부터 반환은 **막는 사유**다(`seatOnly`·`locked`, 입력 가능 = null) — 다른 선생님 교시 기록이 있는 빗금 칸은
 *    막지 않고 상태를 옮긴다(`ghostCellKind` `transfer`). 사유를 가르는 건 자리뿐인 칸에 "반별 보기에서 고치세요"라고
 *    하면 자리 기록을 반별 보기에서 고치라는 거짓 안내가 되기 때문이다.
 */
export function notMineCell(input: GhostCellInput): "seatOnly" | "locked" | null {
  const kind = ghostCellKind(input);
  return kind === "transfer" ? null : kind;
}

type GhostCellInput = {
  /** 서버가 준 값이 있나(`marks`). */
  hasValue: boolean;
  /** 그 값이 수업보고서 **파생**인가(실제 출결 행이 아니다). */
  derivedValue: boolean;
  others?: readonly SlotMark[];
};

/**
 * 제 몫 수기 값이 없는 칸의 성격 — 격자(`buildGridSource`)·행(`matrix-row`)·칸·조회(`queries`)가 **이 한 함수**로 가른다.
 *   · `transfer` = 다른 선생님 교시 기록이 있다 → 입력하면 그 행들에 **상태만** 옮긴다(원장 2026-09-14 *"그냥 그 날의
 *     해당 담당 출석으로 전부 이전시켜. 다른 사람이 대신 찍었어도."*). 서버 `planScopedDay`의 `transfer`와 짝.
 *   · `seatOnly` = 자리(JJ·랩실) 기록뿐 → 막는다(원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."*).
 *   · `locked` = 담임 이전 기록(`pre`)이 섞였거나 값이 파생뿐 → 종전대로 막는다(`NOT_MINE_MESSAGE`).
 * 🔴 `pre`를 먼저 본다 — 그 행은 저장이 제 몫으로 보아 **시수까지** 나눠 쓰므로 "상태만"이라는 약속이 거짓이 된다.
 * 🔴 파생 값 칸은 옮기지 않는다 — 칸이 보여 주는 값(보고서 파생)과 옮겨지는 기록(남의 교시)이 다른 사실이다.
 * ⚠️ null = 빗금 칸이 아니다(세지 않는 교시가 없거나 제 몫 수기 값이 있다 — 종전 경로).
 */
export function ghostCellKind(input: GhostCellInput): "transfer" | "seatOnly" | "locked" | null {
  const others = input.others ?? [];
  if (others.length === 0) return null;
  if (input.hasValue && !input.derivedValue) return null;
  if (others.some((o) => o.pre)) return "locked";
  if (others.every((o) => o.seat)) return "seatOnly";
  return input.derivedValue ? "locked" : "transfer";
}

/** 빗금 칸의 **표시 전용** 값 — `s` 대표 상태 · `u` 소비 시수 합 · `p` 전부 들었을 때의 합(null = 1, 칸 값 규약). */
export type GhostValue = { s: AttendanceMark; u: number | null; p: number | null };

/**
 * `transfer` 칸에 보일 값 — 다른 선생님 교시 기록(자리 제외)의 롤업. 격자가 이 값을 **합계 밖**(`g`)으로 싣는다.
 * 🔴 `p`가 있는 이유: 상태를 옮기면 서버는 그 행들의 시수를 그대로 두므로 옮긴 뒤 합은 `p`(들은 상태) 또는 0이다 —
 *    낙관값이 이 숫자와 같아야 새로고침에서 덮개가 벗겨진다(`grid/store.ts`).
 */
export function ghostGridValue(others: readonly SlotMark[]): GhostValue | null {
  const shared = sharedOtherSlots(others);
  const day = rollupDay(shared);
  if (!day) return null;
  const potential = round1(shared.reduce((sum, o) => sum + consumedUnits("present", o.units), 0));
  const norm = (n: number) => (n > 0 && n !== 1 ? n : null);
  return { s: day.status, u: norm(day.units), p: norm(potential) };
}

/** 빗금 위 흐린 숫자의 글자색 — 격자 원색 표(`ATT_VIVID`)의 글자색만 쓴다(색 맵을 새로 만들지 않는다). */
function statusInk(mark: AttendanceMark): string {
  return STATUS_TONE[mark].split(" ").find((c) => c.startsWith("text-")) ?? "";
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
    /**
     * 빗금 칸(`ghost`)에 보일 **다른 선생님 교시 값**(원장 2026-09-14 — 옮긴 뒤 "빗금 위에 값을 보여주고 합계엔 안 넣는다").
     * 빗금은 그대로 두고 숫자만 흐리게 얹는다. 없으면 종전 가운뎃점.
     */
    ghostMark?: { s: AttendanceMark; u: number | null } | null;
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
  if (opts.ghost && opts.ghostMark) {
    // 요일 배경색은 아래 갈래와 **같은 우선순위**로 고른다(빗금 위 숫자만 다르다).
    const tone = opts.outside
      ? DAY_TONE.outside
      : opts.holiday
        ? DAY_TONE.holiday
        : opts.muted
          ? DAY_TONE.weekend
          : opts.attendDay
            ? DAY_TONE.classDay
            : "";
    const text = markNumber(opts.ghostMark.s, opts.ghostMark.u);
    return { text, className: `${statusInk(opts.ghostMark.s)} ${tone}`.trim(), faded: true, ...hatch };
  }
  if (opts.outside) return { text: "", className: `text-text-faint ${DAY_TONE.outside}`, ...hatch };
  if (opts.holiday) return { text: "·", className: `text-text-faint ${DAY_TONE.holiday}`, ...hatch };
  if (opts.muted) return { text: "·", className: `text-text-faint ${DAY_TONE.weekend}`, ...hatch };
  if (opts.attendDay) return { text: "·", className: `text-text-faint ${DAY_TONE.classDay}`, ...hatch };
  return { text: "·", className: "text-text-faint", ...hatch };
}
