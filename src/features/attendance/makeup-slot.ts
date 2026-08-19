/**
 * 보강 확인창의 **교시 선택지** — 순수(Vitest).
 *
 * 🔴 왜 필요한가: 영어(ECS)는 **하루에 한 교시만 도는 반이 없다**(실측 2026-08-19: 활성 반-요일 115개가
 *    전부 2~4교시). 그런데 보강 추가가 교시를 안 넘기면 그 칸은 `slot_start = null`로 저장되고, 주간
 *    시트는 그런 행을 **그날 첫 교시 칸**에 붙인다 — 3교시에 온 보강 학생이 1교시 자리에 앉는다.
 *    데이터가 깨지는 건 아니지만 화면이 사실과 다르고, 그 칸을 자리(JJ)·교시 축 화면들이 못 알아본다.
 * ⚠️ 교시 축이 **없는** 화면(원스크린·반별 출석부)은 선택지를 넘기지 않는다 — 거기선 "그날 전체"가
 *    맞는 축이라, 없는 질문을 만들면 강사가 매번 의미 없는 선택을 하게 된다.
 * ⚠️ 라벨에 교시 이름을 **지어내지 않는다** — 이름은 호출부가 요일별 교시표로 확정한 값만 쓴다
 *    (시작시각이 같은 교시가 둘 있어 이름을 추측하면 조용히 다른 교시가 된다, [[#106]]).
 * 🔴 **자리(LAB·JJ) 교시는 선택지에서 뺀다.** 자리 출석부의 명단은 수강 기반이라 그 교시에 넣은 보강은
 *    자리 화면에 **영영 안 보인다**. 자리는 화면에 뜨더라도(원장 2026-08-19 "JJ/LAB은 떠도 된다") 보강을
 *    **넣는** 자리는 아니다 — 보강은 반 축에서만 추가한다(CLAUDE.md 결정 로그).
 */

import { isSpecialSlotLabel } from "@/features/timetable/lib/teacher-label";

/** 확인창이 보여 줄 교시 한 줄. `start`가 저장 축("HH:MM"), `label`은 사람이 읽는 표기. */
export type MakeupSlotOption = { start: string; label: string };

/** 화면이 들고 있는 교시(주간 그리드·오늘 보드 공용 모양). */
export type MakeupSlotSource = {
  slotStart: string;
  slotEnd?: string | null;
  /** 요일별 교시표로 **확정된** 이름("N교시"). 못 찾았으면 null — 그때는 시각만 쓴다. */
  periodLabel?: string | null;
  /**
   * 그 교시의 담당 표시명 — 자리(LAB·JJ) 판정에만 쓴다. 🔴 **권한·매칭 근거로 쓰지 말 것**
   * (표시명은 FK와 다른 사람을 가리킬 수 있다). 여기선 "자리인가"만 본다.
   */
  teacherLabel?: string | null;
};

const HHMM = /^(\d{2}):(\d{2})/;

/** "16:20:00" → "16:20". 형식이 아니면 null(추측해서 만들지 않는다). */
function hhmm(raw: string | null | undefined): string | null {
  const m = HHMM.exec(String(raw ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * 화면의 교시들을 확인창 선택지로 — 같은 시작시각은 접고, 이른 순으로 정렬한다.
 * 접을 때 **이름이 있는 쪽을 살린다**(같은 시각에 이름 있는 줄과 없는 줄이 섞일 수 있다).
 */
export function buildMakeupSlotOptions(slots: readonly MakeupSlotSource[]): MakeupSlotOption[] {
  // ⚠️ "이름이 붙었나"를 **라벨 문자열로 되짚지 않는다** — 이름 없는 라벨도 시각으로 시작해서
  //    시작 문자열 비교로는 갈리지 않는다(첫 구현이 그렇게 틀렸다). 플래그로 명시한다.
  const byStart = new Map<string, { option: MakeupSlotOption; named: boolean }>();
  for (const s of slots) {
    // 자리(LAB·JJ)는 보강을 넣는 자리가 아니다 — 위 🔴.
    if (isSpecialSlotLabel(s.teacherLabel)) continue;
    const start = hhmm(s.slotStart);
    if (!start) continue;
    const end = hhmm(s.slotEnd);
    const name = s.periodLabel?.trim() || null;
    const label = name ? `${name} ${start}` : end ? `${start}~${end}` : start;
    const prev = byStart.get(start);
    // 이름이 붙은 쪽이 이긴다 — 사람이 시간표에서 부르는 이름이 가장 알아보기 쉽다.
    if (!prev || (!!name && !prev.named)) byStart.set(start, { option: { start, label }, named: !!name });
  }
  return [...byStart.values()]
    .map((v) => v.option)
    .sort((a, b) => a.start.localeCompare(b.start));
}
