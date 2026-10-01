export type MasterAttendance = {
  id: string;
  classId: string;
  studentId: string;
  date: string;
  startTime: string | null;
  /** Full source row binds every correction, note and unit value to the preview. */
  record: Record<string, unknown>;
};
export type AttendanceLink = {
  classId: string;
  studentId: string;
  date: string;
  kind: string;
};
export type AttendanceMove = {
  ids: string[];
  studentId: string;
  studentName: string;
  date: string;
  fromClassId: string;
  fromClassName: string;
  fromTime: string | null;
  toClassId: string;
  toClassName: string;
  toTime: string | null;
};
export type AttendanceMigration = {
  moves: AttendanceMove[];
  retainedCells: number;
};
