// 강사별 그리드(SheetGrid) → 정규화 배치 슬롯(ParsedStructureSlot[]) 순수 파서.
// 구조 가정(현 인재원 영어 강사별 시트):
//   · 1행: 블록 번호(강사 블록마다 6열 간격, B/H/N/…)
//   · 2행: 강사명 + 담임 방 + 메모   · 3행: 근무 메모
//   · 4행: 블록 내 요일 헤더(월~토, 열마다 1개)   · A열: 시각 라벨(참고용 — 신뢰 불가)
//   · 데이터 셀: "수업명/방번호"(병합셀 = 한 수업). 값은 병합 좌상단에만 존재.
// ⚠️ 시각 = 행 인덱스 규칙(2026-07-06 정정): 데이터 행은 10분 격자라
//   start = 앵커(14:20) + (병합 시작행 − DATA_START_ROW)×10분, end = 병합 높이로 도출.
//   A열 라벨 텍스트는 불규칙("3:00~3:40" 다음 행이 "3:10~3:20")해 end가 틀렸었음 — 앵커 검증에만 사용.
// 파서는 throw하지 않는다 — 인식 못한 셀은 건너뛰고 warnings에 남긴다(자유 편집 시트 방어).

import { enumDayToKo, koDayToEnum, type DayOfWeek } from "@/features/timetable/lib/periods";
import type {
  ParsedScheduleBlock,
  ScheduleBlockKind,
  ParsedStructure,
  ParsedStructureSlot,
  ParsedTeacherBlock,
  SheetGrid,
} from "./types";

const HEADER_ROW = 1; // 0-based: 강사명 행(2행)
const NOTE_ROW = 2; // 0-based: 메모 행(3행)
const DAY_ROW = 3; // 0-based: 요일 헤더 행(4행)
const DATA_START_ROW = 4; // 0-based: 데이터 시작(5행)
const TIME_COL = 0; // A열

const ROOM_RE = /\b(\d{3}|SKY)\b/;
// ⚠️ **일요일 포함** — 빼면 그 열이 통째로 사라진다. 2026-07-22 실측: 7/9 개편에서 Jane 토요일 반이
// 일요일로 옮겨졌는데(`고등E_고2 심화` 3칸) 정규식에 '일'이 없어 열째로 스킵됐고, 컷오버가 그걸
// "시트에서 없어진 수업"으로 읽어 마감했다. 학원이 일요일에 수업을 안 한다는 보장은 없다.
const DAY_HEAD_RE = /^\s*([월화수목금토일])/;
const TIME_TOKEN_RE = /\d{1,2}:\d{2}/g;

function cell(grid: SheetGrid, r: number, c: number): string {
  return grid.cells[r]?.[c] ?? "";
}

/** "4:20~5:00"·"9:50~10:00" 등 오후 학원 시각을 24h "HH:MM"로. 오전 라벨(1~11시)은 +12(오후). */
function to24(token: string): string {
  const [hStr, mStr] = token.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (h < 12) h += 12; // 2:20 → 14:20, 10:00 → 22:00 (A열은 전부 오후~밤)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A열 라벨에서 첫 시각 토큰만 (앵커 검증용 — end 등 나머지 토큰은 불규칙해 신뢰 불가). */
function firstTimeToken(label: string): string | null {
  const toks = label.match(TIME_TOKEN_RE);
  return toks && toks.length > 0 ? to24(toks[0]!) : null;
}

const STEP_MIN = 10; // 데이터 행 = 10분 격자 (행 인덱스가 시각의 진실)
const DEFAULT_ANCHOR_MIN = 14 * 60 + 20; // DATA_START_ROW = 14:20

function minToHM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** 헤더 "Jane 추민아 301 …" → 선두 강사명 토큰(영문 또는 한글 2~4자). */
function leadName(header: string): string {
  const h = header.trim();
  const m = h.match(/^([A-Za-z]+|[가-힣]{2,4})/);
  return m ? m[1]! : h.slice(0, 10);
}

/**
 * "수업명/방\n\n…"에서 수업명(첫 세그먼트).
 * ⚠️ 선두 `*`(보강·정규시간 밖 추가 수업 표시)는 **떼고** 돌려준다 — 표식은 `starred`가 따로 들고 있고,
 * 이름에 남기면 `*MEC1-3`이 기존 반 `MEC1-3`과 매칭에 실패해 그 슬롯이 통째로 누락된다(2026-07-22 실측 3반).
 */
function className(raw: string): string {
  return raw.split(/[/\n]/)[0]!.replace(/^\*+/, "").trim();
}

/**
 * 비수업 칸 분류 — 시트가 강사의 하루 전체를 그리므로 수업 사이에 이런 칸이 섞인다(0138a).
 * ⚠️ 감독('supervise')은 여기서 못 정한다 — 셀이 **다른 강사 이름 한 단어**인지 알려면 블록 목록이
 * 다 모여야 해서, 파싱 2패스 뒤에 판정한다. 여기선 문구로 바로 아는 것만.
 */
const NON_CLASS_KINDS: { re: RegExp; kind: ScheduleBlockKind }[] = [
  { re: /^쉬는\s*시간/, kind: "break" },
  { re: /^수업\s*준비/, kind: "prep" },
  { re: /미팅|회의/, kind: "meeting" },
  { re: /연차|휴가/, kind: "leave" },
];

function nonClassKind(name: string): ScheduleBlockKind | null {
  return NON_CLASS_KINDS.find((x) => x.re.test(name))?.kind ?? null;
}

export function parseTeacherGrid(grid: SheetGrid): ParsedStructure {
  const warnings: string[] = [];
  const blocks: ParsedScheduleBlock[] = [];
  const rowCount = grid.cells.length;

  // 시각 앵커 — DATA_START_ROW의 A열 라벨 첫 토큰으로 검증(파싱 실패 시 14:20 기본 + 경고).
  // 이후 모든 시각은 행 인덱스 × 10분 산술로만 도출(라벨 텍스트 미신뢰 — 2026-07-06 정정).
  const anchorLabel = cell(grid, DATA_START_ROW, TIME_COL);
  const anchorTok = firstTimeToken(anchorLabel);
  let anchorMin = DEFAULT_ANCHOR_MIN;
  if (anchorTok) {
    const [h, m] = anchorTok.split(":").map(Number);
    anchorMin = h! * 60 + m!;
    if (anchorMin !== DEFAULT_ANCHOR_MIN)
      warnings.push(`시각 앵커가 14:20이 아님: "${anchorLabel}" → ${anchorTok} (행 인덱스 규칙으로 계속)`);
  } else {
    warnings.push(`시각 앵커 라벨 인식 실패: (${DATA_START_ROW},${TIME_COL}) "${anchorLabel}" — 14:20 가정`);
  }
  const rowStartHM = (r: number) => minToHM(anchorMin + (r - DATA_START_ROW) * STEP_MIN);
  const rowEndHM = (r: number) => minToHM(anchorMin + (r - DATA_START_ROW + 1) * STEP_MIN);

  // 병합 좌상단 → 범위(0-based, r2/c2 inclusive) 조회맵.
  const mergeAt = new Map<string, { r1: number; c1: number; r2: number; c2: number }>();
  for (const mg of grid.merges) {
    mergeAt.set(`${mg.startRowIndex},${mg.startColumnIndex}`, {
      r1: mg.startRowIndex,
      c1: mg.startColumnIndex,
      r2: mg.endRowIndex - 1,
      c2: mg.endColumnIndex - 1,
    });
  }

  // 블록 시작 열 = 1행(0-based 0)에서 A열 제외(col>=1) 값이 있는 열.
  const startCols: number[] = [];
  const firstRow = grid.cells[0] ?? [];
  for (let c = 1; c < firstRow.length; c++) {
    if ((firstRow[c] ?? "") !== "") startCols.push(c);
  }

  const teachers: ParsedTeacherBlock[] = [];
  const slots: ParsedStructureSlot[] = [];

  // ⚠️ 그리드 폭은 **모든 행의 최대 길이**로 잡는다 — 특정 행(요일 헤더) 길이를 쓰면 안 된다.
  // Sheets API의 rowData는 행마다 마지막 유효 셀까지만 보내 **행 길이가 제각각(ragged)** 이다.
  // 요일 헤더는 가로 병합이라 값이 좌상단에만 있어 데이터 행보다 짧게 끝나는데, 그걸 마지막 블록의
  // 오른쪽 경계로 쓰면 **그 블록의 우측 레인이 통째로 순회에서 빠진다**(경고조차 안 남는 침묵 유실).
  // 2026-07-22 실측: 헤더행 146 vs 실제 149 → 마지막 블록(이주희 LAB) 레인 c146~c148 스킵 →
  // 금요일 5슬롯(LS2a·JP1·MEC1-3·KW1·LS5)이 파싱에서 사라지고 컷오버가 그걸 'remove'로 마감했다.
  const gridWidth = grid.cells.reduce((w, r) => Math.max(w, r.length), 0);

  startCols.forEach((bc, i) => {
    const nextCol = i + 1 < startCols.length ? startCols[i + 1]! : Math.max(gridWidth, bc + 6);
    const header = cell(grid, HEADER_ROW, bc).trim();
    const homeRoom = header.match(ROOM_RE)?.[1] ?? null;
    const block: ParsedTeacherBlock = {
      index: Math.trunc(Number(cell(grid, 0, bc)) || i + 1),
      header,
      name: leadName(header),
      homeRoom,
      note: cell(grid, NOTE_ROW, bc).trim(),
      reserve: header.startsWith("예비"),
      startColumn: bc,
    };
    teachers.push(block);

    // 이 블록의 요일 열(4행 헤더 기준).
    // ⚠️ 요일 헤더가 **가로 병합**이면 그 요일은 여러 열(=병렬 레인)을 덮는다 — LAB(JJ·이주희)처럼 같은
    // 시각에 여러 반이 도는 강사가 이렇게 그려진다(실측 이주희 화=5열). 병합 셀은 좌상단에만 값이 있어
    // 셀 값만 보면 나머지 레인이 "요일 없음"으로 통째 스킵된다 → 2026-07-22 실측: 이주희 51→24슬롯 유실.
    // 그래서 병합 범위만큼 요일을 **펼쳐서** 열마다 매핑한다.
    const dayOfCol = new Map<number, DayOfWeek>();
    for (let c = bc; c < nextCol; c++) {
      const rawDay = cell(grid, DAY_ROW, c);
      const koDay = rawDay.match(DAY_HEAD_RE)?.[1];
      if (!koDay) {
        // ⚠️ 요일로 못 읽은 헤더는 **반드시 경고로 남긴다** — 그 열의 수업이 전부 스킵되는데 조용히
        // 넘어가면 컷오버가 "시트에서 없어진 수업"으로 읽어 마감한다(2026-07-22 일요일 열 3칸 실측).
        // 데이터가 실제로 있는 열만 경고(빈 여백 열까지 경고하면 노이즈로 묻힌다).
        const hasData = grid.cells.some((row, r) => r >= DATA_START_ROW && (row[c] ?? "") !== "");
        if (hasData) {
          warnings.push(
            `요일 헤더를 못 읽어 열 전체를 건너뜀: (${DAY_ROW},${c}) "${rawDay}" — ${block.name} 블록. 이 열의 수업은 반영되지 않는다.`,
          );
        }
        continue;
      }
      const day = koDayToEnum(koDay);
      if (!day) {
        warnings.push(`요일 인식 실패: (${DAY_ROW},${c}) "${cell(grid, DAY_ROW, c)}"`);
        continue;
      }
      const dm = mergeAt.get(`${DAY_ROW},${c}`);
      const lastCol = dm && dm.r1 === DAY_ROW ? Math.min(dm.c2, nextCol - 1) : c;
      for (let cc = c; cc <= lastCol; cc++) dayOfCol.set(cc, day);
    }
    for (const [c, day] of dayOfCol) {
      const koDay = cell(grid, DAY_ROW, c).match(DAY_HEAD_RE)?.[1] ?? enumDayToKo(day);

      // 데이터 셀 순회 — 값 있는 셀만(병합은 좌상단에만 값). 각 셀 = 한 수업.
      for (let r = DATA_START_ROW; r < rowCount; r++) {
        const raw = cell(grid, r, c);
        if (raw === "") continue;
        const mg = mergeAt.get(`${r},${c}`) ?? { r1: r, c1: c, r2: r, c2: c };

        // 시각 = 행 인덱스 규칙 — start는 병합 시작행, end는 병합 높이(하단행+1칸)로.
        const topLabel = cell(grid, mg.r1, TIME_COL);
        const start = rowStartHM(mg.r1);
        const end = rowEndHM(mg.r2);

        // ⚠️ 방은 **반명을 뺀 잔여**에서만 탐색 — 반명에 "SKY"가 든 반(중등E_초6 SKY)에서 raw 전체를
        // 매칭하면 실제 방(303)보다 이름의 SKY가 먼저 걸린다(2026-07-06 — 원 임포트 '본원SKY' 오류의 근본 원인).
        const room = raw.replace(className(raw), "").match(ROOM_RE)?.[1] ?? block.homeRoom;
        // 반명이 비면(별표만 있는 표식 셀 등) 슬롯이 아니다 — 빈 이름은 어떤 반과도 매칭될 수 없다.
        if (className(raw) === "") {
          warnings.push(`반명 없는 셀 건너뜀: (${r},${c}) "${raw.replace(/\n/g, "⏎").slice(0, 30)}"`);
          continue;
        }
        // 비수업 칸(쉬는 시간·수업준비·회의·연차)은 슬롯이 아니라 **블록**으로. 감독은 2패스에서 승격.
        const kind = nonClassKind(className(raw));
        if (kind) {
          blocks.push({
            teacherName: block.name,
            day,
            startTime: start,
            endTime: end,
            kind,
            label: className(raw),
          });
          continue;
        }
        const slot: ParsedStructureSlot = {
          teacherIndex: block.index,
          teacherName: block.name,
          teacherHeader: block.header,
          day,
          koDay,
          className: className(raw),
          room,
          startTime: start,
          endTime: end,
          rawTimeLabel: topLabel.trim(),
          starred: raw.trimStart().startsWith("*"),
          raw,
          grid: mg,
        };
        slots.push(slot);
      }
    }
  });

  // ── 2패스: '감독' 승격 ──────────────────────────────────────────────────────
  // 셀이 **다른 강사 블록의 이름 한 단어**면 그 강사 수업을 감독하러 가는 것이다(원장 확인 2026-07-22:
  // "병합 셀에 JJ 문구 딱 하나면 실제 JJ 수업이 맞아. 감독하러 가야함"). 1패스에선 반 이름과 구분이
  // 안 돼 슬롯으로 들어가 있으므로, 블록 이름이 다 모인 지금 걸러 블록으로 옮긴다.
  // ⚠️ 자기 이름은 제외 — 자기 블록에 자기 이름이 적힌 건 감독이 아니다(머리글 오인 방어).
  const teacherNames = new Set(teachers.filter((t) => !t.reserve).map((t) => t.name));
  const classSlots: ParsedStructureSlot[] = [];
  for (const s of slots) {
    if (teacherNames.has(s.className)) {
      // 강사 이름이 적힌 칸은 **어떤 경우에도 반이 아니다.** 다른 강사면 감독, 자기 이름이면 의미가
      // 불분명하니 'other'로 담아만 둔다(그림엔 나오고 반·수강엔 절대 안 들어간다).
      const isOther = s.className === s.teacherName;
      blocks.push({
        teacherName: s.teacherName,
        day: s.day,
        startTime: s.startTime,
        endTime: s.endTime!,
        kind: isOther ? "other" : "supervise",
        label: s.className,
        ...(isOther ? {} : { superviseTarget: s.className }),
      });
      continue;
    }
    classSlots.push(s);
  }

  return { tabName: grid.tabName, teachers, slots: classSlots, blocks, warnings };
}
