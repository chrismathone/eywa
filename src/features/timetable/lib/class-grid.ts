// 통합뷰(반=열 리치 그리드) 데이터 도출 — ijw EnglishClassTab 이식. 순수 함수(테스트 강제).
// 한 과목 슬롯을 **반(class)별 카드**로 묶고 **시작 교시별 섹션**으로 그룹화. 각 카드:
// 헤더(반명·담임·요일별 강의실) + **요일×교시 미니그리드**(셀마다 강사/LAB, ijw slotTeachers) + 재원/대기/퇴원.
// 셀 강사·LAB·요일별 강의실은 슬롯 라벨(class_schedules.slot_teacher_label/slot_room_label, 0041a 백필)에서 온다.
// ⚠️ server-only 금지 — 클라(rich-card-group)도 import. 순수·plain만.
import {
  slotPeriodRow,
  subjectPeriodRows,
  enumDayToKo,
  type DayOfWeek,
  type PeriodsConfig,
  type TimetableSubject,
} from "./periods";

export type GridStudent = {
  name: string;
  grade: string | null;
  school: string | null;
  studentId?: string;
  status: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  isTransferredIn?: boolean;
  englishName?: string | null;
  // hover 정보용 — 런타임엔 StudentLine 전체가 도착(서버 쿼리가 채움). 분리등원·퇴원일·최근 교재·최근 진도·수강 시작일.
  attendanceDays?: string[];
  /** 수강 시작일(YYYY-MM-DD) — hover에서 신입 시작일·전입일 표시용. */
  enrollmentDate?: string | null;
  endDate?: string | null;
  latestTextbook?: { name: string; date: string | null } | null;
  latestReport?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
};

/** 빌더 입력 — ScheduleSlotWithStudents와 구조 호환(서버 타입 직접 import 회피, [[#61]]). */
export type GridSlot = {
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherName: string | null; // 반 기본 강사(담임)
  classroomName: string | null; // 반 기본 강의실
  slotTeacherLabel: string | null; // 셀 강사/LAB(ijw slotTeachers)
  slotRoomLabel: string | null; // 셀 강의실(ijw slotRooms)
  classBgColor: string | null;
  classTextColor: string | null;
  students: GridStudent[];
};

export type GridCell = { label: string; isLab: boolean };
export type GridPeriodRow = { order: number; label: string; time: string };

/**
 * 강사 라벨(display_name·영문닉네임) → 저장된 색(#RRGGBB). 통합뷰 셀·담임색 배선용.
 * 서버가 users.bg_color/text_color + english_name으로 빌드해 클라 렌더에 plain 객체로 전달
 * (메서드 없는 순수 데이터라 [[#61]] server-only 무관). 미해결 라벨은 teacherColor 해시 폴백.
 */
export type TeacherColorMap = Record<string, { bg: string; text: string }>;

export type RichClassCard = {
  classId: string;
  className: string;
  subject: string; // 과목 키(hover 과목 pill용)
  teacherName: string | null; // 담임
  classroomLabel: string; // "월수 304 / 목 LAB실"
  bgColor: string | null; // ijw 반 헤더색(#RRGGBB) — null이면 과목색 폴백
  textColor: string | null;
  cells: Record<string, GridCell>; // `${order}:${day}` → 셀
  periodRows: GridPeriodRow[]; // 이 카드가 쓰는 교시행(그룹 축 union 재료)
  active: GridStudent[];
  hold: GridStudent[];
  withdrawn: GridStudent[];
  activeCount: number;
  groupOrder: number;
  groupLabel: string;
  /**
   * 이 반이 주말 전용인지 — 섹션의 축(교시표·요일열)을 평일/주말 중 무엇으로 잡을지 결정한다.
   * ⚠️ 예전엔 `groupOrder === WEEKEND_ORDER`로 판정했는데, 커스텀 그룹은 groupOrder를 그룹 번호로
   * 덮어쓰므로 그 판정이 깨진다(주말 반이 평일 축에 얹혀 요일열이 어긋남). 그래서 카드에 못박는다.
   */
  weekendOnly: boolean;
  /**
   * 이 **카드**가 실제 수업하는 요일축(ijw `finalDays` 이식, 2026-07-23 원장 지시).
   *
   * 🔴 왜 카드별인가: 예전엔 섹션 공통 요일축이 평일=월~금 **고정**이라, 평일+토 **혼합 반**의
   * 토요일 수업이 통합뷰에서 **통째로 사라졌다**(실측 4개 반·주말 슬롯 21개 — 반 이름이
   * "고등M 고1 BS4F 토"인데 정작 토요일이 안 보였다). 주말 **전용** 반만 별도 섹션으로 잘 나왔다.
   * ijw 통합뷰는 카드마다 자기 요일축(`finalDays`)을 써서 토요일이 있는 반에만 토 열이 붙는다.
   * → 같은 규약으로 되돌린다. 다른 반 카드에 빈 토 열이 생기지 않는다.
   * ⚠️ 셀은 (그룹 교시행 × 카드 요일)로 조회하므로, 주말 슬롯의 교시 order도 그룹 축에 있어야 보인다
   *    (아래 presentOrders에서 혼합 카드의 주말 order를 함께 넣는 이유).
   */
  days: DayOfWeek[];
  /**
   * 커스텀 그룹 안에서의 열 순서(그룹 정의에 적힌 반 순서). 미설정(자동 그룹)이면 undefined → 가나다.
   * 원장 시트의 좌우 순서를 그대로 재현하기 위한 값이라 **정의 순서가 곧 화면 순서**다.
   */
  groupSeq?: number;
};

/**
 * 통합뷰 섹션을 "N교시 시작" 자동 그룹 대신 **원장이 정한 그룹**으로 묶는 설정(과목별).
 * ijw-calander 통합뷰의 `viewMode: CUSTOM_GROUP`을 이식한 것 — 반을 원하는 행(섹션)에 배치한다.
 * 어느 그룹에도 없는 반은 `showOthers`면 맨 아래 '기타' 섹션으로, 아니면 화면에서 빠진다.
 */
export type IntegrationGroupsConfig = {
  groups: { id: string; title: string; classIds: string[] }[];
  showOthers: boolean;
  othersTitle: string;
};

export type RichCardGroup = {
  key: string;
  label: string; // "1교시 시작" | "주말"
  order: number;
  /** 이 그룹이 속한 "N교시 시작" 섹션의 식별자(=groupOrder). '1시간 단위' 토글은 섹션 단위(같은 sectionKey를 켜고 끔). */
  sectionKey: number;
  /** 이 섹션이 현재 '1시간 단위'로 압축됐는지(토글 체크 상태). 압축 섹션은 부그룹 ②③로 나뉠 수 있어 각 부그룹이 동일 sectionKey·compacted. */
  compacted: boolean;
  /**
   * '1시간 단위' 토글을 붙일 수 있는 섹션인지 = 평일 섹션. 주말은 교시 체계가 없어 압축 대상이 아니다.
   * ⚠️ 소비처가 `sectionKey !== WEEKEND_ORDER`로 판정하면 **커스텀 그룹의 주말 하위 섹션**을 놓친다
   * (그쪽 sectionKey는 그룹 번호라 WEEKEND_ORDER가 아니다) → 이 플래그를 볼 것.
   */
  compactable: boolean;
  cards: RichClassCard[];
  periodRows: GridPeriodRow[]; // 그룹 공통 교시축(카드 union, order순)
  days: DayOfWeek[]; // 그룹 공통 요일축(카드 union)
  holdRows: number; // 그룹 내 max(대기 수) — 카드/라벨열 높이 동기화
  withdrawnRows: number; // 그룹 내 max(퇴원 수)
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKEND = new Set<string>(["sat", "sun"]);
/** 주말 섹션의 groupOrder(=sectionKey). 교시 체계가 없어 '1시간 단위' 압축 대상이 아니다. */
export const WEEKEND_ORDER = 100000;
/**
 * 커스텀 그룹 섹션의 groupOrder 시작값 — 자동 그룹(교시 order, 최대 1440)·주말(100000)과 안 겹치게 크게 잡는다.
 * 그룹 i = BASE + i*10(평일) / +1(그 그룹의 주말 반). '기타'는 항상 맨 아래.
 * ⚠️ 정수만 쓴다 — sectionKey는 '1시간 단위' 쿠키·URL에 실려 다니는데 쿠키 형식이 `.`를 구분자로 쓴다.
 */
const CUSTOM_BASE = 200000;
const CUSTOM_OTHERS = 299000;
const GRID_MIN = 5; // 미니그리드 기본 크기 — 평일 섹션은 항상 5요일(월~금) × 5교시(섹션 시작부터).

/** "본원304" → "304"(공통 건물 접두사 제거로 라벨 압축). "LAB실"·타건물은 그대로 — 건물 구분 유지. */
function shortRoom(room: string): string {
  return room.replace(/^본원/, "") || room;
}

/**
 * 요일별 강의실 → "월수 304 / 목 LAB실·304". 한 요일에 교시마다 강의실이 다르면(LAB 교시 등)
 * 그 요일의 강의실을 "·"로 모아 보여주고(ijw "목 LAB실-본원304" 패턴), 같은 강의실 집합인 요일끼리 묶는다.
 * 전부 같으면 단일, 비면 "-". 방 이름은 shortRoom으로 공통 "본원" 접두사를 떼 압축.
 */
function classroomLabel(perDayRooms: Map<DayOfWeek, Set<string>>): string {
  if (perDayRooms.size === 0) return "-";
  const dayStr = new Map<DayOfWeek, string>();
  for (const [d, set] of perDayRooms)
    dayStr.set(d, [...set].map(shortRoom).sort((a, b) => a.localeCompare(b, "ko")).join("·"));
  const distinct = [...new Set(dayStr.values())];
  if (distinct.length === 1) return distinct[0];
  const byRooms = new Map<string, DayOfWeek[]>();
  for (const d of DAY_ORDER) {
    const r = dayStr.get(d);
    if (!r) continue;
    (byRooms.get(r) ?? byRooms.set(r, []).get(r)!).push(d);
  }
  return [...byRooms.entries()]
    .map(([rooms, days]) => `${days.map(enumDayToKo).join("")} ${rooms}`)
    .join(" / ");
}

/**
 * 카드를 커스텀 그룹에 배정 — `groupOrder`(정렬·섹션키)와 `groupLabel`(제목)만 덮어쓴다.
 *
 * 규칙(ijw 통합뷰와 동일):
 * · 한 반이 여러 그룹에 적혀 있으면 **먼저 나온 그룹**이 갖는다(중복 노출 금지 — 같은 반이 두 줄에 뜨면
 *   인원·명단이 두 번 세어진 것처럼 보인다).
 * · 어느 그룹에도 없는 반은 `showOthers`면 맨 아래 '기타' 섹션, 아니면 **화면에서 뺀다**.
 * · 주말 전용 반은 같은 그룹 안에서도 **별도 섹션**(제목 뒤 "(주말)") — 교시표·요일열 체계가 평일과
 *   달라 한 축에 얹으면 요일이 어긋난다.
 * 미설정(그룹 0개)이면 원본 배열을 그대로 돌려준다 = 지금까지의 "N교시 시작" 자동 그룹.
 */
function applyCustomGroups(
  cards: RichClassCard[],
  custom?: IntegrationGroupsConfig | null,
): RichClassCard[] {
  const groups = custom?.groups?.filter((g) => g.title.trim()) ?? [];
  if (!groups.length) return cards;

  const groupOf = new Map<string, number>(); // classId → 그룹 인덱스(먼저 나온 그룹이 이긴다)
  const seqOf = new Map<string, number>(); // classId → 그룹 안 열 순서(정의 순서 = 화면 순서)
  groups.forEach((g, i) => {
    (g.classIds ?? []).forEach((classId, seq) => {
      if (groupOf.has(classId)) return;
      groupOf.set(classId, i);
      seqOf.set(classId, seq);
    });
  });

  const out: RichClassCard[] = [];
  for (const c of cards) {
    const idx = groupOf.get(c.classId);
    if (idx === undefined) {
      if (!custom?.showOthers) continue; // '기타' 숨김 = 미배정 반은 화면에서 제외(원장 선택)
      out.push({
        ...c,
        groupOrder: CUSTOM_OTHERS + (c.weekendOnly ? 1 : 0),
        groupLabel: othersLabel(custom, c.weekendOnly),
      });
      continue;
    }
    const title = groups[idx].title.trim();
    out.push({
      ...c,
      groupOrder: CUSTOM_BASE + idx * 10 + (c.weekendOnly ? 1 : 0),
      groupLabel: c.weekendOnly ? `${title} (주말)` : title,
      groupSeq: seqOf.get(c.classId),
    });
  }
  return out;
}

const othersLabel = (custom: IntegrationGroupsConfig, weekend: boolean) => {
  const base = custom.othersTitle?.trim() || "기타 수업";
  return weekend ? `${base} (주말)` : base;
};

/**
 * 한 과목 슬롯 → 시작 교시별 리치 카드 섹션. 교시 정렬은 평일 기준, 주말 전용 반은 "주말" 섹션.
 * '1시간 단위'는 **섹션(N교시 시작)별 토글**(사용자 결정 2026-07-06 — 전역 아님): compactSections(=압축할
 * 섹션의 groupOrder 집합)에 든 섹션만 압축. 압축 섹션은:
 * ① 같은 시작 교시라도 **교시 체계가 다른 반은 별도 부그룹(②③)으로 분리**(예: 영어 16:20 시작 = 1시간
 *    체계 4·6·8교시 ↔ 40분 체계 4·5·7교시 — 한 축에 섞으면 서로가 상대의 빈 행을 점유해 못 숨김).
 * ② 각 부그룹에서 실제 쓰는 교시 "사이"의 빈 행만 제거(위아래 윈도우 패딩은 유지). 실제 쓰는 교시는 항상 유지 → 클립 없음.
 * 압축 안 된 섹션은 한 그룹·풀 윈도우(빈 행 유지).
 */
export function buildRichCardGroups(
  slots: GridSlot[],
  config: PeriodsConfig,
  compactSections: Set<number> = new Set(),
  /** 커스텀 그룹(학원설정 과목별). 미지정·빈 그룹이면 지금까지처럼 "N교시 시작" 자동 그룹. */
  custom?: IntegrationGroupsConfig | null,
): RichCardGroup[] {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  const byClass = new Map<string, GridSlot[]>();
  for (const s of slots) (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);

  const cards: RichClassCard[] = [];
  for (const group of byClass.values()) {
    const first = group[0];
    const cells: Record<string, GridCell> = {};
    const perDayRooms = new Map<DayOfWeek, Set<string>>();
    const periodMap = new Map<number, GridPeriodRow>();
    const slotTeacherCount = new Map<string, number>(); // 담임 폴백용(최빈 슬롯 강사, LAB 제외)
    let weekdayStart = Infinity;
    for (const s of group) {
      const day = s.dayOfWeek as DayOfWeek;
      const row = slotPeriodRow(subject, s.startTime, day, config);
      if (!periodMap.has(row.order)) periodMap.set(row.order, { order: row.order, label: row.label, time: row.time });
      const teacher = s.slotTeacherLabel ?? s.teacherName ?? "";
      cells[`${row.order}:${day}`] = { label: teacher, isLab: s.slotTeacherLabel === "LAB" };
      if (s.slotTeacherLabel && s.slotTeacherLabel !== "LAB")
        slotTeacherCount.set(s.slotTeacherLabel, (slotTeacherCount.get(s.slotTeacherLabel) ?? 0) + 1);
      const room = s.slotRoomLabel ?? s.classroomName;
      if (room) (perDayRooms.get(day) ?? perDayRooms.set(day, new Set()).get(day)!).add(room);
      if (!WEEKEND.has(day) && row.order < weekdayStart) weekdayStart = row.order;
    }
    // 담임 = 반 기본 강사 우선, 없으면 가장 많이 가르치는 슬롯 강사(ijw homeroom은 영문닉네임이라 FK 미해결).
    const topSlotTeacher = [...slotTeacherCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const students = first.students;
    const split = (st: GridStudent["status"]) => students.filter((x) => x.status === st);
    const weekend = weekdayStart === Infinity;
    // 이 카드가 실제 수업하는 요일(ijw finalDays) — 평일 반이라도 토·일 슬롯이 있으면 그 요일이 들어간다.
    const cardDays = DAY_ORDER.filter((d) => group.some((s) => (s.dayOfWeek as DayOfWeek) === d));
    cards.push({
      days: cardDays,
      classId: first.classId,
      className: first.className,
      subject: first.subject,
      teacherName: first.teacherName ?? topSlotTeacher,
      classroomLabel: classroomLabel(perDayRooms),
      bgColor: first.classBgColor,
      textColor: first.classTextColor,
      cells,
      periodRows: [...periodMap.values()].sort((a, b) => a.order - b.order),
      active: split("active"),
      hold: split("hold"),
      withdrawn: split("withdrawn"),
      activeCount: students.filter((x) => x.status === "active").length,
      groupOrder: weekend ? WEEKEND_ORDER : weekdayStart,
      groupLabel: weekend ? "주말" : `${periodMap.get(weekdayStart)?.label ?? ""} 시작`,
      weekendOnly: weekend,
    });
  }

  // 커스텀 그룹 — 카드의 소속(groupOrder·groupLabel)만 갈아끼운다. 아래 클러스터링·압축·정렬은
  // 그 두 값만 보고 돌아가므로 자동 그룹과 완전히 같은 경로를 탄다(분기 없음).
  const assignedCards = applyCustomGroups(cards, custom);

  // 시작 교시별 그룹 + 그룹 공통 교시·요일 축(카드 union).
  const groupMap = new Map<string, RichClassCard[]>();
  for (const c of assignedCards) {
    const key = `${c.groupOrder}::${c.groupLabel}`;
    (groupMap.get(key) ?? groupMap.set(key, []).get(key)!).push(c);
  }

  /** 카드가 이 섹션 체계(평일/주말)에서 실제 쓰는 표준 교시 order 집합. */
  const cardStdOrders = (c: RichClassCard, weekend: boolean, standardByOrder: Map<number, GridPeriodRow>) => {
    const out = new Set<number>();
    for (const k of Object.keys(c.cells)) {
      const [ordPart, dayPart] = k.split(":");
      if (WEEKEND.has(dayPart) !== weekend) continue;
      const o = Number(ordPart);
      if (standardByOrder.has(o)) out.add(o);
    }
    return out;
  };
  /** rows의 [min,max] 사이에서 비어있는 표준 교시(=사이 빈 행). */
  const interiorGaps = (rows: Set<number>, standard: GridPeriodRow[]) => {
    if (rows.size < 2) return new Set<number>();
    const lo = Math.min(...rows);
    const hi = Math.max(...rows);
    return new Set(standard.filter((r) => r.order > lo && r.order < hi && !rows.has(r.order)).map((r) => r.order));
  };

  const out: RichCardGroup[] = [];
  for (const cs of groupMap.values()) {
    // 카드 순서 = 커스텀 그룹이면 **원장이 정한 순서**(groupSeq), 아니면 가나다.
    // 그룹 안 열 순서까지 원장 시트와 같아야 "동일한 뷰"가 된다(가나다로 재정렬하면 DP5·LT2·LS2a…가
    // DP5·JP1·KW6…로 뒤섞인다). 자동 그룹은 groupSeq가 없어 tie → 지금까지처럼 가나다.
    cs.sort(
      (a, b) =>
        (a.groupSeq ?? Number.POSITIVE_INFINITY) - (b.groupSeq ?? Number.POSITIVE_INFINITY) ||
        a.className.localeCompare(b.className, "ko"),
    );
    const weekend = cs[0].weekendOnly;
    const standard = subjectPeriodRows(subject, weekend, config);
    const standardByOrder = new Map(standard.map((r) => [r.order, r]));
    // '1시간 단위'는 섹션별 토글(사용자 결정 2026-07-06 "각 교시 시작별로 세팅, 전역 아님").
    // 이 섹션(groupOrder)이 압축 집합에 있을 때만 압축한다.
    const sectionCompact = compactSections.has(cs[0].groupOrder);

    // 압축 섹션 = 같은 시작 교시라도 **교시 체계가 다른 반은 별도 그룹으로 분리**. 예: 영어 16:20 시작에
    // 1시간 체계(4·6·8교시)와 40분 체계(4·5·7교시)가 공존 — 한 축에 두면 서로의 교시가 상대 그룹의
    // '사이 빈 행'을 점유해 아무것도 못 숨긴다. 클러스터 규칙: 서로의 사이 빈 행(interiorGaps)을 안 침범하는 카드끼리 병합.
    let clusters: RichClassCard[][];
    if (sectionCompact) {
      const acc: { rows: Set<number>; cards: RichClassCard[] }[] = [];
      for (const c of cs) {
        const rows = cardStdOrders(c, weekend, standardByOrder);
        const fit = acc.find((cl) => {
          const clGaps = interiorGaps(cl.rows, standard);
          const cGaps = interiorGaps(rows, standard);
          return ![...rows].some((o) => clGaps.has(o)) && ![...cl.rows].some((o) => cGaps.has(o));
        });
        if (fit) {
          for (const o of rows) fit.rows.add(o);
          fit.cards.push(c);
        } else acc.push({ rows: new Set(rows), cards: [c] });
      }
      // 큰 클러스터(주 체계) 먼저, 동수면 첫 반 이름순.
      acc.sort(
        (a, b) =>
          b.cards.length - a.cards.length ||
          a.cards[0].className.localeCompare(b.cards[0].className, "ko"),
      );
      clusters = acc.map((cl) => cl.cards);
    } else {
      clusters = [cs];
    }

    clusters.forEach((cluster, ci) => {
      // 셀(order:day)에서 "이 섹션 체계(평일/주말)의 요일"에 실제 있는 교시 order만 수집.
      // order=자정기준 분이라 평일 영어 2교시(15:00)와 주말 7교시(토 15:00)가 충돌 → 요일로 체계를 가른다.
      const daySet = new Set<DayOfWeek>();
      const presentOrders = new Set<number>();
      // 평일 섹션에 섞여 있는 **주말 슬롯의 교시 order** — 평일 표준표엔 없는 시각이라(수학 토 12:00 등)
      // 따로 모아 축에 얹어야 한다. 안 그러면 토요일 열을 붙여도 셀이 놓일 행이 없어 여전히 안 보인다.
      const mixedWeekendOrders = new Set<number>();
      for (const c of cluster) {
        for (const k of Object.keys(c.cells)) {
          const [ordPart, dayPart] = k.split(":");
          const day = dayPart as DayOfWeek;
          daySet.add(day);
          if (WEEKEND.has(day) === weekend) presentOrders.add(Number(ordPart));
          else if (!weekend) mixedWeekendOrders.add(Number(ordPart));
        }
      }
      // 교시축 = 표준 교시표에서 섹션 시작 교시부터 5칸 윈도우(5×5 기본). 끝 가까운 섹션은
      // 윈도우를 당겨 항상 5칸 확보(표준 교시가 5개 미만인 수학계열은 전부).
      // 앵커 = 섹션에 실제 등장하는 표준 교시 중 가장 이른 것(폴백 시각·다른 체계는 제외됨).
      const presentStd = [...presentOrders].filter((o) => standardByOrder.has(o));
      const anchorOrder = presentStd.length ? Math.min(...presentStd) : standard[0]?.order ?? 0;
      let startIdx = standard.findIndex((r) => r.order === anchorOrder);
      if (startIdx < 0) startIdx = 0;
      startIdx = Math.min(startIdx, Math.max(0, standard.length - GRID_MIN));
      const winRows = new Map<number, GridPeriodRow>();
      for (const r of standard.slice(startIdx, startIdx + GRID_MIN))
        winRows.set(r.order, { order: r.order, label: r.label, time: r.time });
      // 윈도우 밖이어도 실제 등장하는 표준 교시는 포함(긴 수업 클립 방지). 다른 체계(주말)·폴백 시각은
      // 제외 — 한 카드가 두 교시체계를 섞어도 그리드가 폭발하지 않게.
      for (const o of presentStd) {
        if (winRows.has(o)) continue;
        const r = standardByOrder.get(o)!;
        winRows.set(o, { order: r.order, label: r.label, time: r.time });
      }
      // 혼합 반(평일+토·일)의 주말 교시 행을 추가 — 라벨·시각은 그 카드가 이미 만들어 둔 행에서 가져온다
      // (주말 교시표로 해석된 "N교시 09:00~10:00"). ⚠️ **주말 요일 셀에서 온 order만** 넣는다 —
      // 폴백 시각까지 넣으면 예전 주석대로 그리드가 폭발한다. 없는 반엔 빈 행이지만, 애초에 안 보이던
      // 수업이 보이는 쪽이 낫다(원장 2026-07-23 "토요일 포함 수업을 어떻게 나타내야 하는지").
      if (!weekend && mixedWeekendOrders.size) {
        for (const c of cluster) {
          for (const r of c.periodRows) {
            if (!mixedWeekendOrders.has(r.order) || winRows.has(r.order)) continue;
            winRows.set(r.order, { order: r.order, label: r.label, time: r.time });
          }
        }
      }
      // 요일축 = 평일 섹션은 항상 월~금(5열), 주말 섹션은 실제 주말요일.
      // 그룹 축은 **폴백·집계용**(렌더는 카드별 `card.days`). 평일 섹션은 월~금을 항상 보장하되
      // 이 섹션에 실제 등장하는 주말 요일을 뒤에 덧붙인다(혼합 반이 있으면 토/일).
      const days = weekend
        ? DAY_ORDER.filter((d) => WEEKEND.has(d) && daySet.has(d))
        : DAY_ORDER.filter((d) => !WEEKEND.has(d) || daySet.has(d));
      // compact = 이 그룹이 실제 쓰는 교시 범위 [lo,hi] "사이"의 빈 행만 제거.
      // 범위 밖(그룹 위아래 패딩 행)은 유지 — 5칸 윈도우의 컨텍스트 보존(사용자 결정 2026-07-06).
      const winList = [...winRows.values()].sort((a, b) => a.order - b.order);
      let periodRows = winList;
      if (sectionCompact && presentStd.length > 0) {
        const lo = Math.min(...presentStd);
        const hi = Math.max(...presentStd);
        periodRows = winList.filter((r) => r.order <= lo || r.order >= hi || presentOrders.has(r.order));
      }
      // 분리된 부그룹은 라벨에 ②③… 접미(같은 "N교시 시작"이 두 박스로 나뉠 때 구분).
      const label = ci === 0 ? cluster[0].groupLabel : `${cluster[0].groupLabel} ${"②③④⑤"[ci - 1] ?? `(${ci + 1})`}`;
      out.push({
        key: `${cluster[0].groupOrder}::${cluster[0].groupLabel}::${ci}`,
        label,
        order: cluster[0].groupOrder + ci * 0.001, // 같은 앵커의 부그룹은 바로 뒤에 정렬
        sectionKey: cluster[0].groupOrder,
        compacted: sectionCompact,
        compactable: !weekend,
        cards: cluster,
        periodRows,
        days,
        holdRows: Math.max(1, ...cluster.map((c) => c.hold.length)),
        withdrawnRows: Math.max(1, ...cluster.map((c) => c.withdrawn.length)),
      });
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

// 솔리드 배경 + 흰 글자라 대비가 충분한 색만(amber·gold 제외 — 흰 글자 대비 미달로 셀 강사명이 안 읽힘).
const TEACHER_PALETTE = ["blue", "purple", "rose", "primary", "danger"] as const;
/** 강사명(라벨) → 결정적 색 키(이름 해시). eywa엔 강사 색 설정이 없어 라벨 해시로 안정 배정. */
export function teacherColor(name: string | null): (typeof TEACHER_PALETTE)[number] {
  if (!name) return "blue";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TEACHER_PALETTE[h % TEACHER_PALETTE.length];
}
