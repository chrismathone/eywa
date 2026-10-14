import type { ImportedReport } from "./source-parser";
export type MatchStudent = { id: string; name: string; school: string | null; grade: string | null; status: string; withdrawn_at: string | null; courses: { className: string; subject: string }[] };
const fold = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const baseName = (s: string) => fold(s).replace(/[a-z]$/, "");
const school = (s: string) => fold(s).replace(/초등학교/g, "초").replace(/중학교/g, "중").replace(/고등학교/g, "고").replace(/학교/g, "").replace(/(초|중|고)[1-6].*$/, "$1");
const level = (s: string) => { const m = fold(s).match(/(초|중|고)([1-6])/); return m ? ({ 초: 0, 중: 6, 고: 9 }[m[1] as "초" | "중" | "고"] + Number(m[2])) : null; };
export function matchArchive(r: ImportedReport, students: MatchStudent[], today: string) {
  if (!r.studentName.trim()) return { studentId: null, reason: "이름 미기재", candidates: [] };
  const candidates = students.filter(s => baseName(s.name) === baseName(r.studentName)).map(s => {
    const parsedSchool = school(r.schoolGrade);
    const sourceSchool = /^(초|중|고)$/.test(parsedSchool) ? "" : parsedSchool;
    const targetSchool = school(s.school ?? "");
    const schoolMatch = !!sourceSchool && !!targetSchool && sourceSchool === targetSchool;
    const classMatch = !!r.className && s.courses.some(c => (!r.subject || c.subject === r.subject) && fold(c.className) === fold(r.className));
    const sourceLevel = level(r.schoolGrade), targetLevel = level(s.grade ?? "");
    const anchor = s.status === "withdrawn" && s.withdrawn_at ? s.withdrawn_at : today;
    const schoolYear = (d: string) => Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 3 ? 1 : 0);
    const tabDate = r.sheetTitle.match(/^(\d{2})\.(\d{2})/);
    const sourceDate = r.exitDate ?? (tabDate ? `20${tabDate[1]}-${tabDate[2]}-01` : null);
    const shifts = sourceDate ? [schoolYear(anchor) - schoolYear(sourceDate), schoolYear(today) - schoolYear(sourceDate)] : [];
    const gradeConflict = sourceLevel !== null && targetLevel !== null && targetLevel !== sourceLevel && !shifts.some(shift => targetLevel === sourceLevel + shift);
    const schoolConflict = !!sourceSchool && !!targetSchool && !schoolMatch && !classMatch;
    const dateMatch = !!s.withdrawn_at && !!r.exitDate && Math.abs(Date.parse(s.withdrawn_at) - Date.parse(r.exitDate)) <= 7 * 86400000;
    const exactName = fold(s.name) === fold(r.studentName);
    return { id: s.id, name: s.name, school: s.school, grade: s.grade, exactName, schoolMatch, classMatch, dateMatch, conflict: schoolConflict || (gradeConflict && !classMatch), score: (schoolMatch ? 3 : 0) + (classMatch ? 4 : 0) + (dateMatch ? 2 : 0) + (exactName ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);
  const valid = candidates.filter(c => !c.conflict);
  const first = valid[0];
  const confident = first && (valid.length === 1 && (first.exactName || first.schoolMatch || first.classMatch) || first.score >= 4 && first.score - valid[1].score >= 2 && (first.schoolMatch || first.classMatch));
  return { studentId: confident ? first.id : null, reason: confident ? "이름·학교·반·학년·퇴원일 대조" : candidates.length ? "동명이인 또는 신원 정보 재확인" : "학생 기록 없음", candidates };
}
