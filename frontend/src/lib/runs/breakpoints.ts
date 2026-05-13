export const WIDE_BREAKPOINT = 1400

export function isWideLayout(width: number): boolean {
  return width >= WIDE_BREAKPOINT
}
