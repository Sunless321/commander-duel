import { useStore } from '../state/store';
import { client } from './engineClient';
import type { UiMessage } from './protocol';

type ActionMsg = Extract<UiMessage, { type: 'action' }>;

/**
 * Sends a board action stamped with the prompt it answers (by default the prompt on screen). The engine applies it
 * only while that prompt's input still stands, so a double click or a late auto-pass never lands on the next input.
 */
export function sendAction(a: Omit<ActionMsg, 'type' | 'promptSeq'>, promptSeq = useStore.getState().prompt?.promptSeq): void {
  client.send({ type: 'action', ...a, promptSeq });
}
