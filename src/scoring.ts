import type { ChartNote } from './types'

export type Judgment = 'Perfect' | 'Good' | 'Miss'
export const MAX_SCORE = 10_000_000

// A Hold has one head tick and body ticks every half beat. The interval
// immediately before its visual tail is excluded from release judgment.
export function countNoteTicks(note: ChartNote, holdTickMs: number): number {
  if (note.kind !== 'hold' || !note.endTime) return 1
  let ticks = 1
  for (let nextTick = note.time + holdTickMs; nextTick + holdTickMs < note.endTime - .01; nextTick += holdTickMs) ticks++
  return ticks
}

export function scoreFromUnits(earnedHalfUnits: number, totalTicks: number): number {
  return totalTicks ? Math.round(MAX_SCORE * earnedHalfUnits / (totalTicks * 2)) : 0
}

export function accuracyFromUnits(earnedHalfUnits: number, judgedTicks: number): number {
  return judgedTicks ? earnedHalfUnits / (judgedTicks * 2) * 100 : 100
}

export function judgmentUnits(result: Judgment): number {
  return result === 'Perfect' ? 2 : result === 'Good' ? 1 : 0
}
