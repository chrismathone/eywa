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
  /** 마지막 변경 시각(ISO) — 같은 숙제의 중복 기록 중 최신 기록을 고른다. */
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
  /** 반에 현재 지정된 담당 선생님. 관리자 현황의 반 제목에 표시한다. */
  teacherName?: string | null;
  /** 그 반에서 이 학생에게 영상 과제가 나간 수업일(보고서 `video_homework = true`). 조회 기간 앞뒤 여유분을 포함한다. */
  assignedDates: string[];
  /** 지금 설정으로 검사 대상인가 — 아니면 저장된 기록만 회차로 보이고 새 미확인·자동 집계는 만들지 않는다. */
  tracked: boolean;
  editable: boolean;
  canAssignVideos?: boolean;
  /** 숙제 당일~14일 뒤의 업로드 완료 영상 중 수동·자동 배정되지 않은 영상이 남아 있는가. */
  hasAssignableVideos?: boolean;
  /** 보고서 없이 따로 낸 숙제의 날짜(원장 2026-10-13) — 그 칸에 '따로 낸 숙제' 표시와 취소 메뉴를 단다. */
  extraDates?: string[];
  /**
   * 반려한 숙제(원장 2026-10-13) — 숙제일 → 반려 시각(ISO). 그 시각 **전에** 올라온 영상은 그 칸에 자동으로 붙지 않는다(`rounds.ts` ②).
   * 영상만 떼면 다른 숙제에 붙어 있던 영상이 비운 칸으로 당겨져 칸이 다시 차고 뒤 숙제가 빈다.
   */
  rejected?: Readonly<Record<string, string>>;
  /**
   * `assignedDates` 중 **검사 기록 칸에서 옮겨 남긴 숙제**의 날짜(keep-round.ts · 원장 2026-10-13) — 정식 숙제가 아니라 검사 기록 칸처럼
   * ②의 뒷순위로만 영상을 받는다(`rounds.ts`). 자동 판정·미제출 알림에 들지 않는다. 강사뷰·강사 필터에는 그날 보고서를 쓴 선생님의 칸(own-homework.ts).
   */
  kept?: readonly string[];
  /** 숙제일 → 보고서에 고른 마감('다음 수업', due.ts). 없는 날은 숙제일 + 7일이다. */
  dues?: Readonly<Record<string, string>>;
};

/** 숙제 영상 한 건 — 반·시각·id와 재생 가능한 경우의 미리보기만 내려온다. 원본 다운로드 주소는 내리지 않는다. */
export type VideoArrival = {
  /** 담당자가 숙제를 직접 지정한 영상은 자동 날짜 추정 범위를 적용하지 않는다. */
  manuallyAssigned?: boolean;
  id: string; studentId: string; classId: string | null; postedAt: string;
  /** 서버가 파일 id를 검증한 재생 주소. 업로드 전/잘못된 id는 null, 옛 조회는 생략 가능. */
  playback?: { preview: string; thumbnail: string; uploadedAt: string | null } | null;
  /**
   * **정해진 숙제일**(`route.homeworkDate`) — 학생이 올리기 사이트에서 고른 숙제(2026-10-03) 또는 그 숙제를 낸 보고서 글에 댓글로 올린
   * ClassNote 영상(2026-10-06, 연동 PC가 싣는다). 있으면 그 숙제 칸으로만 간다. 없으면 게시일순 규칙.
   */
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
  /** aywa에 이 영상 줄이 생긴 시각 — 반려한 칸에 "반려할 때 이미 있던 영상"을 다시 붙이지 않는 판정(rounds.ts). 없으면 들어온 시각·게시 시각. */
  createdAt?: string | null;
  /** 숙제 없이 올린 영상(`route.free`, 올리기 사이트) — 게시일순 자동 짝(②)에 들지 않는다. 손 배정하면 정해진 숙제 영상(③)이 된다. */
  free?: boolean;
};

export function isVideoHomeworkDate(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
