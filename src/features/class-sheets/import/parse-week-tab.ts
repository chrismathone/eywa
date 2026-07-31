// 반별 시트 주차 탭(요일×교시 격자) → 구조화. 순수(Vitest). IO·DB 없음.
//
// 🔴 **컬럼 위치를 절대 하드코딩하지 않는다.** 실측(2026-07-30, 28문서)에서 요일 블록 시작 컬럼이
//    `월=G` / `월=H` / `월=I`로 제각각이고 요일 순서가 어긋난 문서도 있어 **배치가 10종**이었다.
//    처음에 컬럼을 고정해 짰더니 28반 중 26반이 **에러 없이 "학생 0명"**으로 나왔다(가장 위험한 형태의
//    조용한 실패). 그래서 헤더행(`요일` 바로 오른쪽이 `시기`)에서 요일 컬럼을 찾아낸다.
//
// 블록 구조(요일 컬럼 c 기준):
//   c-1 = 교시/시각 열("1교시" 또는 "02:20\n~\n03:00")
//   c   = 요일 헤더 / 강사·강의실("Elsa\n(담임)\n\n303호") / 학생명
//   c+1 = "시기"(평시·내신) / 출석 체크(TRUE·FALSE)
//   c+2 = 구분(영역) / 학교
//   c+3..c+6 = 교재·페이지·진도·과제 / 학생 개인 기록
import type { DowKey } from "../lib/week";

export const DAY_LABELS: Readonly<Record<string, DowKey>> = {
  월: "mon",
  화: "tue",
  수: "wed",
  목: "thu",
  금: "fri",
  토: "sat",
  일: "sun",
};

export type ParsedSlot = {
  day: DowKey;
  /** 탭 안에서 이 블록을 가리키는 키 — `mon|1교시`. */
  slotKey: string;
  periodLabel: string;
  /** 시각 원문("02:20~03:00") — 없을 수 있다. */
  timeRaw: string | null;
  /** 24시각 변환 시작 시각("14:20") — 변환 불가면 null. */
  start24: string | null;
  end24: string | null;
  teacherLabel: string | null;
  roomLabel: string | null;
};

export type ParsedPlanLine = {
  day: DowKey;
  slotKey: string;
  termMode: "regular" | "exam";
  skillLabel: string | null;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
};

export type ParsedMark = {
  day: DowKey;
  slotKey: string;
  studentLabel: string;
  school: string | null;
  present: boolean;
  /** '완/결석/안침' 등 상태 어휘로 인식된 값. */
  status: string | null;
  /** 그 외 자유 기록(개인 진도) — 여러 칸이면 공백으로 이어붙인다. */
  note: string | null;
};

export type ParsedGoal = {
  role: "homeroom" | "assistant";
  scope: "month" | "week";
  skillLabel: string;
  textbook: string | null;
  targetProgress: string | null;
};

export type ParsedWeekTab = {
  dayColumns: Partial<Record<DowKey, number>>;
  slots: ParsedSlot[];
  planLines: ParsedPlanLine[];
  marks: ParsedMark[];
  goals: ParsedGoal[];
};

/** 상태 어휘 — lib/bulk.ts STATUS_CHIPS와 같은 값. 그 외 텍스트는 개인 진도로 본다. */
const STATUS_WORDS = new Set(["완", "결석", "안침", "지각", "보강", "결", "미완"]);

const PERIOD_RE = /^(\d{1,2})\s*교시$/;
const TIME_RE = /(\d{1,2})\s*:\s*(\d{2})/g;

const clean = (v: string | undefined): string => (v ?? "").replace(/ /g, " ").trim();
const nz = (v: string | undefined): string | null => {
  const t = clean(v);
  return t === "" ? null : t;
};

/**
 * 시트의 12시간 표기를 24시로. 영어 수업은 오후~밤이라 **1~7시는 오후**(1:00→13:00, 7:10→19:10),
 * **8~12시는 그대로**(토요일 9:00 수업 실재, 12시는 정오). 실측 근거: 토요일에 `9:00-12:00`(고1 특별 S)과
 * `1:00~3:50`(고2 심화)이 같은 시트군에 공존한다 — 한쪽 규칙만 적용하면 반대쪽이 3~4시간 어긋난다.
 */
export function to24h(hour: number, minute: number): string | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const h = hour >= 1 && hour <= 7 ? hour + 12 : hour;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * 교시 시각 셀 → 시작·종료. **온전한 범위가 아닐 수 있다** — 실측(초등 브릿지 B 화요일)에서 강사가
 * `04:00~05:00`을 두 교시 칸에 걸쳐 쓰는 바람에 셀이 `"04:00\n~"`(시작만)과 `"~\n05:00"`(종료만)으로
 * 쪼개져 있었다. 온전한 범위만 인정하면 그런 교시가 통째로 유실된다(실측 87교시).
 * `~`가 숫자보다 앞에 오면 그 숫자는 **종료**다 — 그걸 시작으로 읽으면 한 시간씩 밀린다.
 */
export function parseTimeCell(raw: string): { start: string | null; end: string | null } | null {
  const s = raw.replace(/\s+/g, "");
  const times = [...s.matchAll(TIME_RE)].map((m) => ({ at: m.index ?? 0, v: to24h(Number(m[1]), Number(m[2])) }));
  if (times.length === 0) return null;
  if (times.length >= 2) return { start: times[0]!.v, end: times[1]!.v };
  const only = times[0]!;
  const tilde = s.search(/[~\-–]/);
  const endOnly = tilde >= 0 && tilde < only.at;
  return endOnly ? { start: null, end: only.v } : { start: only.v, end: null };
}

/** 강사 셀("Elsa\n(담임)\n\n303호") → 라벨·강의실. 줄바꿈 구분이라 첫 줄=사람, `N호`=강의실. */
export function splitTeacherCell(raw: string): { teacher: string | null; room: string | null } {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { teacher: null, room: null };
  const roomIdx = lines.findIndex((l) => /호$/.test(l) || /^\d+호/.test(l));
  const room = roomIdx >= 0 ? lines[roomIdx]! : null;
  const teacher = lines.filter((_, i) => i !== roomIdx).join(" ") || null;
  return { teacher, room };
}

/**
 * 12시간 표기 중 **오전/오후가 진짜로 애매한 8~11시**를 앞 교시 시각으로 가른다.
 *
 * 🔴 2026-07-30 프로덕션: `중고E_중2 특별` 3교시 `08:20~09:10`은 **밤 20:20**인데 `to24h`가 8시를
 *    그대로 둬서 오전 08:20으로 읽었다 → eywa에 20:20 슬롯이 **있는데도** 매칭 실패(그 반만 60건).
 *    같은 요일에서 교시는 **시간 순으로 내려가므로**, 앞 교시보다 이르면 오후로 본다.
 *    ⚠️ 12시는 옮기지 않는다(24시가 되고 밤 12시 수업은 없다). 첫 교시는 기준이 없어 그대로 둔다
 *    (토요일 오전 9시 수업이 실재하므로 무조건 오후로 밀면 그쪽이 깨진다).
 */
export function disambiguatePm(t: string | null, prev: string | null): string | null {
  if (!t || !prev || t > prev) return t;
  const h = Number(t.slice(0, 2));
  if (h < 8 || h > 11) return t;
  const shifted = `${String(h + 12).padStart(2, "0")}${t.slice(2)}`;
  return shifted > prev ? shifted : t;
}

export type CellMerge = {
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
};

/**
 * **세로 병합을 펼친다** — 구글은 병합 범위에서 **좌상단 셀에만** 값을 주므로, 펼치지 않으면
 * 병합으로 이어진 아래 행들이 "빈 칸"으로 보인다.
 *
 * 🔴 이게 실제로 두 가지를 망가뜨렸다(2026-07-30 프로덕션 반영에서 발각):
 *   ① `시기`(평시/내신)를 세로 병합해 쓰므로 **두 번째·세 번째 계획 줄이 파싱조차 안 됐다**(교재·진도가 있는데 유실).
 *   ② `구분`(영역)도 병합이라 아래 줄의 skill_area가 null → `class_sheet_plan_lines.skill_area`는
 *      **not null**이라 그 반의 계획 저장이 통째로 실패했다.
 *
 * ⚠️ **가로 병합은 펼치지 않는다** — 헤더의 요일 라벨이 가로로 병합돼 있으면 펼치는 순간 `요일` 옆이
 *    `시기`가 아니게 되어 요일 컬럼 탐지가 무너진다. 필요한 건 세로 연속뿐이다.
 */
export function expandVerticalMerges(rows: string[][], merges: readonly CellMerge[]): string[][] {
  const out = rows.map((r) => [...r]);
  for (const m of merges) {
    if (m.endColumnIndex - m.startColumnIndex !== 1) continue; // 가로 병합 제외
    if (m.endRowIndex - m.startRowIndex < 2) continue;
    const c = m.startColumnIndex;
    const anchor = clean(out[m.startRowIndex]?.[c]);
    if (!anchor) continue;
    for (let r = m.startRowIndex + 1; r < m.endRowIndex; r++) {
      const row = out[r];
      if (!row) continue;
      while (row.length <= c) row.push("");
      if (clean(row[c]) === "") row[c] = anchor;
    }
  }
  return out;
}

/** 요일 컬럼 탐지 — 헤더행에서 `요일` 바로 오른쪽이 `시기`인 칸. 같은 요일이 여러 번이면 첫 것. */
export function detectDayColumns(rows: string[][]): Partial<Record<DowKey, number>> {
  const out: Partial<Record<DowKey, number>> = {};
  for (const row of rows) {
    for (let ci = 0; ci < row.length; ci++) {
      const day = DAY_LABELS[clean(row[ci])];
      if (!day || out[day] !== undefined) continue;
      if (clean(row[ci + 1]) === "시기") out[day] = ci;
    }
  }
  return out;
}

/** 좌측 목표 패널 라벨("담임\n월간계획") → role·scope. 못 읽으면 null. */
export function parseGoalPanelLabel(raw: string): { role: "homeroom" | "assistant"; scope: "month" | "week" } | null {
  const t = raw.replace(/\s+/g, "");
  if (!/계획$/.test(t)) return null;
  const role = t.startsWith("부담임") ? "assistant" : t.startsWith("담임") ? "homeroom" : null;
  const scope = t.includes("월간") ? "month" : t.includes("주간") ? "week" : null;
  if (!role || !scope) return null;
  return { role, scope };
}

/**
 * 좌측 목표 패널 파싱 — B열=패널 라벨(병합되어 블록 첫 행에만 있음), C=영역, D=교재명, E=목표 진도.
 * `교재명`/`목표 진도` 헤더행은 건너뛴다. 영역이 비면(교재만 적힌 줄) 버린다(어느 영역인지 알 수 없다).
 */
function parseGoals(rows: string[][]): ParsedGoal[] {
  const out: ParsedGoal[] = [];
  let cur: { role: "homeroom" | "assistant"; scope: "month" | "week" } | null = null;
  for (const row of rows) {
    const label = clean(row[1]);
    if (label) {
      const p = parseGoalPanelLabel(label);
      if (p) cur = p;
    }
    if (!cur) continue;
    const skill = clean(row[2]);
    if (!skill || skill === "구분") continue;
    const textbook = nz(row[3]);
    const target = nz(row[4]);
    if (textbook === "교재명" || target === "목표 진도") continue;
    if (!textbook && !target) continue;
    out.push({ role: cur.role, scope: cur.scope, skillLabel: skill, textbook, targetProgress: target });
  }
  return out;
}

/** 학생 행의 기록 칸들(교재~과제 위치) → 상태·개인노트 분리. */
export function splitMarkCells(cells: (string | undefined)[]): { status: string | null; note: string | null } {
  const vals = cells.map(clean).filter(Boolean);
  const statuses = vals.filter((v) => STATUS_WORDS.has(v));
  const notes = vals.filter((v) => !STATUS_WORDS.has(v));
  return { status: statuses[0] ?? null, note: notes.length ? notes.join(" ") : null };
}

/** 주차 탭 격자 → 구조화. rows는 0-based 2D 문자열(빈 칸은 ""), 짧은 행 허용. */
export function parseWeekTab(rows: string[][]): ParsedWeekTab {
  const dayColumns = detectDayColumns(rows);
  const slots: ParsedSlot[] = [];
  const planLines: ParsedPlanLine[] = [];
  const marks: ParsedMark[] = [];
  const slotByKey = new Map<string, ParsedSlot>();

  for (const [day, col] of Object.entries(dayColumns) as [DowKey, number][]) {
    const periodCol = col - 1;
    let cur: ParsedSlot | null = null;
    for (const row of rows) {
      const periodCell = clean(row[periodCol]);
      // ① 교시 라벨 = 새 블록 시작.
      const pm = PERIOD_RE.exec(periodCell);
      if (pm) {
        const slotKey = `${day}|${periodCell}`;
        const existing = slotByKey.get(slotKey);
        if (existing) {
          cur = existing;
        } else {
          cur = {
            day,
            slotKey,
            periodLabel: periodCell,
            timeRaw: null,
            start24: null,
            end24: null,
            teacherLabel: null,
            roomLabel: null,
          };
          slotByKey.set(slotKey, cur);
          slots.push(cur);
        }
      } else if (cur && periodCell && !cur.timeRaw) {
        // ② 같은 블록 안의 시각 표기(시작만·종료만도 받는다).
        const tr = parseTimeCell(periodCell);
        if (tr) {
          cur.timeRaw = periodCell.replace(/\s+/g, "");
          cur.start24 = tr.start;
          cur.end24 = tr.end;
        }
      }
      if (!cur) continue;

      const tag = clean(row[col + 1]);
      if (tag === "평시" || tag === "내신") {
        // 강사·강의실은 블록 첫 계획행의 요일 칸에 온다(학생명과 같은 열이라 계획행에서만 읽는다).
        const who = clean(row[col]);
        if (who && !cur.teacherLabel) {
          const s = splitTeacherCell(who);
          cur.teacherLabel = s.teacher;
          cur.roomLabel = s.room;
        }
        const line: ParsedPlanLine = {
          day,
          slotKey: cur.slotKey,
          termMode: tag === "내신" ? "exam" : "regular",
          skillLabel: nz(row[col + 2]),
          textbook: nz(row[col + 3]),
          pageRange: nz(row[col + 4]),
          progress: nz(row[col + 5]),
          homework: nz(row[col + 6]),
        };
        if (line.textbook || line.pageRange || line.progress || line.homework) planLines.push(line);
      } else if (tag === "TRUE" || tag === "FALSE") {
        const name = clean(row[col]);
        if (!name || PERIOD_RE.test(name)) continue;
        const { status, note } = splitMarkCells([row[col + 3], row[col + 4], row[col + 5], row[col + 6]]);
        marks.push({
          day,
          slotKey: cur.slotKey,
          studentLabel: name,
          school: nz(row[col + 2]),
          present: tag === "TRUE",
          status,
          note,
        });
      }
    }
  }

  // 요일별로 교시가 시간 순이라는 사실을 이용해 오전/오후 애매(8~11시)를 확정한다(disambiguatePm 주석).
  for (const day of Object.keys(dayColumns) as DowKey[]) {
    let prev: string | null = null;
    for (const s of slots) {
      if (s.day !== day) continue;
      s.start24 = disambiguatePm(s.start24, prev);
      s.end24 = disambiguatePm(s.end24, s.start24 ?? prev);
      if (s.start24) prev = s.start24;
    }
  }

  return { dayColumns, slots, planLines, marks, goals: parseGoals(rows) };
}
