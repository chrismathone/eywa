import type { StaffListPrefs, StaffViewPrefs } from "@/features/staff/list/list-prefs";
import { saveStaffListPrefs } from "@/features/staff/list/server/list-prefs";

/**
 * 직원목록 보기 설정의 **창 안 단일 저장 큐**(적대적 리뷰 2026-09-04).
 *
 * `users.ui_prefs.staff`에 쓰는 자리가 셋이다(필터 = RememberPrefs · 글자 −/+ · 열 고르기). 서버 액션은 ui_prefs 행을
 * 읽고-쓰기라 둘이 겹치면 늦게 커밋한 쪽이 먼저 것을 지운다(열 세 개를 1초 안에 연속 해제 → 계정엔 두 개만 남는다).
 * 그래서 이 문서의 모든 저장은 여기 한 줄로 선다 — 앞 저장이 끝난 뒤 다음을 보낸다. 부분 객체만 보내니 순서만 지키면
 * 마지막 값이 남는다. 창(iframe)·탭·PC가 다르면 이 큐 밖이라, 열·글자는 `base`를 함께 보내 서버가 **이 창이 바꾼 차이만**
 * 얹는다(`mergeStaffView` — 시간이 안 겹쳐도 통째 배열은 남의 변경을 지운다).
 *
 * 클라이언트 컴포넌트만 import한다(지시어 없는 일반 모듈 — 서버가 부를 일이 없다).
 */
let chain: Promise<unknown> = Promise.resolve();

export function queueStaffPrefsSave(
  next: Partial<StaffListPrefs>,
  base?: StaffViewPrefs,
): Promise<{ ok: boolean; error?: string; view?: StaffViewPrefs }> {
  const run = chain.then(() => saveStaffListPrefs(next, base));
  chain = run.catch(() => undefined); // 실패해도 줄은 계속 간다(호출부가 각자 처리).
  return run;
}

/**
 * 이 문서가 **마지막으로 알고 있는** 표 보기 값(클릭 직후엔 낙관값, 저장이 돌아오면 병합된 계정값). Next는 뒤로/앞으로 가기에서
 * 페이지를 클라 캐시로 되살리는데(RSC 페이로드 재사용) 그 페이로드는 클릭 **이전** 스냅샷이라, 상세에서 돌아오면 120%가 100%로
 * 보인다 — 진실은 계정이지만 이미 저장한 값을 눈앞에서 되돌려 보이면 다음 +가 110으로 덮는다(120 유실).
 * 그래서 Provider가 새로 설 때 `rev`로 가른다: 페이로드가 이 값보다 **옛것이거나 같은 세대**면 이 값, 더 새 세대(다른 창·PC가
 * 그 사이 저장)면 페이로드. 하드 로드에선 비어 있어(모듈 새로 평가) SSR과 첫 클라 렌더가 같다(하이드레이션 무변).
 */
let lastPicked: StaffViewPrefs | null = null;

export function rememberPickedView(next: StaffViewPrefs) {
  lastPicked = next;
}
export function seedStaffView(initial: StaffViewPrefs): StaffViewPrefs {
  return lastPicked && lastPicked.rev >= initial.rev ? lastPicked : initial;
}
