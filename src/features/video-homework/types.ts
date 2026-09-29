export type VideoHomeworkStatus = "submitted" | "timed" | "missing";

export type VideoHomeworkMark = {
  classId: string;
  studentId: string;
  checkDate: string;
  homeworkDate: string | null;
  status: VideoHomeworkStatus;
};

export function isVideoHomeworkDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
