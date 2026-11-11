/** 지식그래프·관찰 기록 화면이 함께 쓰는 모양 — 시안 예시 값(sample-data.ts)에서 실제 기록으로 옮기며 떼어 냈다(2026-11-11). */
export type Person = { id: string; name: string; school: string | null; grade: string | null; status?: string | null };
export type Staff = { id: string; display_name: string };
export type FieldAudit = { key: string; total: number; missing: number; scope: string; examples: { label: string; href: string }[] };
