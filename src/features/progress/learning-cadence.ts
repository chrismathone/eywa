/** MCS and the progress clock share the academy's standard course duration. */
export const MATH_LEARNING_CADENCE = {
  regular: { monthlyBlocks: 4, months: 3, totalBlocks: 12 },
  supplement: { monthlyBlocks: 4, months: 1, totalBlocks: 4 },
} as const;

export type MathLearningTrack = keyof typeof MATH_LEARNING_CADENCE;
