import { create } from 'zustand';
import type {
  DeckSummary, GameOverMsg, GameState, ImportResultMsg, PreconSummary, PromptMsg,
  RejectedMsg, RequestMsg, SelectionMsg,
} from '../net/protocol';
import type { ClientEvent } from '../net/engineClient';

export type Screen = 'decks' | 'setup' | 'board' | 'gameOver' | 'engineStopped';
export type RespondMode = 'always' | 'smart' | 'never';

export interface Lobby { precons: PreconSummary[]; decks: DeckSummary[] }

export interface StoreState {
  screen: Screen;
  lobby: Lobby | null;
  game: GameState | null;
  prompt: PromptMsg | null;
  selection: SelectionMsg | null;
  playable: Set<string>;
  /** Open requests, oldest first. The head is the one to show. Kept even while game is null. */
  requests: RequestMsg[];
  lastRejection: RejectedMsg | null;
  lastImport: ImportResultMsg | null;
  gameOver: GameOverMsg | null;
  lastInfo: string | null;
  lastError: string | null;
  respondMode: RespondMode;
  handle: (m: ClientEvent) => void;
  setScreen: (s: Screen) => void;
  setRespondMode: (m: RespondMode) => void;
  removeRequest: (requestId: string) => void;
  /** Clears all per-game state (new game or back to menu). */
  resetGame: () => void;
}

const freshGame = () => ({
  game: null,
  prompt: null,
  selection: null,
  playable: new Set<string>(),
  requests: [] as RequestMsg[],
  lastRejection: null,
  gameOver: null,
});

export const useStore = create<StoreState>((set) => ({
  screen: 'decks',
  lobby: null,
  ...freshGame(),
  lastImport: null,
  lastInfo: null,
  lastError: null,
  respondMode: 'smart',

  handle: (m) =>
    set((s) => {
      switch (m.type) {
        case 'lobby':
          return { lobby: { precons: m.precons, decks: m.decks } };
        case 'importResult':
          return { lastImport: m };
        case 'state':
          return { game: m.state, screen: s.screen === 'gameOver' ? s.screen : 'board' };
        case 'prompt':
          return { prompt: m };
        case 'selection':
          return { selection: m };
        case 'playable':
          return { playable: new Set(m.cardIds) };
        case 'request':
          return { requests: [...s.requests, m] };
        case 'rejected':
          return { lastRejection: m };
        case 'gameOver':
          return { gameOver: m, screen: 'gameOver', requests: [] };
        case 'info':
          return { lastInfo: m.message };
        case 'error':
          return { lastError: m.message };
        case 'engineStopped':
          return { screen: 'engineStopped', requests: [] };
        default:
          return {};
      }
    }),

  setScreen: (screen) => set({ screen }),
  setRespondMode: (respondMode) => set({ respondMode }),
  removeRequest: (requestId) => set((s) => ({ requests: s.requests.filter((r) => r.requestId !== requestId) })),
  resetGame: () => set(freshGame()),
}));
