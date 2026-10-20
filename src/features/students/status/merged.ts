/**
 * **중복 병합으로 흡수된 쪽(mergee)** 판정 — 순수(IO 없음 · Vitest).
 *
 * 원장 제보 2026-09-13: 운영실 '퇴원생'과 퇴원관리에 **중복 병합된 학생**이 퇴원으로 잡혀 있었다
 * (김지유B·권민서B — 둘 다 수강이 0건이라 마지막 반이 없어 과목 분포에서 '기타·미상'으로 떨어졌다).
 * 병합은 *"원래 한 사람이었다"*를 정리한 것이지 **학원을 그만둔 것이 아니다** — 퇴원으로 세면 그 달
 * 퇴원 수가 사실보다 크고, 근거 없는 '미상'이 사유 분포에 쌓인다.
 *
 * 🔑 지금 병합 표식은 `students.notes`의 **접두 문자열 하나뿐**이다(`mergeStudents`가 쓴다). 전용 컬럼
 *    (`merged_into`)은 아직 없어서(원장 미결정) 판정을 여기 한 곳에 모은다 — 컬럼이 생기면 **이 파일만**
 *    고치면 소비처가 따라온다.
 * 🔴 **이름 끝 접미사(`권민서B`)로 판정하지 말 것.** 실측 2026-09-13(injaewon): 접미사 학생 96명 중
 *    퇴원이 50명인데 실제 병합 표식은 **2명**뿐이다 — 접미사로 거르면 진짜 동명이인 퇴원 48명이 통째로
 *    사라진다. 반대로 병합된 5명 중 3명은 접미사가 아예 없다. 접미사는 **동명이인 구분**이지 병합 표식이
 *    아니다(그 판정은 [`duplicate-candidates.ts`](../admin/duplicate-candidates.ts) 몫).
 * ⚠️ **집계에서만 뺀다.** 학생목록에서는 감추지 않는다(퇴원·전체 보기에 그대로 선다). 목록의 '병합됨' 꼬리표는
 *    2026-10-14 걷었다(원장 *"이상한 라벨은 붙일 필요 없을거같은데"*) — 병합 여부는 학생 메모의 표식으로 남는다.
 */

/**
 * `mergeStudents`가 진 쪽 메모 **맨 앞**에 남기는 표식.
 * 🔴 값을 바꾸면 이미 병합된 과거 행이 판정에서 조용히 빠진다(그때는 데이터 마이그레이션이 함께 필요하다).
 */
export const MERGE_NOTE_PREFIX = "중복 병합:";

/**
 * 표식의 **모양** — `mergeNoteFor`가 실제로 쓰는 꼴(`중복 병합: <keeperId>와 통합됨 (날짜)`)만 인정한다.
 *
 * 🔴 접두사만 보면 **사람이 쓴 메모가 걸린다** — 앱이 직접 *"같은 사람이면 관리자 **중복 병합**으로
 *    합치세요"*(`dup-suspect-notice.tsx`)라고 안내하므로 데스크가 `중복 병합: 확인 요망` 같은 메모를 쓸 수
 *    있고, 그러면 **진짜 퇴원생이 퇴원관리·운영실에서 조용히 사라진다**(고치려던 버그의 정확한 역방향).
 * ⚠️ 이미 DB에 쌓인 과거 행도 이 꼴이다(표식을 쓴 코드 경로가 `mergeStudents` 하나뿐이다) — 그래서
 *    이 정규식은 과거 행을 그대로 잡는다. 🔴 꼴을 바꾸려면 데이터 마이그레이션이 함께 필요하다.
 */
const MERGE_NOTE_PATTERN = /^중복 병합:\s*\S+와 통합됨/;

/**
 * 이 학생이 중복 병합으로 흡수된 쪽인가.
 *
 * ⚠️ 표식은 **맨 앞**에 있을 때만 인정한다 — 사람이 쓴 메모 본문 가운데 같은 말이 들어가도 병합으로 치지
 *    않게. `mergeNoteFor`가 항상 앞에 붙인다.
 */
export function isMergedStudent(notes: string | null | undefined): boolean {
  return typeof notes === "string" && MERGE_NOTE_PATTERN.test(notes.trimStart());
}

/**
 * 진 쪽에 남길 메모 — 병합 표식을 **기존 메모 앞에 덧붙인다**.
 *
 * 🔴 덮어쓰지 않는다 — 종전엔 `notes`를 통째로 갈아끼워서 셔틀 안내 같은 **실제 메모가 사라졌다**.
 * 🔴 뒤가 아니라 **앞**이다 — `isMergedStudent`가 접두로 판정하므로 뒤에 붙이면 표식이 안 잡힌다.
 * ⚠️ 이미 병합된 학생을 또 병합하면 표식이 쌓인다 — 그게 맞다(둘 다 일어난 일이고, 판정은 맨 앞만 본다).
 */
export function mergeNoteFor(
  keeperId: string,
  today: string,
  previousNotes: string | null | undefined,
): string {
  const mark = `${MERGE_NOTE_PREFIX} ${keeperId}와 통합됨 (${today})`;
  const previous = (previousNotes ?? "").trim();
  return previous ? `${mark}\n${previous}` : mark;
}

/**
 * 메모를 저장할 때 **병합 표식을 지켜낸다** — 학생 정보 수정 폼의 '메모 / 특이사항' 칸이 곧 `students.notes`라,
 * 표식이 그 칸 안에 사람 메모와 **같이** 들어 있다.
 *
 * 🔴 이게 없으면 데스크가 메모를 한 번 고치는 것만으로 표식이 사라지고, 그 학생이 **집계에서 퇴원으로
 *    되살아난다**(에러도 경고도 없이). `mergeNoteFor`가 사람 메모를 보존하게 만든 뒤로는 그 칸을 열어
 *    고칠 이유가 오히려 늘었으므로, 서버가 표식을 다시 붙여 준다.
 * 🔑 **되돌릴 손잡이는 상태다**(`staysWithdrawn=false`) — 병합을 잘못했으면 그 학생을 재원/휴원으로
 *    되돌리게 되는데, 그때는 표식을 붙잡지 않는다. 이게 없으면 표식을 지울 길이 앱 안에 **하나도 없어서**
 *    (푸는 액션이 없다) 잘못 병합된 학생이 영원히 집계 밖에 남는다 — 이 모듈이 "감추지 않는다"고
 *    적어 둔 이유와 정면으로 어긋난다.
 * ⚠️ 들어온 글에 표식 줄이 남아 있으면 **전부 걷어내고 맨 앞에 한 번만** 다시 붙인다 — 사람이 표식 *위에*
 *    글을 쓰면(텍스트 칸이라 가능하다) 저장할 때마다 표식이 한 줄씩 쌓이던 것을 막는다.
 * ⚠️ 병합된 학생이 아니면 들어온 값을 그대로 쓴다 — 일반 학생의 메모는 한 바이트도 안 바뀐다.
 */
export function preserveMergeNote(
  storedNotes: string | null | undefined,
  nextNotes: string | null | undefined,
  /** 저장 **뒤에도** 이 학생이 퇴원인가. 되돌리는 중이면 표식을 놓아 준다(위 🔑). */
  staysWithdrawn = true,
): string | null {
  const next = nextNotes ?? null;
  if (!isMergedStudent(storedNotes) || !staysWithdrawn) return next;
  // 표식은 저장된 메모의 **첫 줄**이다(`mergeNoteFor`가 그렇게 쓴다).
  const mark = (storedNotes ?? "").trimStart().split(/\r?\n/)[0]!.trim();
  const rest = (next ?? "")
    .split(/\r?\n/)
    .filter((line) => !MERGE_NOTE_PATTERN.test(line.trimStart()))
    .join("\n")
    .trim();
  return rest ? `${mark}\n${rest}` : mark;
}
