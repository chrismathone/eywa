/**
 * 반 스케줄 **겹침 계산** — 순수 함수(Vitest). IO 없음. 서버 액션은 조회+조립만 한다.
 *
 * 🔴 겹침은 저장을 막지 않는다(원장 확정 2026-07-22): "정규도 풀자. 경고만 남기고 실제로는 만들어지는걸로."
 *    합반이 실제 운영이라 활성 반끼리 같은 교실·시간 겹침이 실데이터에 대량 존재한다(실측: 살아있는
 *    슬롯 쌍 기준 강의실 109쌍·강사 78쌍). 막으면 정상 업무가 막힌다. 게다가 겹침 대부분은 영어 시트
 *    임포트 RPC(0087a)로 들어와 폼 검사를 아예 안 거쳤다 — 검사는 실제 이중예약을 못 막으면서 폼
 *    사용자만 막고 있었다. 그래서 이 모듈은 "저장 가능 여부"를 판정하지 않고 **무엇이 몇 건 겹치는지**만 만든다.
 */

export type OverlapKind = "classroom" | "teacher";

/** 요일 한글 라벨. (요일은 운영 enum이 아니라 코드 고정 — 학원설정 대상 아님.) */
export const DAY_LABEL_KO: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};
/** 요일 정렬·선택지 순서(월~일 고정). 라벨은 `DAY_LABEL_KO`. */
export const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type OverlapItem = {
  kind: OverlapKind;
  classId: string;
  className: string;
  dayOfWeek: string;
  /** 화면은 이 한글 라벨을 쓴다(raw 영문 키 노출 금지). */
  dayLabel: string;
  /** 겹치는 **기존** 슬롯의 시각(HH:MM). */
  startTime: string;
  endTime: string;
  /** kind==='classroom'일 때 교실명. 못 풀면 생략. */
  roomName?: string;
  /** kind==='teacher'일 때 강사명. 못 풀면 생략. */
  teacherName?: string;
};

/** 저장하려는 슬롯. teacher/classroom은 **실효값**(슬롯 override ?? 반 기본)을 넣어 넘긴다. */
export type OverlapCandidate = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  teacherId: string | null;
  classroomId: string | null;
  /**
   * 이 슬롯이 **자리(LAB·JJ)** 면 그 이름. 원장 2026-08-04: *"JJ 또는 LAB은 스케줄 겹쳐도 괜찮으니까
   * 경고 차단."* 자리는 병렬 레인이라 같은 방·같은 시각에 여러 반이 도는 게 **정상 운영**이다
   * (시트도 그 열을 병렬로 그린다). 이걸 겹침으로 세면 경고가 상시 켜져 진짜 이중예약이 묻힌다.
   */
  seatLabel?: string | null;
};

/** 기존 슬롯(이름까지 조립된 상태). */
export type ExistingSlot = OverlapCandidate & {
  classId: string;
  className: string;
  teacherName: string | null;
  roomName: string | null;
  isActive: boolean;
  closedAt: string | null;
};

const hm = (t: string) => String(t).slice(0, 5);
const ymd = (d: string) => String(d).slice(0, 10);

/** 두 시각 구간이 겹치는가. 경계 접촉(앞 끝 == 뒤 시작)은 겹침 아님. */
export function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return hm(aStart) < hm(bEnd) && hm(aEnd) > hm(bStart);
}

/** 두 운영 기간이 겹치는가. null = 무기한(시작 -∞ / 종료 +∞). 하루라도 겹치면 true. */
export function dateRangesOverlap(
  aFrom: string | null,
  aTo: string | null,
  bFrom: string | null,
  bTo: string | null,
): boolean {
  if (aFrom && bTo && ymd(aFrom) > ymd(bTo)) return false;
  if (bFrom && aTo && ymd(bFrom) > ymd(aTo)) return false;
  return true;
}

/**
 * 아직 살아있는 슬롯인가 — 폐지(is_active=false)·종강(closed_at<오늘)·만료(valid_to<오늘)는 제외.
 * ⚠️ 이 제외가 없으면 **빈 교실인데 겹침으로 신고**한다(실측: 폐지·종강 반의 살아있는 슬롯 59행이
 *    교실 4곳을 점유). 구 `detectScheduleConflict`가 이걸 안 봐서 저장을 거부하던 진짜 버그다.
 */
export function isLiveSlot(
  s: { isActive: boolean; closedAt: string | null; validTo: string | null },
  today: string,
): boolean {
  if (!s.isActive) return false;
  if (s.closedAt && ymd(s.closedAt) < today) return false;
  if (s.validTo && ymd(s.validTo) < today) return false;
  return true;
}

function push(out: Map<string, OverlapItem>, item: OverlapItem): void {
  const key = `${item.kind}|${item.classId}|${item.dayOfWeek}|${item.startTime}|${item.endTime}`;
  if (!out.has(key)) out.set(key, item);
}

/**
 * 후보 슬롯 × 기존 슬롯 → 겹침 목록(전부, 첫 건에서 멈추지 않는다).
 * 같은 (기존 반·요일·시각)이 강의실·강사 둘 다 겹치면 **2건**으로 낸다(원인이 다르므로).
 */
export function findOverlaps(input: {
  candidates: OverlapCandidate[];
  existing: ExistingSlot[];
  /** KST 오늘(YYYY-MM-DD) — 폐지/종강/만료 판정 기준. */
  today: string;
  /** 수정 시 자기 자신. */
  excludeClassId?: string;
}): OverlapItem[] {
  const out = new Map<string, OverlapItem>();
  const live = input.existing.filter(
    (e) => e.classId !== input.excludeClassId && isLiveSlot(e, input.today),
  );

  for (const c of input.candidates) {
    // 자리(LAB·JJ)는 겹쳐도 정상 — 한쪽이라도 자리면 이 쌍은 아예 안 센다(원장 2026-08-04).
    if (c.seatLabel) continue;
    for (const e of live) {
      if (e.seatLabel) continue;
      if (e.dayOfWeek !== c.dayOfWeek) continue;
      if (!timeRangesOverlap(c.startTime, c.endTime, e.startTime, e.endTime)) continue;
      // 기간이 안 겹치면 충돌이 아니다 — 여름 특강과 겨울 특강은 같은 교실·같은 시각이어도 무관.
      if (!dateRangesOverlap(c.validFrom, c.validTo, e.validFrom, e.validTo)) continue;

      const base = {
        classId: e.classId,
        className: e.className,
        dayOfWeek: e.dayOfWeek,
        dayLabel: DAY_LABEL_KO[e.dayOfWeek] ?? e.dayOfWeek,
        startTime: hm(e.startTime),
        endTime: hm(e.endTime),
      };
      if (c.classroomId && c.classroomId === e.classroomId) {
        push(out, { ...base, kind: "classroom", ...(e.roomName ? { roomName: e.roomName } : {}) });
      }
      if (c.teacherId && c.teacherId === e.teacherId) {
        push(out, {
          ...base,
          kind: "teacher",
          ...(e.teacherName ? { teacherName: e.teacherName } : {}),
        });
      }
    }
  }

  return [...out.values()].sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) ||
      a.startTime.localeCompare(b.startTime) ||
      a.className.localeCompare(b.className, "ko") ||
      a.kind.localeCompare(b.kind),
  );
}

/** 한 건을 한 줄 한글로 — "중2 수학A · 월요일 16:00~17:30 · 본원303". */
export function overlapItemLabel(o: OverlapItem): string {
  const who =
    o.kind === "classroom" ? (o.roomName ?? "같은 강의실") : (o.teacherName ?? "같은 강사");
  return `${o.className} · ${o.dayLabel}요일 ${o.startTime}~${o.endTime} · ${who}`;
}

/** 몇 개 반과 몇 건이 겹치는지 한글 한 줄 — "2개 반과 3건 겹칩니다 (강의실 2건 · 강사 1건)". */
export function overlapSummary(items: OverlapItem[]): string {
  if (items.length === 0) return "겹치는 반이 없습니다.";
  const classes = new Set(items.map((i) => i.classId)).size;
  const room = items.filter((i) => i.kind === "classroom").length;
  const teacher = items.length - room;
  const parts: string[] = [];
  if (room > 0) parts.push(`강의실 ${room}건`);
  if (teacher > 0) parts.push(`강사 ${teacher}건`);
  return `${classes}개 반과 ${items.length}건 겹칩니다 (${parts.join(" · ")})`;
}
