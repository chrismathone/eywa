/**
 * 일정 제목 안의 전화번호 가림 — 레벨테스트 일정은 제목에 학부모 번호를 적는 일이 있다(원장 외엔 가림이 기본).
 * 뒤 네 자리만 남기고 가린다. 날짜(2026-10-01)·시각(14:30)·학년 같은 짧은 숫자는 건드리지 않는다.
 *
 * 구분자는 사람이 손으로 적는 모양을 다 받는다 — 하이픈·점·슬래시·가운뎃점·en/em 대시·괄호·공백(최대 3자, `010 - 1234 - 5678` 포함).
 * 🔴 모르는 모양은 **가려지지 않은 채** 나간다(가림은 정규식 한 벌이 전부 — 새 표기를 발견하면 여기에 추가하고 테스트에 적을 것).
 * 🔴 **한 번의 훑기**로 세 모양(국가번호 → 지역번호 → 8자리)을 함께 찾는다 — 따로 돌리면 앞 단계가 가린 번호의 꼬리 4자리가
 *    뒤따르는 숫자(`… 5678 2026-10-02`)와 다시 한 쌍으로 읽혀 날짜를 먹는다.
 */
const SEP = String.raw`[\s\-.–—/·()]{0,3}`;
const INTL = String.raw`(?<!\d)(\+?82)${SEP}0?(\d{1,2})${SEP}(\d{3,4})${SEP}(\d{4})(?!\d)`;
/** 지역번호 2~3자리 또는 0505 같은 4자리 — 앞쪽(`0\d{1,2}`)부터 시도해 `010`이 `0101`로 읽히지 않는다. */
const PHONE = String.raw`(?<!\d)(0\d{1,2}|050\d)${SEP}(\d{3,4})${SEP}(\d{4})(?!\d)`;
/** 지역번호 없이 적은 8자리(1234-5678). */
const SHORT = String.raw`(?<!\d)(\d{4})[\s\-.–—/·]{1,3}(\d{4})(?!\d)`;
const ANY = new RegExp(`${INTL}|${PHONE}|${SHORT}`, "g");

/** 번호가 아닌 8자리 쌍 — 시각 범위(1500-1600)·연도 범위(2025-2026). 그대로 둔다(대신 1544-1234 같은 대표번호도 안 가려진다). */
const CLOCK = /^(?:[01]\d|2[0-3])[0-5]\d$/;
const YEAR = /^(?:19|20)\d\d$/;

export function maskPhones(text: string): string {
  return text.replace(ANY, (m: string, ...g: (string | undefined)[]) => {
    const [cc, area, , iLast, pArea, , pLast, sFirst, sLast] = g;
    if (cc) return `${cc}-${area}-****-${iLast}`;
    if (pArea) return `${pArea}-****-${pLast}`;
    const first = sFirst ?? "";
    const last = sLast ?? "";
    if ((CLOCK.test(first) && CLOCK.test(last)) || (YEAR.test(first) && YEAR.test(last))) return m;
    return `****-${last}`;
  });
}
