/**
 * 출석부 행 정렬 — 순수 함수(Vitest). 원장 지시 2026-08-06.
 *
 * 🔴 **화면 렌더 순서와 격자 좌표 순서는 반드시 같은 함수에서 나와야 한다.** 격자의 방향키·Shift 범위·
 *    드래그 채우기는 `rows` 배열의 인덱스로 움직이는데(grid/model.ts), 표를 다르게 정렬해 그리면
 *    "아래 화살표를 눌렀는데 엉뚱한 학생 칸으로 뛴다". 그래서 정렬은 여기 한 곳만 거친다
 *    (page.tsx가 이 결과를 buildGridSource와 MatrixTable **양쪽에** 넘긴다).
 *
 * 정렬 4종:
 *  · `class`  — 반별(기본). 유일하게 **반 그룹 머리행을 유지**한다.
 *  · `name`   — 가나다순. 반 구분이 사라지고 한 덩어리로 섞인다(원장: "반구분 없어지고 가나다 정리").
 *  · `grade`  — 학년순 초→중→고.
 *  · `role`   — 담임 먼저, 부담임 나중(담임 판정은 teacher-role.ts).
 */

import { isPreschoolGrade } from "@/lib/format/school-grade";

import type { TeacherRole } from "./teacher-role";

export type AttendanceSortKey = "class" | "name" | "grade" | "role";

export const ATTENDANCE_SORT_KEYS: AttendanceSortKey[] = ["class", "name", "grade", "role"];

export const ATTENDANCE_SORT_LABEL: Record<AttendanceSortKey, string> = {
  class: "반별",
  name: "가나다순",
  grade: "학년순",
  role: "담임·부담임순",
};

/** 반 그룹 머리행을 그리는 정렬인가 — 반별일 때만. 나머지는 한 덩어리(평면). */
export function isGroupedSort(key: AttendanceSortKey): boolean {
  return key === "class";
}

export function parseAttendanceSortKey(raw: unknown): AttendanceSortKey {
  return ATTENDANCE_SORT_KEYS.includes(raw as AttendanceSortKey) ? (raw as AttendanceSortKey) : "class";
}

/**
 * 학년 문자열 → 정렬 키. 초(1~6) → 중(1~3) → 고(1~3) 순.
 *
 * ⚠️ 학년은 학원설정 enum이 아니라 **students.grade 자유 문자열**이다(임포트본에 "고1"·"중3"·"초5" 혼재).
 *    그래서 설정을 읽지 않고 표기에서 급간을 읽는다 — 모르는 값은 **맨 뒤**로 보내되 버리지 않는다
 *    (숨기면 그 학생이 출석부에서 사라진다).
 */
export function gradeOrder(grade: string | null | undefined): number {
  if (!grade) return 9000;
  const s = grade.trim();
  // 미취학(7세·6세)은 모르는 표기가 아니라 학년 흐름의 **시작**이다 — 초1 앞으로(2026-08-18).
  if (isPreschoolGrade(s)) return 500 + (Number(s.replace(/[^0-9]/g, "")) || 0);
  const band = s.startsWith("초") ? 1000 : s.startsWith("중") ? 2000 : s.startsWith("고") ? 3000 : 0;
  const n = Number(s.replace(/[^0-9]/g, ""));
  if (band === 0) return 9000; // 초·중·고가 아닌 표기(성인반 등) — 뒤로, 이름순으로 안정 정렬된다.
  return band + (Number.isFinite(n) ? n : 0);
}

/** 담임 먼저(0) → 부담임(1) → 판정 불가(2). 판정 불가를 중간에 끼우지 않는다(모르는 건 뒤). */
function roleOrder(role: TeacherRole): number {
  return role === "primary" ? 0 : role === "assistant" ? 1 : 2;
}

/** 정렬 입력 — 반·학생 최소 정보만. (매트릭스 전체를 넘기지 않아 테스트가 가볍다.) */
export type SortableRow = {
  classId: string;
  className: string;
  studentId: string;
  name: string;
  grade: string | null;
  /** 이 학생에 대한 **보는 사람**의 역할(teacher-role.ts). 반별·가나다·학년 정렬에선 안 쓴다. */
  role: TeacherRole;
};

/**
 * 정렬 적용 — 항상 **새 배열**을 돌려준다(입력 불변).
 * ⚠️ 모든 정렬의 최종 tie-break는 이름(ko) → studentId다. 안 그러면 같은 값끼리 순서가 매 요청 흔들려
 *    방향키 위치가 새로고침마다 바뀐다.
 */
export function sortAttendanceRows<T extends SortableRow>(
  rows: readonly T[],
  key: AttendanceSortKey,
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "ko") || a.studentId.localeCompare(b.studentId);
  const out = [...rows];
  // 반별 = **입력 순서 그대로**(반 묶음·반 내 순서 모두 서버 쿼리가 정한 것). 여기서 손대면 지금 화면이 바뀐다.
  // ⚠️ "그룹 간엔 0, 그룹 안에선 이름순" 같은 비교자를 쓰지 말 것 — 비이행적이라 정렬 결과가 깨진다.
  if (key === "class") return out;
  if (key === "name") return out.sort(byName);
  if (key === "grade") return out.sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || byName(a, b));
  return out.sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || byName(a, b));
}
