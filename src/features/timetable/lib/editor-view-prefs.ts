import { z } from 'zod';

const color = z.object({ bg: z.string().regex(/^#[a-f0-9]{6}$/i), text: z.string().regex(/^#[a-f0-9]{6}$/i) });
const groups = z.object({ groups: z.array(z.object({ id: z.string().min(1).max(200), title: z.string().max(200), classIds: z.array(z.string().min(1).max(128)).max(1000) })).max(40), showOthers: z.boolean(), othersTitle: z.string().max(200) });
const subjectView = z.object({
  groups: groups.nullable().optional(), teacherColors: z.record(z.string().max(80), color).optional(),
  hidePeriods: z.boolean().optional(), hideSaturday: z.boolean().optional(), showSunday: z.boolean().optional(), scale: z.number().min(.5).max(2).optional(),
  slotMetadata: z.record(z.string().max(128), z.object({ note: z.string().max(300), locked: z.boolean() })).optional(),
});
export type TimetableEditorView = z.infer<typeof subjectView>;
export type EditorViewPref = Record<string, TimetableEditorView>;
const preferences = z.record(z.string().min(1).max(40), subjectView);
export function parseEditorViewPref(raw: unknown): EditorViewPref | null {
  const parsed = preferences.safeParse(raw);
  return parsed.success && Object.keys(parsed.data).length ? parsed.data : null;
}
export function mergeEditorViewPref(current: EditorViewPref | null | undefined, patch: EditorViewPref | null): EditorViewPref | null {
  if (patch === null) return null;
  const next = { ...current };
  for (const [subject, view] of Object.entries(patch)) next[subject] = { ...next[subject], ...view,
    ...(view.teacherColors ? { teacherColors: { ...next[subject]?.teacherColors, ...view.teacherColors } } : {}),
    ...(view.slotMetadata ? { slotMetadata: { ...next[subject]?.slotMetadata, ...view.slotMetadata } } : {}),
  };
  return next;
}
