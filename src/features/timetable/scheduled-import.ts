// **예약된 가져오기**(미래 날짜로 적용해 둔 시간표 변경)의 표시·묶음 규칙 — 순수 함수.
//
// 원장 2026-08-28: *"9/1 시간표 적용 예정 이라고 라벨 같은게 있고"* + *"라벨 옆에 x가 있어서 적용 취소를
// 할 수 있게 하는거지. 그럼 모든게 무로 돌아가는거야."*
//
// 🔴 한 번의 '적용'이 스냅샷을 **둘** 만든다(수업 배치 1 + 학생 반이동 1). 화면엔 날짜 하나로 보이고
//    취소도 한 번이어야 하므로, 여기서 **날짜로 묶는다**. 하나만 되돌리면 배치와 명단이 어긋난다.
// ⚠️ server-only 금지 — 배지(클라)와 서버 액션이 같은 규칙을 쓴다([[#61]]).

/** 스냅샷 한 건(서버가 DB에서 읽어 넘긴다). */
export type ScheduledSnapshot = {
  id: string;
  /** 적용 기준일 `YYYY-MM-DD`. */
  effectiveDate: string;
  /** `structure` = 수업 배치 · `enrollment` = 학생 반이동. */
  kind: "structure" | "enrollment";
  createdAt: string;
};

/** 같은 날짜로 예약된 것들을 한 덩이로 — 화면의 라벨 하나, 취소 한 번에 대응한다. */
export type ScheduledImportGroup = {
  effectiveDate: string;
  /** 되돌릴 스냅샷 — **반이동 먼저, 배치 나중**(적용의 역순). */
  snapshotIds: string[];
  hasStructure: boolean;
  hasEnrollment: boolean;
};

/** "9/1" — 라벨은 짧아야 툴바 한 줄에 들어간다(연도는 오늘과 같으면 생략). */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  const md = `${Number(m)}/${Number(d)}`;
  return y === today.slice(0, 4) ? md : `${y.slice(2)}. ${md}`;
}

/** 툴바에 그대로 찍히는 문구. */
export function scheduledImportLabel(date: string, today: string): string {
  return `${shortDate(date, today)} 시간표 적용 예정`;
}

/**
 * 미래 스냅샷들을 날짜로 묶는다. 오늘 이전(이미 시작됨)은 **예약이 아니라 이력**이라 제외한다 —
 * 되돌리기도 미래분만 허용하므로(0233a) 화면에 띄우면 누를 수 없는 x가 된다.
 */
export function groupScheduledImports(
  rows: readonly ScheduledSnapshot[],
  today: string,
): ScheduledImportGroup[] {
  const byDate = new Map<string, ScheduledSnapshot[]>();
  for (const r of rows) {
    if (r.effectiveDate <= today) continue;
    let arr = byDate.get(r.effectiveDate);
    if (!arr) byDate.set(r.effectiveDate, (arr = []));
    arr.push(r);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([effectiveDate, snaps]) => ({
      effectiveDate,
      // 적용은 배치 → 반이동 순이었으므로 되돌리기는 그 역순. 같은 종류끼리는 나중 것부터.
      snapshotIds: [...snaps]
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "enrollment" ? -1 : 1;
          return b.createdAt.localeCompare(a.createdAt);
        })
        .map((s) => s.id),
      hasStructure: snaps.some((s) => s.kind === "structure"),
      hasEnrollment: snaps.some((s) => s.kind === "enrollment"),
    }));
}
