/** Forge tags card names in log and stack text with its internal id, e.g. "Cultivate (174)"; players don't need it. */
/** Shown for a stack item whose source you can't see (the engine sends no text for it). */
export const HIDDEN_STACK_TEXT = 'A hidden spell or ability';

export function cleanText(text: string): string {
  return text.replace(/ \(\d+\)/g, '');
}
