/**
 * 직원 계약 기간 계산(원장 지시 2026-07-29) — **첫 출근일로부터 1년**이 1차 계약이고,
 * 차수가 늘 때마다 1년씩 이어진다. 저장된 계약 행이 있으면 그 행이 진실이고,
 * 없으면 입사일에서 파생한다(계약을 한 번도 기입하지 않은 직원도 현재계약이 보이게).
 *
 * 순수 함수 — 날짜는 "YYYY-MM-DD" 문자열로만 다룬다(시간대에 흔들리지 않게).
 */

export type ContractRow = {
  id: string;
  seq: number;
  /** 기간이 있는 계약('contract')인지, 시트 히스토리의 기간 없는 한 줄('note')인지. */
  kind: "contract" | "note";
  /** note는 날짜가 없을 수 있다(인센티브 조항 등). */
  startDate: string | null;
  endDate: string | null;
  terms: string | null;
  memo: string | null;
  /** 시트 셀에서의 줄 순서(0=맨 위). 날짜 없는 줄의 원문 순서 보존용. */
  lineNo: number | null;
};

/** 기간이 온전한 계약만 — 현재계약·차수 계산은 이것만 본다(note는 이력 표시 전용). */
export function contractsOnly(rows: readonly ContractRow[]): ContractRow[] {
  return rows.filter((r) => r.kind === "contract" && !!r.startDate && !!r.endDate);
}

export type ContractPeriod = {
  seq: number;
  startDate: string;
  endDate: string;
  /** 저장된 행에서 온 기간인가(false = 입사일에서 계산한 값). */
  stored: boolean;
};

/** "YYYY-MM-DD"에 n년을 더한다. 2/29 시작은 평년에 2/28로 맞춘다(존재하지 않는 날짜 방지). */
export function addYears(date: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return "";
  const y = Number(m[1]) + n;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // 그 달의 마지막 날
  const day = Math.min(d, last);
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 현재 계약 = 저장된 계약 중 **가장 큰 차수**, 없으면 입사일 기준 1차(입사일 ~ +1년).
 * 입사일도 없으면 null(계산할 근거가 없다 — 화면은 "입사일을 먼저 입력하세요"로 안내).
 */
export function currentContract(rows: readonly ContractRow[], hireDate: string | null | undefined): ContractPeriod | null {
  // 기간 없는 이력 줄(note)은 '현재 계약'이 될 수 없다 — 이력 목록에만 보인다.
  const periods = contractsOnly(rows);
  if (periods.length > 0) {
    const top = [...periods].sort((a, b) => b.seq - a.seq)[0];
    return { seq: top.seq, startDate: top.startDate!, endDate: top.endDate!, stored: true };
  }
  const hire = (hireDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hire)) return null;
  return { seq: 1, startDate: hire, endDate: addYears(hire, 1), stored: false };
}

/**
 * 다음 차수 연장의 **기본 제안값** — 현재 계약이 끝나는 날부터 1년.
 * 저장된 계약이 없으면 입사일 기준 2차(입사일+1년 ~ +2년)가 된다.
 */
export function nextContractDefault(
  rows: readonly ContractRow[],
  hireDate: string | null | undefined,
): { seq: number; startDate: string; endDate: string } | null {
  const cur = currentContract(rows, hireDate);
  if (!cur) return null;
  return { seq: cur.seq + 1, startDate: cur.endDate, endDate: addYears(cur.endDate, 1) };
}

/** 만료까지 남은 일수(음수 = 이미 지남). today도 "YYYY-MM-DD". */
export function daysUntil(endDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.UTC(+endDate.slice(0, 4), +endDate.slice(5, 7) - 1, +endDate.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round((a - b) / 86400000);
}

/** 화면 표기 — "2026-06-06 ~ 2027-06-05" 같은 한 줄. */
export function periodLabel(p: { startDate: string; endDate: string }): string {
  return `${p.startDate} ~ ${p.endDate}`;
}
