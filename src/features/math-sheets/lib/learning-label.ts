import { CURRICULUM_GRADES, flatLessons, semesterOfLesson, splitLessons } from "@/features/onescreen/curriculum";

const lessonCourses = new Map<string, { grade: string; semester: number }[]>();
for (const grade of CURRICULUM_GRADES) {
  for (const lesson of flatLessons(grade)) {
    const courses = lessonCourses.get(lesson) ?? [];
    courses.push({ grade, semester: semesterOfLesson(grade, lesson) });
    lessonCourses.set(lesson, courses);
  }
}

/** Display only: keep stored lesson names intact and omit the redundant subject prefix. */
export function learningBlockLabel(block: string, studyGrade?: string | null): string {
  return splitLessons(block).map((line) => {
    let lesson = line.replace(/^\d+\.\s*/, "").replace(/^수학\s+/, "").trim();
    const explicitGrade = CURRICULUM_GRADES.find((grade) => lesson.startsWith(`${grade} `));
    if (explicitGrade) lesson = lesson.slice(explicitGrade.length).replace(/^\s*[·,]?\s*/, "").replace(/^수학\s+/, "");
    const courses = lessonCourses.get(lesson) ?? [];
    const course = explicitGrade
      ? courses.find(({ grade }) => grade === explicitGrade)
      : courses.length === 1 ? courses[0] : courses.find(({ grade }) => grade === studyGrade);
    const grade = course?.grade ?? explicitGrade ?? studyGrade;
    if (!grade) return lesson;
    const semester = course && /^[초중]/.test(grade) ? ` ${course.semester}학기` : "";
    return `${grade}${semester}, ${lesson}`;
  }).join(" / ");
}
