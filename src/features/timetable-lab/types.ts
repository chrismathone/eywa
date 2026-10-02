/** Read-only source snapshot. Importing creates a separate browser draft, never an operating write. */
export type LabSourceSlot = {
  id: string; classId: string; name: string; subject: string;
  day: string; start: string; end: string; teacher: string; teacherId: string | null;
  room: string; roomId: string | null; kind: 'lesson' | 'seat' | 'block';
  students: { id: string; name: string; enrollmentId?: string; attendanceDays: string[] }[];
};
export type LabSource = {
  version: 1; tenantId: string; referenceDate: string; fetchedAt: string; subject: string;
  academy: string; stepMinutes: number; teacherOrder: string[];
  slots: LabSourceSlot[]; outside: LabSourceSlot[]; notices: string[]; uncertainties?: string[];
};
