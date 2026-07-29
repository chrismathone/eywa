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
 * **특수 자리 = 사람이 아니라 방(수업 형태)**. 원장 2026-07-29: *"말 그대로 랩실(JJ = 집중자율수업실)로
 * 처리할 것 — 따로 직원 배정 안 함."*
 * - `랩실`(603호) — 옛 라벨 `LAB`(구 LAB실)·`이주희`. 이주희 선생님이 맡던 자리라 한때 그 이름이 라벨로
 *   들어왔지만 **자리가 사람보다 오래 간다**(담당은 바뀐다). 실제 이주희 계정은 별도 직원으로 존재한다.
 * - `집중자율수업실`(305호) — 옛 라벨 `JJ`. 전담자 없이 강사들이 번갈아 감독한다.
 *
 * 🔴 **이 라벨들은 절대 `users`로 해석하지 않는다** — 직원으로 배선되면 출석부 강사 필터·직원명부·급여표·
 * 담임 드롭다운·발송실패 알림 수신자까지 "가짜 강사"가 따라 붙는다(2026-07-23 공지 발송실패 알림이
 * 로그인 불가한 `JJ` 계정으로 배달돼 아무도 못 본 사고). 시트 재동기도 같은 판정을 쓴다
 * ([`match.ts`](../import/structure/match.ts) `resolveTeacher`가 특수 자리를 먼저 걸러낸다).
 *
 * 📌 DB의 `class_schedules.slot_teacher_label` 원문(`LAB`·`JJ`·`이주희`)은 **그대로 둔다**
 *    (ijw 임포트·시트 동기의 원본이라 고치면 동기화와 충돌). 바뀌는 건 표시뿐이다.
 */
export const LAB_ROOM_LABEL = "랩실";
export const SELF_STUDY_ROOM_LABEL = "집중자율수업실";
export const SPECIAL_SLOT_LABELS = [LAB_ROOM_LABEL, SELF_STUDY_ROOM_LABEL] as const;
export type SpecialSlotLabel = (typeof SPECIAL_SLOT_LABELS)[number];

/** 원 라벨(시트·DB 원문) → 자리 이름. 해석된 이름도 키에 넣어 **멱등**(두 번 통과해도 같은 값). */
const SPECIAL_BY_ALIAS = new Map<string, SpecialSlotLabel>([
  ["lab", LAB_ROOM_LABEL],
  ["lab실", LAB_ROOM_LABEL],
  ["이주희", LAB_ROOM_LABEL],
  ["랩실", LAB_ROOM_LABEL],
  ["jj", SELF_STUDY_ROOM_LABEL],
  ["집중자율수업실", SELF_STUDY_ROOM_LABEL],
  ["자율실", SELF_STUDY_ROOM_LABEL],
]);

/** 좁은 격자 셀용 짧은 이름(열 헤더는 전체 이름) — "집중자율수업실"은 셀 폭을 넘긴다. */
const SPECIAL_SHORT: Record<SpecialSlotLabel, string> = {
  [LAB_ROOM_LABEL]: "랩실",
  [SELF_STUDY_ROOM_LABEL]: "자율실",
};

/** 라벨이 특수 자리면 그 자리 이름, 아니면 null. 원 라벨·해석된 이름 둘 다 받는다. */
export function specialSlotLabel(label: string | null | undefined): SpecialSlotLabel | null {
  if (label == null) return null;
  return SPECIAL_BY_ALIAS.get(label.trim().toLowerCase()) ?? null;
}

/** 이 슬롯이 강사 수업이 아니라 특수 자리(랩실·집중자율수업실)인가. */
export function isSpecialSlotLabel(label: string | null | undefined): boolean {
  return specialSlotLabel(label) != null;
}

/** 격자 셀 칩에 쓸 짧은 이름("랩실"·"자율실"). 특수 자리가 아니면 null. */
export function specialSlotShortLabel(label: string | null | undefined): string | null {
  const special = specialSlotLabel(label);
  return special ? SPECIAL_SHORT[special] : null;
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
  return map?.[raw] ?? raw;
}

/** 라벨 배열을 해석 + 중복 제거(해석 결과가 겹치면 한 열로 합친다 — 이주희·LAB → 랩실 1열). */
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
