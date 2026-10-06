/**
 * 영상 과제 **회차** — 판정 한 벌(순수 · 서버/화면/CSV 공용).
 *
 * 원장 2026-10-01: *"횟수를 강제 지정하지말고 … 1회가 서로 다른 날짜일 수 있음"* · *"숙제 나간 날만 횟수가 늘어나는걸로"* ·
 * *"숙제로 나간 경우에 체크가 안되어있으면 미확인"* · *"영상 제출 현황 카운트도 스마트하게"*.
 *
 * 회차 = (반 × 학생)에게 **영상 과제가 나간 수업**(보고서 `video_homework = true`)을 날짜순으로 센 것.
 *  · 옛 기록은 버리지 않는다 — 보고서 표시가 없어도 검사 기록이 있으면 회차다(지난 숙제일 자리).
 *  · 숙제일 없는 옛 기록(옛 장부·원스크린이 직전 수업을 몰랐던 검사)은 **검사일 직전 숙제**(14일 안)의 기록으로 본다 —
 *    그 검사가 그 숙제를 본 것이라 따로 세면 한 숙제가 두 번 센다. 직전 숙제에 이미 기록이 있거나 14일 안에 숙제가 없으면
 *    검사일 자리(`c:`)에 홀로 선다(더 옛날 숙제로 건너뛰면 기간 밖으로 사라진다 — 재리뷰 2026-10-01).
 *  · 기록이 없고 숙제가 나갔으면 미확인. 단 학부모 영상이 도착했으면 **저장 없이** 완료로 센다(아래 자동 집계).
 *
 * 자동 집계(반 × 학생 단위 — 원장 2026-10-01 *"반 매칭 되는 영상에 한해서 횟수 체크"*):
 *  ⓪ 워커가 **그 반으로 분류한 영상**(`route.classId`)만 센다. 반을 못 정했거나 아직 분류 전인 영상은 어느 줄에도 찍지 않는다 —
 *     같은 과목 반을 둘 다니는 학생의 영상 하나가 두 반에 동시에 찍히지 않는다.
 *  ① 같은 날 올라온 영상은 한 번으로 센다.
 *  ② 영상은 게시일순으로, **그날까지 나간 숙제 중 아직 영상을 못 받은 가장 오래된 것**에 하나씩 간다.
 *     받는 쪽 = 기록 없는 숙제(→ 완료(영상)) 또는 직접 찍은 '완료'(→ 표시는 그대로, 그 영상은 다른 칸으로 안 간다).
 *     그래서 영상으로 센 칸을 확정해도, 미확인 칸을 한 번 눌러 완료로 바꿔도 **다른 칸의 판정이 흔들리지 않는다**.
 *     직접 찍은 '완료'는 그 기록이 볼 수 있었던 영상만 받는다(제출일까지 · 날짜 없는 원스크린 체크는 체크한 시각까지).
 *  🔴 숙제보다 먼저 올라온 영상·`VIDEO_MATCH_WINDOW_DAYS`를 넘겨 올라온 영상은 짝이 아니다. 직접 찍은 기록(완료·미수행)이 늘 이긴다.
 *  ③ 숙제가 정해진 영상(`homeworkDate`) — 학생이 올리기 사이트에서 **숙제를 골라** 올린 영상(원장 2026-10-03 *"숙제 리스트에서 고르도록 해서
 *     숙제 링크 배선"*)과 **그 숙제를 낸 보고서 글에 댓글로 올린 ClassNote 영상**(원장 2026-10-06 *"해당 숙제 보고서 고유의 링크 주소가 있는
 *     보고서에 영상을 업로드하면 무조건 체킹가능하지"* — 연동 PC가 글의 보고서를 확인해 싣는다, `scripts/_classnote/video-report-link.mjs`)은
 *     ②의 순서를 타지 않고 **그 숙제 칸으로만** 간다 — 다른 칸을 채우지 않는다(그 칸이 이미 영상을 받았거나 미수행으로 찍혔으면 그 영상은 세지 않는다).
 *     고른 영상을 먼저 붙이고, 남은 영상(ClassNote·옛 링크)이 ②로 나머지 칸을 채운다. 단 고른 영상이 칸에 붙은 날, **그 영상보다 늦게 들어온**
 *     같은 반 × 학생의 안 고른 영상은 세지 않는다(①과 같은 뜻 — 사이트에 올린 영상을 ClassNote에도 올려도 한 번이다).
 *     🔴 **먼저 들어와 있던** 안 고른 영상은 종전대로 센다 — 나중에 올린 영상이 이미 완료(영상)로 보이던 칸을 되돌리지 않는다.
 *     앞뒤는 게시 시각이 아니라 **들어온 시각**(`arrivedAt`, `videoArrivedAt`)으로 가른다.
 *     ⚠️ 알고 정한 예외 = 보고서 글의 **댓글 영상**: 들어온 시각이 학부모가 올린 시각이라(수집·분류는 그보다 늦다), 같은 날 그 **뒤에** 새 글로 올린
 *     영상이 먼저 분류돼 다른 칸을 채웠다가 댓글 영상이 분류되는 순간 빠질 수 있다(그 칸이 미확인으로 돌아간다 — 보통 몇 분 사이). 끝난 모습은
 *     ①과 같다(같은 날은 한 번 · 먼저 **올린** 영상은 안 빠진다). 틀릴 바에는 '완료'가 아니라 '미확인' 쪽으로 틀린다(선생님이 다시 본다).
 *     🔴 단 하나의 예외 = **같은 파일**(`fingerprint` — md5 + 용량이 같다): 칸에 붙은 고른 영상과 같은 반 × 학생의 같은 파일인 안 고른 영상은,
 *     그 숙제일 이후에 올라왔으면 들어온 순서와 상관없이 세지 않는다(원장 2026-10-03 *"영상 정보를 확인할 방법이 있나? 메타데이터 등이나
 *     용량 등으로"* → *"그렇게하자"*). 학생이 그 파일을 어느 숙제로 냈는지 밝혔으니, 먼저 ClassNote로 올라와 다른 칸을 채웠던 같은 파일은
 *     그 칸에서 빠진다(그 칸은 정말로 아직 안 낸 숙제다). 숙제일 **전에** 이미 올라와 있던 사본은 그 숙제의 영상일 수 없어 종전대로 센다
 *     (옛 영상을 다시 고른 것 — ②의 "숙제보다 먼저 올라온 영상은 짝이 아니다"와 같은 뜻).
 */
import { addDays, kstDateOf } from "@/lib/date-kst";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "./types";

/**
 * 숙제가 나간 뒤 이 일수 안에 올라온 영상까지 그 숙제로 센다.
 * 2주: 숙제는 보통 다음 수업 전에 낸다. 30일로 두면 검사를 안 찍은 오래된 숙제가 4주 뒤 영상까지 가져갔다(운영 데이터 재현 2026-10-01).
 */
export const VIDEO_MATCH_WINDOW_DAYS = 14;
/** 짝 맞추기를 시작하는 자리 = **오늘에서 이만큼 전**(조회 기간과 무관) — 기간을 바꿔도 같은 칸 판정이 같게. */
export const VIDEO_MATCH_HISTORY_DAYS = 60;

/**
 * 서버가 숙제·기록·영상을 읽을 범위. 시작점이 조회 시작일이 아니라 오늘 기준 고정 창이라, 최근 60일 안의 어떤 기간을 봐도
 * 같은 재료로 짝을 맞춘다(오래된 미확인 숙제부터 채우는 규칙은 과거로 이어지므로 시작점이 기간을 따라 움직이면 판정이 바뀐다 — 리뷰 2026-10-01).
 * ⚠️ 한계: 60일보다 오래된 기간은 시작점이 그 기간을 따라가므로, 검사를 안 찍은 숙제가 줄줄이 이어진 학생은 드물게 판정이 다를 수 있다
 *    (고정 도입일부터 다 읽으면 정확하지만 읽는 양이 계속 는다 — 필요해지면 그때 RPC로).
 */
export function videoMatchRange(fromDate: string, toDate: string, today: string): { from: string; to: string } {
  const anchor = addDays(today, -VIDEO_MATCH_HISTORY_DAYS);
  return { from: addDays(fromDate < anchor ? fromDate : anchor, -VIDEO_MATCH_WINDOW_DAYS), to: addDays(toDate, VIDEO_MATCH_WINDOW_DAYS) };
}

export type RoundStatus = "submitted" | "missing" | "unchecked";
export type LedgerRound = {
  /** 회차 식별 — `h:숙제일` 또는(붙일 숙제가 없는 숙제일 없는 옛 기록) `c:검사일`. */
  key: string;
  /** 정렬·표시 기준일 = 숙제가 나간 날(없으면 검사일). */
  date: string;
  homeworkDate: string | null;
  /** 보고서에 '영상 과제 있음'으로 남은 수업인가(아니면 기록만 있는 회차). */
  assigned: boolean;
  mark: VideoHomeworkMark | null;
  status: RoundStatus;
  /** 완료일 — 기록의 제출일, 없으면 짝지어진 영상 게시일. */
  submittedDate: string | null;
  /** 직접 찍은 기록 없이 영상 도착만으로 완료로 센 칸. */
  auto: boolean;
  /** 짝지어진 영상의 게시일(KST). */
  videoDate: string | null;
  /**
   * 짝지어진 영상의 id(그날 가장 먼저 올라온 영상) — 장부 칸의 ▶가 학생 상세 '숙제 영상' 탭으로 바로 가는 데 쓴다.
   * 영상이 짝지어진 칸은 **직접 찍은 '완료'여도 영상 쪽이 이긴다**(▶ 표시): 영상은 그 칸이 받은 증거이고(②), 손 기록은 영상 없이 찍은 칸만 '수동'이다.
   */
  videoId: string | null;
};

type PairRow = Pick<VideoHomeworkLedgerRow, "classId" | "studentId" | "assignedDates" | "tracked">;
export const roundPairKey = (row: { classId: string; studentId: string }) => `${row.classId}:${row.studentId}`;
export const markRoundKey = (mark: Pick<VideoHomeworkMark, "homeworkDate" | "checkDate">) =>
  mark.homeworkDate ? `h:${mark.homeworkDate}` : `c:${mark.checkDate}`;
/** 기록 하나의 자리 — (반 · 학생 · 회차). 같은 숙제의 기록은 어느 화면에서 찍었든 같은 자리다. */
export const markIdentity = (mark: Pick<VideoHomeworkMark, "classId" | "studentId" | "homeworkDate" | "checkDate">) =>
  `${roundPairKey(mark)}:${markRoundKey(mark)}`;
/** 그 칸을 저장할 때 서버에 보낼 회차 — 기록이 있으면 **그 기록의 자리**(숙제일 없는 옛 기록이 숙제 칸에 붙어 있어도 그 줄을 고친다). */
export const roundWriteKey = (round: Pick<LedgerRound, "key" | "mark">) => (round.mark ? markRoundKey(round.mark) : round.key);
/** 같은 자리의 기록이 둘(옛 중복·동시 첫 기록)이면 나중에 찍은 쪽. */
export const newerMark = (a: VideoHomeworkMark, b: VideoHomeworkMark) =>
  (a.updatedAt ?? "") > (b.updatedAt ?? "") || (a.updatedAt ?? "") === (b.updatedAt ?? "") && a.checkDate >= b.checkDate ? a : b;

type VideoDay = { day: string; firstAt: number; id: string };

function videoDays(videos: VideoArrival[]): Map<string, VideoDay[]> {
  const byPair = new Map<string, Map<string, VideoDay>>();
  for (const video of videos) {
    const day = kstDateOf(video.postedAt);
    // 반이 확인되지 않은 영상은 세지 않는다 — 어느 반 숙제인지 모르는 채로 칸을 채우지 않는다.
    if (!video.classId || !day) continue;
    const key = roundPairKey({ classId: video.classId, studentId: video.studentId });
    const days = byPair.get(key) ?? new Map<string, VideoDay>();
    const at = Date.parse(video.postedAt);
    const seen = days.get(day);
    if (seen) { if (at < seen.firstAt) Object.assign(seen, { firstAt: at, id: video.id }); }
    else days.set(day, { day, firstAt: at, id: video.id });
    byPair.set(key, days);
  }
  return new Map([...byPair].map(([key, days]) => [key, [...days.values()].sort((a, b) => a.day.localeCompare(b.day))]));
}

const fresh = (key: string, date: string, homeworkDate: string | null, assigned: boolean): LedgerRound =>
  ({ key, date, homeworkDate, assigned, mark: null, status: "unchecked", submittedDate: null, auto: false, videoDate: null, videoId: null });
function attach(round: LedgerRound, mark: VideoHomeworkMark) {
  round.mark = round.mark ? newerMark(mark, round.mark) : mark;
  round.status = round.mark.status;
  round.submittedDate = round.mark.status === "submitted" ? round.mark.submittedDate ?? null : null;
}

/** 이 영상을 이 칸이 받을 수 있나 — 기록 없는 숙제거나, 그 영상을 볼 수 있었던 직접 '완료'. */
function canTake(round: LedgerRound, video: VideoDay): boolean {
  if (round.videoDate || round.date > video.day || video.day > addDays(round.date, VIDEO_MATCH_WINDOW_DAYS)) return false;
  const mark = round.mark;
  if (!mark) return round.assigned;
  if (mark.status !== "submitted") return false;
  if (mark.submittedDate) return video.day <= mark.submittedDate;
  const seenBy = mark.updatedAt ? Date.parse(mark.updatedAt) : Date.parse(`${addDays(mark.checkDate, 1)}T00:00:00+09:00`);
  return video.firstAt <= seenBy;
}

/**
 * 영상이 **들어온 시각** — 같은 날 고른 영상과 안 고른 영상의 앞뒤를 가르는 값(`VideoArrival.arrivedAt`). 두 로더가 이 함수로 싣는다.
 *  · 고른 영상(올리기 사이트) = 줄이 생긴 시각(`created_at`) 그대로 — 올리기가 **끝나** 장부에 보이기 시작한 때다.
 *    🔴 보고서 글에 댓글로 올려 숙제가 정해진 **ClassNote 영상**은 여기 들지 않는다(아래 '안 고른 영상'과 같은 식) — 그 줄은 연동 PC가
 *    수집한 때 생기므로, 줄이 생긴 시각만 보면 학부모가 먼저 올린 영상이 뒤늦게 들어온 것으로 읽힌다.
 *  · 안 고른 영상 = 줄이 생긴 시각과 그 영상의 실제 시각 중 **이른 쪽**: ClassNote(글 번호가 있다) = 학부모가 올린 시각,
 *    직접 넣은 Drive 파일 = Drive에 파일이 생긴 시각(`uploaded_at`).
 * 🔴 줄이 생긴 시각만 쓰지 말 것 — ClassNote 줄은 연동 PC가 수집한 때 생긴다(댓글 영상 10분 주기 · PC가 꺼져 있었으면 한참 뒤).
 *    먼저 올린 영상이 사이트 업로드보다 늦게 수집되면 '겹쳐 올린 것'으로 빠져 영영 안 세진다. Drive 줄은 파일을 휴지통에서 되살리면 다시 생긴다.
 * 🔴 이른 쪽을 쓰므로 값은 늘 줄이 생긴 시각 이하다 — 올리기 사이트 영상에 대해서는 "먼저 보이던 영상 < 나중에 생긴 고른 영상 줄"이
 *    그대로 성립한다(되돌아감 없음).
 * ⚠️ 숙제가 정해진 ClassNote 영상(댓글 영상)에는 그 보장이 **없다** — 값이 학부모가 올린 시각이고 장부에 보이기 시작하는 때(분류)는 그보다 늦다.
 *    같은 날 그 뒤에 올린 안 고른 영상이 먼저 보이다가 빠질 수 있다(머리 주석 ③의 '알고 정한 예외' · `rounds.test.ts`가 잠근다).
 *    줄이 생긴 시각으로 바꾸면 되돌아감은 줄지만, 같은 날 올린 영상 둘이 수집 순서(새 글 1분 · 댓글 10분)에 따라 두 칸을 채운다(① 위반).
 * 읽을 수 있는 시각이 하나도 없으면 null(게시 시각으로 본다).
 */
export function videoArrivedAt(row: { createdAt?: string | null; postedAt?: string | null; uploadedAt?: string | null; fromClassnote: boolean; picked: boolean }): string | null {
  const ms = (value?: string | null) => (value ? Date.parse(value) : NaN);
  const siteUpload = row.picked && !row.fromClassnote; // 올리기 사이트 — 게시 시각이 '올리기 시작'이라 줄이 생긴 시각만 본다
  const times = [ms(row.createdAt), siteUpload ? NaN : ms(row.fromClassnote ? row.postedAt : row.uploadedAt)].filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

/**
 * 같은 파일 판정용 지문 — 영상 줄의 md5(ClassNote = 연동 PC가 내려받은 원본, 사이트·링크 = Drive가 알려 준 값,
 * 직접 넣은 Drive 파일 = 연동 PC가 훑을 때 Drive가 알려 준 값)와 용량(바이트).
 * 둘 다 같으면 같은 파일이다. 화면까지 내려가는 값이라 md5는 앞 16자만 싣는다(같은 학생의 영상끼리 견주는 데는 충분하다).
 * 모양이 틀리거나 비면 null — 판정하지 않는다(시각 규칙만 탄다).
 */
export function videoFingerprint(md5: unknown, bytes: unknown): string | null {
  const hex = typeof md5 === "string" ? md5.trim().toLowerCase() : "";
  const size = typeof bytes === "string" && /^\d+$/.test(bytes) ? Number(bytes) : bytes;
  if (!/^[0-9a-f]{32}$/.test(hex) || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return null;
  return `${hex.slice(0, 16)}:${size}`;
}

/** (반 × 학생)별 회차 — 조회 기간 밖 여유분까지 넣어 짝을 맞춘 뒤, 기간 안의 회차만 돌려준다. */
export function buildLedgerRounds(input: {
  rows: PairRow[]; marks: Iterable<VideoHomeworkMark>; videos: VideoArrival[]; fromDate: string; toDate: string;
}): Map<string, LedgerRound[]> {
  const all = new Map<string, Map<string, LedgerRound>>();
  const tracked = new Set<string>();
  for (const row of input.rows) {
    const rounds = new Map<string, LedgerRound>();
    if (row.tracked) for (const date of row.assignedDates) rounds.set(`h:${date}`, fresh(`h:${date}`, date, date, true));
    all.set(roundPairKey(row), rounds);
    if (row.tracked) tracked.add(roundPairKey(row));
  }
  const legacy: VideoHomeworkMark[] = [];
  for (const mark of input.marks) {
    const rounds = all.get(roundPairKey(mark));
    if (!rounds) continue;
    if (!mark.homeworkDate) { legacy.push(mark); continue; }
    const key = markRoundKey(mark);
    const round = rounds.get(key) ?? fresh(key, mark.homeworkDate, mark.homeworkDate, false);
    attach(round, mark);
    rounds.set(key, round);
  }
  for (const mark of legacy.sort((a, b) => a.checkDate.localeCompare(b.checkDate))) {
    const rounds = all.get(roundPairKey(mark))!;
    const latest = [...rounds.values()].filter((r) => r.assigned && r.date < mark.checkDate).sort((a, b) => b.date.localeCompare(a.date))[0];
    const before = latest && !latest.mark && mark.checkDate <= addDays(latest.date, VIDEO_MATCH_WINDOW_DAYS) ? latest : undefined;
    const key = markRoundKey(mark);
    const round = before ?? rounds.get(key) ?? fresh(key, mark.checkDate, null, false);
    attach(round, mark);
    if (!before) rounds.set(key, round);
  }
  // ③ 숙제가 정해진 영상(학생이 고른 숙제 · 보고서 글의 댓글 영상) — 그 칸으로만(올린 순서대로 첫 영상이 그 칸의 영상이다).
  const picked = input.videos.filter((v) => !!v.homeworkDate && !!v.classId).sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  // `반:학생:게시일` → 그날 칸에 붙은 고른 영상 중 **가장 먼저 들어온 것**의 시각. 그날 그보다 늦게(같거나 뒤) 들어온 안 고른 영상은 세지 않는다
  // (사이트에 올린 영상을 ClassNote에도 올린 것 — 한 영상이 두 칸을 채우지 않게).
  // 🔴 그보다 **먼저 들어와 있던** 안 고른 영상은 종전대로 센다 — 나중에 올린 영상이 이미 완료(영상)로 보이던 칸을 미확인으로 되돌리지 않는다
  //    (원장 2026-10-03 *"그거 보완해야겠는데"* — 오전에 ClassNote로 낸 숙제가 오후 사이트 업로드 뒤 미확인이 되던 것).
  // 🔴 앞뒤는 **들어온 시각**(`videoArrivedAt`)으로 가른다(게시 시각 아님) — 장부에 먼저 보이던 영상은 늘 그 뒤에 생긴 고른 영상 줄(올리기 사이트)보다 이르다.
  //    ⚠️ 숙제가 정해진 ClassNote 댓글 영상은 예외다(학부모가 올린 시각이 기준 — `videoArrivedAt` 주석).
  const arrived = (v: VideoArrival) => {
    const at = v.arrivedAt ? Date.parse(v.arrivedAt) : NaN;
    return Number.isNaN(at) ? Date.parse(v.postedAt) : at;
  };
  const pickedAt = new Map<string, number>();
  // `반:학생:지문` → 그 파일을 골라 칸에 붙인 숙제일(여럿이면 가장 이른 날). 그날 이후에 올라온 같은 파일의 안 고른 사본은 세지 않는다.
  // 🔴 반 × 학생 단위다(⓪과 같다) — 학생 단위로 넓히면 장부(기간에 회차가 있는 반만 읽는다)·올리기 사이트(그 반만 읽는다)·제출 화면이
  //    서로 다른 고른 영상을 보게 돼 같은 칸 판정이 화면마다 갈린다.
  const pickedFiles = new Map<string, string>();
  for (const video of picked) {
    const pair = roundPairKey({ classId: video.classId!, studentId: video.studentId });
    const day = kstDateOf(video.postedAt);
    const round = tracked.has(pair) ? all.get(pair)?.get(`h:${video.homeworkDate}`) : undefined;
    if (!round || !day || round.videoDate || day < round.date || day > addDays(round.date, VIDEO_MATCH_WINDOW_DAYS)) continue;
    if (round.mark && round.mark.status !== "submitted") continue; // 직접 찍은 미수행이 이긴다
    round.videoDate = day;
    round.videoId = video.id;
    pickedAt.set(`${pair}:${day}`, Math.min(pickedAt.get(`${pair}:${day}`) ?? Infinity, arrived(video)));
    if (video.fingerprint) {
      const file = `${pair}:${video.fingerprint}`;
      const since = pickedFiles.get(file);
      if (!since || round.date < since) pickedFiles.set(file, round.date);
    }
    if (!round.mark) Object.assign(round, { auto: true, status: "submitted", submittedDate: day });
  }
  const afterPicked = (v: VideoArrival) => {
    const at = v.classId ? pickedAt.get(`${roundPairKey({ classId: v.classId, studentId: v.studentId })}:${kstDateOf(v.postedAt)}`) : undefined;
    return at !== undefined && arrived(v) >= at;
  };
  const sameFile = (v: VideoArrival) => {
    const since = v.fingerprint && v.classId ? pickedFiles.get(`${roundPairKey({ classId: v.classId, studentId: v.studentId })}:${v.fingerprint}`) : undefined;
    const day = since ? kstDateOf(v.postedAt) : null;
    return !!since && !!day && day >= since;
  };
  const days = videoDays(input.videos.filter((v) => !v.homeworkDate && !afterPicked(v) && !sameFile(v)));
  for (const [pair, rounds] of all) {
    const available = tracked.has(pair) ? days.get(pair) : undefined;
    if (!available?.length) continue;
    const queue = [...rounds.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const video of available) {
      const round = queue.find((r) => canTake(r, video));
      if (!round) continue;
      round.videoDate = video.day;
      round.videoId = video.id;
      if (!round.mark) Object.assign(round, { auto: true, status: "submitted", submittedDate: video.day });
    }
  }
  return new Map([...all].map(([pair, rounds]) => [pair, [...rounds.values()]
    .filter((round) => round.date >= input.fromDate && round.date <= input.toDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))]));
}

export type RoundCounts = { submitted: number; missing: number; unchecked: number; total: number };
export function roundCounts(rounds: readonly LedgerRound[]): RoundCounts {
  const counts = { submitted: 0, missing: 0, unchecked: 0, total: rounds.length };
  for (const round of rounds) counts[round.status]++;
  return counts;
}
