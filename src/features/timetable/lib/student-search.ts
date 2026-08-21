/**
 * 시간표 **학생 검색** — 판정 재료를 만드는 순수 함수(Vitest).
 *
 * 원장 지시 2026-08-20: *"시간표에도 학생 검색 기능 추가. 학생 검색하면 해당 학생이 존재하는 수업만
 * 노출되도록."* 반이 100개 가까이 깔린 주간표에서 "이 아이가 어느 반에 있나"를 눈으로 훑어야 했다.
 *
 * 🔴 **정규화·매칭은 출석부와 같은 함수**([`student-search.ts`](../../attendance/student-search.ts))를 쓴다.
 *    여기서 새 정규화를 만들면 같은 이름을 출석부에선 찾고 시간표에선 못 찾는 복불복이 된다.
 *    이 파일이 더하는 건 **"무엇을 검색 재료로 볼까"(필드 선정)와 "반 단위 색인"** 둘뿐이다.
 * 🔴 **화면에 이미 그려진 값만 본다** — 학생 전체를 뒤지는 조회를 새로 붙이지 않는다. 강사는 담당 반만
 *    보는데 검색이 그 범위를 넓히면 열람 범위를 뚫는 뒷문이 된다([[#77]]).
 * 🔑 검색 단위 = **반(classId)**. 시간표의 한 칸은 반이고, 같은 반이 여러 칸(요일·교시)에 나오므로
 *    색인을 칸이 아니라 반으로 잡아야 셀·카드·칩 세 뷰가 같은 답을 본다.
 * ⚠️ 초성 검색(ㄱㄷ)은 이번에도 범위 밖 — 넣게 되면 출석부와 공유하는 그 파일 한 곳만 고친다.
 */

import {
  isSearchActive,
  matchesStudentSearch,
  type StudentSearchFields,
} from "@/features/attendance/student-search";
import { schoolGradeLabel } from "@/lib/format/school-grade";

/** 검색 재료로 쓰는 학생 필드 — 시간표 셀이 실제로 그리는 것만(StudentLine이 구조적으로 만족). */
export type TimetableSearchStudent = {
  name: string;
  school?: string | null;
  grade?: string | null;
  /** 영문 이름 — 행에는 없지만 hover 카드(StudentInfoCard)가 그린다. 영어과가 이 이름으로 부른다. */
  englishName?: string | null;
};

/**
 * 학생 한 명이 검색에 내놓는 값 — **색인(칸 숨김)과 강조(이름 반전)가 이 함수 하나를 공유한다.**
 * 두 곳이 다른 필드를 보면 "칸은 떴는데 강조된 이름이 없다"(또는 그 반대)가 생긴다.
 *
 * `schoolGradeLabel`은 화면에 붙어 그려지는 압축 표기("경명여중2") — 친 그대로 걸려야 한다
 * (셀은 `metaLabel`, 통합뷰는 `schoolGradeLabel`인데 둘 다 같은 `formatSchoolGrade(numberLast)`다).
 */
export function studentSearchFields(s: TimetableSearchStudent): StudentSearchFields {
  return [s.name, s.school, s.grade, schoolGradeLabel(s.school, s.grade), s.englishName];
}

/** 반 하나가 들고 있는 검색 재료 — 값은 중복 제거(같은 학교·학년이 명단에 여러 번 나온다). */
export type TimetableSearchClass = { classId: string; fields: string[] };

/** 색인 입력 — `ScheduleSlotWithStudents`가 구조적으로 만족(서버 타입 직접 import 회피, [[#61]]). */
export type TimetableSearchSlot = {
  classId?: string | null;
  students?: readonly TimetableSearchStudent[];
};

/**
 * 슬롯 배열 → **반 단위** 색인. 같은 반의 여러 슬롯(요일·교시)은 한 항목으로 합친다.
 *
 * ⚠️ `classId`가 없는 항목(강사뷰의 비수업 블록 — 감독·준비·회의·연차)은 반이 아니라서 건너뛴다.
 *    세면 "수업 수"가 부풀고, 검색으로 남길 대상도 아니다.
 */
export function buildTimetableSearchIndex(
  slots: readonly TimetableSearchSlot[],
): TimetableSearchClass[] {
  const byClass = new Map<string, Set<string>>();
  for (const slot of slots) {
    const classId = slot.classId;
    if (!classId) continue;
    let fields = byClass.get(classId);
    if (!fields) {
      fields = new Set<string>();
      byClass.set(classId, fields);
    }
    for (const student of slot.students ?? []) {
      for (const f of studentSearchFields(student)) {
        const v = (f ?? "").trim();
        if (v) fields.add(v);
      }
    }
  }
  return [...byClass].map(([classId, fields]) => ({ classId, fields: [...fields] }));
}

/**
 * 검색어에 걸리는 반 id들.
 *
 * 🔴 검색어가 비면 **빈 집합**이다(`matchesStudentSearch`는 빈 검색어에 항상 참이라 그대로 쓰면 전 반이
 *    걸린다). 호출부는 "지금 걸려 있나"를 `isSearchActive`로 따로 묻고, 안 걸렸으면 이 집합을 보지 않는다.
 */
export function matchedClassIds(
  index: readonly TimetableSearchClass[],
  query: string,
): Set<string> {
  const out = new Set<string>();
  if (!isSearchActive(query)) return out;
  for (const c of index) if (matchesStudentSearch(query, c.fields)) out.add(c.classId);
  return out;
}

/**
 * 0건 안내가 말할 **범위** — "이번 주 수학 특강 시간표". 왜 비었는지는 범위로 말하고 권한 이야기는
 * 하지 않는다(검색은 이미 보고 있던 화면만 좁힌다).
 * 빈 조각(null·공백)은 버린다 — 정규 구분처럼 말할 게 없는 축은 문장에서 사라지는 게 맞다.
 */
export function timetableSearchScope(parts: readonly (string | null | undefined)[]): string {
  return [...parts.map((p) => (p ?? "").trim()).filter(Boolean), "시간표"].join(" ");
}
