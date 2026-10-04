/** Only the minimal contact tail leaves this integration. Prefer the student's registered phone. */
export function contactPhoneLast4(
  studentPhone: string | null | undefined,
  parentPhone: string | null | undefined,
): string | null {
  for (const phone of [studentPhone, parentPhone]) {
    const digits = (phone ?? "").replace(/[^0-9]/g, "");
    if (digits.length >= 7) return digits.slice(-4);
  }
  return null;
}
