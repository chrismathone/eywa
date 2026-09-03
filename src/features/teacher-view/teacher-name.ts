/**
 * **강사 이름 표기** — 영어 화면에서는 그 강사의 영어 이름으로 (원장 2026-09-03:
 * *"선생님 이름도 영어선생님의 경우 영어 이름으로 바뀌고"*).
 *
 * 🔴 **번역이 아니다 — 이미 저장돼 있는 사실을 고른다.** `users.english_name`은 영어 시간표 매칭의
 * 앵커라 이 학원이 실제로 쓰는 이름이고(실측 2026-09-03: 영어 반 담임 8명 전원 보유 — Song·Charlie·
 * Elsa·Jane·Anna·Sam·Hannah·Daniella), 원어민 강사는 동료를 그 이름으로 부른다. 음차하거나 지어내지
 * 않는다 — **없으면 한국어 이름 그대로**다.
 *
 * ## 왜 id가 아니라 이름으로 찾나
 * 시간표 슬롯이 들고 있는 것은 FK가 아니라 **라벨 문자열**(`slot.teacherLabel`)이고, 화면은 그 라벨을
 * 우선한다(시간표 3뷰와 같은 순서 — FK 우선으로 뒤집으면 ECS에만 다른 이름이 뜬다,
 * [`period-block.tsx`](../class-sheets/components/period-block.tsx) 주석). 그래서 옮기는 축도 **이름**이다.
 * ⚠️ 라벨이 이미 영어 별명인 경우가 있다(`Song` · 부원장→`Yoojin` 별칭,
 * [`TITLE_LABEL_ALIASES`](../timetable/lib/teacher-label.ts)) — 그때는 표에 없으니 **그대로 남는다**(맞다).
 *
 * ## 🔴 사람이 아닌 라벨을 옮기지 않는다
 * 이 자리엔 자리(`LAB`·`JJ`)나 강의실 표기가 라벨로 들어오기도 한다. 표에 없으면 손대지 않으므로
 * 저절로 안전하다 — 🔴 여기에 "모르면 로마자로 바꾼다" 같은 폴백을 넣지 말 것.
 *
 * ## 🔴 표시 전용
 * 저장값·검색·매칭·엑셀·인쇄·학부모 표면은 **한국어 이름 고정**이다(학부모는 영어 이름을 모른다).
 * 가드가 그 경로들의 import를 구조로 막는다([`teacher-name.test.ts`](./teacher-name.test.ts)).
 */
import type { SheetLang } from "./i18n";

/** 표시 이름(`users.display_name`) → 영어 이름(`users.english_name`). 서버가 만들어 내려보낸다. */
export type TeacherEnglishNames = Readonly<Record<string, string>>;

/**
 * 화면에 적을 강사 이름.
 *
 * @param label 화면이 이미 고른 표시 라벨(슬롯 라벨 → FK 이름 → 담임 순서로 해석된 값).
 * @param map   표시 이름 → 영어 이름.
 */
export function teacherNameFor(
  label: string | null | undefined,
  map: TeacherEnglishNames | null | undefined,
  lang: SheetLang,
): string | null {
  const raw = (label ?? "").trim();
  if (!raw) return null;
  if (lang !== "en" || !map) return raw;
  const en = map[raw]?.trim();
  // 🔴 없으면 한국어 이름 그대로 — 빈 칸을 만들거나 지어내지 않는다.
  return en ? en : raw;
}

/**
 * 여러 이름이 한 문장에 들어가는 자리(`김태건 외 2명`)용 — 조각마다 같은 규칙을 태운다.
 * ⚠️ 구분자는 호출부가 정한다(문장 구조는 사전이 갖고 있다).
 */
export function teacherNamesFor(
  labels: ReadonlyArray<string | null | undefined>,
  map: TeacherEnglishNames | null | undefined,
  lang: SheetLang,
): string[] {
  const out: string[] = [];
  for (const l of labels) {
    const n = teacherNameFor(l, map, lang);
    if (n) out.push(n);
  }
  return out;
}
