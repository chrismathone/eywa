import { goalMilestones, type LearningGoal, type LearningProgress } from "../lib/learning-plan";
import { learningBlockLabel } from "../lib/learning-label";
import styles from "./learning-overview.module.css";

/** Labels live in wrapping cells, never at percentage positions on the rail. */
export function LearningMilestones({ goal, progress }: { goal: LearningGoal; progress?: LearningProgress }) {
  return (
    <ol className={styles.milestones} aria-label="목표 정거장">
      {goalMilestones(goal).map((stop, index) => {
        const done = (progress?.current ?? -1) >= stop.blockCount;
        return (
          <li key={index} data-reached={done || undefined}>
            <span className={styles.stopNumber}>{index + 1}</span>
            <div>
              <strong>{index + 1}차 목표</strong>
              <p>{learningBlockLabel(stop.endBlock, stop.studyGrade)}</p>
              <small>{stop.endDate} · 누적 {stop.blockCount}블록{done ? " · 도달" : ""}</small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
