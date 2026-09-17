/** MCS and the progress clock share the academy's standard course duration. */
export const MATH_LEARNING_CADENCE = {
  regular: { monthlyBlocks: 8, months: 3, totalBlocks: 24 },
  supplement: { monthlyBlocks: 4, months: 1, totalBlocks: 4 },
} as const;

export type MathLearningTrack = keyof typeof MATH_LEARNING_CADENCE;
