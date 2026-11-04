/**
 * 시간표 강사 라벨 → **화면 표기 이름** 해석(순수 함수, 서버·클라 공용).
 *
 * 🔴 왜 필요한가(원장 2026-07-27 "영어 선생님도 시간표에서 전부 닉네임이 아닌 이름이 나오도록"):
 * 영어 슬롯의 `slot_teacher_label`은 ijw 시트에서 **영문 닉네임**으로 들어와 있다(Hannah·Jane·Sam…).
 * 그래서 수학 시간표는 한글 이름인데 영어만 닉네임이 뜨는 비대칭이 있었다. `users.english_name`을
 * 앵커로 `display_name`(한글 이름)을 찾아 바꾼다.
 *
 * ⚠️ **라벨은 표시값이자 열 식별자**다 — 강사뷰 컬럼·비수업 블록·'가로줄 제외 강사' 설정이 모두 이 문자열로
 * 맞물린다. 그러니 해석은 **한 곳에서** 하고, 그 결과를 모든 소비처가 같이 써야 컬럼이 쪼개지지 않는다
 * (수업은 '이현이' 열, 블록은 'Hannah' 열로 갈라지는 사고 방지).
 */

/** 원 라벨(닉네임·한글명) → 표시 이름. 서버가 `users`에서 빌드해 plain 객체로 넘긴다([[#61]] 무관). */
export type TeacherLabelMap = Record<string, string>;

/**
 * 표시 이름(한글) → **영어 닉네임**(`users.english_name`). 위 `TeacherLabelMap`의 반대 방향이다.
 *
 * 🔴 왜 따로 두나(원장 2026-08-13 *"영어시간표에서 원어민강사 제외 한국인강사는 한글이름(영어이름)"*):
 * 영어과는 서로를 **닉네임으로 부른다**(Jane·Hannah…). 2026-07-27에 시간표를 한글 이름으로 통일하고
 * 나니, 이번엔 "화면의 이현이가 평소 부르는 Hannah"라는 연결이 끊겼다. 그래서 **넓은 자리 두 곳에만**
 * 둘 다 적는다(통합뷰 카드 담임 줄 · 강사뷰 강사 헤더).
 *
 * ⚠️ **라벨(열 식별자)은 절대 안 바꾼다** — `resolveTeacherLabel`의 결과가 강사뷰 열·'가로줄 제외 강사'
 *    설정·정렬 순서와 문자열로 맞물려 있다(이 파일 상단 ⚠️). 이 맵은 **렌더 직전 표기**에만 쓴다.
 * ⚠️ 미니그리드(통합뷰 셀)는 제외 — 칸이 35px라 `이현이(Hannah)`가 4자로 잘려 오히려 못 읽는다.
 */
export type TeacherNicknameMap = Record<string, string>;

/**
 * **특수 자리 = 사람이 아니라 방(수업 형태)**. 원장 2026-07-29: *"직원 이름을 마치 영어이름 LAB인 것처럼
 * 해두니 아르바이트 선생님인데 출석부 등 여러 곳에 필요 없는 게 배선돼 노출된다."*
 * - `LAB`(603호) — 원 라벨 `LAB`·`이주희`. 이주희 선생님이 맡던 자리라 한때 그 이름이 라벨로 들어왔지만
 *   **자리가 사람보다 오래 간다**(담당은 바뀐다). 실제 이주희 계정은 별도 직원으로 존재한다.
 * - `JJ`(305호) — 전담자 없이 **일반 강사들이 번갈아** 감독한다(원장 2026-07-27).
 *
 * 🔴 **두 자리는 서로 다른 방이라 절대 한 열로 합치지 않는다.** 2026-07-27~29 사이엔 `JJ`까지 `LAB`으로
 * 합쳐 보여줬는데, 실측하면 JJ(305호) 48슬롯과 이주희(603호) 51슬롯이 **시간까지 겹치는 쌍이 67건**이다
 * — 동시에 다른 방에서 돌아가는 수업을 한 칸에 쌓은 표기였다. 원장 지시 2026-07-30: *"JJ는 그대로 놔둬야 해."*
 * → 자리 판정은 유지하되 **표기는 시트 원문 그대로 `LAB`·`JJ`** 두 열이다(방 이름 `랩실`·`집중자율수업실`로
 * 바꿔봤으나 원장이 시트와 같은 표기를 원해 되돌렸다 — 별칭은 아래에 남겨 옛 값도 계속 해석된다).
 *
 * 🔴 **이 라벨들은 절대 `users`로 해석하지 않는다** — 직원으로 배선되면 출석부 강사 필터·직원명부·급여표·
 * 담임 드롭다운·발송실패 알림 수신자까지 "가짜 강사"가 따라 붙는다(2026-07-23 공지 발송실패 알림이
 * 로그인 불가한 `JJ` 계정으로 배달돼 아무도 못 본 사고). 시트 재동기도 같은 판정을 쓴다
 * ([`match.ts`](../import/structure/match.ts) `resolveTeacher`가 특수 자리를 먼저 걸러낸다).
 * ⚠️ 그러니 "표기를 `JJ`로 되돌렸다"고 해서 `LAB_ALIASES` 시절처럼 **배열에서 JJ만 빼면 안 된다** — 그러면
 *    JJ가 다시 사람으로 세어져(담임 폴백·직원 목록) 그 사고가 재발한다. 자리 판정과 표기는 별개다.
 *
 * 📌 DB의 `class_schedules.slot_teacher_label` 원문(`LAB`·`JJ`·`이주희`)은 **그대로 둔다**
 *    (ijw 임포트·시트 동기의 원본이라 고치면 동기화와 충돌). 바뀌는 건 표시뿐이다.
 */
export const LAB_ROOM_LABEL = "LAB";
export const SELF_STUDY_ROOM_LABEL = "JJ";
export const SPECIAL_SLOT_LABELS = [LAB_ROOM_LABEL, SELF_STUDY_ROOM_LABEL] as const;
export type SpecialSlotLabel = (typeof SPECIAL_SLOT_LABELS)[number];

/**
 * 원 라벨(시트·DB 원문) → 자리 이름. 해석된 이름도 키에 넣어 **멱등**(두 번 통과해도 같은 값).
 * `랩실`·`집중자율수업실`·`자율실`은 2026-07-29~30 사이 잠깐 쓰인 표기 — 저장된 설정값
 * (`teacherViewLineExcluded`)이나 캐시에 남아 있어도 계속 해석되게 별칭으로 남긴다.
 */
const SPECIAL_BY_ALIAS = new Map<string, SpecialSlotLabel>([
  ["lab", LAB_ROOM_LABEL],
  ["lab실", LAB_ROOM_LABEL],
  ["이주희", LAB_ROOM_LABEL],
  ["랩실", LAB_ROOM_LABEL],
  ["jj", SELF_STUDY_ROOM_LABEL],
  ["집중자율수업실", SELF_STUDY_ROOM_LABEL],
  ["자율실", SELF_STUDY_ROOM_LABEL],
]);

/**
 * 자리 별칭 키 전체(소문자) — **스크립트용 사본과의 패리티 테스트** 전용 노출
 * (`scripts/_oneoff/math-auto-units-rules.mjs`는 TS를 못 읽어 같은 표를 따로 든다).
 * 판정은 언제나 `specialSlotLabel`로 할 것 — 이 배열로 직접 비교하지 말 것.
 */
export const SPECIAL_SLOT_ALIAS_KEYS: readonly string[] = [...SPECIAL_BY_ALIAS.keys()];

/**
 * **시트가 사람을 직책으로 적는 칸** → 그 사람의 닉네임 라벨.
 *
 * 원장 2026-08-29: *"시트를 바꾸라는게 아님. 우리로 가져올때 yoojin 처리하라는것."*
 * 마스터 시트는 학원 문서라 우리가 못 고친다(서비스계정은 실제로 읽기 전용 — 쓰기 시도가 403이다).
 * 고칠 수 있어도 `부원장`은 지난 달 탭·급여 정산용·출석부까지 158칸에 흩어져 있어 건드릴 자리가 아니다.
 * → **가져오는 순간 우리 표기로 바꾼다.** 자리(LAB·JJ)를 굳히는 것과 같은 결이다.
 *
 * 🔴 값은 그 직원의 `users.english_name`과 **글자까지 같아야 한다** — 매칭 앵커가 그 컬럼이라
 *    (`match.ts` `resolveTeacher`), 어긋나면 라벨만 바뀌고 계정엔 안 붙어 슬롯이 주인 없이 남는다.
 *    닉네임을 바꾸면 여기도 같이 바꿀 것(실측 2026-08-29: 정유진 = `Yoojin`).
 * ⚠️ 직책은 사람이 바뀐다 — 부원장이 교체되면 이 표의 값도 새 사람의 닉네임으로 바꿔야 한다.
 *    (그래서 직책을 `users.job_title`로 되짚지 않는다: 같은 직책을 여럿이 달 수 있고, 그러면
 *     조용히 엉뚱한 사람 시간표에 슬롯이 붙는다 — 라벨-only로 떨어지는 것보다 나쁘다.)
 */
const TITLE_LABEL_ALIASES = new Map<string, string>([["부원장", "Yoojin"]]);

/** 직책으로 적힌 라벨이면 닉네임 라벨, 아니면 null. */
function titleAlias(label: string): string | null {
  return TITLE_LABEL_ALIASES.get(label.trim().toLowerCase()) ?? null;
}

/** 라벨이 특수 자리면 그 자리 이름, 아니면 null. 원 라벨·해석된 이름 둘 다 받는다. */
export function specialSlotLabel(label: string | null | undefined): SpecialSlotLabel | null {
  if (label == null) return null;
  return SPECIAL_BY_ALIAS.get(label.trim().toLowerCase()) ?? null;
}

/** 이 슬롯이 강사 수업이 아니라 특수 자리(LAB·JJ)인가. */
export function isSpecialSlotLabel(label: string | null | undefined): boolean {
  return specialSlotLabel(label) != null;
}

/**
 * 반 수정 폼의 '교시별 담당' 드롭다운에서 **자리(JJ·LAB)를 고를 때 쓰는 값**.
 * 담당 칸은 원래 `users.id`(uuid)만 담는데 자리는 사람이 아니라 계정이 없다 → uuid와 절대 안 겹치는
 * 접두사를 붙여 같은 칸에 태운다(별도 입력칸을 만들면 "담임 아니면 자리" 배타 관계가 UI에서 깨진다).
 * 서버는 이 값을 보면 `teacher_id = null` + `slot_teacher_label = <자리>`로 저장한다 —
 * 🔴 **자리를 users로 해석하면 안 된다**(가짜 강사가 직원명부·급여·알림 수신자에 붙는 사고, 위 🔴 참조).
 */
export const SEAT_VALUE_PREFIX = "seat:";
export const seatSelectValue = (seat: SpecialSlotLabel): string => `${SEAT_VALUE_PREFIX}${seat}`;
/** 폼 값이 자리면 그 자리 이름, 아니면 null(=uuid이거나 빈 값). */
export function parseSeatValue(value: string | null | undefined): SpecialSlotLabel | null {
  if (!value?.startsWith(SEAT_VALUE_PREFIX)) return null;
  return specialSlotLabel(value.slice(SEAT_VALUE_PREFIX.length));
}

/**
 * 시트 원문 라벨 → **저장할** 라벨. 자리(LAB·JJ)는 사람 이름 대신 **자리 이름으로 굳힌다**.
 *
 * 원장 지시 2026-08-04(불변): *"이주희 = 랩이 아니라 그냥 LAB으로 해. 이주희는 그냥 아르바이트생.
 * 이건 앞으로도 쭉. 아르바이트생인 이주희가 그만두면 다른 사람이 랩실 이어야하기 때문."*
 * → 마스터 시트가 담당자 이름으로 블록을 그려도 aywa엔 `LAB`으로 들어간다. **자리가 사람보다 오래 간다.**
 *
 * ⚠️ 이건 **앞으로 쓰는 값**에만 적용한다 — 기존 행의 `slot_teacher_label`을 UPDATE하지 말 것(위 📌).
 *   컷오버가 옛 행을 마감하고 새 행을 넣으므로 이력은 원문대로 남고 지금부터가 `LAB`이 된다.
 * ⚠️ 표시 해석(`resolveTeacherLabel`)과 **같은 별칭표**를 쓴다 — 한쪽만 고치면 열이 쪼개진다.
 */
export function canonicalSlotTeacherLabel(label: string | null | undefined): string | null {
  const special = specialSlotLabel(label);
  if (special) return special;
  const raw = label?.trim();
  if (!raw) return null;
  // 직책 칸(`부원장`)은 닉네임으로 굳힌다 — 멱등(`Yoojin`은 키가 아니라 그대로 통과).
  return titleAlias(raw) ?? raw;
}

/**
 * 라벨 하나를 표시 이름으로. 우선순위 = **특수 자리 → users 해석 → 원본 그대로**.
 * 못 찾은 라벨(퇴사자 닉네임 등)은 **원본 유지** — 지어내지 않는다(빈 문자열·물음표 금지).
 */
export function resolveTeacherLabel(
  label: string | null | undefined,
  map: TeacherLabelMap | undefined,
): string | null {
  if (label == null) return null;
  const raw = label.trim();
  if (!raw) return label;
  const special = specialSlotLabel(raw);
  if (special) return special;
  // 직책 칸은 **닉네임을 거쳐** 해석한다 — 이미 저장된 `부원장` 행과 앞으로 들어올 `Yoojin` 행이
  // 같은 이름으로 떨어져야 한 열로 합쳐진다(이 파일 상단 ⚠️ "한쪽만 고치면 열이 쪼개진다").
  // ⚠️ 닉네임이 users에 없으면 **원본을 유지한다** — 계정이 사라진 뒤에 `Yoojin`만 남기면
  //    사람이 못 알아보는 라벨이 된다("지어내지 않는다" 규약).
  const alias = titleAlias(raw);
  if (alias) {
    const named = map?.[alias];
    if (named) return named;
  }
  return map?.[raw] ?? raw;
}

/** 자리 라벨을 보존하고, 사람 교시는 저장된 담당자 FK를 예전 시트 라벨보다 우선한다. */
export function resolveSlotTeacherLabel(
  label: string | null | undefined,
  teacher: { display_name?: string | null } | { display_name?: string | null }[] | null | undefined,
  map?: TeacherLabelMap,
): string | null {
  const assigned = Array.isArray(teacher) ? teacher[0] : teacher;
  return resolveTeacherLabel(specialSlotLabel(label) ?? (assigned?.display_name?.trim() || label?.trim() || null), map);
}

/** 라벨 배열을 해석 + 중복 제거(해석 결과가 겹치면 한 열로 합친다 — 이주희·LAB → LAB 1열, JJ는 별도 열). */
export function resolveTeacherLabels(
  labels: readonly (string | null | undefined)[],
  map: TeacherLabelMap | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of labels) {
    const r = resolveTeacherLabel(l, map);
    if (r == null || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

/**
 * `users` 행에서 라벨 맵을 만든다 — `english_name`(슬롯에 적힌 닉네임) → `display_name`(한글 이름).
 *
 * ⚠️ **모호하면 안 바꾼다**: 같은 닉네임을 쓰는 사람이 둘 이상이면(실데이터: `Zoe` = 곽민정·박나연 둘 다
 * 퇴사) 재직자를 우선하고, 그래도 후보가 하나로 안 좁혀지면 **그 닉네임은 맵에서 뺀다**. 남의 이름을
 * 잘못 붙이는 것보다 닉네임 그대로 두는 편이 낫다.
 * 특수 자리는 `resolveTeacherLabel`이 먼저 처리하므로 여기서 굳이 거르지 않는다.
 */
const HANGUL = /[가-힣]/;

/**
 * 이 표시 이름이 **한국인 강사**인가 — 한글 음절이 하나라도 있으면 그렇다(원어민은 이름 자체가 로마자).
 *
 * 원어민을 어떻게 아나: 직급(`job_title`)에 "원어민"이라 적혀 있긴 하지만 그건 학원설정 운영 enum이라
 * 라벨이 바뀌면 판정이 조용히 뒤집힌다. 대신 이름으로 가른다 — 실측(injaewon 활성 12명)에서 로마자
 * 이름은 `KRISTINE DRIVER`·`Florence Park` 둘뿐이고 그 둘이 원어민이다.
 *
 * 🔴 소비처가 둘이고 **뜻이 다르다**: ① 시간표 닉네임 표기(한국인만 `한글이름(영어이름)`, 원장 2026-08-13)
 *    ② **담임 후보**(원어민은 담임을 맡지 않는다, 원장 2026-08-29 *"외국인은 담임시키지말고 한국인
 *    선생님중에서 가장 많이 들어가는 선생님이 담당으로"*). 판정이 갈리면 표기와 배정이 어긋나므로 한 곳에서 한다.
 */
export function isKoreanTeacherName(displayName: string | null | undefined): boolean {
  return HANGUL.test((displayName ?? "").trim());
}

/**
 * 표시 이름 → 영어 닉네임 맵. **한국인 강사만**(원장 2026-08-13 *"원어민강사 제외"*) — 판정은 위
 * `isKoreanTeacherName` 단일 소스. 덤으로 "이름이 곧 영어인 사람에게 (영어이름)을 또 붙이는" 중복이
 * 구조적으로 안 생긴다.
 *
 * ⚠️ 모호하면 안 붙인다 — 같은 한글 이름을 쓰는 사람이 둘 이상이면(동명이인) 재직자를 우선하고,
 *    그래도 하나로 안 좁혀지면 그 이름은 맵에서 뺀다(`buildTeacherLabelMap`과 같은 규약).
 */
export function buildTeacherNicknameMap(
  users: readonly { displayName: string | null; englishName: string | null; active: boolean }[],
): TeacherNicknameMap {
  const byName = new Map<string, { nick: string; active: boolean }[]>();
  for (const u of users) {
    const name = u.displayName?.trim();
    const nick = u.englishName?.trim();
    if (!name || !nick || nick === name) continue;
    if (!isKoreanTeacherName(name)) continue; // 원어민(로마자 이름) 제외
    (byName.get(name) ?? byName.set(name, []).get(name)!).push({ nick, active: u.active });
  }
  const map: TeacherNicknameMap = {};
  for (const [name, cands] of byName) {
    const pool = cands.some((c) => c.active) ? cands.filter((c) => c.active) : cands;
    const nicks = [...new Set(pool.map((c) => c.nick))];
    if (nicks.length !== 1) continue; // 모호 → 안 붙인다
    map[name] = nicks[0];
  }
  return map;
}

export function buildTeacherLabelMap(
  users: readonly { displayName: string | null; englishName: string | null; active: boolean }[],
): TeacherLabelMap {
  const byNick = new Map<string, { displayName: string; active: boolean }[]>();
  for (const u of users) {
    const nick = u.englishName?.trim();
    const name = u.displayName?.trim();
    if (!nick || !name || nick === name) continue; // 닉네임=이름이면 바꿀 게 없다
    (byNick.get(nick) ?? byNick.set(nick, []).get(nick)!).push({ displayName: name, active: u.active });
  }
  const map: TeacherLabelMap = {};
  for (const [nick, cands] of byNick) {
    const pool = cands.some((c) => c.active) ? cands.filter((c) => c.active) : cands;
    if (pool.length !== 1) continue; // 모호 → 원본 닉네임 유지
    map[nick] = pool[0].displayName;
  }
  return map;
}

/**
 * 퇴사한 직원의 표기(한글 이름·영어 닉네임) — 강사뷰 근무 블록(수업준비·쉬는 시간·회의)을 거르는 데 쓴다.
 * 블록은 사람 id가 아니라 시트 라벨로 저장돼 퇴사해도 기간이 안 닫힌다 → 그대로 두면 수업이 하나도 없는
 * 퇴사자 열이 강사뷰에 남는다(원장 2026-11-04, 정은지(Charlie) 10-31 퇴사).
 * ⚠️ 재직 중인(퇴사 아닌) 사람과 같은 표기는 빼지 않는다 — 동명·같은 닉네임이면 그 사람 블록까지 사라진다.
 */
export function resignedTeacherLabels(
  rows: readonly { displayName: string | null; englishName: string | null; status: string | null }[],
): Set<string> {
  const resigned = new Set<string>();
  const working = new Set<string>();
  for (const r of rows) {
    const target = r.status === "inactive" ? resigned : working;
    for (const l of [r.displayName, r.englishName]) if (l?.trim()) target.add(l.trim());
  }
  for (const l of working) resigned.delete(l);
  return resigned;
}
