/**
 * The Mondays of the last `weeks` weeks, oldest first, ending with the week that starts on `currentWeek` (YYYY-MM-DD). Shared by the
 * leadership trend (STORY-015) and the override rate (STORY-024), which are both counted in the database's weeks.
 */
export function weekStarts(currentWeek: string, weeks = 12): string[] {
  const [year, month, day] = currentWeek.split('-').map(Number);
  return Array.from({ length: weeks }, (_, i) => new Date(Date.UTC(year, month - 1, day - 7 * (weeks - 1 - i))).toISOString().slice(0, 10));
}
