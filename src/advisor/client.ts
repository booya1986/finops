import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from '../secrets/keychain.js';

export const ADVISOR_MODEL = 'claude-opus-4-8';

/**
 * The API key lives in the Keychain (never env/args/logs) and is read only
 * when a client is actually needed (PLAN.md §1.1).
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = getSecret('anthropic.apiKey');
  if (apiKey === null) {
    throw new Error('חסר "anthropic.apiKey" ב-Keychain. הרץ: npm run secrets -- set anthropic.apiKey');
  }
  return new Anthropic({ apiKey });
}

/** Extract the text block from a response, failing closed on refusals. */
export function responseText(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') {
    throw new Error('הבקשה נדחתה על ידי המודל (refusal)');
  }
  const block = message.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('לא התקבל תוכן טקסט מהמודל');
  }
  return block.text;
}
