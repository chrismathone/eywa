// 이탈(churn) 위험 점수 — 순수 함수. I/O·Date 없음.
// 시간 파생 입력(상담 공백일·수강 종료 임박일 등)은 server query가 미리 계산해 넘긴다.
// → 단위 테스트 가능 + 마이그레이션 불필요(저장하지 않고 읽을 때 파생).
// 부원장 프로토타입의 analyzeRow / getRenewal / getPrimaryAction 로직을 eywa 데이터 형태로 포팅.

export type RiskLevel = "risk" | "warn" | "ok";
export type RenewalTone = "risk" | "warn" | "ok";
export type RiskCategory = "score" | "homework" | "attend" | "counsel" | "parent";

/** 학생 1명의 정규화된 위험 신호 — eywa 실데이터에서 server query가 집계. */
export type RetentionSignals = {
  /** 최근 성적(%) — student_grades 최신(score/max_score*100). null = 기록 없음 */
  lastScore: number | null;
  /** 직전 성적(%) — 최신 직전. null이면 lastScore로 대체 */
  previousScore: number | null;
  /** 숙제 이행률(%) — 윈도우 내 done/required*100. null = 기록 없음 */
  homeworkRate: number | null;
  /** 윈도우 전반부 숙제율(%) — 하락 감지용. null이면 미적용 */
  previousHomeworkRate: number | null;
  /** 윈도우 내 결석 수 */
  absences: number;
  /** 윈도우 내 지각 수 */
  lateCount: number;
  /** 마지막 상담 이후 경과일. null = 상담 이력 없음 */
  daysSinceCounsel: number | null;
  /** 최근 상담 요약 + 학생 메모(자유텍스트) — 이탈 키워드 탐지용 */
  parentSignalText: string;
  /** 월 수강료(원) — 매출 위험·정렬용 */
  monthlyFee: number;
  /** 가장 임박한 수강 종료까지 남은 일수. null = 종료일 없음 */
  enrollmentEndsInDays: number | null;
};

export type RiskFactor = {
  category: RiskCategory;
  label: string;
  points: number;
  adjustment?: boolean;
};

export type RiskResult = {
  score: number; // 0–100
  level: RiskLevel;
  reasons: string[];
  factors: RiskFactor[];
  scoreDrop: number; // 성적 하락폭(점)
  homeworkDrop: number; // 숙제율 하락폭(%p)
  renewal: { tone: RenewalTone; label: string; score: number };
};

const RISK_THRESHOLD = 60;
const WARN_THRESHOLD = 35;

const clampPercent = (n: number) => Math.max(0, Math.min(100, n));
const clampCount = (n: number) => Math.max(0, n);
// 소수 점수끼리 빼면 9.000000000000007 같은 부동소수점 표시 오차가 생긴다. 표시용 차이값은 반올림한다.
const roundTo = (n: number, digits = 2) =>
  Number.isFinite(n) ? Math.round(n * 10 ** digits) / 10 ** digits : 0;

/** 텍스트에 키워드 중 하나라도 포함되는지(대소문자 무시). */
export function includesAny(text: string, words: string[]): boolean {
  const src = (text ?? "").toLowerCase();
  return words.some((w) => src.includes(w.toLowerCase()));
}

export function levelLabel(level: RiskLevel): string {
  return level === "risk" ? "위험" : level === "warn" ? "관심" : "안정";
}

/** 정규화 신호 → 위험 점수/등급/사유/재등록 전망. 부원장 analyzeRow 가중치 그대로. */
export function scoreStudent(signals: RetentionSignals): RiskResult {
  const homeworkMissing = signals.homeworkRate == null;
  const counselMissing = signals.daysSinceCounsel == null;

  const lastScore = clampPercent(signals.lastScore ?? 0);
  const previousScore = clampPercent(signals.previousScore ?? lastScore);
  const homeworkRate = clampPercent(signals.homeworkRate ?? 100);
  const previousHomeworkRate = clampPercent(signals.previousHomeworkRate ?? homeworkRate);
  const absences = clampCount(signals.absences);
  const lateCount = clampCount(signals.lateCount);
  const daysSinceCounsel = clampCount(signals.daysSinceCounsel ?? 0);
  const parentMood = signals.parentSignalText ?? "";

  const scoreDrop =
    signals.lastScore != null && signals.previousScore != null
      ? roundTo(Math.max(0, previousScore - lastScore))
      : 0;
  const homeworkDrop = homeworkMissing ? 0 : roundTo(Math.max(0, previousHomeworkRate - homeworkRate));

  const reasons: string[] = [];
  const factors: RiskFactor[] = [];
  let score = 0;
  const add = (category: RiskCategory, label: string, points: number) => {
    score += points;
    reasons.push(label);
    factors.push({ category, label, points });
  };

  if (scoreDrop >= 15) add("score", `성적 ${scoreDrop}점 하락`, 30);
  else if (scoreDrop >= 8) add("score", `성적 ${scoreDrop}점 하락`, 20);
  else if (scoreDrop >= 4) add("score", `성적 ${scoreDrop}점 하락`, 10);

  if (homeworkMissing) add("homework", "숙제 기록 없음", 0);
  else if (homeworkRate < 60) add("homework", `숙제율 ${Math.round(homeworkRate)}%`, 20);
  else if (homeworkRate < 75) add("homework", `숙제율 ${Math.round(homeworkRate)}%`, 10);
  if (homeworkDrop >= 20) add("homework", `숙제율 ${Math.round(homeworkDrop)}%p 하락`, 10);

  if (absences >= 3) add("attend", `결석 ${absences}회`, 20);
  else if (absences >= 2) add("attend", `결석 ${absences}회`, 12);
  if (lateCount >= 3) add("attend", `지각 ${lateCount}회`, 10);
  if (absences >= 2 && !homeworkMissing && homeworkDrop >= 15)
    add("attend", "출결·과제 동반 하락", 10);

  if (counselMissing) add("counsel", "상담 이력 없음", 10);
  else if (daysSinceCounsel >= 45) add("counsel", `상담 공백 ${daysSinceCounsel}일`, 15);
  else if (daysSinceCounsel >= 30) add("counsel", `상담 공백 ${daysSinceCounsel}일`, 10);

  const strongParentSignal = includesAny(parentMood, ["퇴원", "환불", "전원"]);
  if (strongParentSignal) add("parent", "상담·메모 내 강한 이탈 신호", 30);
  else if (includesAny(parentMood, ["불만", "비용", "고민"]))
    add("parent", "상담·메모 내 이탈 우려", 15);
  else if (includesAny(parentMood, ["집중", "자신감", "질문"]))
    add("parent", "상담·메모 내 관리 필요", 5);

  // 하한 보정도 factor 행으로 물질화 → Σpoints === score 불변식 유지.
  const riskRawTotal = score;
  if (strongParentSignal && riskRawTotal < RISK_THRESHOLD) {
    factors.push({
      category: "parent",
      label: "퇴원·환불 신호 최소 위험도 보정",
      points: RISK_THRESHOLD - riskRawTotal,
      adjustment: true,
    });
  }
  if (strongParentSignal) score = Math.max(score, RISK_THRESHOLD);
  score = Math.min(100, score);

  const level: RiskLevel =
    score >= RISK_THRESHOLD ? "risk" : score >= WARN_THRESHOLD ? "warn" : "ok";

  return {
    score,
    level,
    reasons: reasons.length ? reasons : ["뚜렷한 위험 신호 없음"],
    factors,
    scoreDrop,
    homeworkDrop,
    renewal: renewalOf(score, parentMood, daysSinceCounsel, signals.enrollmentEndsInDays),
  };
}

/** 재등록 전망 — 위험 점수 + 학부모 신호 + 상담 공백 + 수강 종료 임박. 부원장 getRenewal 포팅. */
export function renewalOf(
  score: number,
  parentMood: string,
  daysSinceCounsel: number,
  enrollmentEndsInDays: number | null,
): { tone: RenewalTone; label: string; score: number } {
  if (score >= RISK_THRESHOLD || includesAny(parentMood, ["환불", "퇴원", "전원", "불만"]))
    return { tone: "risk", label: "낮음", score: 28 };
  if (
    score >= WARN_THRESHOLD ||
    daysSinceCounsel >= 45 ||
    (enrollmentEndsInDays != null && enrollmentEndsInDays <= 21) ||
    includesAny(parentMood, ["비용", "고민"])
  )
    return { tone: "warn", label: "보통", score: 58 };
  return { tone: "ok", label: "높음", score: 82 };
}

/** 등급별 담당 주체. */
export function ownerFor(level: RiskLevel, teacherName: string | null): string {
  if (level === "risk") return "원장 직접";
  if (level === "warn") return teacherName ? `${teacherName} 강사` : "담당 강사";
  return "정기 관리";
}

/** 다음 권장 조치 한 줄. 부원장 getPrimaryAction 포팅. */
export function primaryAction(r: RiskResult, homeworkRate: number | null): string {
  if (r.level === "risk")
    return r.scoreDrop >= 8
      ? "시험 결과 안내 겸 24시간 내 학부모 전화 상담"
      : "오늘 중 원장 직접 전화 상담";
  if (homeworkRate != null && homeworkRate < 75) return "숙제 루틴 점검 후 학부모 업데이트";
  if (r.level === "warn") return "담당 강사 면담 후 짧은 공유";
  return "정기 리포트 유지";
}
