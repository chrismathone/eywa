import { CURRICULUM_GRADES, flatLessons, semesterOfLesson, splitLessons } from "@/features/onescreen/curriculum";
import { MATH_LEARNING_CADENCE } from "@/features/progress/learning-cadence";

export type LearningMilestone = {
  studyGrade: string;
  endBlock: string;
  endDate: string;
  /** Cumulative teaching blocks; earlier milestones keep their original allocation. */
  blockCount: number;
};
export type LearningRange = {
  studyGrade: string;
  endStudyGrade?: string;
  startBlock: string;
  endBlock: string;
  milestones?: LearningMilestone[];
  track?: "regular" | "supplement";
};
export type LearningTopic = { grade: string; lesson: string; semester: number };

const core = CURRICULUM_GRADES.filter((grade) => /^[초중]/.test(grade)).concat("공통수학1", "공통수학2");
// High-school electives are branches, not a single mandatory sequence.
const prerequisites: Record<string, string[]> = {
  대수: ["대수"],
  미적분Ⅰ: ["대수", "미적분Ⅰ"],
  미적분Ⅱ: ["대수", "미적분Ⅰ", "미적분Ⅱ"],
  "확률과 통계": ["확률과 통계"],
  기하: ["기하"],
};

export function learningCoursePath(start: string, end: string): string[] {
  if (!CURRICULUM_GRADES.includes(start) || !CURRICULUM_GRADES.includes(end)) return [];
  if (start === end) return [start];
  const path = [...core, ...(prerequisites[end] ?? [])];
  const from = path.indexOf(start), to = path.indexOf(end);
  if (from >= 0 && to > from) return path.slice(from, to + 1);
  // Moving between elective subjects must be explicit; never insert unrelated electives.
  if (!core.includes(start) && !core.includes(end) && !prerequisites[start]?.includes(end)) return [start, end];
  return [];
}

function intervalTopics(range: LearningRange): LearningTopic[] {
  const endGrade = range.endStudyGrade ?? range.studyGrade;
  const courses = learningCoursePath(range.studyGrade, endGrade);
  const topics = courses.flatMap((grade) => flatLessons(grade).map((lesson) => ({ grade, lesson, semester: semesterOfLesson(grade, lesson) })));
  const from = topics.findIndex((topic) => topic.grade === range.studyGrade && topic.lesson === range.startBlock);
  const to = topics.findIndex((topic) => topic.grade === endGrade && topic.lesson === range.endBlock);
  return from < 0 || to < from ? [] : topics.slice(from, to + 1);
}

export function learningTopics(range: LearningRange): LearningTopic[] {
  if (!range.milestones?.length) return intervalTopics(range);
  const topics: LearningTopic[] = [];
  let grade = range.studyGrade, lesson = range.startBlock;
  for (const [index, milestone] of range.milestones.entries()) {
    const interval = intervalTopics({ studyGrade: grade, startBlock: lesson, endStudyGrade: milestone.studyGrade, endBlock: milestone.endBlock });
    const added = index === 0 ? interval : interval.slice(1);
    if (!added.length) return [];
    topics.push(...added);
    grade = milestone.studyGrade; lesson = milestone.endBlock;
  }
  return topics;
}

export function topicSegments(topics: LearningTopic[]): LearningTopic[][] {
  const segments: LearningTopic[][] = [];
  for (const topic of topics) {
    const previous = segments.at(-1);
    if (previous?.[0].grade === topic.grade && previous[0].semester === topic.semester) previous.push(topic);
    else segments.push([topic]);
  }
  return segments;
}

export function regularBlockCount(range: LearningRange): number {
  return topicSegments(learningTopics(range)).length * MATH_LEARNING_CADENCE.regular.totalBlocks;
}

export function courseRangeLabel(range: LearningRange): string {
  const end = range.endStudyGrade ?? range.studyGrade;
  return end === range.studyGrade ? range.studyGrade : `${range.studyGrade} → ${end}`;
}

/** Ambiguous unqualified lessons never jump to a later course. */
export function learningTopicIndex(progress: string | null, topics: LearningTopic[]): number | null {
  let best: number | null = null;
  for (const line of splitLessons(progress)) {
    let candidate = line.replace(/^\d+\.\s*/, "").trim();
    let explicitGrade: string | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const grade = CURRICULUM_GRADES.find((value) => candidate.startsWith(`${value} `));
      if (grade) {
        explicitGrade = grade;
        candidate = candidate.slice(grade.length).trim();
      }
      const matches = topics.flatMap((topic, index) => topic.lesson === candidate && (!explicitGrade || topic.grade === explicitGrade) ? [index] : []);
      if (matches.length === 1) { best = Math.max(best ?? -1, matches[0]); break; }
      if (matches.length > 1) break;
      const space = candidate.indexOf(" ");
      if (space < 0) break;
      candidate = candidate.slice(space + 1).trim();
    }
  }
  return best;
}
