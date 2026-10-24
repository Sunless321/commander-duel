import { useMemo, useState } from 'react';
import { Battlefield, FieldCard, type CardFlags } from '../components/Battlefield';
import { Card } from '../components/Card';
import { ChooseFrom, offBoardChoices } from '../components/ChooseFrom';
import { ConcedeButton } from '../components/ConcedeButton';
import { ElsewhereStrip, unrenderedOffers } from '../components/ElsewhereStrip';
import { Hand } from '../components/Hand';
import { PhaseBar } from '../components/PhaseBar';
import { PlayerPanel, type ViewZone } from '../components/PlayerPanel';
import { PromptBar } from '../components/PromptBar';
import { ResponsePopup } from '../components/ResponsePopup';
import { RequestDialog } from '../components/RequestDialog';
import { StackView } from '../components/StackView';
import { ZoneViewer } from '../components/ZoneViewer';
import { client } from '../net/engineClient';
import type { GameState, PlayerDto } from '../net/protocol';
import { useStore } from '../state/store';
import '../styles/board.css';

const MANA = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

interface OpenZone { playerId: string; zone: ViewZone }

/** The main game screen. It renders what the engine sends and relays clicks; the engine decides legality. */
export function Board() {
  const game = useStore((s) => s.game);
  const selection = useStore((s) => s.selection);
  const playable = useStore((s) => s.playable);
  const [hovered, setHovered] = useState<string | null>(null);
  const [openZone, setOpenZone] = useState<OpenZone | null>(null);

  const flags = useMemo<CardFlags | null>(() => {
    if (!game) return null;
    // Opponents' permanents never glow for you; anything else the engine calls playable may
    // (your hand, battlefield, command zone, any graveyard or exile: flashback, foretell, "you may cast").
    const theirs = new Set(game.players.filter((p) => !p.you).flatMap((p) => [...p.battlefield, ...p.command]));
    const selectable = new Set(selection?.selectable ?? []);
    const chosen = new Set(selection?.chosen ?? []);
    const selecting = selectable.size > 0;
    return {
      glow: (id) => !selecting && playable.has(id) && !theirs.has(id),
      selectable: (id) => selectable.has(id),
      chosen: (id) => chosen.has(id),
      onCard: (id) => {
        if (game.cards[id]) client.send({ type: 'action', action: 'selectCard', id });
      },
      onHover: setHovered,
    };
  }, [game, selection, playable]);

  // Selectable cards no zone draws (a searched library, a revealed hand) get the "Choose from" panel;
  // the strip keeps whatever else the engine offers off the board.
  const choices = useMemo(() => (game ? offBoardChoices(game, selection?.selectable ?? []) : []), [game, selection]);
  const elsewhere = useMemo(() => {
    if (!game) return [];
    const inChoices = new Set(choices.flatMap((g) => g.ids));
    return unrenderedOffers(game, playable).filter((id) => !inChoices.has(id));
  }, [game, playable, choices]);

  const ok = () => client.send({ type: 'action', action: 'ok' });
  const cancel = () => client.send({ type: 'action', action: 'cancel' });
  const concede = () => client.send({ type: 'action', action: 'concede' });

  return (
    <div className="board">
      <div className="board-main">
        {game && flags ? (
          <Table game={game} flags={flags} onZone={(playerId, zone) => setOpenZone({ playerId, zone })} />
        ) : (
          <div className="shuffling">Shuffling up…</div>
        )}
        {game && flags && (
          <ChooseFrom key={choices.flatMap((g) => g.ids).join(',')} groups={choices} game={game} flags={flags} />
        )}
      </div>
      <aside className="board-side">
        {game && hovered && game.cards[hovered] && !game.cards[hovered].hidden && (
          <div className="preview"><Card card={game.cards[hovered]} size="hand" glow={false} selectable={false} chosen={false} /></div>
        )}
        <div className="grow" />
        {game && flags && <ElsewhereStrip ids={elsewhere} game={game} flags={flags} />}
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
        {game && <ConcedeButton onConcede={concede} />}
      </aside>
      {game && flags && openZone && (
        <ZoneViewer game={game} playerId={openZone.playerId} zone={openZone.zone} flags={flags} onClose={() => setOpenZone(null)} />
      )}
      <ResponsePopup />
      <RequestDialog />
    </div>
  );
}

function Table(props: { game: GameState; flags: CardFlags; onZone: (playerId: string, zone: ViewZone) => void }) {
  const { game, flags, onZone } = props;
  const you = game.players.find((p) => p.you);
  const opponents = game.players.filter((p) => !p.you);
  const onPlayer = (id: string) => {
    if (game.players.some((p) => p.id === id)) client.send({ type: 'action', action: 'selectPlayer', id });
  };
  const panel = (p: PlayerDto) => (
    <PlayerPanel player={p} game={game} flags={flags} onClick={() => onPlayer(p.id)} onZone={(z) => onZone(p.id, z)} />
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
