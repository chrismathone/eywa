/**
 * 등록상담 **사전 브리프(상담지)** — 순수 로직: 타입·반 매칭·프롬프트·검증·폴백.
 *
 * 목적: 상담사가 상담을 **시작하기 전에** 학부모 QR 접수 내용 + 학원 실데이터(개설 반·자리·시간·
 * 수강료·같은 학교 재원생·형제·교재·정책)를 한 장으로 받아본다. 상담 후 산출물인 'AI 심층분석
 * (인수인계서)'과는 방향이 반대 — 이건 **상담 전** 준비물이다.
 *
 * ⚠️ 설계 원칙(브리핑 팀보고 `briefing-team-report.ts`와 동일): **사실은 코드가, 말은 LLM이.**
 * 반 이름·강사·정원/현원·금액·인원은 전부 `PrepFacts`(DB 결정론 스냅샷)가 진실이고, LLM은 그
 * 사실만 인용해 문장을 만든다. 검증(`validatePrepBrief`)이 사실에 없는 숫자·영문 토큰을 걸러
 * 탈락하면 결정론 폴백(`buildPrepBriefFacts` 기반)으로 대체한다 —
 * 학부모 앞에서 읽는 문서라 **환각 한 줄이 곧 지킬 수 없는 약속**이 되기 때문.
 *
 * server 전용 import 금지(#61·#81) — facts 수집은 `server/prep-facts.ts`가 담당한다.
 */

import {
  ADVANCED_REASON_OPTIONS,
  CHANGE_OPTIONS,
  ENGLISH_STATE_OPTIONS,
  GOAL_OPTIONS,
  HABIT_ITEMS,
  LEVEL_BASIS_OPTIONS,
  MATH_STATE_OPTIONS,
  PRIOR_REASON_OPTIONS,
  PRIOR_STATUS_OPTIONS,
  WANT_OPTIONS,
  WORRY_OPTIONS,
  labelOf,
  type ChoiceOption,
  type IntakeChecklist,
} from "./intake-checklist";
// 시간 계산은 시간표 순수 모듈 재사용(server-only 없음) — 같은 셈을 두 번 구현하면 두 값이 갈린다.
import { occupiedMinutes } from "@/features/timetable/lib/room-grid";
import { timeToMin } from "@/features/timetable/lib/ten-minute-grid";

// ── 사실(Facts) 스냅샷 ────────────────────────────────────────────────────────

/** 개설 반 후보 1건 — 정원/현원은 "자리 있나"를 상담 자리에서 즉답하기 위한 값. */
export type PrepClassFact = {
  id: string;
  className: string;
  /** 한글 과목 라벨(설정 단일 소스에서 변환된 값 — raw key 금지). */
  subjectLabel: string;
  teacherName: string | null;
  /** "월·수·금 16:30" 형태. 스케줄이 없으면 null. */
  scheduleLabel: string | null;
  /** 강의실 정원(classrooms.capacity). 미지정이면 null → '정원 미지정'. */
  seats: number | null;
  enrolled: number;
  notes: string | null;
  /** 학년 토큰까지 맞은 반인지(=1순위 후보). 과목만 맞으면 false. */
  gradeMatched: boolean;
};

export type PrepTuitionFact = {
  category: string;
  name: string;
  price: number;
  /**
   * "회당 단가"/"월 단가"/null(미지정) — pricingModeLabel 변환값. ⚠️ 반드시 금액 옆에 표기한다:
   * 회당 24,000원을 월 수강료로 잘못 안내하면 상담 자리에서 바로 사고다(0102a 곱셈 사고 방지와 동일 원칙).
   */
  modeLabel: string | null;
  note: string | null;
};
export type PrepTextbookFact = { title: string; subjectLabel: string; gradeLevel: string | null };
export type PrepSiblingFact = {
  name: string;
  school: string | null;
  grade: string | null;
  /** 현재 수강 중인 반 이름 — 상담에서 "형 OO는 지금 이 반에 있습니다"로 바로 쓰는 카드. */
  classNames: string[];
};
export type PrepPriorConsultFact = { date: string | null; outcomeLabel: string; subjectLabel: string | null };

export type PrepFacts = {
  student: {
    name: string;
    grade: string | null;
    school: string | null;
    subjectLabel: string | null;
    genderLabel: string | null;
    careerGoal: string | null;
    /** 학부모가 접수 폼에 쓴 요청사항(자유입력). */
    request: string | null;
    shuttleRequest: boolean;
    siblingsText: string | null;
    safetyNotes: string | null;
    consultationPath: string | null;
    /**
     * 이미 우리 학원에 재원 중인 학생인지 + 현재 수강 반. QR 접수는 **기존 재원생이 다른 과목을 물으러
     * 낼 때도** 들어온다(확정 정책: student_id 연결만 하고 pending 큐 노출). 이걸 모르고 신규처럼
     * 반·수강료를 깔면 상담 자리에서 바로 사고다 → 사실로 명시한다.
     */
    enrolledNow: { classNames: string[] } | null;
  };
  parent: { name: string | null; relation: string | null };
  /** 사전 체크리스트 — 라벨로 변환된 (문항, 답) 쌍. 접수 폼 2단계 미작성이면 빈 배열. */
  checklist: { question: string; answer: string }[];
  /** 학습 행동 1~5점. 낮을수록 도움 필요 → 상담 스크립트의 근거. */
  habits: { label: string; score: number }[];
  /** 이 학생 이름으로 앞서 들어온 다른 등록상담(반복 QR 접수). */
  priorConsults: PrepPriorConsultFact[];
  /** 학부모 연락처가 같은 재원생 = 형제자매 후보(있으면 강력한 상담 카드). */
  siblings: PrepSiblingFact[];
  classes: PrepClassFact[];
  tuition: PrepTuitionFact[];
  textbooks: PrepTextbookFact[];
  peers: {
    /** 같은 학교 재원생 수(이름 없이 집계만 — 개인 식별 정보는 브리프에 싣지 않는다). */
    sameSchool: number;
    /** 같은 학년 재원생 수. */
    sameGrade: number;
    /** 학원 전체 재원생 수. */
    total: number;
  };
  policy: {
    academyName: string;
    dueDay: number | null;
    latePolicy: string | null;
    shuttleEnabled: boolean;
    shuttleFee: string | null;
    shuttleRoutes: string[];
  };
};

// ── 브리프(LLM 산출) ─────────────────────────────────────────────────────────

export type PrepBrief = {
  /** 이 상담을 한 줄로 규정(상담사가 제일 먼저 읽는 줄). */
  headline: string;
  /** 오프닝 멘트 — 접수 내용을 읽었다는 신호를 주는 2~3문장. */
  opening: string;
  /** 접수서로는 알 수 없어 반드시 물어야 할 확인 질문. */
  questions: string[];
  /** 학부모 걱정 → 접수 근거 → 대응 화법. */
  playbook: { concern: string; evidence: string; response: string }[];
  /** 반·시간·시작 시점 제안(사실의 반만 인용). */
  proposal: string;
  /** 예상 반론과 답변. */
  objections: { objection: string; answer: string }[];
  /** 클로징 + 다음 단계. */
  closing: string;
  /** 이 학부모에게 하면 안 되는 말(지뢰). */
  cautions: string[];
};

/** 저장 형태 — 화면·인쇄가 소비. `source`로 AI/폴백을 구분해 화면에 정직하게 표시한다. */
export type PrepBriefRecord = {
  version: 1;
  source: "ai" | "fallback";
  /** 폴백일 때 왜 떨어졌는지(화면 툴팁·로그용, raw 원문 금지). */
  fallbackReason?: string;
  model: string | null;
  generatedAt: string;
  facts: PrepFacts;
  brief: PrepBrief;
};

// ── 사전 체크리스트 → 라벨 쌍 ────────────────────────────────────────────────

function joinLabels(options: ChoiceOption[], values: string[], etc: string | null): string | null {
  const parts = values.map((v) => labelOf(options, v));
  if (etc) parts.push(etc);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * 저장된 slug 체크리스트를 (문항, 답) 라벨 쌍으로. 화면 `ChecklistView`와 **같은 순서·같은 문구**를
 * 쓴다 — 상담사가 화면에서 본 것과 브리프가 다른 말을 하면 신뢰가 깨진다.
 */
export function checklistToPairs(c: IntakeChecklist): { question: string; answer: string }[] {
  const rows: [string, string | null][] = [
    ["가장 알고 싶은 문제", joinLabels(GOAL_OPTIONS, c.goals, c.goalsEtc)],
    ["가장 걱정되는 것", joinLabels(WORRY_OPTIONS, c.worries, c.worriesEtc)],
    ["유지 시 걱정되는 결과", c.worryOutcome],
    ["수준 판단 근거", joinLabels(LEVEL_BASIS_OPTIONS, c.levelBasis, c.levelBasisEtc)],
    ["수학 현재 상태", c.math ? joinLabels(MATH_STATE_OPTIONS, c.math.states, null) : null],
    ["수학 교재·과정", c.math?.course ?? null],
    ["영어 현재 상태", c.english ? joinLabels(ENGLISH_STATE_OPTIONS, c.english.states, null) : null],
    ["영어 교재·과정", c.english?.course ?? null],
    ["선행학습 여부", c.priorStatus ? labelOf(PRIOR_STATUS_OPTIONS, c.priorStatus) : null],
    ["선행 이유", c.priorReason ? labelOf(PRIOR_REASON_OPTIONS, c.priorReason) : null],
    ["선행 안 하는 이유", c.priorNoneReason],
    ["심화학습 여부", c.advancedStatus ? labelOf(PRIOR_STATUS_OPTIONS, c.advancedStatus) : null],
    ["심화 이유", c.advancedReason ? labelOf(ADVANCED_REASON_OPTIONS, c.advancedReason) : null],
    ["심화 안 하는 이유", c.advancedNoneReason],
    ["6개월 내 원하는 변화", joinLabels(CHANGE_OPTIONS, c.changes, c.changesEtc)],
    ["학원에 바라는 것", joinLabels(WANT_OPTIONS, c.wants, c.wantsEtc)],
    ["학생의 강점·성공 경험", c.strengths],
    ["추가 전달 사항", c.extra],
  ];
  return rows.filter(([, v]) => !!v).map(([q, v]) => ({ question: q, answer: v as string }));
}

/** 학습 행동 점수 → 라벨+점수(응답한 항목만). */
export function checklistHabits(c: IntakeChecklist): { label: string; score: number }[] {
  return HABIT_ITEMS.filter((h) => typeof c.habits?.[h.value] === "number").map((h) => ({
    label: h.label,
    score: c.habits[h.value] as number,
  }));
}

// ── 반 매칭 ──────────────────────────────────────────────────────────────────

/**
 * 학년 문자열에서 매칭 토큰 추출 — "중학교 1학년"·"중1" 모두 "중1"로.
 * 반 이름은 "중1 수학 A"처럼 축약 표기라 학제+숫자 조합이 유일하게 통하는 키다.
 */
export function gradeToken(grade: string | null | undefined): string | null {
  const g = (grade ?? "").trim();
  if (!g) return null;
  const level = g.includes("초") ? "초" : g.includes("중") ? "중" : g.includes("고") ? "고" : null;
  const num = g.match(/\d/)?.[0] ?? null;
  if (level && num) return `${level}${num}`;
  return level ?? null;
}

/**
 * 반 이름이 학생과 **다른 학제·다른 학년**을 명시하는지 — "[특강] 고등개별"·"[특강]중2-2 문제 풀이반"은
 * 중1 후보에서 배제해야 한다(적대 검수 2026-07-28: 과목만 일치한 타학제·타학년 반이 상담지에 딸려 나옴).
 * ⚠️ 배제는 "다른 학제/학년이 명시된 반"만 — 표기가 아예 없는 반("EIE M3")·학제만 같은 반("중등M")은
 * 후보로 남긴다(없는 정보로 빼면 과소포함 = 제안 가능한 반을 상담사가 못 본다).
 */
export function conflictsSchoolLevel(className: string, studentToken: string | null): boolean {
  if (!studentToken) return false;
  const studentLevel = studentToken.charAt(0);
  const LEVELS: { level: string; patterns: RegExp }[] = [
    { level: "초", patterns: /초등|초[1-6]/ },
    { level: "중", patterns: /중등|중[1-3]/ },
    { level: "고", patterns: /고등|고[1-3]/ },
  ];
  // ⚠️ 이 학원 반 이름은 **부서 접두사 + 실제 학년**이다("중등M 초6 JJ2A" = 중등부가 운영하는 초6 반,
  //    "고등E_중3 최상위"). 접두사만 보고 배제하면 정작 그 학년 학생이 자기 반을 못 본다(실측 21/106반,
  //    초등 영어는 브릿지·초5/초6 반이 전멸했음). → 반 이름에 **학생 자신의 학제 표기가 있으면**
  //    부서 접두사로 인한 학제 배제를 건너뛴다(학년 숫자 충돌 검사는 아래에서 계속 적용).
  const selfPattern = LEVELS.find((l) => l.level === studentLevel)?.patterns;
  const selfDeclared = !!selfPattern && selfPattern.test(className);
  if (!selfDeclared) {
    for (const { level, patterns } of LEVELS) {
      if (level !== studentLevel && patterns.test(className)) return true;
    }
  }
  // 같은 학제라도 **다른 학년 숫자**가 명시돼 있으면 배제("중2-2 문제 풀이반"은 중1 후보 아님).
  // 학생 학년 숫자를 모르면(토큰이 "중"뿐) 학년 비교는 생략(없는 정보로 배제 금지).
  if (studentToken.length > 1) {
    const others = className.match(new RegExp(`${studentLevel}[1-6]`, "g")) ?? [];
    if (others.some((t) => t !== studentToken)) return true;
  }
  return false;
}

/** 평일 요일 — 반교시 판정은 평일 교시 그룹에만 있는 개념이라 주말은 안 본다. */
const WEEKDAYS_SET = new Set(["mon", "tue", "wed", "thu", "fri"]);

/**
 * **반교시 반** = 평일에 *교시 하나(그룹)를 통째로 채우는 날이 하루도 없는* 반.
 *
 * 원장 2026-08-04: *"반교시건은 추천하지마, 완교시만 추천"* · *"반교시들은 대부분 완교시+반교시
 * (담당+부담당) 수업이므로 완전한 3시간짜리 수업임. 학생리스트가 완전히 일치하고 이어서 진행하는
 * 수업임(일부 일치하지 않을수도 있으나 대부분 일치)"*.
 *
 * 🔑 그래서 반교시를 빼도 **그 시간대가 상담지에서 사라지지 않는다** — 짝인 완교시 반이 같은 학생·같은
 * 흐름을 대표한다. 실측(2026-08-04, 활성 수학 반): 반교시는 4반뿐이고 3반이 짝을 갖는다.
 * `초등M 초5 JJ1A`(월·목 16:20~17:15) ↔ `초등M 초5 MS1A`(월·목 14:30~16:20) 재원 6/6 완전 일치,
 * `중등M 초6 JJ2A`(15:25~16:20) ↔ `중등M 초6 MS2A`(16:20~18:10) 9/9, `중등M 중2 JJPS` ↔ `PS2S` 5/5.
 * 나머지 1반은 재원 0명이라 어차피 제안 대상이 아니다.
 *
 * ⚠️ **반 이름으로 판정하지 않는다**(JJ·PS 같은 접미사로 가르면 이름을 고치는 날 분류가 조용히
 *    뒤집힌다 — english_track과 같은 교훈). 근거는 오직 **시간 길이**다.
 * ⚠️ `fullPeriodMin`이 null인 과목(영어처럼 그룹이 없는 과목)은 **항상 false** — 반교시라는 개념이 없다.
 * ⚠️ 평일 슬롯이 하나도 없으면(주말 전용 반·시각 미상) 판단하지 않는다(false) — 모르면 빼지 않는다.
 */
export function isHalfPeriodClass(
  slots: readonly { day: string; start: string | null; end: string | null }[],
  fullPeriodMin: number | null,
): boolean {
  if (fullPeriodMin == null || fullPeriodMin <= 0) return false;
  const byDay = new Map<string, { startMin: number; endMin: number }[]>();
  for (const s of slots) {
    if (!WEEKDAYS_SET.has(s.day)) continue;
    const a = timeToMin(s.start ?? "");
    const b = timeToMin(s.end ?? "");
    if (a == null || b == null || b <= a) continue;
    (byDay.get(s.day) ?? byDay.set(s.day, []).get(s.day)!).push({ startMin: a, endMin: b });
  }
  if (byDay.size === 0) return false;
  let longestDay = 0;
  // 같은 날 여러 슬롯은 **합집합**으로 센다(붙어 있는 세부교시 2개 = 한 교시). occupiedMinutes 재사용.
  for (const list of byDay.values()) longestDay = Math.max(longestDay, occupiedMinutes(list));
  return longestDay > 0 && longestDay < fullPeriodMin;
}

/**
 * 상담 학생에게 제안할 반 후보 정렬 — ① 과목+학년 일치 ② 과목만 일치 순, 각 그룹 안에서는
 * **자리 있는 반 먼저**(상담 자리에서 바로 제안 가능한 순서). 과목 미상이면 학년만으로 좁힌다.
 *
 * ⚠️ 기존 `runAiAnalysis`의 매칭(반 이름에 학년 접두사 포함 여부)보다 과목 조건을 먼저 본다 —
 * 이름만 보면 "중1 영어"가 수학 상담에도 딸려 나온다.
 * ⚠️ **반교시 반은 후보에서 아예 뺀다**(원장 2026-08-04, [isHalfPeriodClass] 주석 참조) — 짝인 완교시
 *    반이 같은 학생·같은 흐름을 대표하므로 시간대가 사라지지 않는다.
 */
export function rankPrepClasses(
  all: (Omit<PrepClassFact, "gradeMatched"> & { halfPeriod?: boolean })[],
  opts: { subjectKeyLabel: string | null; grade: string | null },
  limit = 6,
): PrepClassFact[] {
  const token = gradeToken(opts.grade);
  const subject = opts.subjectKeyLabel;
  const scored = all.filter((c) => !c.halfPeriod).map((c) => {
    // 다른 학제·학년이 이름에 명시된 반은 무조건 배제(중1 상담지에 "고등"·"중2" 반 금지).
    if (conflictsSchoolLevel(c.className, token)) return { ...c, gradeMatched: false, tier: 0 };
    const gradeMatched = !!token && c.className.includes(token);
    const subjectMatched = !!subject && c.subjectLabel === subject;
    // 3=과목+학년, 2=과목만, 1=학년만(과목 미상일 때만), 0=무관
    // ⚠️ 상담 과목이 정해져 있으면 **다른 과목 반은 후보에서 아예 뺀다** — 수학 상담지에 영어 반이
    //    섞이면 상담사가 과목을 잘못 제안한다(교차과목 오매몰 금지, QR 자동연결과 같은 원칙).
    const tier = subject
      ? subjectMatched
        ? gradeMatched
          ? 3
          : 2
        : 0
      : gradeMatched
        ? 1
        : 0;
    return { ...c, gradeMatched, tier };
  });
  const anyCriteria = !!token || !!subject;
  const pool = anyCriteria ? scored.filter((c) => c.tier > 0) : scored;
  pool.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier;
    const aFree = seatsLeft(a);
    const bFree = seatsLeft(b);
    // 정원이 입력된 반끼리는 잔여석 많은 순. ⚠️ 실측상 이 학원 classrooms.capacity는 전부 비어 있어
    // (0/104) 이 비교가 통째로 무동작이었다 → 정원 미상일 땐 **현원 적은 순**으로 대체한다
    // (자리 여부를 모를 때 그나마 살아있는 신호. 이름 가나다순은 상담사에게 아무 의미가 없다).
    if (aFree != null && bFree != null && aFree !== bFree) return bFree - aFree;
    if (aFree == null && bFree == null && a.enrolled !== b.enrolled) return a.enrolled - b.enrolled;
    if (aFree == null !== (bFree == null)) return aFree == null ? 1 : -1;
    return a.className.localeCompare(b.className, "ko");
  });
  return pool.slice(0, limit).map((c) => ({
    id: c.id,
    className: c.className,
    subjectLabel: c.subjectLabel,
    teacherName: c.teacherName,
    scheduleLabel: c.scheduleLabel,
    seats: c.seats,
    enrolled: c.enrolled,
    notes: c.notes,
    gradeMatched: c.gradeMatched,
  }));
}

const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * 요일+시작시각 라벨 — 전 요일 시각이 같으면 "월·수·금 16:30", 요일별로 다르면 "월 16:20 · 목 18:20"로
 * **요일별 명기**한다. ⚠️ 가장 이른 시각 하나만 붙이면 "월·목 16:20"처럼 목요일 시간을 거짓말하게 된다
 * (적대 검수 2026-07-28 — 상담 자리에서 등원 시간을 안내하는 문서라 시간 오표기는 실사고).
 */
export function formatSchedule(slots: { day: string; start: string | null }[]): string | null {
  if (slots.length === 0) return null;
  const sorted = slots.slice().sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  const label = (s: { day: string; start: string | null }) => DAY_LABEL[s.day] ?? "?";
  const times = new Set(sorted.map((s) => s.start?.slice(0, 5) ?? "?"));
  if (times.size === 1) {
    const t = [...times][0];
    return t === "?" ? sorted.map(label).join("·") : `${sorted.map(label).join("·")} ${t}`;
  }
  return sorted.map((s) => `${label(s)} ${s.start?.slice(0, 5) ?? "시간 미상"}`).join(" · ");
}

/**
 * 학교명 정규화 — "칠성초등학교"와 "칠성초"를 같은 학교로 본다.
 *
 * ⚠️ QR 접수는 학부모가 전체 이름을 쓰고("칠성초등학교") 학생 DB는 압축 표기를 쓴다("칠성초", 실측
 * 재원생 67명). 원문 그대로 비교하면 브리프가 "칠성초등학교 재학 재원생 0명"이라는 **거짓 문장**을
 * 만든다(실측 QR 29건 중 6개 학교가 이 함정에 빠짐). 표시 규약 `schoolGradeLabel`과 같은 압축 방향.
 */
export function normalizeSchool(school: string | null | undefined): string | null {
  const s = (school ?? "").trim();
  if (!s) return null;
  return s
    .replace(/초등학교$/, "초")
    .replace(/중학교$/, "중")
    .replace(/고등학교$/, "고")
    .replace(/\s+/g, "");
}

/**
 * 전화번호 → 숫자만. QR 접수는 "01067332180"(하이픈 없음), 학생 DB는 "010-6733-2180"(하이픈 96%)라
 * 원문 비교로는 형제자매를 못 찾는다(실측 QR 29건 중 8건이 실제 형제가 있는데 누락).
 */
export function phoneDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d : null;
}

/** 숫자 전화번호의 하이픈 표기 후보들 — PostgREST `.in()`으로 양쪽 포맷을 함께 조회하기 위한 변형. */
export function phoneVariants(phone: string | null | undefined): string[] {
  const d = phoneDigits(phone);
  if (!d) return [];
  const out = new Set<string>([d]);
  if (d.length === 11) out.add(`${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`);
  if (d.length === 10) {
    out.add(`${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`);
    out.add(`${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`);
  }
  const raw = (phone ?? "").trim();
  if (raw) out.add(raw);
  return [...out];
}

/**
 * 상담 과목 라벨 → 수강료 단가표에서 함께 봐야 할 분류(category)들.
 *
 * ⚠️ 이 학원의 초등 영어 본프로그램은 분류가 "EIE"다(활성 12행 — Dr.Phonics·Pre Junior 등). 라벨
 * 상호포함만 보면 "영어" 상담에서 EIE가 통째로 빠져 **제안할 단가가 하나도 안 실린다**(프롬프트가
 * "이 금액 외 언급 금지"라 LLM도 말할 수 없다). 별칭을 명시로 잇는다.
 */
const SUBJECT_CATEGORY_ALIASES: Record<string, string[]> = { 영어: ["EIE"] };

/** 단가표 분류가 이 상담 과목에 해당하는지 — 라벨 상호포함 + 학원 고유 별칭(EIE 등). */
export function matchesSubjectCategory(category: string, subjectLabel: string): boolean {
  const a = category.trim();
  const b = subjectLabel.trim();
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return (SUBJECT_CATEGORY_ALIASES[b] ?? []).some((alias) => a.includes(alias));
}

/** 남은 자리 — 정원 미지정이면 null(모르면 모른다고 표시, 0으로 단정 금지). */
export function seatsLeft(c: Pick<PrepClassFact, "seats" | "enrolled">): number | null {
  return c.seats == null ? null : Math.max(0, c.seats - c.enrolled);
}

/** 반 1건을 사람이 읽는 한 줄로 — 프롬프트·폴백·인쇄가 같은 문구를 쓴다. */
export function classLine(c: PrepClassFact): string {
  const free = seatsLeft(c);
  const parts = [
    c.className,
    c.subjectLabel,
    c.teacherName ? `${c.teacherName} 강사` : null,
    c.scheduleLabel,
    c.seats == null ? `현원 ${c.enrolled}명(정원 미지정)` : `정원 ${c.seats}명 중 ${c.enrolled}명 (잔여 ${free}석)`,
  ].filter(Boolean);
  return parts.join(" · ");
}

// ── 학부모 호칭 ─────────────────────────────────────────────────────────────

/** 접수 폼의 관계(`RELATION_OPTIONS`) → 부르는 호칭. 모르는 값·미기재는 중립 "학부모님". */
const RELATION_HONORIFIC: Record<string, string> = {
  모: "어머님",
  부: "아버님",
  조모: "할머님",
  조부: "할아버님",
};

/**
 * 상담에서 학부모를 부르는 호칭 — **학생 이름 + 관계**("임세이 어머님").
 *
 * ⚠️ 학부모 이름을 부르지 않는다(원장 지적 2026-07-29): 실측 브리프가 "정윤영님, 접수서 꼼꼼히
 * 읽어보았습니다"로 시작했는데, 학원에서 학부모를 이름+님으로 부르는 일은 없고 어색하다. 게다가
 * 학생 이름이 빠져 "누구 상담인지"가 첫 문장에서 사라진다. 관계 미기재(레거시 수기 접수 416건)나
 * '기타'는 단정하지 않고 "학부모님"으로 — 어머님/아버님을 찍어 부르면 그 자리에서 바로 틀린다.
 */
export function parentAddress(f: PrepFacts): string {
  const honorific = RELATION_HONORIFIC[(f.parent.relation ?? "").trim()] ?? "학부모님";
  const name = f.student.name?.trim();
  return name ? `${name} ${honorific}` : honorific;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * LLM이 그래도 학부모 이름을 썼을 때의 **결정론 후처리** — "정윤영님"·"정윤영 어머님"·"정윤영"을
 * 모두 `parentAddress`로 치환한다. 프롬프트 지시만으로는 모델이 지킬 때도 안 지킬 때도 있어서
 * (실측 3건이 서로 다른 호칭을 씀), 사람 앞에서 읽는 문서는 코드가 보장한다.
 *
 * 치환만 하고 탈락시키지 않는 이유: 호칭은 문체 문제라 브리프 전체를 폴백으로 버릴 사안이 아니다.
 * ⚠️ 학부모 이름이 학생 이름에 포함되면(동명·부분일치) 학생 언급까지 망가지므로 건너뛴다.
 */
export function applyParentAddress(brief: PrepBrief, f: PrepFacts): PrepBrief {
  const name = (f.parent.name ?? "").trim();
  const student = (f.student.name ?? "").trim();
  if (name.length < 2 || (student && student.includes(name))) return brief;
  const address = parentAddress(f);
  // ⚠️ 공백은 **호칭이 뒤따를 때만** 먹는다 — `\s*`를 그룹 밖에 두면 "김미영 앞에서"의 띄어쓰기까지
  //    삼켜 "…어머님앞에서"가 된다(테스트로 잡힘).
  const re = new RegExp(
    `${escapeRegExp(name)}(?:\\s*(?:님|씨|어머님|어머니|아버님|아버지|할머님|할아버님|학부모님|보호자님))?`,
    "g",
  );
  const fix = (t: string) => t.replace(re, address);
  return {
    headline: fix(brief.headline),
    opening: fix(brief.opening),
    questions: brief.questions.map(fix),
    playbook: brief.playbook.map((p) => ({
      concern: fix(p.concern),
      evidence: fix(p.evidence),
      response: fix(p.response),
    })),
    proposal: fix(brief.proposal),
    objections: brief.objections.map((o) => ({ objection: fix(o.objection), answer: fix(o.answer) })),
    closing: fix(brief.closing),
    cautions: brief.cautions.map(fix),
  };
}

// ── 프롬프트 ────────────────────────────────────────────────────────────────

/**
 * 사실 블록 — 프롬프트와 grounding 화이트리스트가 **같은 문자열**을 본다(둘이 어긋나면 정상 답이
 * 검증에서 탈락한다). 외부 AI 전송 금지선: 연락처·주소·주민번호·금액 계좌 등은 애초에 facts에
 * 담지 않는다(수강료 단가표는 학원 공개 정보라 포함).
 */
export function buildFactsBlock(f: PrepFacts): string {
  const L: string[] = [];
  L.push("[학생·접수 정보]");
  L.push(`- 이름: ${f.student.name}`);
  if (f.student.enrolledNow) {
    const cls = f.student.enrolledNow.classNames;
    L.push(
      `- ⚠️ 이미 우리 학원 재원생임${cls.length > 0 ? ` (현재 수강: ${cls.join(", ")})` : " (현재 수강 반 없음)"}`,
    );
  }
  if (f.student.grade) L.push(`- 학년: ${f.student.grade}`);
  if (f.student.school) L.push(`- 학교: ${f.student.school}`);
  if (f.student.subjectLabel) L.push(`- 상담 과목: ${f.student.subjectLabel}`);
  if (f.student.genderLabel) L.push(`- 성별: ${f.student.genderLabel}`);
  if (f.student.careerGoal) L.push(`- 진로 희망: ${f.student.careerGoal}`);
  // ⚠️ 학부모 **이름은 싣지 않는다**(원장 지적 2026-07-29 — 실측 "정윤영님, 접수서 …"). 학원에서 학부모를
  //    이름+님으로 부르지 않고 **학생 이름 + 관계 호칭**("임세이 어머님")으로 부른다. 이름을 사실로 주면
  //    모델이 그걸 호칭으로 쓴다 → 사실 자체를 호칭으로 바꿔 실는다(이름은 접수 정보 화면·인쇄 상단에 있다).
  L.push(`- 학부모 호칭: ${parentAddress(f)}`);
  if (f.student.consultationPath) L.push(`- 유입 경로: ${f.student.consultationPath}`);
  if (f.student.request) L.push(`- 학부모 요청사항: ${f.student.request}`);
  if (f.student.siblingsText) L.push(`- 형제자매(접수 기재): ${f.student.siblingsText}`);
  if (f.student.safetyNotes) L.push(`- 안전·건강 특이사항: ${f.student.safetyNotes}`);
  // 셔틀은 **접수 폼이 이미 물어본 항목**이라 답을 양방향으로 싣는다(원장 지적 2026-07-29).
  // ⚠️ 예전엔 신청(true)일 때만 한 줄을 넣고 미신청이면 침묵했다 → LLM은 아래 [학원 현황]의 "셔틀 운행
  //    (월 20,000원)"만 보고 "셔틀 이용을 원하시나요?"를 확인 질문으로 만들었다(실측 3/3 브리프 전부).
  //    학부모가 폼에서 이미 고른 것을 상담 자리에서 되묻는 건 "접수서를 안 읽었다"는 신호다.
  //    요금·노선은 **신청한 경우에만** 싣는다(안 실으면 grounding 화이트리스트에서도 빠져 언급 자체가 막힌다).
  if (f.student.shuttleRequest) {
    const detail = [f.policy.shuttleFee, f.policy.shuttleRoutes.join(", ")].filter(Boolean).join(" · ");
    L.push(`- 셔틀버스: 접수서에서 신청함${detail ? ` (${detail})` : ""} — 탑승 위치·노선만 상담에서 확정`);
  } else if (f.policy.shuttleEnabled) {
    // ⚠️ 여기에 "묻지 말 것" 같은 지시문을 쓰면 모델이 그 문장을 cautions에 그대로 옮겨 적는다
    //    (드라이런 실측: "셔틀버스 관련 질문 절대 금지"가 상담사 주의사항으로 출력됨). 사실만 적고
    //    재질문 금지는 아래 프롬프트 [작성 원칙]이 담당한다.
    L.push("- 셔틀버스: 접수서에서 신청하지 않음(미신청)");
  }

  if (f.checklist.length > 0) {
    L.push("", "[학부모가 접수 폼에 답한 사전 체크리스트]");
    for (const row of f.checklist) L.push(`- ${row.question}: ${row.answer}`);
  }
  if (f.habits.length > 0) {
    L.push("", "[학습 행동 자가평가 — 1점(전혀 아니다)~5점(매우 그렇다)]");
    for (const h of f.habits) L.push(`- ${h.label}: ${h.score}점`);
  }
  if (f.priorConsults.length > 0) {
    L.push("", "[같은 학생의 이전 상담 접수]");
    for (const p of f.priorConsults) {
      L.push(`- ${p.date ?? "날짜 미상"} · ${p.outcomeLabel}${p.subjectLabel ? ` · ${p.subjectLabel}` : ""}`);
    }
  }
  if (f.siblings.length > 0) {
    L.push("", "[같은 연락처로 등록된 재원생 = 형제자매로 추정]");
    for (const s of f.siblings) {
      const cls = s.classNames.length > 0 ? ` · 현재 수강: ${s.classNames.join(", ")}` : "";
      L.push(`- ${s.name}${s.grade ? ` ${s.grade}` : ""}${s.school ? ` · ${s.school}` : ""}${cls}`);
    }
  }

  L.push("", "[우리 학원 개설 반 — 이 목록에 없는 반·강사는 절대 언급 금지]");
  if (f.classes.length === 0) L.push("- (조건에 맞는 개설 반 없음)");
  for (const c of f.classes) L.push(`- ${classLine(c)}`);

  if (f.tuition.length > 0) {
    L.push("", "[수강료 단가표 — 이 금액 외 다른 금액 언급 금지. '회당 단가'는 월 수강료가 아님(회당×주횟수×주수). 단가 종류 미상이면 금액만 전달하고 월액으로 단정 금지]");
    for (const t of f.tuition) {
      L.push(`- ${t.category} ${t.name}: ${t.price}원${t.modeLabel ? ` (${t.modeLabel})` : " (단가 종류 미지정)"}`);
    }
  }
  if (f.textbooks.length > 0) {
    L.push("", "[사용 교재]");
    for (const t of f.textbooks) L.push(`- ${t.title} (${t.subjectLabel}${t.gradeLevel ? ` · ${t.gradeLevel}` : ""})`);
  }

  L.push("", "[학원 현황]");
  L.push(`- 전체 재원생 ${f.peers.total}명`);
  if (f.student.school) L.push(`- ${f.student.school} 재학 재원생 ${f.peers.sameSchool}명`);
  if (f.student.grade) L.push(`- ${f.student.grade} 재원생 ${f.peers.sameGrade}명`);
  if (f.policy.dueDay != null) L.push(`- 수강료 납부일: 매월 ${f.policy.dueDay}일`);
  if (f.policy.latePolicy) L.push(`- 미납·환불 정책: ${f.policy.latePolicy}`);
  // ⚠️ 셔틀 요금·노선을 여기(학원 현황)에 상시로 두지 말 것 — 미신청 학부모의 브리프에도 "월 20,000원,
  //    1·2호차"가 실려 확인 질문·반론이 만들어졌다. 신청한 경우에만 위 [학생·접수 정보]에 함께 싣는다.
  return L.join("\n");
}

/** 사전 브리프 프롬프트. FACT_GUARD는 `generateJSON`이 앞에 자동 부착하므로 여기 중복 금지. */
export function buildPrepBriefPrompt(f: PrepFacts): string {
  return [
    "당신은 학원 상담을 준비시키는 코치입니다. 아래 [사실]만 근거로, 상담자가 상담 직전에 읽는 준비 브리프를 JSON으로 작성하세요.",
    "",
    "⚠️ 작성 원칙 (최우선):",
    "- 사실에 없는 반 이름·강사 이름·교재·금액·인원·기간을 절대 만들어내지 마세요. 숫자는 [사실]에 적힌 숫자만 씁니다.",
    "- 학부모가 답하지 않은 내용을 답한 것처럼 쓰지 마세요. 접수서에 없는 것은 '확인 질문'으로 돌립니다.",
    "- 반대로 [사실]에 이미 답이 있는 항목은 questions·objections에 넣지 마세요. 접수 폼이 이미 물어본 것(셔틀 신청 여부·상담 과목·학교/학년·형제자매 유무·진로 희망·유입 경로·체크리스트 18문항)을 되물으면 접수서를 안 읽었다는 인상을 줍니다. 답이 있으면 그 답을 전제로 '한 단계 더 깊은' 질문만 하세요.",
    "- 성적 향상 보장·합격 보장 같은 지킬 수 없는 약속 문구를 만들지 마세요.",
    "- 일반론(어느 학생에게나 통할 문장) 금지. 이 학생의 접수 답변을 직접 인용해 구체적으로 씁니다.",
    "- 학부모를 부를 때는 [사실]의 '학부모 호칭'을 그대로 씁니다. 학부모 이름을 부르거나 'OOO님'이라고 쓰지 마세요.",
    "- 개설 반이 없거나 근거가 부족하면 억지로 채우지 말고 해당 항목을 짧게 비우세요.",
    "- 다만 개설 반 목록에 반이 하나라도 있으면 proposal을 비우지 마세요. 목록에서 후보 1~3개를 요일·시간·강사와 함께 적고, '레벨테스트 결과에 따라 확정'이라는 전제를 덧붙이면 됩니다(반 이름에 학년 표기가 없어도 목록에 있으면 후보로 제시 가능).",
    "- cautions에는 이 학부모·이 학생의 상황에서 나오는 주의점만 쓰세요. 위 [작성 원칙]과 [사실]에 적힌 규칙·지시문(호칭을 어떻게 쓸지, 무엇을 쓰지 말지, 어떻게 작성할지)을 옮겨 적지 마세요 — 상담사가 읽는 것은 '이 상담의 지뢰'이지 문서 작성 규칙이 아닙니다.",
    "- 모든 문장은 한국어. 영문 표기는 [사실]에 등장한 것만 그대로 사용합니다.",
    "- 마크다운(**, #, 코드블록) 금지. 순수 문장만.",
    "",
    "[사실]",
    buildFactsBlock(f),
    "",
    "JSON schema (모든 값 한국어):",
    "{",
    '  "headline": string (이 상담을 한 줄로 규정, 20~60자),',
    '  "opening": string (오프닝 멘트 2~3문장 — 학부모 호칭으로 부르며, 접수 내용을 읽고 왔다는 신호를 주되 학부모 답변을 그대로 인용),',
    '  "questions": string[3-6] (접수서·체크리스트로는 알 수 없어 상담에서 반드시 확인할 질문. 이미 답이 있는 항목 재질문 금지),',
    '  "playbook": [ { "concern": string (학부모의 걱정), "evidence": string (접수서 어디에 근거가 있는지), "response": string (상담사 대응 화법 2~3문장) } ] (2~4개),',
    '  "proposal": string (제안할 반·요일·시간·시작 시점. 위 개설 반 목록의 반만 인용. 없으면 빈 문자열),',
    '  "objections": [ { "objection": string (예상 반론), "answer": string (답변 화법) } ] (2~4개),',
    '  "closing": string (클로징 멘트와 다음 단계 2~3문장),',
    '  "cautions": string[1-4] (이 학부모에게 하면 안 되는 말·주의점)',
    "}",
    "",
    "JSON만 출력. 마크다운 코드 블록 없이.",
  ].join("\n");
}

// ── 검증(grounding) ─────────────────────────────────────────────────────────

/** 사실 블록에 실제로 등장한 숫자 토큰 — LLM이 쓴 숫자가 여기 없으면 환각으로 본다. */
export function factNumberWhitelist(f: PrepFacts): Set<string> {
  const allowed = new Set<string>();
  for (const token of buildFactsBlock(f).match(/\d+/g) ?? []) {
    allowed.add(token);
    allowed.add(String(Number(token)));
  }
  // 금액은 "150,000원"처럼 천 단위 구분이 붙어 나오는 게 자연스럽다 → 콤마 제거형도 허용.
  for (const t of f.tuition) {
    allowed.add(String(t.price));
    for (const part of t.price.toLocaleString("en-US").split(",")) allowed.add(part);
  }
  // 잔여 좌석은 코드가 계산해 사실 블록 문장에 이미 들어가지만, 명시적으로도 허용.
  for (const c of f.classes) {
    const left = seatsLeft(c);
    if (left != null) allowed.add(String(left));
  }
  return allowed;
}

/** 사실 블록에 등장한 영문 토큰(반 이름 "EIE M3" 등) — 이것만 브리프에 나올 수 있다. */
export function factWordWhitelist(f: PrepFacts): Set<string> {
  return new Set((buildFactsBlock(f).match(/[A-Za-z]{2,}/g) ?? []).map((w) => w.toLowerCase()));
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * LLM 산출 검증 — 형식·길이 + **숫자/영문 grounding**. 하나라도 걸리면 폴백으로 대체한다
 * (팀보고 `validateTeamReport`와 같은 정책: 통과분만 저장, 미검증 문장을 사람 앞에 내지 않는다).
 * 한 자리 숫자는 문장 안 일반 표현("2~3가지")이라 허용 — 환각 위험은 금액·인원 같은 2자리 이상에 몰려 있다.
 */
export function validatePrepBrief(
  raw: unknown,
  facts: PrepFacts,
): { ok: true; value: PrepBrief } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "형식 아님" };
  const r = raw as Record<string, unknown>;

  const numbers = factNumberWhitelist(facts);
  const words = factWordWhitelist(facts);
  let failure: string | null = null;

  const check = (text: string, where: string): boolean => {
    for (const token of text.match(/\d+/g) ?? []) {
      if (token.length < 2) continue;
      if (!numbers.has(token) && !numbers.has(String(Number(token)))) {
        failure = `${where}: 근거 없는 숫자 ${token}`;
        return false;
      }
    }
    for (const word of text.match(/[A-Za-z]{2,}/g) ?? []) {
      if (!words.has(word.toLowerCase())) {
        failure = `${where}: 근거 없는 영문 ${word}`;
        return false;
      }
    }
    return true;
  };

  const text = (key: string, min: number, max: number, required = true): string | null => {
    const v = str(r[key]);
    if (!v) {
      if (required) failure = `${key} 비어 있음`;
      return required ? null : "";
    }
    if (v.length < min || v.length > max) {
      failure = `${key} 길이 ${v.length}`;
      return null;
    }
    return check(v, key) ? v : null;
  };

  const list = (key: string, min: number, max: number, itemMax: number): string[] | null => {
    const arr = Array.isArray(r[key]) ? (r[key] as unknown[]) : null;
    if (!arr) {
      failure = `${key} 배열 아님`;
      return null;
    }
    const items = arr.map(str).filter(Boolean);
    if (items.length < min || items.length > max) {
      failure = `${key} 개수 ${items.length}`;
      return null;
    }
    for (const item of items) {
      if (item.length > itemMax) {
        failure = `${key} 항목 길이 ${item.length}`;
        return null;
      }
      if (!check(item, key)) return null;
    }
    return items;
  };

  const pairs = <K extends string>(
    key: string,
    keys: [K, K, ...K[]],
    min: number,
    max: number,
  ): Record<K, string>[] | null => {
    const arr = Array.isArray(r[key]) ? (r[key] as unknown[]) : null;
    if (!arr) {
      failure = `${key} 배열 아님`;
      return null;
    }
    const out: Record<K, string>[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const row = {} as Record<K, string>;
      let complete = true;
      for (const k of keys) {
        const v = str(e[k]);
        if (!v || v.length > 400) complete = false;
        else if (!check(v, `${key}.${k}`)) return null;
        row[k] = v;
      }
      if (complete) out.push(row);
    }
    if (out.length < min || out.length > max) {
      failure = `${key} 개수 ${out.length}`;
      return null;
    }
    return out;
  };

  const headline = text("headline", 8, 80);
  const opening = text("opening", 20, 600);
  const questions = list("questions", 2, 8, 200);
  const playbook = pairs("playbook", ["concern", "evidence", "response"], 1, 6);
  // 개설 반이 하나도 없으면 제안할 게 없는 게 정상 → proposal은 비어도 통과.
  const proposal = text("proposal", 10, 800, false);
  const objections = pairs("objections", ["objection", "answer"], 1, 6);
  const closing = text("closing", 15, 600);
  const cautions = list("cautions", 1, 6, 200);

  if (
    headline == null || opening == null || questions == null || playbook == null ||
    proposal == null || objections == null || closing == null || cautions == null
  ) {
    return { ok: false, reason: failure ?? "검증 실패" };
  }

  return {
    ok: true,
    value: {
      headline,
      opening,
      questions,
      playbook: playbook as PrepBrief["playbook"],
      proposal,
      objections: objections as PrepBrief["objections"],
      closing,
      cautions,
    },
  };
}

// ── 폴백(결정론) ────────────────────────────────────────────────────────────

/**
 * LLM 실패·검증 탈락 시의 브리프 — **사실만 재배열**한다(스크립트 문장을 지어내지 않는다).
 * 상담사가 빈 화면을 보는 일이 없어야 하고, 동시에 "AI가 썼다"고 착각하면 안 되므로
 * 저장 레코드의 `source: "fallback"`이 화면에 표시된다.
 */
export function buildFallbackPrepBrief(f: PrepFacts): PrepBrief {
  const top = f.checklist.slice(0, 3);
  const worries = f.checklist.find((c) => c.question === "가장 걱정되는 것")?.answer ?? null;
  const wants = f.checklist.find((c) => c.question === "학원에 바라는 것")?.answer ?? null;
  const goals = f.checklist.find((c) => c.question === "가장 알고 싶은 문제")?.answer ?? null;

  const headline = [
    f.student.name,
    f.student.grade,
    f.student.subjectLabel ? `${f.student.subjectLabel} 상담` : "등록 상담",
  ]
    .filter(Boolean)
    .join(" · ");

  const questions: string[] = [];
  if (!goals) questions.push("이번 상담에서 가장 알고 싶은 것이 무엇인지 확인");
  if (!worries) questions.push("현재 학습에서 가장 걱정되는 부분 확인");
  questions.push("현재 다니는 학원·공부방과 그만두려는 이유 확인");
  questions.push("가능한 등원 요일과 시간대 확인");
  // 형제자매는 접수 폼이 이미 묻는다("있음"/"없음(외동)") — 답이 있으면 되묻지 않고, 동선만 확인한다.
  // 셔틀도 폼이 묻는 항목이라 폴백에서도 "이용하시나요?"를 만들지 않는다(신청 시 노선 확정만).
  if (f.student.siblingsText || f.siblings.length > 0) {
    if (f.siblings.length > 0) questions.push("형제자매 등·하원 동선을 함께 맞출지 확인");
  } else {
    questions.push("형제자매 재원 여부와 등·하원 동선 확인");
  }
  if (f.student.shuttleRequest) questions.push("셔틀 탑승 위치와 이용 노선 확정");

  const playbook = (worries ? [{ concern: worries, evidence: "접수 폼 '가장 걱정되는 것' 응답", response: "접수 폼에 적은 걱정을 그대로 되짚어 확인한 뒤, 해당 영역을 어떻게 진단하고 관리하는지 설명한다." }] : []).concat(
    wants
      ? [{ concern: wants, evidence: "접수 폼 '학원에 바라는 것' 응답", response: "학부모가 요청한 항목부터 순서대로 설명한다." }]
      : [],
  );

  const lowHabits = f.habits.filter((h) => h.score <= 2);
  if (lowHabits.length > 0) {
    playbook.push({
      concern: `학습 행동 자가평가 저점: ${lowHabits.map((h) => `${h.label} ${h.score}점`).join(", ")}`,
      evidence: "접수 폼 학습 행동 자가평가",
      response: "낮게 답한 항목을 언급하며 학원에서 어떻게 관리하는지 설명한다.",
    });
  }

  const proposal =
    f.classes.length > 0
      ? ["제안 가능한 반:", ...f.classes.slice(0, 3).map((c) => `- ${classLine(c)}`)].join("\n")
      : "";

  const cautions: string[] = [];
  if (f.student.safetyNotes) cautions.push(`안전·건강 특이사항 있음: ${f.student.safetyNotes}`);
  if (f.priorConsults.length > 0) cautions.push(`이전 상담 접수 ${f.priorConsults.length}건 — 같은 질문을 반복하지 말 것`);
  if (f.classes.length === 0) cautions.push("조건에 맞는 개설 반이 없어 반 제안 전 시간표 확인 필요");
  if (cautions.length === 0) cautions.push("접수 폼에 없는 내용은 단정하지 말고 질문으로 확인할 것");

  return {
    headline: headline || `${f.student.name} 등록 상담`,
    opening:
      top.length > 0
        ? `${parentAddress(f)}, 접수해 주신 내용을 먼저 확인했습니다. ${top.map((t) => `${t.question}: ${t.answer}`).join(" / ")}`
        : `${parentAddress(f)}, 접수해 주신 내용을 바탕으로 상담을 진행하겠습니다.`,
    questions,
    playbook:
      playbook.length > 0
        ? playbook
        : [
            {
              concern: "접수 폼 응답 없음",
              evidence: "사전 체크리스트 미작성",
              response: "상담 초반에 걱정되는 부분부터 직접 여쭙고 기록한다.",
            },
          ],
    proposal,
    objections: [
      { objection: "다른 학원과 비교해 보고 결정하겠다", answer: "결정을 재촉하지 말고, 비교에 필요한 자료(시간표·수강료·관리 방식)를 정리해 드린다." },
      { objection: "수강료가 부담된다", answer: "단가표에 있는 금액만 그대로 안내하고, 임의 할인·확답은 하지 않는다." },
    ],
    closing: "오늘 논의한 내용을 정리해 드리고, 다음 단계(레벨테스트·반 배정·등원 시작일)를 언제까지 결정할지 합의한다.",
    cautions,
  };
}
