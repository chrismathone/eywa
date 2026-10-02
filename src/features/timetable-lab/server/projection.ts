import type { ScheduleSlot } from '@/features/timetable/server/queries';
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from '@/features/enrollments/eligibility';
import { dateOfDowInWeek, slotLiveOnDate } from '@/features/timetable/lib/week';
import { resolveTeacherLabel, specialSlotLabel, type TeacherLabelMap } from '@/features/timetable/lib/teacher-label';
import type { LabSourceSlot } from '../types';

export type RosterRow = { id: string; class_id: string; student_id: string; start_date: string; end_date: string | null;
  on_hold: boolean | null; is_transferred: boolean | null; attendance_days: string[] | null;
  student: { name: string; status: string; withdrawn_at: string | null } | { name: string; status: string; withdrawn_at: string | null }[] | null };
export type BlockRow = { id: string; teacher_label: string; day_of_week: string; start_time: string; end_time: string;
  label: string; valid_from: string | null; valid_to: string | null };
export type TeacherRow = { id: string; display_name: string | null; english_name?: string | null;
  status?: string | null; bg_color?: string | null; text_color?: string | null };
const one = <T>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value;

export function projectSlots(slots: ScheduleSlot[], roster: RosterRow[], teachers: TeacherRow[], monday: string, map: TeacherLabelMap = {}): LabSourceSlot[] {
  const byClass = new Map<string, RosterRow[]>();
  for (const row of roster) byClass.set(row.class_id, [...byClass.get(row.class_id) ?? [], row]);
  return slots.map(s => {
    const date = dateOfDowInWeek(monday, s.dayOfWeek);
    if (!date) throw new Error('Unknown schedule day');
    const teacher = resolveTeacherLabel(s.slotTeacherLabel || s.teacherName, map) || '';
    const ids = teachers.filter(t => t.display_name?.trim() === teacher.trim()).map(t => t.id);
    const students = new Map<string, LabSourceSlot['students'][number]>();
    for (const r of byClass.get(s.classId) ?? []) {
      const student = one(r.student);
      if (!student) throw new Error('Missing student reference');
      if (!isEnrollmentActiveOn({ startDate: r.start_date, endDate: r.end_date, onHold: !!r.on_hold, isTransferred: !!r.is_transferred }, date)
        || !enrollmentAttendsOnDay(r.attendance_days, s.dayOfWeek)
        || (student.status === 'withdrawn' && student.withdrawn_at && student.withdrawn_at <= date)) continue;
      students.set(r.student_id, { id: r.student_id, name: student.name, enrollmentId: r.id, attendanceDays: r.attendance_days ?? [] });
    }
    return { id: s.id, classId: s.classId, name: s.className, subject: s.subject, day: s.dayOfWeek,
      start: s.startTime.slice(0, 5), end: s.endTime.slice(0, 5), teacher, teacherId: ids.length === 1 && !specialSlotLabel(teacher) ? ids[0] : null,
      room: s.slotRoomLabel || s.classroomName || '', roomId: s.slotRoomId ?? s.classRoomId,
      homeroomTeacher: resolveTeacherLabel(s.teacherName, map) || '', labSeparate: s.labSeparate === true,
      ...(s.classBgColor ? { classColor: { bg: s.classBgColor, text: s.classTextColor || '#121212' } } : {}),
      kind: specialSlotLabel(teacher) ? 'seat' : 'lesson', students: [...students.values()] };
  });
}
export function projectBlocks(rows: BlockRow[], monday: string, map: TeacherLabelMap, teachers: TeacherRow[]): LabSourceSlot[] {
  return rows.filter(r => slotLiveOnDate({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }, monday)).map(r => {
    const teacher = resolveTeacherLabel(r.teacher_label, map) || '', ids = teachers.filter(t => t.display_name?.trim() === teacher).map(t => t.id);
    return { id: `block:${r.id}`, classId: '', name: resolveTeacherLabel(r.label, map) || r.label, subject: 'english', day: r.day_of_week,
      start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), teacher, teacherId: ids.length === 1 ? ids[0] : null,
      room: '', roomId: null, kind: 'block', students: [] };
  });
}
