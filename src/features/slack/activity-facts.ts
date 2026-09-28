import { STATUS_TEXT, type AttendanceMark } from "@/features/attendance/cell-display";
import { schoolGradeLabel } from "@/lib/format/school-grade";

/**
 * 슬랙 활동 메시지의 **누구의 무엇**(원장 2026-09-28 *"슬랙 메시지를 더 고도화시킬 수 있도록. 너무 그냥 간단하게 날아감"* →
 * '허용 항목만 풀기' 선택). 출결·수업보고서·ClassNote처럼 가장 많은 활동은 감사로그 대상 칸이 비어 "— 남정화"만 나갔다.
 *
 * 🔴 metadata를 **통째로 넘기지 않는다** — 아래 허용 키만 꺼내 **확인된 이름·한글 라벨**로 바꾼다:
 *    학생 id → 이름·학교학년 · 반 id → 반 이름·과목 라벨 · 날짜·교시 시각 · 출결 상태 한글 · 인원 수.
 *    메모·전후 값·파일명·금액 같은 자유 글과 모르는 키는 싣지 않는다(돈 계열 `opaque`는 이것마저 안 싣는다 — render).
 *    이름을 못 찾은 id는 버린다(원문 id 노출 금지).
 * 순수 함수(Vitest) — 조회는 호출부(expand)가 한다.
 */
export type FactLookups = {
  student: ReadonlyMap<string, { name: string; school: string | null; grade: string | null }>;
  klass: ReadonlyMap<string, { name: string; subject: string | null }>;
  subjectLabel: (key: string) => string;
};
export type ActivityFacts = {
  /** 짧게 한 줄에 붙는 조각(이름 · 반 · 날짜 · 상태). */
  brief: string[];
  /** 자세히의 표 줄. */
  rows: { label: string; value: string }[];
  /** 에이와에서 열 곳 — 학생 한 명이면 그 학생 화면. */
  href: string | null;
};

const EMPTY: ActivityFacts = { brief: [], rows: [], href: null };
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** `2026-09-28` → `9/28(월)` — 모양이 틀리면 null(원문을 흘리지 않는다). */
export function shortDate(v: unknown): string | null {
  const s = str(v);
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${+m[2]}/${+m[3]}(${WEEK[d.getUTCDay()]})`;
}

const clock = (v: unknown) => str(v)?.match(/^(\d{2}):(\d{2})/)?.slice(1, 3).join(":") ?? null;

export function activityFacts(action: string, metadata: unknown, lk: FactLookups): ActivityFacts {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return EMPTY;
  const m = metadata as Record<string, unknown>;
  const brief: string[] = [];
  const rows: ActivityFacts["rows"] = [];

  const sid = str(m.studentId);
  const student = sid ? lk.student.get(sid) : undefined;
  const all = ids(m.studentIds);
  const many = all.filter((id) => lk.student.has(id)).slice(0, 5);
  if (student) {
    const sg = schoolGradeLabel(student.school, student.grade);
    brief.push(student.name);
    rows.push({ label: "학생", value: sg ? `${student.name} (${sg})` : student.name });
  } else if (many.length) {
    const names = many.map((id) => lk.student.get(id)!.name);
    const text = all.length > names.length ? `${names.join(", ")} 외 ${all.length - names.length}명` : names.join(", ");
    brief.push(`학생 ${all.length}명`);
    rows.push({ label: "학생", value: text });
  }

  const cid = str(m.classId);
  const klass = cid ? lk.klass.get(cid) : undefined;
  const subjectKey = str(m.subject) ?? klass?.subject ?? null;
  const subject = subjectKey ? lk.subjectLabel(subjectKey) : null;
  if (klass) {
    brief.push(klass.name);
    rows.push({ label: "반", value: subject ? `${klass.name} · ${subject}` : klass.name });
  } else if (subject) {
    rows.push({ label: "과목", value: subject });
  }

  const date = shortDate(m.date) ?? shortDate(m.planDate);
  const time = clock(m.slotStart);
  if (date) {
    brief.push(time ? `${date} ${time}` : date);
    rows.push({ label: "날짜", value: time ? `${date} ${time} 교시` : date });
  }

  // 출결 상태만 한글로 — 다른 액션의 status(발송 상태 등)는 원문 enum이라 싣지 않는다.
  if (action.startsWith("attendance") || action.startsWith("seat_attendance")) {
    const st = str(m.status);
    const label = st && Object.hasOwn(STATUS_TEXT, st) ? STATUS_TEXT[st as AttendanceMark] : null;
    if (label) {
      const text = st === "excused" ? "결석(사유)" : label;
      brief.push(text);
      rows.push({ label: "출결", value: text });
    }
  }
  const count = typeof m.count === "number" && Number.isFinite(m.count) ? m.count : null;
  if (count !== null && !many.length) rows.push({ label: "건수", value: `${count}건` });

  return { brief, rows, href: sid && student ? `/students/${sid}` : null };
}

/** 조회할 id 모으기 — 허용 키에서만. */
export function factIds(metadata: unknown): { students: string[]; classes: string[] } {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { students: [], classes: [] };
  const m = metadata as Record<string, unknown>;
  const s = str(m.studentId);
  const c = str(m.classId);
  return { students: [...(s ? [s] : []), ...ids(m.studentIds).slice(0, 5)], classes: c ? [c] : [] };
}
