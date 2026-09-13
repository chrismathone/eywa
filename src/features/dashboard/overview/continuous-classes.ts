import type { OverviewData } from "./model";

type ScheduleRow = OverviewData["schedule"][number];

/** 이어진 수업으로 보는 교시 사이 최대 간격(분) — 쉬는 시간. 근거는 [`mergeContinuousClasses`] 주석. */
export const BREAK_MAX_MIN = 10;

const toMin = (hms: string): number => {
  const [h, m] = hms.split(":");
  return Number(h) * 60 + Number(m);
};

function mergedStatus(parts: readonly ScheduleRow["status"][]): ScheduleRow["status"] {
  if (parts.every((s) => s === "done")) return "done";
  if (parts.every((s) => s === "upcoming")) return "upcoming";
  return "ongoing";
}

const byStart = (a: ScheduleRow, b: ScheduleRow) =>
  toMin(a.startTime) - toMin(b.startTime) || a.id.localeCompare(b.id);

/**
 * 운영실 '현재 수업 현황' — 같은 반이 **이어서** 하는 교시를 한 줄로 묶는다.
 *
 * 원장 2026-09-13: *"사실상 두시간이나 세시간 수업이 이렇게 쪼개져서 보이는데, 하나로 묶으면 좋을듯"* —
 * 시간표는 교시 단위로 저장돼서 주말내신특강 12:00~14:00이 `12~13` / `13~14` 두 줄로 섰다.
 *
 * 묶는 조건(둘 다):
 * - **같은 반 · 같은 강사 이름 · 같은 교실 이름** — 줄에 적히는 값이 같을 때만 묶는다. 영어는 같은 반이라도
 *   교시마다 담당·교실이 갈리는 게 흔해서(실측 106쌍) 반만 보고 묶으면 강사 교대가 화면에서 사라진다.
 * - 앞 교시 끝과 다음 교시 시작 사이가 **쉬는 시간([`BREAK_MAX_MIN`]) 이내**. 실측(2026-09-13 유효 슬롯 568행):
 *   같은 반·같은 강사·같은 교실의 이어지는 교시는 간격이 0분 155쌍 · 5분 19쌍 · 10분 17쌍뿐이다.
 *
 * 상태는 조각에서 합친다(시계를 따로 재지 않는다 — 조각 상태가 이미 서버 스냅샷의 판정이다):
 * 전부 끝났으면 `done`, 전부 전이면 `upcoming`, 그 밖은 `ongoing` — 쉬는 시간(끝난 조각 + 남은 조각)도
 * 수업 중이다. 안 그러면 5분 쉬는 동안 그 반이 '진행 중'에서 빠졌다가 '다음 수업'으로 돌아온다.
 *
 * ⚠️ 담당 계정이 연결 안 되면 표시가 담임 이름으로 떨어져서(`getTodaySchedule`) 원래 담당이 다른 두 교시가 같은 이름으로
 *    묶일 수 있다 — 실측(같은 날) 묶이는 191쌍 중 그런 쌍은 0이다. 줄에 보이는 값은 어느 쪽이든 같다.
 * ⚠️ 운영실 표시 전용이다 — [`getTodaySchedule`](../../timetable/server/queries.ts)을 묶지 말 것
 *    (작성률·출결 등은 교시 단위로 센다).
 */
export function mergeContinuousClasses(rows: readonly ScheduleRow[]): ScheduleRow[] {
  // JSON 키 — null(강사·교실 미정)과 빈 문자열이 한 무리로 섞이지 않는다.
  const groups = new Map<string, ScheduleRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.classId, row.teacherName, row.classroomName]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const out: ScheduleRow[] = [];
  for (const group of groups.values()) {
    const blocks: { row: ScheduleRow; end: number; parts: ScheduleRow["status"][] }[] = [];
    for (const row of [...group].sort(byStart)) {
      const last = blocks[blocks.length - 1];
      if (last && toMin(row.startTime) - last.end <= BREAK_MAX_MIN) {
        // 이어지는 교시 — 끝 시각만 늘린다(겹치는 중복 행이면 더 늦은 끝을 쓴다). id는 첫 교시 것.
        if (toMin(row.endTime) > last.end) {
          last.end = toMin(row.endTime);
          last.row = { ...last.row, endTime: row.endTime };
        }
        last.parts.push(row.status);
      } else {
        blocks.push({ row, end: toMin(row.endTime), parts: [row.status] });
      }
    }
    for (const block of blocks) out.push({ ...block.row, status: mergedStatus(block.parts) });
  }
  return out.sort(byStart);
}
