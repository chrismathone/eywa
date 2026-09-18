import { goalMilestones, learningTopicPositions, type LearningGoal, type LearningProgress } from "./learning-plan";
import { learningTopicIndex } from "./learning-path";

/** Each numbered goal occupies one unit; progress within that goal is fractional. */
export function learningAxisPosition(block: number, stops: readonly { blockCount: number }[]): number {
  if (!Number.isFinite(block) || block <= 0) return 0;
  let previous = 0;
  for (const [index, stop] of stops.entries()) {
    if (block <= stop.blockCount) return index + (block - previous) / (stop.blockCount - previous);
    previous = stop.blockCount;
  }
  return stops.length;
}

export function learningAxisLabel(position: number): string {
  return String(Math.round(position * 100) / 100);
}

/** Each minor interval is one teaching block, even when goals span different amounts of work. */
export function learningAxisTicks(stops: readonly { blockCount: number }[]): { block: number; position: number; goal: boolean }[] {
  const ticks: { block: number; position: number; goal: boolean }[] = [];
  let previous = 0;
  for (const [index, stop] of stops.entries()) {
    for (let block = previous + 1; block <= stop.blockCount; block++) {
      ticks.push({ block, position: index + (block - previous) / (stop.blockCount - previous), goal: block === stop.blockCount });
    }
    previous = stop.blockCount;
  }
  return ticks;
}

/** One tick per lesson in every track, including lessons at integer block positions. */
export function learningTopicTicks(goal: LearningGoal) {
  const stops = goalMilestones(goal);
  return learningTopicPositions(goal).map((topic) => ({
    ...topic, position: learningAxisPosition(topic.block, stops),
  }));
}

/** The curriculum ruler shows a lesson's location, including in classes that count review days. */
export function learningCurrentPosition(goal: LearningGoal, progress: LearningProgress | undefined, topics = learningTopicTicks(goal)): number | null {
  const index = learningTopicIndex(progress?.currentBlock ?? null, topics);
  if (index != null) return topics[index].position;
  // A review-day count says nothing about which curriculum lesson was reached.
  if (goal.track === "supplement" || progress?.current == null) return null;
  return learningAxisPosition(progress.current, goalMilestones(goal));
}
