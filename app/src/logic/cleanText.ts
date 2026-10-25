/** Forge tags card names in log and stack text with its internal id, e.g. "Cultivate (174)"; players don't need it. */
export function cleanText(text: string): string {
  return text.replace(/ \(\d+\)/g, '');
}
