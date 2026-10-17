/** A time as the person's own browser writes it; nothing for no time. */
export const formatTime = (value) => (value ? new Date(value).toLocaleString() : '');

/** How a passage is named: its document's title and its heading, or the title alone when the heading is the title. */
export const sourceName = ({ docTitle, heading }) => (heading === docTitle ? docTitle : `${docTitle}: ${heading}`);

/** Where a source's button sits on the page, so a number in the answer can move focus to it. */
export const sourceButtonId = (base, index) => `${base}-source-${index + 1}`;

/** How long ago a time was, in the largest sensible unit: "5 minutes", "7 hours", "3 days". */
export function waitedSince(value, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`;
}
