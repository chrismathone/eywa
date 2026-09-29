/**
 * 시간표(개발중) — **시트 한 탭 → 그 달 계획(`PlanSlotInput[]`)** 변환. 전부 순수 함수(IO 없음).
 *
 * 왜 따로 있나: 본 시간표의 구조 import(`features/timetable/server/structure-import-actions`)는 같은 파서를
 * 쓰지만 결과를 **`class_schedules`에 쓴다**(그 액션 주석: "적용(class_schedules 쓰기). ⚠️ 프로덕션 반영").
 * 계획 층은 그 표에 한 행도 쓰면 안 되므로(0232a·isolation.test.ts) 시트→계획 변환을 여기서 **따로** 만든다.
 * 파서·매처(`import/structure/*`)는 순수 함수라 그대로 재사용한다(수정 없음).
 *
 * 🔴 **계획에 담는 것은 aywa에 이미 있는 반뿐이다.** 시트에는 메모 칸("<-"·"5.5"·"TEVO")과 신설 반이 섞여
 *    있고 둘 다 "DB에 없는 이름"이라 구분할 수가 없다(색 신호가 없는 읽기 경로다). 반을 새로 만들지 않고
 *    **매칭된 반만** 담고 나머지는 `skipped`로 사람에게 보여 준다 — 계획 화면이 유령 반을 그리지 않는다.
 *
 * ⚠️ 시각은 반드시 `hhmm()`로 자른다(계약 주석) — 비교가 문자열 동등이라 형식이 갈리면 손대지 않은 칸까지
 *    전부 '변경'이 된다.
 */
import type { ResolvedSlot, SheetGrid } from "@/features/timetable/import/structure/types";
import { hhmm, type PlanDayOfWeek, type PlanSlot, type PlanSlotInput } from "../types";
import { toPlanDay } from "./plan-row";

// ── ① 원장이 붙여넣는 시트 주소 ────────────────────────────────────────────────

/** `/spreadsheets/d/{id}` — 문서 id. 뒤에 `/edit`·`/view`가 붙어도 id만 집는다. */
const SHEET_ID_RE = /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/;
/** 주소가 아니라 id만 붙여넣은 경우(연동 설정에 저장된 값이 그렇다). */
const BARE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
/** `#gid=123`(해시) — 구글이 탭을 옮길 때 갱신하는 쪽. */
const GID_HASH_RE = /#(?:.*&)?gid=(\d+)/;
/** `?gid=123`·`&gid=123`(쿼리) — 해시가 없을 때의 폴백. */
const GID_QUERY_RE = /[?&]gid=(\d+)/;

/** 문서의 탭 한 줄(Sheets `sheets[].properties`) — 주소의 gid를 탭 이름으로 잇는 유일한 통로. */
export type SheetTab = { gid: number; title: string };

export type SheetUrlTarget = {
  spreadsheetId: string;
  /** 탭 번호. 주소에 없으면 null → 호출부가 탭을 고르게 한다(첫 탭을 임의로 집지 않는다). */
  gid: number | null;
};

/**
 * 원장이 주소창에서 복사해 붙여넣는 주소 한 줄을 문서 id + 탭 번호로 가른다.
 * 예: `https://docs.google.com/spreadsheets/d/1-1JHC…/edit?gid=661682520#gid=661682520`
 *
 * 🔑 **gid는 해시(`#gid=`)를 우선**하고 쿼리(`?gid=`)는 폴백이다 — 구글 시트에서 탭을 바꾸면 주소의 해시가
 *    갱신되고 쿼리는 처음 열었던 탭에 남는 경우가 있다(둘이 다르면 사람이 지금 보고 있는 탭 = 해시).
 * ⚠️ 스킴이 붙은 주소는 **구글 문서만** 받는다 — 다른 도메인의 비슷한 경로를 삼키면 서비스계정이 엉뚱한
 *    문서를 긁으러 간다. 스킴이 없으면(=id만 붙여넣음) id 형식으로만 판정한다.
 */
export function parseSheetUrl(input: string | null | undefined): SheetUrlTarget | null {
  const s = String(input ?? "").trim();
  if (!s) return null;

  const scheme = s.match(/^[a-zA-Z][\w+.-]*:\/\/([^/]+)/);
  if (scheme) {
    const host = scheme[1]!.split(":")[0]!.toLowerCase();
    if (!/(^|\.)google\.com$/.test(host)) return null;
  }

  const idMatch = s.match(SHEET_ID_RE);
  const spreadsheetId = idMatch ? idMatch[1]! : BARE_ID_RE.test(s) ? s : null;
  if (!spreadsheetId) return null;

  const raw = s.match(GID_HASH_RE)?.[1] ?? s.match(GID_QUERY_RE)?.[1] ?? null;
  const gid = raw === null ? null : Number(raw);
  return { spreadsheetId, gid: gid !== null && Number.isFinite(gid) ? gid : null };
}

// ── ② 어느 파서로 읽을 탭인가 ─────────────────────────────────────────────────

const DAY_HEAD_RE = /^\s*[월화수목금토일]/;

function dayHeaderCount(grid: SheetGrid, row: number): number {
  const cells = grid.cells[row] ?? [];
  let n = 0;
  for (let c = 1; c < cells.length; c++) if (DAY_HEAD_RE.test(cells[c] ?? "")) n++;
  return n;
}

/**
 * 탭 구조 판별 — 요일 헤더가 몇 행에 있는지로 가른다.
 *   · `master`(손으로 만든 마스터 시트, parse-grid): 1행 블록번호 · 2행 강사명 · **4행 요일**
 *   · `aywa`(aywa가 export한 강사별 탭, parse-aywa-grid): 1행 강사 · **2행 요일**
 * 사람이 고르게 하지 않는 이유 = 원장이 붙여넣는 건 주소 하나뿐이라, 여기서 못 가리면 "왜 0건이지"가 된다.
 * ⚠️ 동수·둘 다 0이면 `master`로 본다 — 미래 달 탭은 사람이 손으로 만든 마스터 구조이기 때문.
 */
export function detectGridLayout(grid: SheetGrid): "master" | "aywa" {
  return dayHeaderCount(grid, 1) > dayHeaderCount(grid, 3) ? "aywa" : "master";
}

// ── ③ 파싱·매칭 결과 → 계획 칸 ────────────────────────────────────────────────

export type PlanImportAction = "add" | "update" | "keep";

export type PlanImportRow = {
  action: PlanImportAction;
  className: string;
  input: PlanSlotInput;
  /** update일 때 "이전 → 이후"를 보여주기 위한 값(화면 전용). */
  before?: { endTime: string; teacherLabel: string | null; roomLabel: string | null };
};

/** 계획에 담지 못한 칸 — 이유별로 묶어 몇 개인지까지(한 반이 여러 칸일 수 있다). */
export type PlanImportSkip = { className: string; reason: string; count: number };

/** 시트에는 없고 계획에만 있는 칸 — `replace`에서만 지워진다(기본 `merge`는 손대지 않는다). */
export type PlanImportOrphan = {
  id: string;
  className: string;
  dayOfWeek: PlanDayOfWeek;
  startTime: string;
  endTime: string;
};

export type PlanSheetImportPlan = {
  rows: PlanImportRow[];
  orphans: PlanImportOrphan[];
  skipped: PlanImportSkip[];
  counts: { add: number; update: number; keep: number; orphan: number; skipped: number };
  warnings: string[];
  /** 변경분의 결정적 해시 — 미리보기 이후 시트·계획이 바뀌었는지 적용 직전에 대조한다. */
  hash: string;
};

const SKIP_NO_CLASS = "에이와에 없는 반이라 계획에 담지 않았습니다(반을 먼저 만들어 주세요)";
const SKIP_NO_END = "종료 시각을 읽지 못했습니다";
const SKIP_BAD_DAY = "요일을 읽지 못했습니다";
const SKIP_BAD_TIME = "시각 형식이 올바르지 않습니다";

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_ORDER: readonly PlanDayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** 방 라벨 비교 토큰("본원303"→"303", "SKY"→"SKY") — 표기만 다른 같은 방을 '변경'으로 잡지 않게. */
function roomTok(r: string | null | undefined): string {
  if (!r) return "";
  return (r.match(/\b(\d{3}|SKY)\b/i)?.[1] ?? r.trim()).toUpperCase();
}
function normLabel(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/ /g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
/** 결정적 FNV-1a(env 무관) — 미리보기↔적용 사이의 변경 감지에만 쓴다. */
function fnv1a(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

type Target = {
  classId: string;
  className: string;
  day: PlanDayOfWeek;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  teacherLabel: string;
  roomLabel: string | null;
  classroomId: string | null;
  /** 같은 칸에 다른 강사가 또 적힌 경우(합반) — 라벨은 첫 강사만 담고 나머지는 경고로 알린다. */
  extraTeachers: string[];
};

function anchorKey(classId: string, day: string, start: string): string {
  return `${classId}|${day}|${start}`;
}

/**
 * 시트에서 읽어 매칭까지 끝난 슬롯(`ResolvedSlot[]`)을 그 달 계획 칸으로 바꾼다.
 *
 * 규칙(전부 여기 한 곳):
 *  · 앵커 = (반, 요일, 시작시각) — 0232a의 유니크와 같다. 같은 앵커가 여럿이면 **첫 칸이 이긴다**(시트에
 *    같은 반이 두 번 그려진 경우. 값이 다르면 경고로 알린다 — 조용히 덮지 않는다).
 *  · **시트가 표현하지 못하는 값은 있던 것을 보존한다** — 교시 라벨·합반 묶음·복사 출처는 시트에 없다.
 *    덮어쓰면 사람이 화면에서 묶어 둔 합반이 가져오기 한 번에 풀린다.
 *  · 강사/강의실도 같은 결 — 시트의 **이름이 그대로면** 기존 연결(FK)을 유지하고, 이름이 **바뀌었을 때만**
 *    새로 해석한 id로 간다(이름이 모호해 해석 실패했다고 멀쩡한 연결을 null로 떨어뜨리지 않는다).
 */
export function buildPlanSheetImport(
  resolved: ResolvedSlot[],
  existing: PlanSlot[],
  opts: { classNameById?: Map<string, string> } = {},
): PlanSheetImportPlan {
  const warnings: string[] = [];
  const skipAcc = new Map<string, PlanImportSkip>();
  const skip = (className: string, reason: string) => {
    const key = `${className}|${reason}`;
    const cur = skipAcc.get(key);
    if (cur) cur.count += 1;
    else skipAcc.set(key, { className: className || "(이름 없음)", reason, count: 1 });
  };

  // 1) 시트 슬롯 → 앵커별 목표 한 줄.
  const targets = new Map<string, Target>();
  for (const s of resolved) {
    if (!s.classId) {
      skip(s.className, SKIP_NO_CLASS);
      continue;
    }
    const day = toPlanDay(s.day);
    if (!day) {
      skip(s.className, SKIP_BAD_DAY);
      continue;
    }
    if (!s.endTime) {
      skip(s.className, SKIP_NO_END);
      continue;
    }
    const startTime = hhmm(s.startTime);
    const endTime = hhmm(s.endTime);
    if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime) || endTime <= startTime) {
      skip(s.className, SKIP_BAD_TIME);
      continue;
    }

    const key = anchorKey(s.classId, day, startTime);
    const cur = targets.get(key);
    if (cur) {
      // 같은 칸에 다른 강사 = 합반. 다른 시각·방 = 시트가 서로 다른 말을 한다 → 첫 칸을 쓰고 알린다.
      if (normLabel(cur.teacherLabel) !== normLabel(s.teacherName) && !cur.extraTeachers.includes(s.teacherName))
        cur.extraTeachers.push(s.teacherName);
      if (cur.endTime !== endTime)
        warnings.push(
          `"${cur.className}" ${day} ${startTime} 칸의 종료 시각이 시트에서 둘(${cur.endTime} / ${endTime})입니다 — 먼저 읽은 ${cur.endTime}로 담았습니다.`,
        );
      continue;
    }
    targets.set(key, {
      classId: s.classId,
      className: s.className,
      day,
      startTime,
      endTime,
      teacherId: s.teacherId ?? null,
      teacherLabel: s.teacherName,
      roomLabel: s.room ?? null,
      classroomId: s.classroomId ?? null,
      extraTeachers: [],
    });
  }

  // 2) 지금 계획에 있는 칸(같은 앵커)과 맞춰 add/update/keep 판정.
  const existingByKey = new Map<string, PlanSlot>();
  for (const e of existing) existingByKey.set(anchorKey(e.classId, e.dayOfWeek, hhmm(e.startTime)), e);

  const rows: PlanImportRow[] = [];
  for (const t of targets.values()) {
    const prev = existingByKey.get(anchorKey(t.classId, t.day, t.startTime));

    const labelSame = prev ? normLabel(prev.slotTeacherLabel) === normLabel(t.teacherLabel) : false;
    const teacherId = labelSame ? (t.teacherId ?? prev!.teacherId) : t.teacherId;

    const roomSame = prev ? roomTok(prev.slotRoomLabel) === roomTok(t.roomLabel) : false;
    const slotRoomLabel =
      t.roomLabel === null ? (prev?.slotRoomLabel ?? null) : roomSame ? (prev!.slotRoomLabel ?? t.roomLabel) : t.roomLabel;
    const classroomId =
      t.roomLabel === null
        ? (prev?.classroomId ?? null)
        : roomSame
          ? (t.classroomId ?? prev!.classroomId)
          : t.classroomId;

    const input: PlanSlotInput = {
      classId: t.classId,
      dayOfWeek: t.day,
      startTime: t.startTime,
      endTime: t.endTime,
      teacherId,
      classroomId,
      slotTeacherLabel: t.teacherLabel.trim() || null,
      slotRoomLabel,
      // 시트에 없는 값 = 있던 것 보존(덮어쓰면 화면에서 묶어 둔 합반·교시 라벨이 사라진다).
      periodLabel: prev?.periodLabel ?? null,
      mergeGroup: prev?.mergeGroup ?? null,
      sourceScheduleId: prev?.sourceScheduleId ?? null,
    };

    const unchanged =
      prev !== undefined &&
      prev.endTime === input.endTime &&
      prev.teacherId === input.teacherId &&
      prev.classroomId === input.classroomId &&
      normLabel(prev.slotTeacherLabel) === normLabel(input.slotTeacherLabel) &&
      roomTok(prev.slotRoomLabel) === roomTok(input.slotRoomLabel);

    rows.push({
      action: !prev ? "add" : unchanged ? "keep" : "update",
      className: t.className,
      input,
      ...(prev && !unchanged
        ? {
            before: {
              endTime: prev.endTime,
              teacherLabel: prev.slotTeacherLabel,
              roomLabel: prev.slotRoomLabel,
            },
          }
        : {}),
    });

    if (t.extraTeachers.length > 0)
      warnings.push(
        `합반으로 보입니다 — "${t.className}" ${t.day} ${t.startTime}에 강사가 여럿(${[t.teacherLabel, ...t.extraTeachers].join("·")}). 계획에는 ${t.teacherLabel}만 적었습니다.`,
      );
  }

  // 화면·해시가 흔들리지 않게 결정적 정렬(요일 → 시작시각 → 반 이름).
  rows.sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.input.dayOfWeek) - DAY_ORDER.indexOf(b.input.dayOfWeek) ||
      a.input.startTime.localeCompare(b.input.startTime) ||
      a.className.localeCompare(b.className, "ko"),
  );

  // 3) 시트에 없는 기존 계획 칸.
  const orphans: PlanImportOrphan[] = [];
  for (const e of existing) {
    if (targets.has(anchorKey(e.classId, e.dayOfWeek, hhmm(e.startTime)))) continue;
    orphans.push({
      id: e.id,
      className: opts.classNameById?.get(e.classId) ?? "(반 이름 미확인)",
      dayOfWeek: e.dayOfWeek,
      startTime: hhmm(e.startTime),
      endTime: hhmm(e.endTime),
    });
  }
  orphans.sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) ||
      a.startTime.localeCompare(b.startTime) ||
      a.className.localeCompare(b.className, "ko"),
  );

  const skipped = [...skipAcc.values()].sort(
    (a, b) => b.count - a.count || a.className.localeCompare(b.className, "ko"),
  );
  const counts = {
    add: rows.filter((r) => r.action === "add").length,
    update: rows.filter((r) => r.action === "update").length,
    keep: rows.filter((r) => r.action === "keep").length,
    orphan: orphans.length,
    skipped: skipped.reduce((n, s) => n + s.count, 0),
  };

  // 변경분만 해시에 담는다(keep은 무쓰기라 바뀌어도 적용 결과가 같다).
  const hash = fnv1a(
    [
      ...rows
        .filter((r) => r.action !== "keep")
        .map(
          (r) =>
            `${r.action}|${r.input.classId}|${r.input.dayOfWeek}|${r.input.startTime}|${r.input.endTime}|` +
            `${normLabel(r.input.slotTeacherLabel)}|${roomTok(r.input.slotRoomLabel)}|${r.input.teacherId ?? ""}|${r.input.classroomId ?? ""}`,
        ),
      ...orphans.map((o) => `orphan|${o.id}`),
    ]
      .sort()
      .join("\n"),
  );

  return { rows, orphans, skipped, counts, warnings, hash };
}
