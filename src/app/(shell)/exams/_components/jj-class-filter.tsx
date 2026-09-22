/**
 * JJ 화면의 **반 칩** — `반: 전체 / LS4 …`(aywa 영어 반, 2026-09-11 "학생별 반별 유기적으로"). 서버 컴포넌트.
 * 항목은 서버가 만든 주소다(기간·유형을 함께 싣는다) — 그래서 FilterSelect가 아니라 HrefSelect.
 * 선택지가 없으면(연결된 반이 없거나 조회 실패) 칩을 세우지 않는다.
 */
import { HrefSelect } from "@/components/href-select";
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import type { JjClassRef } from "@/features/ijw/class-groups";

export function JjClassFilter({
  classes,
  value,
  hrefFor,
}: {
  classes: readonly JjClassRef[];
  /** 지금 고른 반 id(없으면 전체). 선택지에 없는 값은 호출부가 미리 걸러 넘긴다. */
  value: string | null;
  hrefFor: (classId: string | null) => string;
}) {
  if (classes.length === 0) return null;
  const options = [
    { value: "all", label: "전체", href: hrefFor(null) },
    ...classes.map((c) => ({
      value: c.id,
      label: c.name,
      href: hrefFor(c.id),
      hint: c.track ? ENGLISH_TRACK_LABEL[c.track] : undefined,
    })),
  ];
  return <HrefSelect axisLabel="반" ariaLabel="반 선택" value={value ?? "all"} options={options} />;
}
