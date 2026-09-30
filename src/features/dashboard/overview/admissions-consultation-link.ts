import { isCancelledEventTitle } from "@/features/calendar/cancelled";
import { addDays } from "@/lib/date-kst";
import { baseNameOf } from "@/features/students/name-suffix";
import { containsWord, schoolGradeKey, titleSchoolHints } from "./admissions-class-link";

/**
 * 운영실 '레벨테스트 및 첫수업 일정' 한 줄 ↔ 콜&상담 — 순수 판정(Vitest). 원장 2026-09-13:
 * *"14시에 입학 예정이였던 전유솔 일정 있지? 실제로 오늘 상담을 했으므로 이후에 상담이 생겼을 때 링크 연결 가능한지"* ·
 * *"일정상 첫 수업은 '김근우A'인데 캘린더에서 그대로 가져오다 보니 '김근우'로 되어 있네. 가져올 때 후보정"*.
 *
 * 🔑 **저장하지 않는다** — 운영실은 30초마다 다시 계산하므로 일정이 먼저 있고 상담이 나중에 생겨도 다음 갱신에 저절로 붙는다.
 *    일정·상담 어느 쪽에도 연결 칸을 만들지 않는다(구글에서 가져온 일정은 제목 문자열뿐이다).
 * 규칙(모호하거나 모순이면 붙이지 않는다 — 0258a 동명이인 원칙과 같은 방향. 틀린 링크·틀린 이름이 링크 없음보다 나쁘다):
 *   1. 이름: 상담 이름(또는 연결된 원생의 정식 이름·접미사 뗀 이름)이 제목에 **낱말로** 있어야 한다('김지우'가 '김지우현'에 안 걸린다).
 *      제목 앞 `[담당자]` 괄호는 직원 이름이라 떼고 본다. 사람 이름 모양(한글 2~4자 + 접미사)이 아니거나 '어머니·영어문의·첫수업'
 *      같은 낱말은 이름이 아니다.
 *   2. 날짜: 상담이 일정일 60일 전 이후(`consulted_at`). 서버가 받아 온 범위(`since`)보다 앞으로는 넓히지 않는다(모르는 구간을 없다고 치지 않게).
 *   3. 같은 아이 = **연결된 원생이 같다**(학교 표기가 달라도). 🔴 원생 연결이 없는 상담은 **원생 쪽에 합치지 않는다** — 0258a가 보호자
 *      번호가 다른 동명이인 QR을 일부러 연결 없이 남기는데, 그걸 이름·학교·학년만으로 합치면 바로 그 아이를 다른 아이로 만든다.
 *      연결 없는 상담끼리는 이름·학교·학년이 같으면 한 아이(거듭 접수)이고, 학교를 모르면 번호가 같을 때만 한 아이다(빈 칸은 같음의 증거가 아니다).
 *   4. 🔴 **모순이면 한 명이어도 안 붙인다**: 제목에 학교·학년 힌트('일중1')가 있는데 그 아이의 상담이 모두 다른 학교·학년이면 제외
 *      (반 연결 `matchFirstClass`와 같은 방향). 학교(급)를 모르는 상담('칠성'+'5')은 모순도 증거도 아니다. 모순으로 누군가를 뺐다면
 *      같은 이름의 다른 아이가 있다는 뜻이라, 남은 쪽도 번호나 학교·학년이 **실제로 맞아야** 붙는다.
 *      🔴 **보호자 번호는 모순으로 치지 않는다** — 엄마·아빠 번호가 갈린다(실측: 전유솔 일정 제목의 번호 ≠ QR 상담의 보호자 번호).
 *   5. 그래도 둘 이상이면 제목의 **전화번호**, 그다음 **학교·학년 힌트**로 한 사람이 남을 때만 고른다.
 *   6. 🔴 **동명이인**(원생 표에 이 아이 말고 같은 이름의 재원·대기 원생이 있다 — `families`, 연결 없는 아이는 원생 표에 없으니 한 명만
 *      있어도 동명이인이다)이면 창 안 상담이 한 명뿐이어도 **직접 증거**가 있어야 붙인다: 제목 번호가 이 아이 상담 번호와 같거나, 제목의
 *      학교·학년이 이 아이에게는 맞고 다른 동명이인 누구에게도 안 맞을 때. 60일 창은 원래 원생 '김근우'의 옛 상담을 지워 '김근우A' 상담
 *      하나만 남긴다 — 창만 보면 모호하지 않아 보인다.
 *   7. 고른 아이의 가장 최근 상담으로 링크하고, 이름은 연결된 원생의 정식 이름(없으면 상담 이름)을 돌려준다.
 */
export type AdmissionsConsultationCandidate = {
  id: string;
  /** 상담의 학생 이름(prospect_name). */
  name: string;
  school: string | null;
  grade: string | null;
  /** 보호자 번호 숫자만 — 동명이인을 가를 때만 쓴다(모순 조건 아님). 서버 판정용, 클라이언트로 안 나간다. */
  phoneDigits: string | null;
  studentId: string | null;
  /** 연결된 원생의 정식 이름(동명이인 접미사 포함). */
  studentName: string | null;
  /** 상담 날짜 KST(`consulted_at`). */
  consultedOn: string;
};

/** 접미사 뗀 이름 → 그 이름을 쓰는 재원·대기 원생들(id + 학교·학년 키 `schoolGradeKey`). */
export type HomonymFamilies = ReadonlyMap<string, readonly { studentId: string; key: string }[]>;

export const CONSULTATION_LINK_WINDOW_DAYS = 60;

const squash = (text: string) => text.replace(/\s+/g, "");
const PERSON_NAME = /^[가-힣]{2,4}[A-Z]?$/;
const NOT_A_NAME_SUFFIX = /(문의|상담|학생|학부모|예약|입테|레테|수업|동생|형제)$/;
const NOT_A_NAME = new Set(["어머니", "아버지", "엄마", "아빠", "미정", "초등", "중등", "고등", "신규", "재원", "대기", "원장", "대표", "대표님"]);
/** 제목 앞의 `[대표] · [허은진,정유진]` — 담당 직원 표시라 이름 대조에서 뺀다. */
const stripStaffTags = (title: string) => title.replace(/\[[^\]]*\]/g, " ");

function titlePhones(title: string): Set<string> {
  return new Set(
    [...title.matchAll(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g)].map((m) => m[0].replace(/\D/g, "")),
  );
}

type Candidate = AdmissionsConsultationCandidate;

function isPersonName(name: string, stop: ReadonlySet<string>): boolean {
  return (
    PERSON_NAME.test(name) &&
    !NOT_A_NAME_SUFFIX.test(name) &&
    !NOT_A_NAME.has(baseNameOf(name)) &&
    !stop.has(name) &&
    !stop.has(baseNameOf(name))
  );
}

/** 이 상담이 제목(직원 괄호 뗀 것)의 낱말로 걸리는가 — 매칭·가족 조회 대상 고르기가 같은 판정을 쓴다. */
function nameHits(title: string, c: Candidate, stop: ReadonlySet<string>): boolean {
  const name = squash(c.name);
  if (!isPersonName(name, stop)) return false;
  const aliases = [name, baseNameOf(name), c.studentName ? squash(c.studentName) : ""];
  return aliases.some((alias) => containsWord(title, alias));
}

const baseOf = (c: Candidate) => baseNameOf(squash(c.studentName ?? c.name));

/** 상담의 학교·학년 키 — 학교가 비었거나 학교급(초·중·고)을 알 수 없으면('칠성' + '5') null = 모름(모순도 증거도 아니다). */
function schoolInfo(c: Candidate): string | null {
  const school = (c.school ?? "").trim();
  if (!school || (!/[초중고]/.test(school) && !/[초중고]/.test(c.grade ?? ""))) return null;
  return schoolGradeKey(c.school, c.grade);
}

/** 서버가 동명이인 가족을 조회할 이름들 — 일정 제목에 걸린 상담의 접미사 뗀 이름(보통 몇 개). */
export function consultationBasesInTitles(
  events: readonly { title: string }[],
  candidates: readonly Candidate[],
  notNames: readonly string[] = [],
): string[] {
  const stop = new Set(notNames.map(squash));
  const titles = events.filter((e) => !isCancelledEventTitle(e.title)).map((e) => stripStaffTags(e.title));
  return [...new Set(candidates.filter((c) => titles.some((t) => nameHits(t, c, stop))).map(baseOf))];
}

/**
 * @param notNames 이름으로 치지 않을 낱말(학원설정 과목 라벨 등 — '영어'라는 상담 이름이 '영어 입테' 제목에 걸리지 않게).
 * @param opts.since 서버가 상담을 받아 온 첫날(KST) — 창 하한을 이보다 앞으로 넓히지 않는다.
 * @param opts.families 동명이인 가족(규칙 6). 서버는 늘 넘긴다(조회 실패면 이 함수를 아예 부르지 않는다).
 */
export function matchAdmissionsConsultation(
  event: { title: string; startDate: string },
  candidates: readonly Candidate[],
  notNames: readonly string[] = [],
  opts: { since?: string; families?: HomonymFamilies } = {},
): { id: string; name: string } | null {
  if (isCancelledEventTitle(event.title)) return null;
  const title = stripStaffTags(event.title);
  const windowFloor = addDays(event.startDate, -CONSULTATION_LINK_WINDOW_DAYS);
  const floor = opts.since && opts.since > windowFloor ? opts.since : windowFloor;
  const stop = new Set(notNames.map(squash));
  const named = candidates.filter((c) => c.consultedOn >= floor && nameHits(title, c, stop));
  if (!named.length) return null;

  // 3. 사람 묶기 — 연결된 원생은 원생 id로, 연결 없는 상담은 자기들끼리만(원생 쪽에 합치지 않는다).
  const people = new Map<string, Candidate[]>();
  const push = (key: string, c: Candidate) => people.set(key, [...(people.get(key) ?? []), c]);
  for (const c of named) {
    const info = schoolInfo(c);
    if (c.studentId) push(`s:${c.studentId}`, c);
    else if (info) push(`n:${baseOf(c)}|${info}`, c);
    else if (c.phoneDigits) push(`n:${baseOf(c)}|p:${c.phoneDigits}`, c);
    else push(`id:${c.id}`, c);
  }

  const hints = titleSchoolHints(title);
  const phones = titlePhones(event.title);
  const phoneHit = (p: Candidate[]) => p.some((c) => !!c.phoneDigits && phones.has(c.phoneDigits));
  const schoolHit = (p: Candidate[]) => p.some((c) => { const k = schoolInfo(c); return k !== null && hints.includes(k); });

  // 4. 모순 제외 — 제목의 학교·학년과 다른 학교·학년만 적힌 아이는 한 명뿐이어도 안 붙인다.
  const all = [...people.values()];
  const consistent = (p: Candidate[]) => !hints.length || p.some((c) => { const k = schoolInfo(c); return k === null || hints.includes(k); });
  let chosen = all.filter(consistent);
  // 모순으로 누군가를 뺐다 = 같은 이름의 다른 아이가 있다 → 남은 쪽도 번호나 학교·학년이 실제로 맞아야 한다(모르는 칸은 증거가 아니다).
  if (chosen.length < all.length) chosen = chosen.filter((p) => phoneHit(p) || schoolHit(p));

  // 5. 동명이인 가르기 — 번호 → 학교·학년 힌트(실제로 일치하는 쪽만).
  if (chosen.length > 1) {
    const byPhone = chosen.filter(phoneHit);
    if (byPhone.length === 1) chosen = byPhone;
  }
  if (chosen.length > 1 && hints.length) {
    const bySchool = chosen.filter(schoolHit);
    if (bySchool.length === 1) chosen = bySchool;
  }
  if (chosen.length !== 1) return null;
  const person = chosen[0];

  // 6. 동명이인 — 원생 표에 이 아이 말고 같은 이름의 원생이 있으면 직접 증거가 있어야 한다.
  const self = person.find((c) => c.studentId)?.studentId ?? null;
  const family = opts.families?.get(baseOf(person[0])) ?? [];
  const others = family.filter((f) => f.studentId !== self);
  if (others.length > 0) {
    const myKeys = [
      ...family.filter((f) => f.studentId === self).map((f) => f.key),
      ...person.flatMap((c) => { const k = schoolInfo(c); return k ? [k] : []; }),
    ];
    const schoolOk = hints.some((h) => myKeys.includes(h) && !others.some((o) => o.key === h));
    if (!phoneHit(person) && !schoolOk) return null;
  }

  const latest = [...person].sort((a, b) => b.consultedOn.localeCompare(a.consultedOn) || b.id.localeCompare(a.id))[0];
  const withStudent = person.find((c) => c.studentName);
  return { id: latest.id, name: squash(withStudent?.studentName ?? latest.name) };
}

/**
 * 일정 제목의 학생 이름을 **정식 이름**으로 — 제목엔 '김근우'인데 연결된 원생이 '김근우A'면 그 낱말 하나만 바꾼다.
 * 접미사가 없는 이름이거나 이미 정식 이름이 적혀 있으면 원문 그대로다(없는 걸 지어내지 않는다). `[담당자]` 괄호 안은 건드리지 않는다.
 * 원문은 호출부가 보존한다(카드·팝업의 툴팁).
 */
export function canonicalEventTitle(title: string, canonical: string | null | undefined): string {
  const name = canonical ? squash(canonical) : "";
  const base = baseNameOf(name);
  if (!name || base === name || containsWord(stripStaffTags(title), name)) return title;
  const brackets = [...title.matchAll(/\[[^\]]*\]/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const);
  const inBracket = (at: number) => brackets.some(([from, to]) => at >= from && at < to);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let done = false;
  return title.replace(
    new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "gu"),
    (match: string, pre: string, offset: number) => {
      // 이름이 시작하는 자리(= 앞 글자 다음)가 괄호 안인지 본다 — '[대표]김근우'는 ']' 뒤라 괄호 밖이다.
      if (done || inBracket(offset + pre.length)) return match;
      done = true;
      return `${pre}${name}`;
    },
  );
}
