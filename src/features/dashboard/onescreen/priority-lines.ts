/**
 * **우선 확인 세 줄** — 이미 만들어진 결정론 배열에서 **분야별 대표를 고르기만** 한다(순수·Vitest).
 *
 * 🔴 **순위 엔진이 아니다.** 점수를 매기지 않고, 새 신호를 만들지 않고, LLM을 부르지 않는다. 하는 일은
 *    **고정 버킷 순서**로 훑으며 각 재료 배열의 **앞에서부터** 집는 것뿐이다 — 순위 규칙이 두 벌이 되면
 *    곧 다른 목록이 되기 때문이다(외부 PRD의 `AI PRIORITY`를 그대로 옮기지 않은 이유).
 * 🔴 **3은 상한이고 0줄이 정상**이다 — 빈 자리를 덜 급한 것으로 채우지 않는다.
 * 🔴 **한 학생은 한 줄만** — 같은 사람이 세 줄을 다 차지하면 "분야별 대표"가 아니게 된다.
 * 🔴 **재료를 못 받은 것과 0건은 다르다** — 못 받았으면 `null`로 넘어오고, 호출부가 그 사실을 적는다
 *    (여기서 빈 배열로 삼키면 "지금 확인할 것 없음"이라는 거짓 안심이 된다).
 *
 * 버킷 순서(코드에 못박고 테스트로 잠근다):
 *  1. 오늘 첫 수업인데 사전콜·안내·OJT가 안 됐다 — 오늘이 지나면 되돌릴 수 없다.
 *  2. 신규생 **무통보** 결석 — 사전 통보로 설명되는 결석은 브리핑 스포트라이트가 이미 뺐다.
 *  3. 첫 수업 후 콜 지연.
 *  4. 퇴원위험 — 사유·권장 조치는 retention이 만든 문장 **그대로**.
 *  5. 1개월 콜 지연.
 *  6. 미작성 보고서 — 영어 제외 규칙은 '오늘 할 일'이 이미 적용한 것을 그대로 받는다.
 */

import {
  careCellByKey,
  careCellDaysLeft,
  careCellMatches,
  type CareRow,
} from "@/features/newcomers/care-cells";
import { NEWCOMER_BASELINE_DATE, statusOf } from "@/features/newcomers/onboarding-items";

export const PRIORITY_BUCKETS = [
  "first-class-today",
  "newcomer-absence",
  "after-first-call",
  "churn",
  "month1-call",
  "unwritten-reports",
] as const;
export type PriorityBucket = (typeof PRIORITY_BUCKETS)[number];

export type PriorityLine = {
  key: string;
  bucket: PriorityBucket;
  /** 굵게 적는 주어 — 학생 이름 또는 신호 이름. */
  title: string;
  /** 왜 지금인가 — 결정론 문장 그대로. */
  detail: string;
  /** 마우스 오버로 남기는 덧말(권장 조치 등). 없으면 null. */
  hint: string | null;
  tone: "critical" | "caution";
  href: string;
};

/** 신규생 한 명 — 조회(`NewcomerRow`)가 그대로 들어맞는다. */
export type PriorityNewcomer = CareRow & { studentId: string; name: string };

/** 브리핑 payload의 스포트라이트 한 줄(결정론 — cron이 만든 값). */
export type PrioritySpotlight = {
  studentId: string | null;
  name: string;
  reasons: string[];
  action: string | null;
};

/** '오늘 할 일'에서 필요한 것만(이미 권한을 통과한 배열이다). */
export type PriorityTodo = {
  key: string;
  label: string;
  count: number | null;
  unit: string | null;
  note: string | null;
  href: string;
};

export type PriorityInput = {
  today: string;
  /** 90일 창 안 신규생. 🔴 `null` = 못 받았다(0명이 아니다). */
  newcomers: readonly PriorityNewcomer[] | null;
  /** 브리핑 스포트라이트. 🔴 `null` = 못 받았다(브리핑 미열람·미생성 포함). */
  spotlights: readonly PrioritySpotlight[] | null;
  /** 권한을 통과한 '오늘 할 일' 항목. */
  todos: readonly PriorityTodo[];
  baseline?: string;
};

/**
 * 🔑 **스포트라이트의 출처를 가르는 유일한 표식은 `action`이다.**
 * 브리핑이 만들 때 retention 상위는 `primaryAction`(항상 문자열)을 달고, 결석에서 온 줄은 `action: null`로
 * 넣는다(briefing-digest `buildSpotlights`). 옛 payload에도 같은 규칙이라 안전하다.
 * ⚠️ 그쪽 규칙이 바뀌면 이 판정도 함께 바꿀 것 — 가드가 두 파일을 함께 잠근다.
 */
function isChurnSpotlight(s: PrioritySpotlight): boolean {
  return s.action !== null && s.action !== "";
}

/** 오늘 첫 수업 학생이 아직 못 받은 준비 절차(사전콜·안내·OJT) — 라벨은 케어 칸 단일 소스에서. */
const FIRST_CLASS_PREP = ["pre_call", "first_class_guide", "ojt"] as const;

function overdueLine(days: number): string {
  return days < 0 ? `${-days}일 지남` : days === 0 ? "오늘" : `D-${days}`;
}

export function buildPriorityLines(input: PriorityInput): PriorityLine[] {
  const { today, todos } = input;
  const baseline = input.baseline ?? NEWCOMER_BASELINE_DATE;
  const newcomers = input.newcomers ?? [];
  const spotlights = input.spotlights ?? [];
  const newcomerIds = new Set(newcomers.map((n) => n.studentId));

  const out: PriorityLine[] = [];
  const usedStudents = new Set<string>();
  const push = (line: PriorityLine, studentId: string | null) => {
    if (studentId) {
      if (usedStudents.has(studentId)) return;
      usedStudents.add(studentId);
    }
    out.push(line);
  };

  // ── 1. 오늘 첫 수업인데 준비가 안 됐다 ────────────────────────────────────────
  // 🔴 '오늘'은 호출부가 KST로 넘긴다(`kstToday`) — 여기서 Date를 만들지 않는다.
  const firstClassToday = newcomers
    .filter((n) => n.firstClassOn === today)
    .map((n) => {
      const missing = FIRST_CLASS_PREP.map((key) => careCellByKey(key))
        .filter((cell) => cell !== null)
        // 🔴 미완 판정도 케어 칸과 같은 함수다 — `waived`(기능 시작 전 기한)는 여기서도 안 센다.
        .filter((cell) => careCellMatches(cell, n, today, baseline));
      return { n, missing };
    })
    .filter((x) => x.missing.length > 0)
    .sort((a, b) => a.n.name.localeCompare(b.n.name, "ko"));
  for (const { n, missing } of firstClassToday) {
    push(
      {
        key: `first-class-today:${n.studentId}`,
        bucket: "first-class-today",
        title: n.name,
        detail: `오늘 첫 수업 · ${missing.map((c) => c.label).join("·")} 미완`,
        hint: null,
        tone: "critical",
        href: `/students/${n.studentId}`,
      },
      n.studentId,
    );
  }

  // ── 2. 신규생 무통보 결석 ───────────────────────────────────────────────────
  // 🔴 사전 통보로 전부 설명되는 결석은 스포트라이트가 이미 뺐다(briefing-digest `unexplainedAbsences`).
  //    여기서 다시 거르지 않는다 — 같은 판정을 두 곳에서 하면 언젠가 갈린다.
  for (const s of spotlights) {
    if (isChurnSpotlight(s)) continue;
    if (!s.studentId || !newcomerIds.has(s.studentId)) continue;
    push(
      {
        key: `newcomer-absence:${s.studentId}`,
        bucket: "newcomer-absence",
        title: s.name,
        detail: s.reasons[0] ?? "결석 위험",
        hint: null,
        tone: "critical",
        href: `/students/${s.studentId}`,
      },
      s.studentId,
    );
  }

  // ── 3·5. 콜 지연 ───────────────────────────────────────────────────────────
  const callBucket = (itemKey: string, bucket: PriorityBucket, label: string) => {
    const cell = careCellByKey(itemKey);
    if (!cell || cell.kind !== "item") return;
    newcomers
      .filter(
        (n) =>
          statusOf(
            cell.item,
            { enrolledOn: n.enrolledOn, firstClassOn: n.firstClassOn },
            n.checks[itemKey],
            today,
            baseline,
          ) === "overdue",
      )
      .map((n) => ({ n, days: careCellDaysLeft(cell, n, today) ?? 0 }))
      .sort((a, b) => a.days - b.days || a.n.name.localeCompare(b.n.name, "ko"))
      .forEach(({ n, days }) =>
        push(
          {
            key: `${bucket}:${n.studentId}`,
            bucket,
            title: n.name,
            detail: `${label} · ${overdueLine(days)}`,
            hint: null,
            tone: "critical",
            href: `/students/${n.studentId}`,
          },
          n.studentId,
        ),
      );
  };
  callBucket("after_first_call", "after-first-call", "첫 수업 후 콜");

  // ── 4. 퇴원위험 ────────────────────────────────────────────────────────────
  for (const s of spotlights) {
    if (!isChurnSpotlight(s)) continue;
    push(
      {
        key: `churn:${s.studentId ?? s.name}`,
        bucket: "churn",
        title: s.name,
        // 🔴 사유·권장 조치는 retention이 만든 문장 그대로 — 여기서 다시 쓰지 않는다.
        detail: s.reasons.slice(0, 2).join(" · ") || "퇴원위험",
        hint: s.action,
        tone: "critical",
        href: s.studentId ? `/students/${s.studentId}` : "/retention",
      },
      s.studentId,
    );
  }

  callBucket("month1_call", "month1-call", "1개월 콜");

  // ── 6. 미작성 보고서 ────────────────────────────────────────────────────────
  // 🔴 영어 제외는 '오늘 할 일'이 이미 적용한 것을 **그대로 받는다**(report-subjects 단일 소스).
  const unwritten = todos.find((t) => t.key === "unwritten-reports");
  if (unwritten && (unwritten.count ?? 0) > 0) {
    push(
      {
        key: "unwritten-reports",
        bucket: "unwritten-reports",
        title: unwritten.label,
        detail: `${unwritten.count}${unwritten.unit ?? ""}`,
        hint: unwritten.note,
        tone: "caution",
        href: unwritten.href,
      },
      null,
    );
  }

  return out;
}

/** 세 줄에 못 담은 나머지 — 잘렸다는 사실을 숨기지 않는다([[#89]]). */
export function priorityOverflow(lines: readonly PriorityLine[], limit = 3): number {
  return Math.max(0, lines.length - limit);
}
