/**
 * 보강이 메울 **결석 후보** 정리(순수 · Vitest) — "며칠자 결석분인가"를 손으로 적는 대신 고르게 한다.
 *
 * 원장 2026-08-19: *"반이동으로 인해 반이 이동했는데 이전 수업을 이월해 보강할 수도 있을테니까."*
 * 그래서 후보는 **지금 수강 중인 반이 아니라 출결 기록**에서 뽑는다 — 반을 옮겨도 옛 반의 결석 기록은
 * 그 반 이름으로 남아 있으므로, 이월 보강이 자연히 후보에 들어온다(수강 여부로 거르면 사라진다).
 *
 * 🔴 **보강한 날은 후보가 아니다** — 출석부가 (반·학생·날짜) 한 칸이라 "결석 0 그대로 + 보강 시수"를
 *    동시에 적을 자리가 없다(그 경우는 합침이거나 '추가 보강'이다). 서버도 같은 이유로 거절한다.
 * ⚠️ 같은 날 같은 반에 **교시 수만큼 행이 있다**(slot_start) — 실측 한 학생 하루 3행. 화면엔 한 줄로 접는다.
 */

/** 결석 후보 한 줄(화면·판정에 필요한 것만). */
export type MakeupAbsenceOption = {
  classId: string;
  className: string;
  /** YYYY-MM-DD */
  date: string;
  /** 지금은 그 반 수강이 아님(반 이동·수강 종료 뒤) — 화면에 "이전 반"으로 밝힌다. */
  pastClass?: boolean;
  /**
   * 이미 보강으로 메운 결석 — 그 칸 메모에 "N/N 보강 예정·완료"가 남아 있다.
   * 🔴 목록에서 지우지 않고 **표시만** 한다: 같은 결석을 두 번 메우는 오조작은 막아야 하지만,
   *    보이지 않으면 "왜 내 결석이 목록에 없지"가 된다(멱등은 같은 날짜쌍만 막는다).
   */
  alreadyMadeUp?: boolean;
  /**
   * 그날 그 반의 결석 **교시**("HH:MM", 이른 순) — 하루에 여러 교시를 도는 반(JJ실·영어)에서 어느
   * 수업의 결석인지 밝힌다. 교시 없이 하루 단위로 찍힌 결석은 비어 있다.
   * 🔴 **교시 '이름'을 붙이지 않는다** — 시작시각이 같은 교시가 둘 있어(EiE 4교시 16:20~17:00 /
   *    IJW 1교시 16:20~17:20) 이름으로 옮기면 조용히 다른 교시로 보인다([[#106]]). 시각이 사실이다.
   */
  slots?: string[];
};

/** 원본 출결 행(중복·정렬 전). */
export type AbsenceRow = {
  classId: string;
  className: string | null;
  date: string;
  /** 그 결석 칸의 메모 — "N/N 보강 예정"이 있으면 이미 메운 결석이다. */
  note?: string | null;
  /** 그 칸의 교시("HH:MM[:SS]") — 하루 단위로 찍힌 결석은 없다(null). */
  slotStart?: string | null;
};

/**
 * 결석 행을 화면에 쓸 후보로 접는다 — (반,날짜) 중복 제거 + 최신순 + 보강일 제외.
 * @param makeupDate 보강을 실제로 한 날 — 이 날은 후보에서 뺀다(위 🔴).
 * @param currentClassIds 지금 수강 중인 반 id 집합 — 여기 없으면 '이전 반'으로 표시한다.
 */
/** 결석 칸 메모의 보강 표시 — `absenceMemo()`가 남기는 "7/16 보강 예정 · 보강 완료" 형태. */
const MADE_UP_RE = /\d{1,2}\/\d{1,2}\s*보강\s*(예정|완료)/;

export function buildAbsenceOptions(
  rows: readonly AbsenceRow[],
  makeupDate: string,
  currentClassIds: ReadonlySet<string> = new Set(),
): MakeupAbsenceOption[] {
  // 같은 (반,날짜)의 교시별 행을 **접으면서** 교시를 모은다 — 첫 행만 보고 버리면 "어느 수업의
  // 결석인지"가 사라지고, 보강 메모가 뒤 행에만 있는 경우 '보강 완료' 표시도 놓친다.
  const folded = new Map<string, { option: MakeupAbsenceOption; slots: Set<string>; madeUp: boolean }>();
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    if (!r.classId || !date || date === makeupDate) continue;
    const key = `${r.classId}|${date}`;
    const madeUp = MADE_UP_RE.test(r.note ?? "");
    const slot = slotLabel(r.slotStart);
    const hit = folded.get(key);
    if (hit) {
      if (slot) hit.slots.add(slot);
      hit.madeUp = hit.madeUp || madeUp;
      continue;
    }
    folded.set(key, {
      option: {
        classId: r.classId,
        // 반 이름이 비면 그렇게 적는다 — 빈 칸을 만들지 않는다(무엇을 고르는지 모르게 된다).
        className: r.className?.trim() || "(반 이름 없음)",
        date,
        ...(currentClassIds.has(r.classId) ? {} : { pastClass: true }),
      },
      slots: new Set(slot ? [slot] : []),
      madeUp,
    });
  }
  const out: MakeupAbsenceOption[] = [...folded.values()].map(({ option, slots, madeUp }) => ({
    ...option,
    ...(madeUp ? { alreadyMadeUp: true } : {}),
    ...(slots.size > 0 ? { slots: [...slots].sort() } : {}),
  }));
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.className.localeCompare(b.className, "ko")));
}

/** 저장된 교시 시각을 화면용 "HH:MM"으로 — 형식이 아니면 버린다(추측해서 만들지 않는다). */
function slotLabel(raw: string | null | undefined): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(String(raw ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** 화면 표기 — "8/12 수학 초4 BS1J 16:20" · 이전 반이면 꼬리표를 단다. */
export function absenceOptionLabel(o: MakeupAbsenceOption): string {
  const [, m, d] = o.date.split("-");
  const tags = [o.pastClass ? "이전 반" : null, o.alreadyMadeUp ? "보강 완료" : null].filter(Boolean);
  // 하루 여러 교시를 도는 반이면 어느 수업의 결석인지 시각으로 밝힌다(교시 이름은 안 쓴다 — 위 🔴).
  const slots = o.slots?.length ? ` ${o.slots.join("·")}` : "";
  return `${Number(m)}/${Number(d)} ${o.className}${slots}${tags.length ? ` (${tags.join(" · ")})` : ""}`;
}
