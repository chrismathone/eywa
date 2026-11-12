import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth/require-access";
import { EmbedLink } from "@/components/embed-link";
import { getMathTeacherRoster, type TeacherStudentRow } from "@/features/math-sheets/server/teacher-roster";
import { McsViewSwitch } from "@/features/math-sheets/components/mcs-view-switch";
import { roadmapStatusLabel } from "@/features/math-sheets/lib/roadmap-status";
import { averageProgress } from "@/features/math-sheets/lib/teacher-average";
import styles from "./teachers.module.css";

export const metadata: Metadata = { title: "수학 강사 시트 · 선생님별 — 에이와" };

/**
 * MCS **선생님별 보기** — 선생님마다 맡은 학생과 지금 교재 3개월 진행(두 권 · 나간 차시/전체).
 * 학생을 누르면 그 반 시트의 학생 집중 보기로 간다(원장 2026-10-20 *"클릭하면 상세로 보이게"*).
 */
export default async function McsTeachersPage() {
  await requireAccess("mcs");
  const res = await getMathTeacherRoster();
  return (
    <div className={styles.surface}>
      <header className={styles.heading}>
        <div>
          <h2>수학 강사 시트 · 선생님별</h2>
          <p>{res.ok && !res.textbooksOn ? "선생님이 맡은 학생입니다. 학생을 누르면 상세가 열립니다." : "선생님이 맡은 학생과 교재 3개월 진행입니다. 학생을 누르면 상세가 열립니다."}</p>
        </div>
        <McsViewSwitch active="teachers" />
      </header>
      {!res.ok ? (
        <p className={styles.empty}>{res.error}</p>
      ) : res.groups.length === 0 ? (
        <p className={styles.empty}>담당하는 수학 반 학생이 없습니다.</p>
      ) : (
        <>
          {res.textbooksOn ? <Average label="전체 평균" students={res.groups.flatMap((g) => g.students)} /> : null}
          {/* 선생님이 많아 처음엔 **접어 둔다**(원장 *"접기기능으로 휠 안내려도 다른쌤 볼수있도록"*) — 머리 줄만으로
              이름·학생 수·평균이 보이고, 누르면 학생 목록이 펼쳐진다. */}
          <div className={styles.groups}>
            {res.groups.map((g) => (
              <details key={g.teacherName} className={styles.group}>
                <summary>
                  <h3>{g.teacherName}</h3>
                  <span>학생 {g.students.length}명</span>
                  {res.textbooksOn ? <Average students={g.students} /> : null}
                  <i aria-hidden>›</i>
                </summary>
                <ul>
                  {g.students.map((s) => <Row key={s.studentId} s={s} textbooksOn={res.textbooksOn} />)}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 평균 진행률(3개월 기준) — 진도를 읽은 학생만으로 낸 평균이라 몇 명 기준인지 같이 적는다. */
function Average({ students, label }: { students: readonly TeacherStudentRow[]; label?: string }) {
  const { pct, counted } = averageProgress(students);
  return (
    <span className={label ? styles.total : styles.avg} title={pct == null ? "진도를 읽은 학생이 없습니다" : `진도를 읽은 ${counted}명의 3개월 진행률 평균`}>
      {label ? <small>{label}</small> : null}
      <b>{pct == null ? "—" : `${pct}%`}</b>
      {pct == null ? null : <small>{counted}명 기준</small>}
      {pct == null ? null : <span className={styles.bar}><i style={{ width: `${pct}%` }} /></span>}
    </span>
  );
}

function Row({ s, textbooksOn }: { s: TeacherStudentRow; textbooksOn: boolean }) {
  const w = s.window;
  const pct = w && w.done != null ? Math.round((w.done / Math.max(1, w.total)) * 100) : null;
  return (
    <li>
      <EmbedLink href={`/mcs/${s.classId}/month?student=${s.studentId}`} className={`${styles.row} ${textbooksOn ? "" : styles.rowNoTextbooks}`}>
        <span className={styles.who}>
          <strong>{s.name}{s.bookName ? <em className={styles.bookName}>{s.bookName}</em> : null}</strong>
          <small>{[s.school, s.grade].filter(Boolean).join(" ")} · {s.className}</small>
        </span>
        {textbooksOn && w ? (
          <span className={styles.book} title={w.name}>
            <span className={styles.count}><b>{w.done ?? "—"}</b>/{w.total}차시<small>3개월 기준</small></span>
            <span className={styles.bar}><i style={{ width: `${pct ?? 0}%` }} /></span>
          </span>
        ) : textbooksOn ? (
          <span className={styles.none}>교재 주문 기록 없음</span>
        ) : null}
        {textbooksOn ? (
          <span className={styles.status} data-tone={s.status ?? undefined}>
            {s.status ? roadmapStatusLabel({ status: s.status, difference: s.difference }) : "—"}
          </span>
        ) : null}
        <span className={styles.arrow} aria-hidden>›</span>
      </EmbedLink>
    </li>
  );
}
