/**
 * Whole years between the date of birth and today, accounting for whether the birthday
 * has passed this year.
 *
 * A "YYYY-MM-DD" string is read as a calendar date. `new Date("YYYY-MM-DD")` would parse
 * it as UTC midnight, which local-time getters shift to the previous day in timezones
 * west of UTC — making people a year older one day early. Date objects (node-pg returns
 * DATE columns as local midnight) are read with local getters.
 */
export function calculateAge(dob: string | Date): number {
  let year: number;
  let month: number; // 0-based
  let day: number;

  const match = typeof dob === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dob) : null;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  } else {
    const d = new Date(dob);
    year = d.getFullYear();
    month = d.getMonth();
    day = d.getDate();
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() < month || (today.getMonth() === month && today.getDate() < day)) {
    age--;
  }
  return age;
}
