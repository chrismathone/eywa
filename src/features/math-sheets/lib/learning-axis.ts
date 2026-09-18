import { goalMilestones, type LearningGoal, type LearningProgress } from "./learning-plan";
import { learningCoursePath, learningTopicIndex, learningTopics, topicSegments, type LearningTopic } from "./learning-path";
import { flatLessons, semesterOfLesson } from "@/features/onescreen/curriculum";

/** The same physical spacing applies to every lesson, student, goal, and viewport. */
export const LEARNING_LESSON_WIDTH = 16;

/** Two previous semesters plus the current semester and the next three; electives stay explicit. */
export function learningTopicTicks(goal: LearningGoal, progress?: LearningProgress) {
  const courses = [...new Set([
    ...learningCoursePath("초1", "공통수학2"),
    ...learningCoursePath("초1", goal.studyGrade),
    ...learningTopics(goal).map(topic => topic.grade),
  ])];
  const full: LearningTopic[] = courses.flatMap(grade => flatLessons(grade).map(lesson => ({
    grade, lesson, semester: semesterOfLesson(grade, lesson),
  })));
  const currentIndex = learningTopicIndex(progress?.currentBlock ?? null, full);
  const anchorIndex = currentIndex ?? full.findIndex(topic => topic.grade === goal.studyGrade && topic.lesson === goal.startBlock);
  if (anchorIndex < 0) return [];
  const anchor = full[anchorIndex];
  const semesters = topicSegments(full);
  const semesterIndex = semesters.findIndex(topics => topics[0].grade === anchor.grade && topics[0].semester === anchor.semester);
  return semesters.slice(Math.max(0, semesterIndex - 2), semesterIndex + 4)
    .flatMap(topics => topics).map((topic, index) => ({ ...topic, position: index + 1 }));
}

export function learningGoalTicks(goal: LearningGoal, topics = learningTopicTicks(goal)) {
  const saved = goalMilestones(goal);
  return topicSegments(topics).map((semester, index) => {
    const last = semester.at(-1)!;
    const stop = saved.findLast(item => item.studyGrade === last.grade && semester.some(topic => topic.lesson === item.endBlock));
    const endBlock = stop?.endBlock ?? last.lesson;
    return {
      number: index + 1, studyGrade: last.grade, semester: last.semester, endBlock,
      position: topics.findIndex(topic => topic.grade === last.grade && topic.lesson === endBlock) + 1,
      endDate: stop?.endDate ?? null, blockCount: stop?.blockCount ?? null,
    };
  });
}

/** The curriculum ruler shows a lesson's location, including in classes that count review days. */
export function learningCurrentPosition(goal: LearningGoal, progress: LearningProgress | undefined, topics = learningTopicTicks(goal, progress)): number | null {
  const index = learningTopicIndex(progress?.currentBlock ?? null, topics);
  if (index != null) return topics[index].position;
  // Counts and plan boundaries say nothing about a lesson's position in this moving window.
  return null;
}
