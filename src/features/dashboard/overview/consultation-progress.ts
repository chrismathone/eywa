/**
 * 콜&상담 진행 — 운영실 '상담 진행' 카드와 신규문의·전일 입테·입학 일정 줄의 단계 칩(원장 2026-09-22 *"콜&상담에 입력된
 * 상담을 이용해서 이 상담이 어디까지 진행되었나, 등록이 되었나 체크 가능하게"* → 새 카드 + 줄마다 단계 "둘 다").
 * 순수 함수 한 벌 — 카드 숫자·멈춘 상담·칩이 전부 여기서 나온다(한 곳이 따로 판정하면 같은 상담이 화면마다 다른 단계가 된다).
 *
 * 🔑 단계 판정은 **콜&상담 칸반과 같은 함수**(`stageOfCard`)를 지난다 — 칸반 '등록 완료' 칸의 카드가 여기서도 '등록'이다.
 *    배정 수도 칸반과 같은 재료(연결 원생의 미종료 수강 중 상담 과목 것)다. 다른 점은 하나: 칸반은 시작 전 수강도 '배정'으로만
 *    세지만 여기서는 시작일로 **반 배정 / 첫 수업**을 가른다(`started`).
 * 🔑 날짜 축 = `consulted_at`(KST 날짜) — 콜&상담 칸반·목록의 기간 필터가 쓰는 축이다. `created_at`은 행이 생긴 시각이라
 *    이관된 옛 상담이 이관한 날로 몰린다(신규문의 KPI만 `created_at` — '오늘 들어온 것'이 그 카드의 뜻이다).
 */
import { stageOfCard, type BoardStageColor, type BoardStageKey } from "@/features/enrollment/board-stages";
import { daysBetween, shiftDate } from "@/features/newcomers/onboarding-items";

/** 카드 단계별 인원을 세는 창 — 상담일 기준 최근 30일(오늘 포함). */
export const PROGRESS_WINDOW_DAYS = 30;
/** 멈춘 상담을 찾는 창 — 일정↔상담 연결 창(60일)과 같다. 30일로 자르면 오래 멈춘 상담일수록 목록에서 먼저 사라진다([[#105]]). */
export const STALL_WINDOW_DAYS = 60;
/** 상담 완료 뒤 이 날수를 **넘게** 결정(등록·미등록)이 없으면 멈춤. */
export const STALL_CONSULTED_DAYS = 7;
/** 입테 날짜가 지나고 이 날수를 **넘게** 등록이 없으면 멈춤. */
export const STALL_LEVEL_TEST_DAYS = 3;

export type ProgressConsultation = {
  id: string;
  name: string;
  /** outcome 원값(pending·scheduled·consulted·ai_done·enrolled·declined·no_show). */
  outcome: string;
  /** 상담 날짜 KST(`consulted_at`). */
  consultedOn: string;
  /** 상담 과목 키(없으면 null — 그때는 칸반처럼 전체 수강으로 판정). */
  subject: string | null;
  studentId: string | null;
};

/** 연결 원생의 **미종료** 수강(end_date 없음 또는 오늘 이후) — 칸반 배정 판정과 같은 재료. */
export type ProgressEnrollment = { studentId: string; subject: string | null; startDate: string | null };

/** 이 상담에 연결된 레벨테스트 일정 날짜(KST). null = 모름(캘린더를 못 읽음) — 없음(빈 배열)과 다르다. */
export type LevelTestDates = readonly string[] | null;

export type ConsultProgress = {
  id: string;
  name: string;
  /** 상담 과목(키 또는 옛 자유 텍스트) — 한 아이가 과목별로 상담을 둘 내면 멈춘 상담에 이름이 두 번 서서 과목으로 가른다. */
  subject: string | null;
  consultedOn: string;
  stage: BoardStageKey;
  /** 상담을 했다 — 상담 완료·등록 칸, 또는 상담 뒤 미등록(거절). 노쇼·상담 전은 아니다. */
  consulted: boolean;
  enrolled: boolean;
  /** 상담 과목의 미종료 수강이 있다(칸반 '반 배정 완료'와 같은 판정). */
  assigned: boolean;
  /** 그 수강 중 하나가 이미 시작했다(시작일 ≤ 오늘 · 시작일 모름은 시작한 것으로 — 모름을 '아직'으로 읽지 않는다). */
  started: boolean;
  /** 아직 시작 전이면 가장 이른 시작일. */
  firstClassOn: string | null;
  /** 레벨테스트 — 모르면 null. `last` = 오늘 포함 가장 최근 날짜 · `next` = 내일부터 가장 이른 날짜. */
  levelTest: { last: string | null; next: string | null } | null;
};

export function progressOf(
  c: ProgressConsultation,
  enrollments: readonly ProgressEnrollment[],
  levelTests: LevelTestDates,
  today: string,
): ConsultProgress {
  const mine = c.studentId
    ? enrollments.filter((e) => e.studentId === c.studentId && (!c.subject || e.subject === c.subject))
    : [];
  const stage = stageOfCard({ outcome: c.outcome, assignedClassCount: mine.length });
  const started = mine.some((e) => !e.startDate || e.startDate <= today);
  const future = mine.flatMap((e) => (e.startDate && e.startDate > today ? [e.startDate] : [])).sort();
  const dates = levelTests ? [...levelTests].sort() : null;
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    consultedOn: c.consultedOn,
    stage,
    consulted: stage === "consulted" || stage === "enrolled" || c.outcome === "declined",
    enrolled: stage === "enrolled",
    assigned: mine.length > 0,
    started,
    firstClassOn: started ? null : (future[0] ?? null),
    levelTest: dates
      ? {
          last: dates.filter((d) => d <= today).at(-1) ?? null,
          next: dates.find((d) => d > today) ?? null,
        }
      : null,
  };
}

/** `9/23` — 칩 안의 날짜(연도·요일 없이 짧게). */
function shortDate(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

export type ProgressChip = {
  /** 지금 단계 — 칸반 칸 이름과 같은 말(상담 전·상담 완료·미등록) + 등록 뒤 세 갈래(등록·반 배정·수업 시작). */
  label: string;
  /** 다음 일정·덧붙임(입테 9/23 · 첫 수업 10/1 · 반 배정 전). 없으면 null. */
  detail: string | null;
  /** 칸반 칸 색과 같은 색(같은 단계 = 같은 색). */
  color: BoardStageColor;
};

const STAGE_COLOR: Record<BoardStageKey, BoardStageColor> = {
  before: "amber",
  consulted: "blue",
  unregistered: "neutral",
  enrolled: "green",
};

export function chipOf(p: ConsultProgress, today: string): ProgressChip {
  const color = STAGE_COLOR[p.stage];
  if (p.stage === "enrolled") {
    if (p.started) return { label: "수업 시작", detail: null, color };
    if (p.assigned) return { label: "반 배정", detail: p.firstClassOn ? `첫 수업 ${shortDate(p.firstClassOn)}` : null, color };
    return { label: "등록", detail: "반 배정 전", color };
  }
  if (p.stage === "unregistered") return { label: "미등록", detail: null, color };
  const lt = p.levelTest;
  const detail = !lt
    ? null
    : lt.last === today
      ? "입테 오늘"
      : lt.next
        ? `입테 ${shortDate(lt.next)}`
        : lt.last
          ? "입테 끝"
          : null;
  return { label: p.stage === "before" ? "상담 전" : "상담 완료", detail, color };
}

export type StalledConsult = {
  id: string;
  name: string;
  subject: string | null;
  reason: "levelTest" | "consulted";
  /** 기준일(입테 날짜 또는 상담일)부터 오늘까지 날수. */
  days: number;
  /** 화면 문장 — "입테 끝 5일째 · 등록 없음" / "상담 완료 9일째 · 결정 없음". */
  label: string;
};

/**
 * 멈춘 상담 — 결정(등록·미등록)이 나지 않은 채 기다리는 건.
 *   ① 입테가 지나고 3일을 넘겼는데 등록이 없다(다음 입테가 잡혀 있으면 아니다).
 *   ② 입테 기록이 없는 상담 완료 건이 상담일부터 7일을 넘겼다(입테가 잡혀 있으면 기다리는 중이라 아니다).
 * 등록·배정·미등록(거절·노쇼)은 이미 결정이 났으므로 빠진다. 입테를 모르면(캘린더 권한 없음) ①은 판정하지 않는다.
 */
export function stallOf(p: ConsultProgress, today: string): StalledConsult | null {
  if (p.stage === "enrolled" || p.stage === "unregistered" || p.assigned) return null;
  const lt = p.levelTest;
  if (lt?.next) return null;
  if (lt?.last) {
    const days = daysBetween(lt.last, today);
    return days > STALL_LEVEL_TEST_DAYS
      ? { id: p.id, name: p.name, subject: p.subject, reason: "levelTest", days, label: `입테 끝 ${days}일째 · 등록 없음` }
      : null;
  }
  if (p.stage !== "consulted") return null;
  const days = daysBetween(p.consultedOn, today);
  return days > STALL_CONSULTED_DAYS
    ? { id: p.id, name: p.name, subject: p.subject, reason: "consulted", days, label: `상담 완료 ${days}일째 · 결정 없음` }
    : null;
}

export type ProgressCounts = {
  /** 창 안 상담 건수(상담일 기준). */
  received: number;
  consulted: number;
  /** 입테를 치른(오늘 포함) 상담 — 입테를 모르면 null(0으로 적지 않는다). */
  levelTest: number | null;
  enrolled: number;
  assigned: number;
  started: number;
};

export type ProgressSummary = {
  /** 단계별 인원을 센 창의 첫날(KST). */
  from: string;
  counts: ProgressCounts;
  /** 오래 멈춘 순. */
  stalled: StalledConsult[];
};

/**
 * @param list 멈춤 창(60일) 안의 상담 전부 — 단계별 인원은 그중 최근 30일만 센다.
 * ⚠️ 단계는 **각자 닿은 수**다. 입테는 건너뛰고 등록하는 아이가 있어 '입테 < 등록'일 수 있다(나머지는 앞 단계가 뒤를 품는다:
 *    상담 ⊇ 등록 ⊇ 반 배정 ⊇ 수업 시작).
 */
export function summarizeProgress(list: readonly ConsultProgress[], today: string, levelTestKnown: boolean): ProgressSummary {
  const from = shiftDate(today, -(PROGRESS_WINDOW_DAYS - 1));
  const windowed = list.filter((p) => p.consultedOn >= from);
  const count = (pred: (p: ConsultProgress) => boolean) => windowed.filter(pred).length;
  return {
    from,
    counts: {
      received: windowed.length,
      consulted: count((p) => p.consulted),
      levelTest: levelTestKnown ? count((p) => !!p.levelTest?.last) : null,
      enrolled: count((p) => p.enrolled),
      assigned: count((p) => p.assigned),
      started: count((p) => p.started && p.assigned),
    },
    stalled: list
      .flatMap((p) => {
        const s = stallOf(p, today);
        return s ? [s] : [];
      })
      .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "ko")),
  };
}

/** 운영실 스냅샷에 실리는 모양 — 클라이언트(카드·칩)가 읽는다. 판정 결과만 싣고 outcome 원값·보호자 번호는 안 싣는다. */
export type ConsultProgressData = {
  summary: ProgressSummary;
  /** 상담 id → 지금 단계 칩(60일 창 안 상담 전부). 신규문의·전일 입테·입학 일정 줄이 상담 id로 찾아 쓴다. */
  chips: Record<string, ProgressChip>;
};
