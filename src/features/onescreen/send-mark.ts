import type { Subject } from "./types";
import { effectiveClassnoteStatus, isAlreadySent, isReportOptoutRow } from "./grid";

export type SendMark = { sent: number; total: number; label: string; overdue?: number; delivery?: boolean };
type Report = { sent?: boolean; classnoteStatus?: string | null };
type Lesson = { id: string; endTime?: string | null };

/** 같은 반에 여러 교시가 있으면 마지막 종료 시각까지 기다린다. 불완전한 시간표는 추측하지 않는다. */
export function lessonEndsByClass(rows: readonly { class_id: string; end_time: string | null }[]) {
  const ends = new Map<string, string | null>();
  for (const row of rows) {
    const time = row.end_time?.slice(0, 5);
    const valid = time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
    const previous = ends.get(row.class_id);
    ends.set(row.class_id, previous === null || !valid ? null : previous && previous > valid ? previous : valid);
  }
  return ends;
}

/** 실제 게시 결과만 발송으로 센다. 저장만 된 보고서·발송 대기·회수 완료는 초록 발송이 아니다. */
export function buildSendMark({ subjects, reports, delivery, label, date, now, lessons, showingAll = false }: {
  subjects: readonly Subject[];
  reports?: Record<string, Report | undefined>;
  delivery: boolean;
  label: string;
  date: string;
  /** KST YYYY-MM-DDTHH:mm. 초기 서버 렌더에서는 null. */
  now: string | null;
  lessons: readonly Lesson[];
  showingAll?: boolean;
}): SendMark {
  const rows = subjects.filter(su => su.attendanceRaw !== "absent" && !isReportOptoutRow(su));
  let sent = 0;
  let overdue = 0;
  for (const su of rows) {
    const rep = reports?.[su.name];
    const done = delivery
      ? isAlreadySent(effectiveClassnoteStatus(rep?.classnoteStatus, su.classnoteStatus))
      : rep?.sent === true;
    if (done) { sent++; continue; }
    if (!delivery || !now) continue;
    const lesson = lessons.find(c => c.id === (su.classId ?? su.makeupClassId));
    // 전체 담당 반 보기에서 오늘 수업이 없는 반을 연체로 만들지 않는다.
    if (showingAll && !lesson?.endTime) continue;
    if (date < now.slice(0, 10) || (lesson?.endTime && `${date}T${lesson.endTime}` <= now)) overdue++;
  }
  return { sent, total: rows.length, label, overdue, delivery };
}
