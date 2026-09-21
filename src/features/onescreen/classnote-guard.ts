import { kstMinutesOfDay, kstToday } from "@/lib/date-kst";

/**
 * ClassNote 발송 too_old 가드 — edutrix 2026-05~06 과거보고서 재발송 사고(1~4월 3,500건이 학부모에게 오발송)
 * 대응으로 도입. **KST 기준** 순수 문자열(YYYY-MM-DD) 비교라 Vercel UTC 월초/자정 경계 오류 없음.
 *
 * 🔴 2026-07-28 원장 결정: 허용 창 = "전 달 1일 이후" → **오늘 포함 최근 7일**로 조임(절대 규칙).
 *    "학부모가 일주일이 지났는데 이전 보고서를 받는 것도 비합리적" — 이날 이관분 대량 발송에서
 *    2주 전 보고서까지 나가는 사고 후 확정. 모든 소비처(큐잉·발송 콘솔·재발송·달력 sendable·
 *    미발송 재촉 이벤트)가 이 함수 하나를 지나므로 여기만이 규칙의 자리다. **완화 금지.**
 * 🔑 예외는 하나 — 원장이 **건마다** 지정한 보고서(2026-09-21, 0276a `classnote_deadline_exempt_at`)는 워커가 창 밖에서도
 *    집는다. 지정은 `scripts/_reports/resend-past-deadline.mts`만 하고 앱 화면·발송 콘솔은 이 함수 그대로다.
 */

const ALLOW_WINDOW_DAYS = 7; // 오늘 포함 7일(= 오늘-6일까지 허용). 7/28 기준 7/22~7/28 발송 가능.

/** 오늘(KST) 기준 발송 허용 최소 날짜(YYYY-MM-DD) = 오늘 포함 최근 7일 창의 시작일. */
export function classnoteMinDate(todayKst: string = kstToday()): string {
  const [y, m, d] = todayKst.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  t.setUTCDate(t.getUTCDate() - (ALLOW_WINDOW_DAYS - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** report_date(YYYY-MM-DD)가 발송 허용 범위인가 — 최근 7일 창(문자열 사전순 비교). */
export function isClassnoteAllowed(reportDate: string, todayKst: string = kstToday()): boolean {
  if (!reportDate) return false;
  return reportDate >= classnoteMinDate(todayKst);
}

/** 재발송 기한 판정 결과 — 화면 배지("오늘까지"·"D-2"·"기한 만료")와 재발송 대상 산정이 함께 쓴다. */
export type ClassnoteRetryDeadline = {
  /** 다시 보낼 수 있는 **마지막 날**(YYYY-MM-DD). 빈 report_date면 "". */
  lastDate: string;
  /** 오늘 포함 남은 날 수 — 0이면 오늘이 마지막 날, 음수면 이미 만료. */
  daysLeft: number;
  /** 이미 창 밖이라 어떤 경로로도 못 나간다(too_old). `isClassnoteAllowed`의 부정과 항상 같다. */
  expired: boolean;
};

/**
 * 이 보고서를 **언제까지** 다시 보낼 수 있나(순수).
 *
 * 발송 창이 "오늘 포함 7일"이라 report_date 기준 **6일 뒤가 마지막 날**이고 그 뒤엔 어떤 경로로도 못 나간다.
 * 🔴 이 값을 화면에 띄우는 이유: 실패한 보고서는 **사람이 원인을 고쳐야만** 풀리는데(보드 배정·구분 이름 지정)
 * 기한이 안 보이면 "나중에 고치지" 하는 사이 조용히 만료된다 — 2026-08-11 실측으로 실패 16건 중 **11건이
 * 이미 만료**(학부모에게 영영 못 나감)였다. 남은 날을 숫자로 보여 주는 것이 유일한 방어다.
 * ⚠️ 만료 판정은 반드시 `isClassnoteAllowed`에서 파생할 것 — 따로 계산하면 두 규칙이 조용히 어긋난다.
 */
export function classnoteRetryDeadline(
  reportDate: string,
  todayKst: string = kstToday(),
): ClassnoteRetryDeadline {
  if (!reportDate) return { lastDate: "", daysLeft: -1, expired: true };
  const [y, m, d] = reportDate.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  t.setUTCDate(t.getUTCDate() + (ALLOW_WINDOW_DAYS - 1));
  const lastDate = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  const daysLeft = Math.round((t.getTime() - Date.parse(`${todayKst}T00:00:00Z`)) / 86_400_000);
  return { lastDate, daysLeft, expired: !isClassnoteAllowed(reportDate, todayKst) };
}

/**
 * ClassNote로 발송 가능한 과목 키 화이트리스트 — 실보드 명명 관례가 `(수학)학생명`/`(영어)학생명` 둘뿐이라
 * 보드 라벨 매핑이 있는 과목만 발송할 수 있다(math·subject_1→수학 보드, english→영어 보드).
 * ⚠️ 이 목록에 없는 과목을 발송하면 워커 subjectLabel이 전부 "(수학)" 보드로 보내는 오게시가 났었음
 * (2026-07-10 병행 발송 적대 검증 P0-3). 새 과목을 발송 지원하려면 여기 + classnote-core.mjs subjectLabel
 * + ClassNote 실보드 관례를 함께 확장할 것.
 */
export const CLASSNOTE_SENDABLE_SUBJECTS = ["math", "subject_1", "english"] as const;

/**
 * 과목별 ClassNote 발송 허용 여부 — 학원설정 `report.classnoteSubjects`(발송 허용 과목 키 목록)에 든 과목만 발송.
 * **명시 opt-in**: 목록이 비면(기본) 어떤 과목도 발송 안 함(수학만 쓰는 현 운영 + 오발송 안전장치 겸용).
 * **발송 경로에서 subject null/빈값은 거부**(2026-07-10 P0-2) — 이관(edutrix_import)·레거시 행이 math opt-in에
 * 편승해 과목 게이트를 통과하는 것 차단. (조회용 null→math 정규화는 score-history 등 별도 코드 — 영향 없음.)
 * 화이트리스트 밖 과목도 거부(P0-3) — 보드 매핑이 없어 "(수학)" 보드 오게시로 직결되기 때문.
 * 순수 함수(Vitest). 큐 진입(saveAndQueueClassnote)·재발송(retryClassnote) 공용 게이트.
 */
/**
 * 발송 허용 시간창 대기 안내 — 지금 큐잉하면 창 밖이라 대기하는가? 창 밖이면 "HH:MM~HH:MM" 라벨,
 * 창 안·무제한이면 null. **워커(scripts/_classnote/send-window.mjs)의 앱측 미러**(같은 의미론:
 * 한쪽만/형식 오류/시작=종료 = 무제한 fail-open, 시작>종료 = 자정 넘김 창, 시작 포함·종료 제외).
 * 실제 지연은 워커 게이트가 담당하고 이 함수는 **강사 안내 문구만** 만든다 — 의미론이 어긋나도
 * 발송은 안 깨지고 안내만 틀린다(그래도 어긋나면 양쪽을 함께 고칠 것). 앱↔워커 미러는
 * isClassnoteAllowed↔minDate와 같은 기존 관례. 순수 함수(Vitest).
 */
export function classnoteSendWindowHint(
  startStr: string,
  endStr: string,
  minutes: number = kstMinutesOfDay(),
): string | null {
  const start = parseWindowHM(startStr);
  const end = parseWindowHM(endStr);
  if (start === null || end === null || start === end) return null; // 무제한 — 안내 불필요
  const inside = start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  return inside ? null : `${startStr.trim()}~${endStr.trim()}`;
}

function parseWindowHM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * 발송 시간창 상시 안내 라벨 — 시간창이 **활성**(둘 다 유효 HH:MM + 시작≠종료)이면 현재 시각과 무관하게
 * "HH:MM~HH:MM"을, 무제한(빈값/한쪽만/형식 오류/시작=종료)이면 null을 반환. 원스크린 상단의 강사 참고
 * 안내("원장이 발송 시간대를 정해뒀다")용 — 창 밖 여부를 따지는 classnoteSendWindowHint(발송 시점 대기
 * 안내)와 활성 판정 의미론을 공유한다(워커 send-window.mjs fail-open 규약과 동일). 순수 함수(Vitest).
 */
export function classnoteSendWindowLabel(startStr: string, endStr: string): string | null {
  const start = parseWindowHM(startStr);
  const end = parseWindowHM(endStr);
  if (start === null || end === null || start === end) return null;
  return `${startStr.trim()}~${endStr.trim()}`;
}

export function isClassnoteSubjectEnabled(
  subject: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!subject || !subject.trim()) return false; // 발송 경로에선 과목 불명 = 거부
  if (!(CLASSNOTE_SENDABLE_SUBJECTS as readonly string[]).includes(subject)) return false;
  return allowed.includes(subject);
}
