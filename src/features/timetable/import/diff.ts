// 수강편집 시트 ↔ 현재 DB 상태 diff — 순수 함수. 추가/삭제/이동/무변경 분류 + 경고.
// enrollmentId로 앵커되므로 행 순서·셀 위치에 무관(ijw zone 추론보다 견고).

import { matchClass, matchStudent, norm } from "./match";
import type {
  ClassRef,
  EnrollmentSnapshotRow,
  ImportDiff,
  ParsedEditRow,
  StudentRef,
} from "./types";

export function computeImportDiff(
  parsed: ParsedEditRow[],
  current: EnrollmentSnapshotRow[],
  classes: ClassRef[],
  students: StudentRef[],
  opts?: {
    /**
     * 구글 시트 경로 stale-drift 보호 — 이 시각(보통 시트 push=last_synced_at) 이후 **시작된** 수강은
     * 시트가 알 수 없으므로 '삭제'로 잡지 않는다. 날짜(YYYY-MM-DD)만 비교. 파일 경로는 미전달(보호 없음).
     */
    protectNewerThan?: string | null;
  },
): ImportDiff {
  const diff: ImportDiff = { moves: [], removes: [], adds: [], unchanged: 0, warnings: [] };
  const cutoffDate = opts?.protectNewerThan ? opts.protectNewerThan.slice(0, 10) : null;

  const currentById = new Map(current.map((c) => [c.enrollmentId, c]));
  const seen = new Set<string>();

  for (const row of parsed) {
    if (row.enrollmentId) {
      const cur = currentById.get(row.enrollmentId);
      if (!cur) {
        diff.warnings.push(`알 수 없는 수강 ID(${row.enrollmentId}) — 다른 시점 파일일 수 있음`);
        continue;
      }
      seen.add(row.enrollmentId);
      // 반이름 변경 없음 → 무변경
      if (norm(row.className) === norm(cur.className)) {
        diff.unchanged += 1;
        continue;
      }
      const m = matchClass(row.className, classes);
      if (m.status === "none") {
        diff.warnings.push(`"${row.studentName}"의 대상 반 "${row.className}"을 찾을 수 없음`);
        continue;
      }
      if (m.status === "ambiguous") {
        diff.warnings.push(`대상 반 "${row.className}"이 모호함(동명이반)`);
        continue;
      }
      diff.moves.push({
        enrollmentId: cur.enrollmentId,
        studentName: cur.studentName,
        fromClassName: cur.className,
        toClassName: row.className,
        toClassId: m.value,
      });
    } else {
      // 신규 추가 행
      if (!norm(row.studentName) || !norm(row.className)) continue; // 빈 행 무시
      const cls = matchClass(row.className, classes);
      const stu = matchStudent(row.studentName, row.school, row.grade, students);
      if (cls.status !== "ok") {
        diff.warnings.push(`신규 행 반 "${row.className}" ${cls.status === "none" ? "없음" : "모호"}`);
        continue;
      }
      if (stu.status !== "ok") {
        diff.warnings.push(
          `신규 학생 "${row.studentName}" ${stu.status === "none" ? "미매칭" : "동명이인 모호"}`,
        );
        continue;
      }
      diff.adds.push({
        studentName: row.studentName,
        school: row.school,
        grade: row.grade,
        className: row.className,
        classId: cls.value,
        studentId: stu.value,
      });
    }
  }

  // 시트에서 사라진 기존 수강 → 삭제
  for (const cur of current) {
    if (seen.has(cur.enrollmentId)) continue;
    // 시트 생성 시점 이후 시작된 수강은 시트가 알 수 없음 → 삭제 후보에서 제외(stale-drift 보호).
    if (cutoffDate && cur.startDate && cur.startDate.slice(0, 10) > cutoffDate) {
      diff.warnings.push(
        `"${cur.studentName}"(${cur.className})은 시트 생성 이후 등록돼 삭제하지 않았습니다(시트가 모르는 신규).`,
      );
      continue;
    }
    diff.removes.push({
      enrollmentId: cur.enrollmentId,
      studentName: cur.studentName,
      className: cur.className,
    });
  }

  return diff;
}

/** 변경 총건수(미리보기 대량변경 경고용). */
export function totalChanges(d: ImportDiff): number {
  return d.moves.length + d.removes.length + d.adds.length;
}
