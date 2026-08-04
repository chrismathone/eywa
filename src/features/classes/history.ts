/**
 * 반 이력 타임라인 **조립 규칙**(순수 · Vitest) — 반 상세 '이력'란(원장 2026-08-04:
 * *"각 수업의 상세화면에 '이력'란을 추가해"* + *"로그 등 기록을 활용해서 최대한 이력 살릴 수 있는 부분은 전부 살릴것"*).
 *
 * 재료가 한 곳에 없어서 **여러 기록을 합친다**. 각 항목은 **어디서 왔는지(source)를 달고** 나간다 —
 * 출처가 다르면 확실성도 다르기 때문이다(배치 구간은 사실, 보고서 작성자는 정황).
 *
 * 🔴 **없는 사실을 지어내지 않는다.** 반 수정 폼에는 감사로그가 없었고(2026-08-04 이전) 인수인계 로그에도
 *    **바뀌기 전 담당이 없다**(newTeacherId만). 그래서 "이전 담당 → 새 담당"으로 단정하지 않고,
 *    기록에 있는 것만 적는다(모르면 안 적는 게 정직하다 — 형제 규칙 [[#93]]).
 * ⚠️ 보고서 작성자(`lesson_reports.teacher_name`)는 **작성자이지 담당이 아니다**(사무실 대리 작성이
 *    설계된 동작). 그래서 라벨을 '보고서 작성'으로 달고 담당 변경으로 읽히지 않게 한다.
 */

/** 이력 한 줄의 출처 — 화면이 이 값으로 아이콘·설명을 가른다. */
export type ClassHistorySource =
  /** class_schedules 유효 구간 — "이 배치가 언제부터 언제까지" (사실). */
  | "schedule"
  /** audit_logs — 인수인계·종강·폐지·위임 등 사람이 한 행위(사실, 행위자 있음). */
  | "audit"
  /** class_delegations — 임시 위임 기간(사실). */
  | "delegation"
  /** lesson_reports 작성 기록 — 그 달 누가 보고서를 썼나(정황). */
  | "report";

export type ClassHistoryEntry = {
  /** 정렬·표시 기준일(YYYY-MM-DD). 구간이면 시작일. */
  date: string;
  /** 구간의 끝(있으면). null=계속. */
  endDate?: string | null;
  source: ClassHistorySource;
  /** 한 줄 제목(한글 — raw 코드·영문 키 노출 금지). */
  title: string;
  /** 부연(담당·강의실·행위자 등). 없으면 표시 안 함. */
  detail?: string | null;
  /** 누가 한 일인지(감사로그만). */
  actor?: string | null;
};

/** 슬롯 한 줄(이력 판정에 필요한 것만). */
export type HistorySlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  teacherName: string | null;
  roomName: string | null;
};

const DOW_KO: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

const hm = (t: string | null | undefined): string => String(t ?? "").slice(0, 5);

/** "월 16:00~17:00" — 배치 한 줄의 사람이 읽는 표기. */
export function slotLabel(s: { dayOfWeek: string; startTime: string; endTime: string }): string {
  return `${DOW_KO[s.dayOfWeek] ?? s.dayOfWeek} ${hm(s.startTime)}~${hm(s.endTime)}`;
}

/**
 * 같은 시작일을 가진 슬롯들을 **한 줄로 묶는다** — 요일마다 행이 있어 그대로 펴면 이력이 수십 줄이 된다.
 * 담당·강의실이 갈리면 각각 적는다(한 배치 안에서도 요일별로 다를 수 있다).
 */
export function buildScheduleHistory(slots: HistorySlot[]): ClassHistoryEntry[] {
  const byPeriod = new Map<string, HistorySlot[]>();
  for (const s of slots) {
    // 시작일이 없는 행(구 데이터)은 이력으로 못 쓴다 — 언제부터인지 모르는 걸 지어내지 않는다.
    if (!s.validFrom) continue;
    const key = `${String(s.validFrom).slice(0, 10)}|${s.validTo ? String(s.validTo).slice(0, 10) : ""}`;
    (byPeriod.get(key) ?? byPeriod.set(key, []).get(key)!).push(s);
  }
  const out: ClassHistoryEntry[] = [];
  for (const [key, group] of byPeriod) {
    const [from, to] = key.split("|");
    const teachers = [...new Set(group.map((g) => g.teacherName).filter((v): v is string => !!v))];
    const rooms = [...new Set(group.map((g) => g.roomName).filter((v): v is string => !!v))];
    const days = group
      .slice()
      .sort((a, b) => slotLabel(a).localeCompare(slotLabel(b), "ko"))
      .map(slotLabel);
    out.push({
      date: from!,
      endDate: to || null,
      source: "schedule",
      title: `수업 배치 ${days.length}개`,
      detail: [
        days.join(" · "),
        teachers.length ? `담당 ${teachers.join("·")}` : null,
        rooms.length ? `강의실 ${rooms.join("·")}` : null,
      ]
        .filter(Boolean)
        .join(" / "),
    });
  }
  return out;
}

/**
 * 여러 출처를 **최신순 한 줄기로** 합친다. 같은 날짜면 사실(배치·감사로그)이 정황(보고서)보다 위.
 * ⚠️ 정렬만 한다 — 중복 제거·추론은 하지 않는다(합치는 순간 어느 기록이 근거인지 사라진다).
 */
export function mergeClassHistory(groups: ClassHistoryEntry[][]): ClassHistoryEntry[] {
  const RANK: Record<ClassHistorySource, number> = { audit: 0, schedule: 1, delegation: 2, report: 3 };
  return groups
    .flat()
    .filter((e) => !!e.date)
    .sort((a, b) => (a.date === b.date ? RANK[a.source] - RANK[b.source] : a.date < b.date ? 1 : -1));
}
