/**
 * 학부모 결석 통보 **접수** — "어느 칸에 결석을 찍을지"를 정하는 순수 로직(IO 없음 · Vitest).
 *
 * 배경(원장 2026-08-19): *"데스크에서 학부모 연락을 받으면 결석처리를 진행하고, 그 결석이 모든 곳에
 * 자동으로 연결돼 담임이 이중으로 결석처리하지 않게. 메모도 마찬가지."*
 *
 * 전화 한 통은 보통 **여러 칸**이다 — "8월 19일·21일 제주도 여행"이면 그 학생이 그 이틀에 듣는 반이
 * 전부 결석이고, 영어처럼 하루 3교시를 듣는 학생이면 칸이 더 늘어난다. 지금까지는 데스크가 출석부에서
 * 그 칸들을 하나씩 찾아 찍어야 했다(실측: 최근 90일 결석 647건 중 미리 찍은 건 5건뿐).
 *
 * 🔴 **저장 축은 과목이 정한다**([`live/slot-axis.ts`](../live/slot-axis.ts)) — 영어는 교시별 한 행,
 *    수학은 하루 한 행이 규약이다. 이 규칙을 무시하고 교시별로 찍으면 수학 연강 반의 시수·회차가
 *    2~3배로 부풀어 급여·청구가 조용히 틀어진다. 그래서 칸을 만들 때부터 축을 확정해 둔다.
 * 🔴 **흩어진 날짜를 구간으로 뭉치지 않는다**([[#100]]) — "19일과 21일"을 "19~21일"로 적으면 20일까지
 *    결석이 되어 아이가 오는 날 안 온 것으로 표시된다. 날짜는 **목록**으로 다룬다.
 * ⚠️ 공휴일(학원설정 `operations.holidays`)은 애초에 칸을 만들지 않는다 — 쉬는 날 결석은 거짓이다.
 */
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { weekdayIndexOf } from "@/lib/date-kst";
import { DOW_KEYS } from "../calendar";
import { isPerSlotSubject } from "../live/slot-axis";

/** 한 번에 접수할 수 있는 최대 기간(일). 장기 결석은 휴원 처리가 정석이라 한 달로 끊는다. */
export const INTAKE_MAX_RANGE_DAYS = 31;
/** 한 번에 만들 수 있는 최대 칸 수 — 실수로 전 학년을 훑는 요청을 막는 안전선(정상 통보는 10칸 안팎). */
export const INTAKE_MAX_CELLS = 60;
/** 사유 메모 최대 길이 — 출석부 칸 툴팁·ECS 사유 칸에 그대로 실린다. */
export const INTAKE_MAX_REASON = 200;

export type IntakeEnrollment = {
  classId: string;
  className: string;
  subject: string | null;
  startDate: string | null;
  endDate: string | null;
  /** 반이동으로 끝난 구간인가 — 종료일 당일은 이미 새 반이다([eligibility](@/features/enrollments/eligibility)). */
  isTransferred?: boolean;
  /** 분리등원(`enrollments.attendance_days`). 비면 그 반 수업요일 전부. */
  attendanceDays: readonly (string | null)[] | null;
};

export type IntakeSlot = {
  classId: string;
  dayOfWeek: string;
  /** "HH:MM" 또는 "HH:MM:SS" — 앞 5자만 쓴다. */
  startTime: string;
  validFrom: string | null;
  validTo: string | null;
};

export type IntakeCell = {
  classId: string;
  className: string;
  subject: string | null;
  date: string;
  /** 화면에 보이는 교시 시작("HH:MM") — 하루 한 행 과목에선 그날 첫 교시. */
  periodStart: string;
  /** 저장 축 — per-slot 과목(영어)이면 그 교시, 아니면 null("그날 전체"). */
  saveSlot: string | null;
  /** 이 칸이 접은 교시 수(하루 한 행 과목의 연강). 화면이 "1~3교시"를 밝히는 데 쓴다. */
  slotCount: number;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: string | null | undefined): boolean {
  return !!value && YMD.test(value);
}

/** "HH:MM:SS" → "HH:MM". 축 비교·저장이 모두 5자 기준이다(save-targets와 같은 규약). */
export function hhmm(time: string | null | undefined): string {
  return String(time ?? "").slice(0, 5);
}

/**
 * from~to(양끝 포함)의 날짜 목록. 뒤집힌 범위는 빈 배열(호출부가 검증 메시지를 낸다).
 * ⚠️ 상한을 넘으면 **자르지 않고 빈 배열** — 조용히 잘라 절반만 접수되면 나머지 날은 아무도 모른다.
 */
export function expandDateRange(from: string, to: string, maxDays: number = INTAKE_MAX_RANGE_DAYS): string[] {
  if (!isYmd(from) || !isYmd(to) || to < from) return [];
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const cur = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  for (let i = 0; i < maxDays; i++) {
    const iso = cur.toISOString().slice(0, 10);
    if (iso > to) return out;
    out.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  // 상한 안에서 to에 못 닿았다 = 범위가 너무 길다.
  return out[out.length - 1] === to ? out : [];
}

/** 이 스케줄 행이 그 날짜에 살아 있나 — 요일 일치 + 유효기간 포함(둘 다 없으면 항상 유효). */
export function slotAppliesOn(slot: IntakeSlot, date: string, dow: string): boolean {
  if (slot.dayOfWeek !== dow) return false;
  const from = slot.validFrom ? String(slot.validFrom).slice(0, 10) : null;
  const to = slot.validTo ? String(slot.validTo).slice(0, 10) : null;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** 칸의 신원 — (반, 날짜, 저장축). 같은 반에 수강행이 둘(재등록)이어도 칸은 하나다. */
export function cellKey(cell: Pick<IntakeCell, "classId" | "date" | "saveSlot">): string {
  return `${cell.classId}|${cell.date}|${cell.saveSlot ?? ""}`;
}

/**
 * 접수 대상 칸 목록 — "그 기간에 이 학생이 실제로 수업이 있는 (반 × 날짜 × 저장축)".
 *
 * 판정 순서: 공휴일 제외 → 수강 구간 안 → 분리등원 요일 → 그 날짜에 살아 있는 교시 → 과목별 저장 축.
 * ⚠️ 교시가 하나도 없는 날은 칸을 만들지 않는다(그 반이 그날 수업하지 않는다는 뜻).
 */
export function buildAbsenceCells(input: {
  dates: readonly string[];
  enrollments: readonly IntakeEnrollment[];
  slots: readonly IntakeSlot[];
  holidays: ReadonlySet<string>;
}): IntakeCell[] {
  const slotsByClass = new Map<string, IntakeSlot[]>();
  for (const s of input.slots) {
    const list = slotsByClass.get(s.classId);
    if (list) list.push(s);
    else slotsByClass.set(s.classId, [s]);
  }

  const seen = new Set<string>();
  const out: IntakeCell[] = [];
  for (const date of input.dates) {
    if (!isYmd(date) || input.holidays.has(date)) continue;
    const dow = DOW_KEYS[weekdayIndexOf(date)];
    if (!dow) continue;
    for (const e of input.enrollments) {
      if (e.startDate && date < e.startDate) continue;
      // 종료 규약은 eligibility 단일 소스 — `date > e.endDate`로 직접 쓰면 **반이동 학생의 옛 반이
      // 적용일에 후보로 남아** 데스크가 이미 떠난 반에 결석을 찍는다(2026-09-01 실측).
      if (isEnrollmentEndedOn(e.endDate, date, e.isTransferred)) continue;
      const own = (e.attendanceDays ?? [])
        .map((k) => String(k ?? "").trim().toLowerCase())
        .filter(Boolean);
      if (own.length > 0 && !own.includes(dow)) continue;

      const daySlots = [
        ...new Set(
          (slotsByClass.get(e.classId) ?? [])
            .filter((s) => slotAppliesOn(s, date, dow))
            .map((s) => hhmm(s.startTime))
            .filter(Boolean),
        ),
      ].sort();
      if (daySlots.length === 0) continue;

      const base = { classId: e.classId, className: e.className, subject: e.subject, date };
      if (isPerSlotSubject(e.subject)) {
        for (const slot of daySlots) {
          const cell: IntakeCell = { ...base, periodStart: slot, saveSlot: slot, slotCount: 1 };
          if (seen.has(cellKey(cell))) continue;
          seen.add(cellKey(cell));
          out.push(cell);
        }
      } else {
        const cell: IntakeCell = {
          ...base,
          periodStart: daySlots[0]!,
          saveSlot: null,
          slotCount: daySlots.length,
        };
        if (seen.has(cellKey(cell))) continue;
        seen.add(cellKey(cell));
        out.push(cell);
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.periodStart.localeCompare(b.periodStart) ||
      a.className.localeCompare(b.className, "ko"),
  );
}

/**
 * 접수가 남기는 **메모 한 줄** — 사유 + 출처.
 *
 * 🔑 출처를 `recorded_via`(desk/teacher 컬럼)가 아니라 **메모에 적는** 이유: 그 컬럼은 저장만 되고
 *    읽는 화면이 한 곳도 없는데, `note`는 이미 다섯 표면이 읽고 있다(출석부 칸 툴팁·팝오버 / ECS 사유 /
 *    원스크린 / 당일 출결 큐 / 좌석표 hover). 한 줄에 실으면 **쿼리 한 줄 안 고치고** 담임이 보는
 *    모든 자리에 "이건 데스크가 학부모 연락 받고 처리한 것"이 함께 간다 — 이중 처리를 막는 게 목적이다.
 * ⚠️ 접미어를 붙였다 뗐다 하지 말 것 — 멱등 판정(`hasMemoLine`)이 **이 완성된 한 줄**을 기준으로 돈다.
 */
export const INTAKE_MEMO_SUFFIX = "(데스크 접수)";

export function intakeMemo(reason: string): string {
  const body = reason.trim().slice(0, INTAKE_MAX_REASON);
  if (!body) return "";
  // 이미 접미어가 달린 문장을 다시 접수하면 두 번 붙이지 않는다(데스크가 메모를 복사해 넣는 경우).
  return body.endsWith(INTAKE_MEMO_SUFFIX) ? body : `${body} ${INTAKE_MEMO_SUFFIX}`;
}

/**
 * 출결 상태 → 한글 라벨 — **접수 화면과 접수 액션이 같은 한 벌**을 쓴다.
 *
 * 🔑 맵을 두 벌로 만들지 말 것(팔레트 v4 작업의 교훈: 같은 뜻이 최대 6벌로 갈려 있었고, 사본은
 *    새 상태를 따라오지 않아 화면이 조용히 "—"를 뱉었다). 화면은 여기에 문장만 덧붙인다.
 * ⚠️ raw enum을 UI에 그대로 내보내지 않는다(전역 규칙) — 모르는 값도 한글 폴백으로 접는다.
 */
export const ATTENDANCE_STATUS_LABEL: Readonly<Record<string, string>> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  early_leave: "조퇴",
  makeup: "보강",
  excused: "공결",
};

export function attendanceStatusLabel(status: string | null | undefined): string {
  return ATTENDANCE_STATUS_LABEL[String(status ?? "")] ?? "기록 있음";
}

/**
 * 미리보기 칸에 적을 **담당 강사 표기** — 판정은 [`teacher-axis`](../teacher-axis.ts)가 하고
 * 여기서는 그 결과를 사람이 읽을 말로만 바꾼다(순수 · Vitest).
 *
 * 🔴 담임(`classes.teacher_id`)을 그대로 적으면 **교시마다 담당이 다른 반에서 거짓말이 된다**
 *    (원장 제보 2026-08-19: 수요일 16:20=이다교 / 17:20=김태건인데 접수 창이 둘 다 이다교로 표시).
 *    영어는 교시마다 사람이 다른 게 기본이라 이 경로가 정상 케이스다.
 * ⚠️ 자리(LAB·JJ)는 사람이 아니라 **방**이라 담임으로 떨어뜨리지 않는다 — 방 표기를 그대로 보인다.
 * ⚠️ 담당이 갈리면 지어내지 않는다("담당 여럿") — 한 명을 임의로 고르면 그 사람 이름으로 남의 수업이 보인다.
 */
export function intakeTeacherLabel(input: {
  source: "slot" | "homeroom" | "seat" | "ambiguous" | "none";
  teacherName: string | null;
  /** 자리 슬롯의 방 표기(LAB·JJ). 없으면 일반 문구로 접는다. */
  seatLabel?: string | null;
}): string | null {
  switch (input.source) {
    case "slot":
    case "homeroom":
      return input.teacherName?.trim() || null;
    case "seat":
      return input.seatLabel?.trim() || "자리 수업";
    case "ambiguous":
      return "담당 여럿";
    default:
      return null;
  }
}

/* ── 학생 검색 — "수업을 진짜로 듣고 있는" 학생만 (원장 2026-08-20) ─────────────────────────── */

/** 검색어 상한 — 출석부 허브 검색과 같은 길이(긴 붙여넣기로 조회 URL을 부풀리지 않는다). */
export const INTAKE_SEARCH_MAX_QUERY = 40;
/**
 * SQL에서 받아올 상한 — **수강 후필터에 쓸 여유분**이다.
 * 🔴 화면 상한(20)만큼만 받아 후필터하면, 이름으로 20명이 걸리고 그게 전부 걸러지는 순간 목록이
 *    통째로 빈다("검색이 고장났다"로 보인다). 넉넉히 받아 거른 뒤 20개로 자른다.
 */
export const INTAKE_SEARCH_SCAN = 60;
/** 화면에 내려보내는 상한. 넘으면 "더 있다"를 밝힌다(개수로 거짓말하지 않는다). */
export const INTAKE_SEARCH_LIMIT = 20;

/**
 * 대조에 쓰는 **정리된 검색어** — DB(`ilike`)와 화면 문구가 **같은 문자열**을 본다.
 *
 * 🔴 `%`·`_`·`\`는 와일드카드라 지운다(허브 검색과 같은 규약) — 친 글자가 조용히 "아무거나"가 되면
 *    엉뚱한 학생이 상한을 채우고 정작 찾는 아이가 밀린다.
 * ⚠️ 공백은 **지우지 않는다**(허브 검색과 다른 점) — 여기 대조 대상은 이름 컬럼 자체고, 이름에 공백이
 *    있는 학생(영문 이름)이 실제로 있어 공백을 지우면 그 학생이 영영 안 걸린다.
 */
export function intakeSearchTerm(query: string): string {
  return query.slice(0, INTAKE_SEARCH_MAX_QUERY).replace(/[%_\\]/g, "").trim();
}

/** 목록이 빈 이유. 문구는 아래 한 곳에서 만든다 — 화면이 지어내지 않는다. */
export type IntakeSearchEmptyReason = "not_teaching" | "withdrawn" | "no_match" | "unknown";

/** 이름 뒤 조사 '와/과' — 받침 유무로 고른다. 한글 음절이 아니면(영문 이름) '과'로 둔다. */
function waGwa(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return "과";
  return (code - 0xac00) % 28 === 0 ? "와" : "과";
}

/**
 * 0건일 때 화면에 그대로 띄울 한 줄 — **왜 비었는지**를 사람 말로 밝힌다.
 *
 * 🔴 빈 목록만 두면 데스크는 이름을 잘못 쳤는지, 그 학생이 조건에 안 맞는지 알 수 없다(원장 지시의
 *    핵심은 "예비가 뜨지 않게"이지 "말없이 사라지게"가 아니다).
 * 🔴 **권한 이야기는 하지 않는다** — 이 창을 연 사람은 이미 접수 권한이 있다.
 */
export function intakeSearchEmptyMessage(term: string, reason: IntakeSearchEmptyReason): string {
  const q = `‘${term}’${waGwa(term)}`;
  switch (reason) {
    case "not_teaching":
      return `${q} 맞는 학생은 있지만 지금 듣고 있는 수업이 없습니다 — 재원 중이고 수업이 있는 학생만 나옵니다.`;
    case "withdrawn":
      return `${q} 맞는 학생은 퇴원 처리돼 있습니다 — 재원 중이고 수업이 있는 학생만 나옵니다.`;
    case "no_match":
      return `${q} 맞는 학생이 없습니다 — 이름을 다시 확인해 주세요.`;
    default:
      // 확인 조회가 실패한 경우 — 없는 사실을 지어내지 않고, 확실히 참인 것만 말한다.
      return `지금 수업을 듣고 있는 학생 중에 ${q} 맞는 학생이 없습니다.`;
  }
}
