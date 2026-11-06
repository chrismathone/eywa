import { addDays, weekdayIndexOf } from "@/lib/date-kst";
import type { ExploreRow } from "../../../model";

/**
 * 시험 표본의 **기록 줄**(가상 값) — 서버 조회(`server/student.ts` · `class.ts` · `teacher.ts`)가 채우는 줄 모양을 그대로 흉내 낸다.
 * 출결은 기준일까지 30일 창의 하루하루 기록(반 이름이 줄 제목 · 상태가 오른쪽 · 교시가 상세)이고, 원생 '출결' 조각은 그 기록을 7줄
 * (출석률 = 반별 · 출석 횟수 = 출석+지각 · 기록 = 전부 · 출석 · 지각 · 결석 · 인정결석)로 다시 담는다 — 같은 기록이 여러 줄에 든다.
 */

export const AS_OF = "2026-11-04";
const SINCE = addDays(AS_OF, -30);
const days = (dows: number[]) => {
  const out: string[] = [];
  for (let d = SINCE; d <= AS_OF; d = addDays(d, 1)) if (dows.includes(weekdayIndexOf(d))) out.push(d);
  return out;
};

type Att = { id: string; className: string; date: string; status: "present" | "late" | "absent" | "excused"; slot: string; note: string | null };
const STATUS_LABEL = { present: "출석", late: "지각", absent: "결석", excused: "인정결석" } as const;
const special: Record<string, Att["status"]> = { "2026-10-14": "late", "2026-10-27": "late", "2026-10-21": "absent", "2026-10-31": "excused" };

/** 원생 김서연의 30일 출결 — 월·수·금 수학 A반 · 화·목 EiE · 토 심화반. */
export function studentAttendance(classes: { a: string; e: string; s: string }): Att[] {
  const one = (className: string, slot: string) => (date: string): Att => ({
    id: `${date}-${className}-${slot}`,
    className,
    date,
    status: special[date] ?? "present",
    slot,
    note: special[date] === "absent" ? "사전 통보 · 병원" : null,
  });
  return [...days([1, 3, 5]).map(one(classes.a, "16:20")), ...days([2, 4]).map(one(classes.e, "17:30")), ...days([6]).map(one(classes.s, "10:00"))].sort((x, y) => y.date.localeCompare(x.date));
}

const item = (r: Att): ExploreRow => ({ id: r.id, title: r.className, date: r.date, right: STATUS_LABEL[r.status], detail: [r.slot, r.note].filter(Boolean).join(" · ") || null });

/** 원생 '출결' 조각의 7줄 — `server/student.ts`와 같은 줄 id·제목·담는 법. */
export function studentAttendanceRows(recs: Att[]): ExploreRow[] {
  const pick = (pred: (s: Att["status"]) => boolean) => recs.filter((r) => pred(r.status)).map(item);
  const n = (s: Att["status"]) => recs.filter((r) => r.status === s).length;
  const byClass = [...new Set(recs.map((r) => r.className))].map((name) => {
    const rows = recs.filter((x) => x.className === name);
    const ok = rows.filter((x) => x.status === "present" || x.status === "late").length;
    return { id: `c:${name}`, title: name, right: `${Math.round((ok / rows.length) * 100)}%`, detail: `${rows.length}건 중 ${ok}회 출석` } satisfies ExploreRow;
  });
  const attended = n("present") + n("late");
  return [
    { id: "rate", title: "출석률", right: `${((attended / recs.length) * 100).toFixed(1)}%`, items: byClass },
    { id: "attended", title: "출석 횟수", right: `${attended}회`, items: pick((s) => s === "present" || s === "late") },
    { id: "total", title: "기록", right: `${recs.length}건`, items: pick(() => true) },
    { id: "present", title: "출석", right: `${n("present")}건`, items: pick((s) => s === "present") },
    { id: "late", title: "지각", right: `${n("late")}건`, items: pick((s) => s === "late") },
    { id: "absent", title: "결석", right: `${n("absent")}건`, items: pick((s) => s === "absent") },
    { id: "excused", title: "인정결석", right: `${n("excused")}건`, items: pick((s) => s === "excused") },
  ];
}

/** 수업 '출석부' 조각의 5줄 — 학생마다 월·수·금 30일(`server/class.ts`와 같은 줄 id·제목 · 기록 제목 = 학생 이름). */
export function classAttendanceRows(students: string[]): ExploreRow[] {
  const recs = days([1, 3, 5]).flatMap((date) =>
    students.map((name, i): Att => ({ id: `${date}-${i}`, className: name, date, status: i === 3 && date === "2026-10-21" ? "absent" : i === 5 && date === "2026-10-14" ? "late" : "present", slot: "16:20", note: null })),
  );
  const pick = (pred: (s: Att["status"]) => boolean) => recs.filter((r) => pred(r.status)).map(item);
  const n = (s: Att["status"]) => recs.filter((r) => r.status === s).length;
  return [
    { id: "total", title: "기록", right: `${recs.length}건`, items: pick(() => true) },
    { id: "present", title: "출석", right: `${n("present")}건`, items: pick((s) => s === "present") },
    { id: "late", title: "지각", right: `${n("late")}건`, items: pick((s) => s === "late") },
    { id: "absent", title: "결석", right: `${n("absent")}건`, items: pick((s) => s === "absent") },
    { id: "excused", title: "인정결석", right: `${n("excused")}건`, items: pick((s) => s === "excused") },
  ];
}

/** 상담 5건(최근 5건 · 해를 넘는다) — 제목 = 요약 한 줄 · 상세 = 과목 · 상담자(`server/student.ts`). */
export const CONSULTS: ExploreRow[] = [
  ["cs1", "2026-10-28", "10월 학습 점검 · 학부모 통화 — 월말평가 뒤 오답 정리 방법 안내", "수학 · 박지훈"],
  ["cs2", "2026-10-14", "자습 집중 저하 관찰 공유 · 휴대폰 보관함 사용 권함", "영어 · 최유진"],
  ["cs3", "2026-09-30", "30일 날 결석한다고 해서 이날 MT치는 날이라 따로 와서 시험치면 된다고 함", "영어 · 정유진"],
  ["cs4", "2026-04-30", "60일 점검 통화 · 첫 수업 적응 좋음", "수학 · 데스크"],
  ["cs5", "2025-12-12", "첫 상담 · 겨울방학 특강 안내", "수학 · 박지훈"],
].map(([id, date, title, detail]) => ({ id, title, date, detail, body: `${title}\n\n상담 기록 본문(가상).` }));
