export type VideoHomeworkStatus = "submitted" | "missing";

export type VideoHomeworkMark = {
  classId: string;
  studentId: string;
  checkDate: string;
  homeworkDate: string | null;
  status: VideoHomeworkStatus;
};

export type VideoHomeworkRosterRow = {
  classId: string;
  className: string;
  subject: string;
  studentId: string;
  studentName: string;
  school: string | null;
  grade: string | null;
};

export type VideoHomeworkHistoryRow = VideoHomeworkRosterRow & VideoHomeworkMark;

export type VideoHomeworkLedgerRow = VideoHomeworkRosterRow & {
  /** 수강 기간·등원 요일·보강·기존 기록으로 확인되는 학생별 수업일. */
  lessonDates: string[];
  editable: boolean;
  /** 조회 종료일 전 마지막 보고서의 영상 과제 값. 모르면 생략하며 검사 이력에는 영향을 주지 않는다. */
  lastAssignment?: { beforeDate: string; assigned: boolean };
};

export function isVideoHomeworkDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
