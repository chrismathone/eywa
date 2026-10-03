export type VideoHomeworkStatus = "submitted" | "missing";

export type VideoHomeworkMark = {
  classId: string;
  studentId: string;
  /** 저장 자리(원스크린 = 검사한 수업일 · 장부에서 새로 찍은 기록 = 숙제일 다음 날). 숙제를 가리키는 값은 `homeworkDate`다. */
  checkDate: string;
  homeworkDate: string | null;
  /** 실제 제출일. 기존 기록·제출일을 조회하지 않는 강사 체크 화면에서는 비어 있을 수 있다. */
  submittedDate?: string | null;
  status: VideoHomeworkStatus;
  /** 마지막으로 찍은 시각(ISO) — 영상 자동 집계가 "그 검사가 본 영상"을 가릴 때만 쓴다. */
  updatedAt?: string | null;
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

/** 장부의 한 줄 = 반 × 학생. 회차는 `rounds.ts`가 숙제가 나간 날·기록·영상 도착으로 만든다. */
export type VideoHomeworkLedgerRow = VideoHomeworkRosterRow & {
  /** 그 반에서 이 학생에게 영상 과제가 나간 수업일(보고서 `video_homework = true`). 조회 기간 앞뒤 여유분을 포함한다. */
  assignedDates: string[];
  /** 지금 설정으로 검사 대상인가 — 아니면 저장된 기록만 회차로 보이고 새 미확인·자동 집계는 만들지 않는다. */
  tracked: boolean;
  editable: boolean;
};

/** 학부모가 올린 숙제 영상 한 건 — 워커가 분류한 반(`route.classId`, 못 정했으면 null)과 게시 시각·영상 id만 내려온다(원본·주소는 안 내려온다 — id는 학생 상세 '숙제 영상' 탭으로 바로 가는 링크용). */
export type VideoArrival = {
  id: string; studentId: string; classId: string | null; postedAt: string;
  /** 학생이 올리기 사이트에서 **고른 숙제일**(`route.homeworkDate`, 2026-10-03) — 있으면 그 숙제 칸으로만 간다. 없으면 게시일순 규칙. */
  homeworkDate?: string | null;
  /**
   * 이 영상이 **들어온 시각** — 같은 날 고른 영상과 안 고른 영상의 앞뒤를 가른다(`videoArrivedAt`, rounds.ts가 정한다).
   * 🔴 게시 시각(`postedAt`)은 순서가 아니다: 직접 넣은 Drive 파일은 그날 정오 고정, 사이트 업로드는 올리기를 **시작한** 시각이다.
   * 없으면 게시 시각으로 본다.
   */
  arrivedAt?: string | null;
  /**
   * 같은 파일 판정용 지문(`videoFingerprint` — md5 앞 16자 + 용량). 고른 영상과 지문이 같은 안 고른 영상은 같은 파일이라 세지 않는다.
   * 🔑 같으면 같은 파일이지만, 다르다고 다른 영상인 것은 아니다(폰·브라우저가 다시 압축하면 달라진다). 없으면 판정하지 않는다.
   */
  fingerprint?: string | null;
};

export function isVideoHomeworkDate(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
