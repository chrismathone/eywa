// 교재 요청 작성 폼의 "방금 기록한 요청" — 같은 내용으로 두 번째 버튼을 눌러도 새 요청을 만들지 않게 한다.
//
// 원장 2026-10-20(최연재 건): '이미지 저장 및 기록'과 '클래스노트 발송'이 **각자 요청을 만들어**, 이미지를 받고
// 발송까지 하면 같은 줄이 둘 생겼다. 선생님이 하나를 지우다 발송한 쪽을 지워 공지 연결이 끊긴 것이 9/10~10/20 9건.
// 그래서 마지막으로 기록한 요청과 **폼 내용이 같으면** 두 버튼 모두 그 요청을 다시 쓴다(발송창은 그 요청으로 ·
// 이미지는 다시 받기만). 칸 하나라도 바꾸면 새 요청이다(같은 학생에게 다른 교재를 이어서 요청하는 흐름은 그대로).

export type SavedRequest = {
  /** 기록할 때의 폼 내용 지문. */
  fp: string;
  created: { id: string; studentName: string | null }[];
};

export function requestFingerprint(v: {
  studentIds: readonly string[];
  teacherName: string;
  requestDate: string;
  bookName: string;
  bookDetail: string;
  price: number | string;
  notes: string;
}): string {
  // 서버 저장 규칙과 같은 정규화(앞뒤 공백 · 빈 금액 = 0 · 학생 순서 무관) — 보이는 값이 같으면 같은 요청이다.
  return JSON.stringify([
    [...v.studentIds].sort(),
    v.teacherName.trim(),
    v.requestDate,
    v.bookName.trim(),
    v.bookDetail.trim(),
    Math.max(0, Number(v.price) || 0),
    v.notes.trim(),
  ]);
}

/** 지금 폼이 마지막으로 기록한 요청과 같으면 그 요청, 아니면 null. */
export function sameSavedRequest(saved: SavedRequest | null, fp: string): SavedRequest | null {
  return saved && saved.fp === fp && saved.created.length > 0 ? saved : null;
}
