// TypeScript mirror of the engine wire protocol (engine Dto.java, BridgeGuiGame.java, Session.java).
// Ids are prefixed strings: players "p<n>", cards "c<n>", stack items "s<n>", amount targets "t<i>",
// options "o<n>", requests "r<n>".

export interface PlayerDto {
  id: string;
  name: string;
  you: boolean;
  life: number;
  poison: number;
  commanderDamage: Record<string, number>;
  manaPool: Record<string, number>;
  hand: string[];
  handCount: number;
  libraryCount: number;
  graveyard: string[];
  exile: string[];
  command: string[];
  battlefield: string[];
  /** Library cards Forge lets you look at right now (e.g. while you search); usually empty. */
  visibleLibrary: string[];
  /** This opponent's hand cards Forge lets you look at right now (e.g. a discard spell's reveal); empty for you. */
  visibleHand: string[];
}

export interface CardDto {
  id: string;
  name: string | null;
  ownerId: string;
  controllerId: string;
  zone: string;
  tapped: boolean;
  sick: boolean;
  hidden: boolean;
  imageUrl: string | null;
  manaCost: string | null;
  typeLine: string | null;
  text: string | null;
  power: string | null;
  toughness: string | null;
  damage: number;
  counters: Record<string, number>;
  attachedToId: string | null;
  commander: boolean;
}

export interface StackItemDto {
  id: string;
  text: string;
  sourceCardId: string | null;
  activatorId: string | null;
  targetIds: string[];
}

export interface AttackDto {
  attackerId: string;
  defenderId: string;
  blockerIds: string[];
}

export interface GameState {
  turn: number;
  phase: string;
  activePlayerId: string | null;
  priorityPlayerId: string | null;
  youId: string;
  players: PlayerDto[];
  cards: Record<string, CardDto>;
  stack: StackItemDto[];
  combat: AttackDto[];
}

export interface DeckSummary {
  id: string;
  name: string;
  commanders: string[];
}

export interface PreconSummary {
  id: string;
  name: string;
  commander: string;
  colors: string[];
}

// ---------------------------------------------------------------- engine -> UI

export interface ReadyMsg { type: 'ready' }
export interface LobbyMsg { type: 'lobby'; precons: PreconSummary[]; decks: DeckSummary[] }
export interface ImportResultMsg {
  type: 'importResult';
  ok: boolean;
  deck: DeckSummary | null;
  unknownCards: string[];
  problems: string[];
}
/** `seq` numbers states; prompt/selection/request carry the `stateSeq` of the state sent just before them. */
export interface StateMsg { type: 'state'; seq: number; state: GameState }

export type InputKind = 'priority' | 'mulligan' | 'attack' | 'block' | 'payMana' | 'target' | 'select' | 'other' | 'wait';
export interface PromptButton { label: string; enabled: boolean }
export interface PromptMsg {
  type: 'prompt';
  stateSeq: number;
  message: string;
  inputKind: InputKind;
  ok: PromptButton | null;
  cancel: PromptButton | null;
}

export interface SelectionMsg {
  type: 'selection';
  stateSeq: number;
  selectable: string[];
  chosen: string[];
  min: number;
  max: number;
}
export interface PlayableMsg { type: 'playable'; cardIds: string[] }

export type RequestKind =
  | 'choose' | 'order' | 'confirm' | 'ability' | 'integer' | 'text'
  | 'damage' | 'amount' | 'entity' | 'manipulate';
export interface RequestOption { id: string; label: string; cardId: string | null }
export interface AmountTarget { id: string; playerId?: string; cardId?: string; label: string; max: number }
export interface RequestMsg {
  type: 'request';
  stateSeq: number;
  requestId: string;
  kind: RequestKind;
  title: string;
  message: string;
  options: RequestOption[];
  min: number;
  max: number;
  /** Kind-specific fields: choose {selected, reveal}, order {ordered, top, selected, cardId},
   *  confirm {default, cardId}, integer {initial, numeric, min, max}, text {initial, numeric},
   *  ability {cardId}, manipulate {manipulable, toTop, toBottom, toAnywhere},
   *  damage/amount {amount, targets: AmountTarget[], maySkip, ...}. */
  extras: Record<string, unknown>;
}

export interface RejectedMsg { type: 'rejected'; requestId: string | null; reason: string }
export interface GameOverMsg { type: 'gameOver'; winnerNames: string[]; youWon: boolean }
export interface InfoMsg { type: 'info'; title?: string | null; message: string }
export interface ErrorMsg { type: 'error'; message: string }

export type EngineMessage =
  | ReadyMsg | LobbyMsg | ImportResultMsg | StateMsg | PromptMsg | SelectionMsg | PlayableMsg
  | RequestMsg | RejectedMsg | GameOverMsg | InfoMsg | ErrorMsg;

/** Emitted locally by EngineClient when the socket closes; never sent by the engine. */
export interface EngineStoppedMsg { type: 'engineStopped' }

// ---------------------------------------------------------------- UI -> engine

export type BotDeck = { kind: 'randomPrecon' } | { kind: 'precon'; id: string } | { kind: 'imported'; id: string };
export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';
export type GameAction = 'selectCard' | 'selectPlayer' | 'selectStackItem' | 'ok' | 'cancel' | 'useMana' | 'concede';

export type UiMessage =
  | { type: 'listLobby' }
  | { type: 'importDeck'; name: string; commanders: string[]; main: { count: number; name: string }[]; skippedLines?: string[] }
  | { type: 'startGame'; deckId: string; bots: { deck: BotDeck; difficulty: Difficulty }[] }
  | { type: 'answer'; requestId: string; optionIds: string[] }
  | { type: 'answer'; requestId: string; value: number }
  | { type: 'answer'; requestId: string; text: string }
  | { type: 'answer'; requestId: string; amounts: Record<string, number> }
  | { type: 'action'; action: GameAction; id?: string; color?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C' };

// ---------------------------------------------------------------- Electron bridge

export type ArchidektResult =
  | { ok: true; name: string; commanders: string[]; main: { count: number; name: string }[]; skippedLines?: string[] }
  | { ok: false; error: string };

export interface EngineEndpoint { port: number; token: string }

export interface DuelBridge {
  getEngine(): Promise<EngineEndpoint>;
  restartEngine(): Promise<EngineEndpoint>;
  importArchidekt(url: string): Promise<ArchidektResult>;
}
