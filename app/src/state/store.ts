import { create } from 'zustand';
import type {
  DeckSummary, GameOverMsg, GameState, ImportResultMsg, PreconSummary, PromptMsg,
  RejectedMsg, RequestMsg, SelectionMsg, UiMessage,
} from '../net/protocol';
import type { ClientEvent } from '../net/engineClient';

export type Screen = 'decks' | 'setup' | 'board' | 'gameOver' | 'engineStopped';
export type RespondMode = 'always' | 'smart' | 'never';

const MODE_KEY = 'commanderDuel.respondMode';
const TIP_KEY = 'commanderDuel.respondTipDismissed';

function loadMode(): RespondMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'always' || v === 'smart' || v === 'never') return v;
  } catch { /* storage unavailable */ }
  return 'smart';
}

function loadTipDismissed(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === '1';
  } catch {
    return false;
  }
}

export interface Lobby { precons: PreconSummary[]; decks: DeckSummary[] }
export type StartGameMsg = Extract<UiMessage, { type: 'startGame' }>;
export interface InfoNote { title: string | null; message: string }

export interface StoreState {
  screen: Screen;
  lobby: Lobby | null;
  game: GameState | null;
  prompt: PromptMsg | null;
  selection: SelectionMsg | null;
  playable: Set<string>;
  /** Open requests, oldest first. The head is the one to show. Kept even while game is null. */
  requests: RequestMsg[];
  /** Answered requests awaiting the engine's verdict; a rejection puts one back at the head of `requests`. */
  answered: RequestMsg[];
  /** Rejection reasons for open requests, by requestId. */
  requestErrors: Record<string, string>;
  /** The latest rejection of a click (no requestId). */
  lastRejection: RejectedMsg | null;
  lastImport: ImportResultMsg | null;
  selectedDeck: DeckSummary | null;
  selectDeck: (d: DeckSummary | null) => void;
  gameOver: GameOverMsg | null;
  lastInfo: InfoNote | null;
  lastError: string | null;
  /** The last startGame sent, for "Play again". */
  lastStart: StartGameMsg | null;
  respondMode: RespondMode;
  respondTipDismissed: boolean;
  handle: (m: ClientEvent) => void;
  setScreen: (s: Screen) => void;
  setRespondMode: (m: RespondMode) => void;
  dismissRespondTip: () => void;
  removeRequest: (requestId: string) => void;
  /** Call right after sending an answer: the request leaves the queue unless the engine rejects it. */
  markAnswered: (requestId: string) => void;
  dismissInfo: () => void;
  dismissError: () => void;
  /** Clears all per-game state (new game or back to menu). */
  resetGame: () => void;
}

const freshGame = () => ({
  game: null,
  prompt: null,
  selection: null,
  playable: new Set<string>(),
  requests: [] as RequestMsg[],
  answered: [] as RequestMsg[],
  requestErrors: {} as Record<string, string>,
  lastRejection: null,
  gameOver: null,
});

export const useStore = create<StoreState>((set) => ({
  screen: 'decks',
  lobby: null,
  ...freshGame(),
  lastImport: null,
  selectedDeck: null,
  lastInfo: null,
  lastError: null,
  lastStart: null,
  respondMode: loadMode(),
  respondTipDismissed: loadTipDismissed(),

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
        case 'rejected': {
          if (m.requestId == null) return { lastRejection: m };
          const id = m.requestId;
          const requestErrors = { ...s.requestErrors, [id]: m.reason };
          const back = s.answered.find((r) => r.requestId === id);
          if (back) {
            return { requests: [back, ...s.requests], answered: s.answered.filter((r) => r !== back), requestErrors };
          }
          return s.requests.some((r) => r.requestId === id) ? { requestErrors } : { lastRejection: m };
        }
        case 'gameOver':
          return { gameOver: m, screen: 'gameOver', requests: [] };
        case 'info':
          return { lastInfo: { title: m.title ?? null, message: m.message } };
        case 'error':
          return { lastError: m.message };
        case 'engineStopped':
          return { ...freshGame(), screen: 'engineStopped' };
        default:
          return {};
      }
    }),

  setScreen: (screen) => set({ screen }),
  selectDeck: (selectedDeck) => set({ selectedDeck }),
  setRespondMode: (respondMode) => {
    try { localStorage.setItem(MODE_KEY, respondMode); } catch { /* storage unavailable */ }
    set({ respondMode });
  },
  dismissRespondTip: () => {
    try { localStorage.setItem(TIP_KEY, '1'); } catch { /* storage unavailable */ }
    set({ respondTipDismissed: true });
  },
  removeRequest: (requestId) => set((s) => ({ requests: s.requests.filter((r) => r.requestId !== requestId) })),
  markAnswered: (requestId) =>
    set((s) => {
      const r = s.requests.find((x) => x.requestId === requestId);
      if (!r) return {};
      const requestErrors = { ...s.requestErrors };
      delete requestErrors[requestId];
      // An accepted answer gets no reply, so only the latest few are kept in case of a rejection.
      return { requests: s.requests.filter((x) => x !== r), answered: [...s.answered.slice(-9), r], requestErrors };
    }),
  dismissInfo: () => set({ lastInfo: null }),
  dismissError: () => set({ lastError: null }),
  resetGame: () => set(freshGame()),
}));
