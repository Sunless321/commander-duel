import { useMemo, useState } from 'react';
import { Battlefield, FieldCard, type CardFlags } from '../components/Battlefield';
import { Card } from '../components/Card';
import { Hand } from '../components/Hand';
import { PhaseBar } from '../components/PhaseBar';
import { PlayerPanel } from '../components/PlayerPanel';
import { PromptBar } from '../components/PromptBar';
import { RequestDialog } from '../components/RequestDialog';
import { StackView } from '../components/StackView';
import { client } from '../net/engineClient';
import type { GameState, PlayerDto } from '../net/protocol';
import { useStore } from '../state/store';
import '../styles/board.css';

const MANA = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

/** The main game screen. It renders what the engine sends and relays clicks; the engine decides legality. */
export function Board() {
  const game = useStore((s) => s.game);
  const selection = useStore((s) => s.selection);
  const playable = useStore((s) => s.playable);
  const [hovered, setHovered] = useState<string | null>(null);

  const flags = useMemo<CardFlags | null>(() => {
    if (!game) return null;
    const you = game.players.find((p) => p.you);
    const mine = new Set([...(you?.hand ?? []), ...(you?.battlefield ?? []), ...(you?.command ?? [])]);
    const selectable = new Set(selection?.selectable ?? []);
    const chosen = new Set(selection?.chosen ?? []);
    const selecting = selectable.size > 0;
    return {
      glow: (id) => !selecting && playable.has(id) && mine.has(id),
      selectable: (id) => selectable.has(id),
      chosen: (id) => chosen.has(id),
      onCard: (id) => {
        if (game.cards[id]) client.send({ type: 'action', action: 'selectCard', id });
      },
      onHover: setHovered,
    };
  }, [game, selection, playable]);

  const ok = () => client.send({ type: 'action', action: 'ok' });
  const cancel = () => client.send({ type: 'action', action: 'cancel' });

  return (
    <div className="board">
      <div className="board-main">
        {game && flags ? <Table game={game} flags={flags} /> : <div className="shuffling">Shuffling up…</div>}
      </div>
      <aside className="board-side">
        {game && hovered && game.cards[hovered] && !game.cards[hovered].hidden && (
          <div className="preview"><Card card={game.cards[hovered]} size="hand" glow={false} selectable={false} chosen={false} /></div>
        )}
        <div className="grow" />
        {game && flags && (
          <StackView
            game={game}
            selectable={flags.selectable}
            chosen={flags.chosen}
            onClick={(id) => {
              if (game.stack.some((s) => s.id === id)) client.send({ type: 'action', action: 'selectStackItem', id });
            }}
          />
        )}
        <PromptBar onOk={ok} onCancel={cancel} />
      </aside>
      <RequestDialog />
    </div>
  );
}

function Table({ game, flags }: { game: GameState; flags: CardFlags }) {
  const you = game.players.find((p) => p.you);
  const opponents = game.players.filter((p) => !p.you);
  const onPlayer = (id: string) => {
    if (game.players.some((p) => p.id === id)) client.send({ type: 'action', action: 'selectPlayer', id });
  };
  const panel = (p: PlayerDto) => (
    <PlayerPanel player={p} game={game} selectable={flags.selectable(p.id)} chosen={flags.chosen(p.id)} onClick={() => onPlayer(p.id)} />
  );

  return (
    <>
      <div className={`opponents n${opponents.length}`}>
        {opponents.map((p) => (
          <div key={p.id} className="opp-strip" data-player-id={p.id}>
            {panel(p)}
            <div className="opp-field">
              {p.command.length > 0 && (
                <div className="command-mini" aria-label={`${p.name}'s command zone`}>
                  {p.command.map((id) => <FieldCard key={id} id={id} game={game} flags={flags} />)}
                </div>
              )}
              <Battlefield ids={p.battlefield} game={game} flags={flags} label={`${p.name}'s battlefield`} />
            </div>
          </div>
        ))}
      </div>
      <PhaseBar game={game} />
      {you && (
        <>
          <div className="my-row" data-player-id={you.id}>
            <section className="command-zone" aria-label="Command zone">
              <span className="zone-title">Command zone</span>
              <div className="field-row">{you.command.map((id) => <FieldCard key={id} id={id} game={game} flags={flags} />)}</div>
            </section>
            <div className="my-field">
              <Battlefield ids={you.battlefield} game={game} flags={flags} label="Your battlefield" />
            </div>
          </div>
          <div className="bottom-row">
            <div className="my-panel">
              {panel(you)}
              <ManaPool player={you} />
            </div>
            <Hand ids={you.hand} game={game} flags={flags} />
          </div>
        </>
      )}
    </>
  );
}

function ManaPool({ player }: { player: PlayerDto }) {
  const pips = MANA.filter((c) => (player.manaPool[c] ?? 0) > 0);
  if (pips.length === 0) return null;
  return (
    <div className="mana-pool" aria-label="Mana pool">
      {pips.map((c) => (
        <button
          key={c}
          type="button"
          className={`pip pip-${c}`}
          aria-label={`Use ${c} mana (${player.manaPool[c]})`}
          onClick={() => client.send({ type: 'action', action: 'useMana', color: c })}
        >
          {c}<span className="pip-count">{player.manaPool[c]}</span>
        </button>
      ))}
    </div>
  );
}
