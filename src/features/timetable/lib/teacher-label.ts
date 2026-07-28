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

/** LAB 셀 판정에 쓰는 고정 라벨. `class-grid`/`teacher-grid`가 이 값으로 LAB 칩을 그린다. */
export const LAB_LABEL = "LAB";

/**
 * **LAB으로 고정 표기**할 라벨(원장 지시 2026-07-27: "아르바이트 선생님이므로 그냥 이름을 LAB으로 고정").
 * LAB·JJ는 **사람이 아니라 아르바이트 성격의 담당 자리**라, 시간표에선 개인 이름이 아니라 역할로 읽는 게 맞다.
 * - `이주희` — 그 자리를 맡던 강사. 2026-07-27 계정을 **`display_name`='LAB' / 직급 '아르바이트'로 개명**했다.
 *   ⚠️ 그래도 이 별칭은 **계속 필요하다** — `class_schedules.slot_teacher_label`에 `이주희` 문자열이 그대로
 *   102행 남아 있다(ijw 임포트·시트 동기의 원본이라 고치면 동기화와 충돌). 지우면 그 102슬롯이 '이주희'로 노출된다.
 * - `JJ` — 🔴 **전담자가 없는 자리**다. 원래 아르바이트 선생님이 맡았는데 지금은 그 사람이 없어 **일반 강사들이
 *   번갈아** 담당한다(원장 2026-07-27). 그래서 계정은 `JJ` 그대로 두기로 했다 — 한 사람으로 묶으면 실제 운영과
 *   어긋나고, `display_name`을 LAB으로 바꾸면 이주희(=LAB)와 겹쳐 담당이 더 흐려진다. **개명·직급 배정 금지.**
 *
 * 📌 원장이 학원설정 `teacherViewLineExcluded`에 넣어 둔 `["LAB","JJ","이주희"]`와 같은 집합이다.
 */
export const LAB_ALIASES: readonly string[] = ["LAB", "JJ", "이주희"];

const LAB_ALIAS_SET = new Set(LAB_ALIASES.map((s) => s.trim().toLowerCase()));

/**
 * 라벨 하나를 표시 이름으로. 우선순위 = **LAB 고정 → users 해석 → 원본 그대로**.
 * 못 찾은 라벨(퇴사자 닉네임 등)은 **원본 유지** — 지어내지 않는다(빈 문자열·물음표 금지).
 */
export function resolveTeacherLabel(
  label: string | null | undefined,
  map: TeacherLabelMap | undefined,
): string | null {
  if (label == null) return null;
  const raw = label.trim();
  if (!raw) return label;
  if (LAB_ALIAS_SET.has(raw.toLowerCase())) return LAB_LABEL;
  return map?.[raw] ?? raw;
}

/** 라벨 배열을 해석 + 중복 제거(해석 결과가 겹치면 한 열로 합친다 — 이주희·JJ·LAB → LAB 1열). */
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
 * LAB 고정 대상은 `resolveTeacherLabel`이 먼저 처리하므로 여기서 굳이 거르지 않는다.
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
