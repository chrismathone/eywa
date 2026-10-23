import type { ImportedReport } from "./source-parser";
import { archiveClass, archiveName, archiveSchool, foldArchiveText as fold } from "./archive-normalize";
export type MatchStudent = { id: string; name: string; school: string | null; grade: string | null; status: string; withdrawn_at: string | null; courses: { className: string; subject: string }[] };
const baseName = (s: string) => archiveName(s).replace(/(?<=[가-힣])[a-z]$/, "");
const level = (s: string) => { const m = fold(s).match(/(초|중|고)(?:등학교|학교)?([1-6])/); return m ? ({ 초: 0, 중: 6, 고: 9 }[m[1] as "초" | "중" | "고"] + Number(m[2])) : null; };
export function matchArchive(r: ImportedReport, students: MatchStudent[], today: string) {
  if (!r.studentName.trim()) return { studentId: null, reason: "이름 미기재", candidates: [] };
  const tabDate = r.sheetTitle.match(/^(\d{2})\.(\d{2})/);
  const dateConflict = !!r.exitDate && !!tabDate && Math.abs(Number(r.exitDate.slice(0, 4)) - Number(`20${tabDate[1]}`)) > 1;
  const sourceDate = r.exitDate ?? (tabDate ? `20${tabDate[1]}-${tabDate[2]}-01` : null);
  const sourceLevel = level(r.schoolGrade) ?? level(r.studentName.split(/\r?\n/).slice(1).join(" "));
  const bareGrade = fold(r.schoolGrade).match(/^([1-6])(?:학년)?$/);
  const possibleLevels = sourceLevel !== null ? [sourceLevel] : bareGrade ? [0, 6, 9].filter(offset => offset === 0 || Number(bareGrade[1]) <= 3).map(offset => offset + Number(bareGrade[1])) : [];
  const prefixSubject = fold(r.className).match(/^(?:초등|중등|고등|중고)([em])/)?.[1];
  const sourceSubject = r.subject ?? (prefixSubject === "e" ? "english" : prefixSubject === "m" ? "math" : null);
  const candidates = students.filter(s => baseName(s.name) === baseName(r.studentName)).map(s => {
    const sourceSchool = archiveSchool(r.schoolGrade);
    const targetSchool = archiveSchool(s.school ?? "");
    const schoolMatch = !!sourceSchool && !!targetSchool && sourceSchool === targetSchool;
    const sourceClass = archiveClass(r.className);
    const classMatch = !!sourceClass && s.courses.some(c => (!sourceSubject || c.subject === sourceSubject) && archiveClass(c.className) === sourceClass);
    const targetLevel = level(s.grade ?? "");
    const anchor = s.status === "withdrawn" && s.withdrawn_at ? s.withdrawn_at : today;
    const schoolYear = (d: string) => Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 3 ? 1 : 0);
    const shifts = sourceDate ? [schoolYear(anchor) - schoolYear(sourceDate), schoolYear(today) - schoolYear(sourceDate)] : [];
    const gradeConflict = possibleLevels.length > 0 && targetLevel !== null && !possibleLevels.some(l => targetLevel === l || shifts.some(shift => targetLevel === l + shift));
    const schoolConflict = !!sourceSchool && !!targetSchool && !schoolMatch && !classMatch;
    const dateMatch = !!s.withdrawn_at && !!r.exitDate && Math.abs(Date.parse(s.withdrawn_at) - Date.parse(r.exitDate)) <= 7 * 86400000;
    const exactName = archiveName(s.name) === archiveName(r.studentName);
    return { id: s.id, name: s.name, school: s.school, grade: s.grade, exactName, schoolMatch, classMatch, dateMatch, schoolConflict, gradeConflict, conflict: schoolConflict || (gradeConflict && !classMatch), score: (schoolMatch ? 3 : 0) + (classMatch ? 4 : 0) + (dateMatch ? 2 : 0) + (exactName ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);
  const hasExplicitSuffix = /[가-힣][a-z]$/.test(archiveName(r.studentName));
  const valid = candidates.filter(c => !c.conflict && (!hasExplicitSuffix || c.exactName));
  const first = valid[0];
  const confident = !dateConflict && first && (valid.length === 1 && (first.exactName || first.schoolMatch || first.classMatch) || first.score >= 4 && first.score - valid[1].score >= 2 && (first.schoolMatch || first.classMatch));
  return { studentId: confident ? first.id : null, reason: dateConflict ? "원본 퇴원일과 보고서 월 재확인" : confident ? "이름·학교·반·학년·퇴원일 대조" : candidates.length ? "동명이인 또는 신원 정보 재확인" : "학생 기록 없음", candidates };
}
