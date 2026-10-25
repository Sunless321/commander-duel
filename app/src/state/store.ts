import { create } from 'zustand';
import type {
  DeckSummary, GameOverMsg, GameState, ImportResultMsg, LogEntry, PreconSummary, PromptMsg,
  RejectedMsg, RequestMsg, SelectionMsg, UiMessage,
} from '../net/protocol';
import type { ClientEvent } from '../net/engineClient';
import { emptyRecorder, finishRecording, recordLog, recordState, type Recorder, type Recording } from '../logic/recording';

export type Screen = 'decks' | 'setup' | 'board' | 'gameOver' | 'engineStopped' | 'matches' | 'replay';
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
  /** This match's play log, oldest first. Memory only: cleared with the rest of the game state. */
  log: LogEntry[];
  /** Turn snapshots and the full log of the match in progress; memory only unless the player saves it. */
  recorder: Recorder;
  /** The finished match, ready to save from the game-over screen. */
  lastRecording: Recording | null;
  /** The saved match open in the replay viewer. */
  replay: Recording | null;
  openReplay: (r: Recording) => void;
  lastInfo: InfoNote | null;
  lastError: string | null;
  /** The last startGame sent, for "Play again". */
  lastStart: StartGameMsg | null;
  respondMode: RespondMode;
  respondTipDismissed: boolean;
  /** Seq of the applied state; a prompt is only acted on when its stateSeq is not above this (an older state is the bug; a newer one is fine). */
  stateSeq: number;
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
  stateSeq: -1,
  game: null,
  prompt: null,
  selection: null,
  playable: new Set<string>(),
  requests: [] as RequestMsg[],
  answered: [] as RequestMsg[],
  requestErrors: {} as Record<string, string>,
  lastRejection: null,
  gameOver: null,
  log: [] as LogEntry[],
  recorder: emptyRecorder(),
  lastRecording: null as Recording | null,
});

const MAX_LOG = 500;

export const useStore = create<StoreState>((set) => ({
  screen: 'decks',
  lobby: null,
  ...freshGame(),
  lastImport: null,
  selectedDeck: null,
  lastInfo: null,
  lastError: null,
  lastStart: null,
  replay: null,
  openReplay: (replay) => set({ replay, screen: 'replay' }),
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
          return {
            game: m.state,
            screen: s.screen === 'gameOver' ? s.screen : 'board',
            stateSeq: m.seq,
            recorder: recordState(s.recorder, m.state),
            // The engine's last board can arrive just after gameOver: the recording ends on it.
            ...(s.screen === 'gameOver' && s.lastRecording ? { lastRecording: { ...s.lastRecording, final: m.state } } : {}),
          };
        case 'prompt':
          return { prompt: m };
        case 'selection':
          return { selection: m };
        case 'playable':
          return { playable: new Set(m.cardIds) };
        case 'request':
          return { requests: [...s.requests, m] };
        case 'rejected': {
          // A stale action (double click, or a prompt that moved on) was dropped by the engine: nothing to tell you.
          if (m.requestId == null) return m.reason.startsWith('stale') ? {} : { lastRejection: m };
          const id = m.requestId;
          const requestErrors = { ...s.requestErrors, [id]: m.reason };
          const back = s.answered.find((r) => r.requestId === id);
          if (back) {
            return { requests: [back, ...s.requests], answered: s.answered.filter((r) => r !== back), requestErrors };
          }
          return s.requests.some((r) => r.requestId === id) ? { requestErrors } : { lastRejection: m };
        }
        case 'log':
          return { log: [...s.log, ...m.entries].slice(-MAX_LOG), recorder: recordLog(s.recorder, m.entries) };
        case 'gameOver': {
          // The log goes with the match; the recording waits on the game-over screen in case it is saved.
          const deckName = s.lobby?.decks.find((d) => d.id === s.lastStart?.deckId)?.name ?? null;
          const lastRecording = finishRecording(s.recorder, s.game, m, deckName);
          return { gameOver: m, screen: 'gameOver', requests: [], log: [], recorder: emptyRecorder(), lastRecording };
        }
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
