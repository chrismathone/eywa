/**
 * **숙제 위험 집계** — 수업보고서의 `homework_score`를 학생 단위로 접는다(순수·Vitest).
 *
 * 🔴 **숫자로 바꾸는 곳은 [`parseHomeworkRate`](@/features/onescreen/homework-rate) 하나다.** 여기서
 *    새 매핑을 만들지 말 것 — `일부 미흡`을 50으로 읽던 코드가 학부모 카드에 강사가 하지 않은 판단을
 *    찍어 보낸 사고가 그 파일 주석에 남아 있다.
 * 🔴 **null은 0이 아니다.** `없음`·`일부 미흡`·빈칸은 "숫자로 말할 수 없음"이라 분모에서 빠진다
 *    (0으로 세면 과제가 없던 날이 '숙제 안 함'이 된다).
 * 🔴 **`미제출`(안 내옴)과 `0%`(했는데 못 함)를 뭉치지 않는다** — 수행률로는 둘 다 0이지만 학부모에게
 *    하는 말이 다르다. 화면이 두 수를 갈라 말할 수 있게 따로 센다.
 * ⚠️ 이 재료는 **aywa에 보고서를 쓰는 과목만**이다(현 운영상 수학) — 과목 축은 조회가
 *    `report.classnoteSubjects`로 이미 좁히고, 화면은 그 사실을 라벨에 적는다.
 */

import { NOT_SUBMITTED, parseHomeworkRate } from "@/features/onescreen/homework-rate";

/** 이 비율 **미만**이면 낮다고 본다. 🔴 화면엔 상수 이름이 아니라 이 값이 만든 문장을 적는다([[#121]]). */
export const LOW_HOMEWORK_RATE = 60;

export type HomeworkRow = { studentId: string; homeworkScore: string | null };

export type HomeworkRisk = {
  /** 낮은 기록이 하나라도 있는 **학생 수**(중복 없음). */
  students: number;
  /** 그중 `미제출`이 있던 학생 수. */
  notSubmitted: number;
  /** 그중 `0%`(했지만 하나도 못 함)가 있던 학생 수. */
  zero: number;
  /** 판정할 수 없어 뺀 기록 수(`없음`·`일부 미흡`·빈칸) — 분모에서 빠졌다는 사실을 화면이 밝힌다. */
  unparsed: number;
  /** 판정한 기록 수(분모). */
  parsed: number;
};

export function buildHomeworkRisk(rows: readonly HomeworkRow[]): HomeworkRisk {
  const low = new Set<string>();
  const notSubmitted = new Set<string>();
  const zero = new Set<string>();
  let unparsed = 0;
  let parsed = 0;
  for (const row of rows) {
    const raw = (row.homeworkScore ?? "").trim();
    const rate = parseHomeworkRate(raw);
    if (rate === null) {
      unparsed += 1;
      continue;
    }
    parsed += 1;
    if (rate >= LOW_HOMEWORK_RATE) continue;
    low.add(row.studentId);
    // 🔴 두 사실을 갈라 센다 — 수행률은 둘 다 0이지만 "안 냈다"와 "못 했다"는 다른 말이다.
    if (raw === NOT_SUBMITTED) notSubmitted.add(row.studentId);
    else if (rate === 0) zero.add(row.studentId);
  }
  return {
    students: low.size,
    notSubmitted: notSubmitted.size,
    zero: zero.size,
    unparsed,
    parsed,
  };
}
