import { getStudentRecordSummary } from "../server/summary-query";
import { RecordSummary } from "./record-summary";
export async function StoredSummary({ studentId }: { studentId: string }) {
  const data = await getStudentRecordSummary(studentId);
  return data ? <RecordSummary key={studentId} studentId={studentId} data={data} /> : null;
}
