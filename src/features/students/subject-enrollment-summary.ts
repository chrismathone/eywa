/** 과목별 학생 집합을 정확한 수강 조합으로 나눈다. 같은 과목의 여러 반은 한 번만 센다. */
export function subjectEnrollmentSummary(
  bySubject: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const subjectsByStudent = new Map<string, string[]>();
  for (const [subject, ids] of bySubject) {
    for (const id of ids) {
      const subjects = subjectsByStudent.get(id) ?? [];
      subjects.push(subject);
      subjectsByStudent.set(id, subjects);
    }
  }
  const groups = new Map<string, { subjects: string[]; value: number }>();
  let concurrent = 0;
  for (const subjects of subjectsByStudent.values()) {
    subjects.sort();
    if (subjects.length > 1) concurrent++;
    const key = JSON.stringify(subjects);
    const group = groups.get(key) ?? { subjects, value: 0 };
    group.value++;
    groups.set(key, group);
  }
  return {
    concurrent,
    combinations: [...groups.values()].sort(
      (a, b) =>
        b.value - a.value || a.subjects.join().localeCompare(b.subjects.join()),
    ),
  };
}
