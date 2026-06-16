/**
 * 학생 누적 이력 — 결정적 생성기.
 * 프로토타입(data/원스크린_패키지/소스/data.js 213~293행)의 세션 이력 생성을 그대로 이식.
 * 같은 학생(idx)은 항상 같은 9세션을 만든다(LCG RNG). 라이브 데이터·네트워크 없음.
 * 마지막 세션(6/1)은 강사 원스크린의 base 값으로 오버라이드 → 두 화면이 일관.
 */
import type { AttendanceMark, OneScreenStudent } from "@/features/onescreen/types";

export const SESSION_DATES = ["5/7", "5/9", "5/14", "5/16", "5/21", "5/23", "5/28", "5/30", "6/1"];
const TOTAL_LESSONS = 16;

export type SessionSubject = {
  name: string;
  prev: string;
  today: string;
  daily: number;
  check: number;
  lesson: number;
};

export type Session = {
  date: string;
  attendance: AttendanceMark;
  attitude: string | null;
  homework: string;
  subjects: SessionSubject[];
  daily: number; // 세션 평균(모든 과목)
  check: number;
  reportSent: boolean;
  prevDaily: number | null;
  prevCheck: number | null;
};

export type CurriculumItem = { name: string; done: number; total: number };
export type LearningStats = { avgPct: number; attRate: number; sessions: number; currPct: number };

export type StudentLearning = {
  student: OneScreenStudent;
  history: Session[];
  curriculum: CurriculumItem[];
  stat: LearningStats;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function pickAttitude(check: number): string {
  if (check >= 18) return "아주 좋음";
  if (check >= 15) return "좋음";
  if (check >= 12) return "보통";
  return "피곤함";
}

/** 점수(0~max) → 백분율. 차트·진행바 공용. */
export function pctOf(score: number, max = 20): number {
  return max ? Math.round((score / max) * 100) : 0;
}

/**
 * 결정적 9세션 이력 + 진도 + 누적 통계 생성.
 * RNG 호출 순서가 결정성을 좌우 — 세션마다 (과목당 daily,check) → attendance → homework 순서를 엄수.
 */
export function buildLearning(base: OneScreenStudent, idx: number): StudentLearning {
  const seed = (idx + 1) * 37;
  const nS = SESSION_DATES.length;

  const sb = base.subjects.map((_su, j) => ({
    baseDaily: 12 + ((seed + j * 13) % 7),
    baseCheck: 13 + ((seed + j * 7) % 6),
    start: 3 + ((seed + j * 5) % 4),
  }));

  let rng = seed % 233280;
  const rand = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };

  const history: Session[] = SESSION_DATES.map((date, i) => {
    const prog = i / (nS - 1);
    const isLast = i === nS - 1;

    const subjects: SessionSubject[] = base.subjects.map((su, j) => {
      const b = sb[j]!;
      let daily = clamp(Math.round(b.baseDaily - 3 + prog * 5 + (rand() - 0.5) * 3), 4, 20);
      let check = clamp(Math.round(b.baseCheck - 3 + prog * 5 + (rand() - 0.5) * 3), 4, 20);
      const lessonToday = Math.min(b.start + i + 1, TOTAL_LESSONS);
      let prev = `${lessonToday - 1}강`;
      let today = `${lessonToday}강`;
      if (isLast) {
        prev = su.prev;
        today = su.today;
        if (base.tests.daily.score != null) daily = base.tests.daily.score;
        if (base.tests.check.score != null) check = base.tests.check.score;
      }
      return { name: su.name, prev, today, daily, check, lesson: lessonToday };
    });

    const avg = (k: "daily" | "check") =>
      Math.round(subjects.reduce((a, s) => a + s[k], 0) / subjects.length);
    const r = rand();
    let attendance: AttendanceMark = r > 0.93 ? "결석" : r > 0.88 ? "지각" : "출석";
    let homework = rand() > 0.9 ? "일부 미흡" : "완료";
    const dayAgg = avg("daily");
    const chkAgg = avg("check");
    let attitude = pickAttitude(chkAgg);

    if (isLast) {
      attendance = base.attendance;
      homework = base.homework;
      if (base.attitude) attitude = base.attitude;
    }

    return {
      date,
      attendance,
      attitude,
      homework,
      subjects,
      daily: dayAgg,
      check: chkAgg,
      reportSent: isLast ? !!base.reportSent : true,
      prevDaily: null,
      prevCheck: null,
    };
  });

  // 직전 세션 점수(델타용)
  history.forEach((h, i) => {
    h.prevDaily = i > 0 ? history[i - 1]!.daily : null;
    h.prevCheck = i > 0 ? history[i - 1]!.check : null;
  });

  const lastH = history[nS - 1]!;
  const curriculum: CurriculumItem[] = base.subjects.map((su, j) => ({
    name: su.name,
    done: lastH.subjects[j]!.lesson,
    total: TOTAL_LESSONS,
  }));

  const stat: LearningStats = {
    avgPct: Math.round((history.reduce((a, h) => a + (h.daily + h.check) / 2, 0) / nS / 20) * 100),
    attRate: Math.round((history.filter((h) => h.attendance === "출석").length / nS) * 100),
    sessions: nS,
    currPct: Math.round((curriculum.reduce((a, c) => a + c.done / c.total, 0) / curriculum.length) * 100),
  };

  return { student: base, history, curriculum, stat };
}

/** 날짜 라벨로 세션 찾기. 없으면 최신. */
export function findSession(history: Session[], dateLabel?: string | null): Session {
  if (!dateLabel) return history[history.length - 1]!;
  return history.find((h) => h.date === dateLabel) ?? history[history.length - 1]!;
}

/** "5/7" → "5월 7일" */
export function dateKo(label: string): string {
  const [m, d] = label.split("/");
  return `${m}월 ${d}일`;
}

/** 세션 → 데일리 리포트용 학생 형태(buildReport 입력 + 화면 표시 공용).
 *  결석일은 테스트를 안 봤으므로 점수를 null로 둔다(RecentRecords가 결석 점수를 가리는 규칙과 일치). */
export function sessionToStudent(base: OneScreenStudent, session: Session): OneScreenStudent {
  const absent = session.attendance === "결석";
  return {
    ...base,
    attendance: session.attendance,
    attitude: session.attitude,
    homework: session.homework,
    subjects: session.subjects.map((s) => ({ name: s.name, prev: s.prev, today: s.today })),
    tests: {
      daily: { score: absent ? null : session.daily, max: 20, prevScore: session.prevDaily },
      check: { score: absent ? null : session.check, max: 20, prevScore: session.prevCheck },
    },
    reportSent: session.reportSent,
  };
}
