import { useState, type ReactNode } from 'react';
import { client } from '../net/engineClient';
import type { AmountTarget, CardDto, RequestMsg, RequestOption } from '../net/protocol';
import { useStore } from '../state/store';
import { Card } from './Card';

type Answer = { optionIds: string[] } | { value: number } | { text: string } | { amounts: Record<string, number> };
type Cards = Record<string, CardDto>;
interface BodyProps { request: RequestMsg; cards: Cards; answer: (a: Answer) => void }

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const offered = (r: RequestMsg) => new Set(r.options.map((o) => o.id));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Modal for the head of the request queue. Every answer carries only ids/targets the request offered. */
export function RequestDialog() {
  const request = useStore((s) => s.requests[0]);
  const error = useStore((s) => (s.requests[0] ? s.requestErrors[s.requests[0].requestId] : undefined));
  const cards = useStore((s) => s.game?.cards) ?? {};
  if (!request) return null;

  const answer = (a: Answer) => {
    client.send({ type: 'answer', requestId: request.requestId, ...a } as Parameters<typeof client.send>[0]);
    useStore.getState().markAnswered(request.requestId);
  };
  const showMessage = request.message && request.message !== request.title;
  const titleId = `req-title-${request.requestId}`;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="modal-title">{request.title || 'Choose'}</h2>
        {showMessage && <p className="modal-message">{request.message}</p>}
        {error && <p role="alert" className="modal-error">{error}</p>}
        <Body key={request.requestId} request={request} cards={cards} answer={answer} />
      </div>
    </div>
  );
}

function Body(props: BodyProps) {
  switch (props.request.kind) {
    case 'confirm':
    case 'ability':
      return <ButtonsBody {...props} />;
    case 'order':
      return <OrderBody {...props} />;
    case 'manipulate':
      return <ManipulateBody {...props} />;
    case 'integer':
      return <IntegerBody {...props} />;
    case 'text':
      return <TextBody {...props} />;
    case 'damage':
    case 'amount':
      return <AmountBody {...props} />;
    default:
      return <ChooseBody {...props} />;
  }
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}

/** An option's face: its card when it names one in the game, otherwise its label. */
function OptionFace({ option, cards }: { option: RequestOption; cards: Cards }) {
  const card = option.cardId ? cards[option.cardId] : undefined;
  if (!card) return <>{option.label}</>;
  return (
    <span className="option-card">
      <Card card={card} size="stack" glow={false} selectable={false} chosen={false} />
      <span className="option-label">{option.label}</span>
    </span>
  );
}

const hasCards = (r: RequestMsg, cards: Cards) => r.options.some((o) => o.cardId && cards[o.cardId]);

// ---------------------------------------------------------------- choose / entity

function ChooseBody({ request, cards, answer }: BodyProps) {
  const { min, max, options } = request;
  const ids = offered(request);
  const [picked, setPicked] = useState<string[]>(() => strings(request.extras.selected).filter((id) => ids.has(id)).slice(0, max));

  if (request.extras.reveal === true || max === 0) {
    return (
      <>
        <div className={hasCards(request, cards) ? 'option-grid' : 'option-list'}>
          {options.map((o) => <div key={o.id} className="option static"><OptionFace option={o} cards={cards} /></div>)}
        </div>
        <Actions><button type="button" className="btn primary" onClick={() => answer({ optionIds: [] })}>OK</button></Actions>
      </>
    );
  }

  const full = picked.length >= max;
  const toggle = (id: string) =>
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (max === 1) return [id];
      return cur.length < max ? [...cur, id] : cur;
    });
  const ok = picked.length >= min && picked.length <= max;
  return (
    <>
      <p className="modal-hint">{min === max ? `Choose ${min}` : `Choose ${min}–${max}`} · {picked.length} chosen</p>
      <div className={hasCards(request, cards) ? 'option-grid' : 'option-list'}>
        {options.map((o) => {
          const on = picked.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`option${on ? ' on' : ''}`}
              aria-pressed={on}
              aria-label={o.label}
              disabled={!on && full && max > 1}
              onClick={() => toggle(o.id)}
            >
              <OptionFace option={o} cards={cards} />
            </button>
          );
        })}
      </div>
      <Actions>
        <button type="button" className="btn primary" disabled={!ok} onClick={() => answer({ optionIds: picked.filter((id) => ids.has(id)) })}>
          Confirm
        </button>
      </Actions>
    </>
  );
}

// ---------------------------------------------------------------- confirm / ability

function ButtonsBody({ request, cards, answer }: BodyProps) {
  const card = typeof request.extras.cardId === 'string' ? cards[request.extras.cardId] : undefined;
  const def = num(request.extras.default, -1);
  return (
    <>
      {card && <div className="modal-card"><Card card={card} size="stack" glow={false} selectable={false} chosen={false} /></div>}
      <Actions>
        {request.options.map((o, i) => (
          <button key={o.id} type="button" className={`btn${i === def ? ' primary' : ''}`} onClick={() => answer({ optionIds: [o.id] })}>
            {o.label}
          </button>
        ))}
        {request.min === 0 && (
          <button type="button" className="btn" onClick={() => answer({ optionIds: [] })}>Cancel</button>
        )}
      </Actions>
    </>
  );
}

// ---------------------------------------------------------------- order / manipulate

function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function OrderedList(props: {
  ids: string[];
  byId: Map<string, RequestOption>;
  cards: Cards;
  movable: (id: string) => boolean;
  onMove: (i: number, d: number) => void;
  onRemove?: (i: number) => void;
}) {
  const { ids, byId, cards, movable, onMove, onRemove } = props;
  return (
    <ol className="order-list">
      {ids.map((id, i) => {
        const o = byId.get(id)!;
        return (
          <li key={id} className="order-row">
            <span className="order-pos">{i + 1}</span>
            <span className="order-face"><OptionFace option={o} cards={cards} /></span>
            <button type="button" className="btn small" aria-label={`Move ${o.label} up`} disabled={!movable(id) || i === 0} onClick={() => onMove(i, -1)}>▲</button>
            <button type="button" className="btn small" aria-label={`Move ${o.label} down`} disabled={!movable(id) || i === ids.length - 1} onClick={() => onMove(i, 1)}>▼</button>
            {onRemove && <button type="button" className="btn small" aria-label={`Remove ${o.label}`} onClick={() => onRemove(i)}>✕</button>}
          </li>
        );
      })}
    </ol>
  );
}

function OrderBody({ request, cards, answer }: BodyProps) {
  const { min, max, options } = request;
  const byId = new Map(options.map((o) => [o.id, o]));
  const [chosen, setChosen] = useState<string[]>(() =>
    min >= options.length ? options.map((o) => o.id) : strings(request.extras.selected).filter((id) => byId.has(id)).slice(0, max),
  );
  const rest = options.filter((o) => !chosen.includes(o.id));
  const ok = chosen.length >= min && chosen.length <= max;
  const top = typeof request.extras.top === 'string' && request.extras.top !== request.message ? request.extras.top : null;
  return (
    <>
      {top && <p className="modal-hint">{top}</p>}
      <OrderedList
        ids={chosen}
        byId={byId}
        cards={cards}
        movable={() => true}
        onMove={(i, d) => setChosen((c) => move(c, i, d))}
        onRemove={min >= options.length ? undefined : (i) => setChosen((c) => c.filter((_, j) => j !== i))}
      />
      {rest.length > 0 && (
        <div className="option-list">
          {rest.map((o) => (
            <button key={o.id} type="button" className="option" aria-label={`Add ${o.label}`} disabled={chosen.length >= max} onClick={() => setChosen((c) => [...c, o.id])}>
              <OptionFace option={o} cards={cards} />
            </button>
          ))}
        </div>
      )}
      <Actions>
        <button type="button" className="btn primary" disabled={!ok} onClick={() => answer({ optionIds: chosen })}>Confirm</button>
      </Actions>
    </>
  );
}

function ManipulateBody({ request, cards, answer }: BodyProps) {
  const byId = new Map(request.options.map((o) => [o.id, o]));
  const movable = new Set(strings(request.extras.manipulable));
  const [ids, setIds] = useState(() => request.options.map((o) => o.id));
  return (
    <>
      <OrderedList ids={ids} byId={byId} cards={cards} movable={(id) => movable.has(id)} onMove={(i, d) => setIds((c) => move(c, i, d))} />
      <Actions>
        <button type="button" className="btn primary" onClick={() => answer({ optionIds: ids })}>Confirm</button>
      </Actions>
    </>
  );
}

// ---------------------------------------------------------------- numbers and text

function Stepper(props: { label: string; value: number; canLess: boolean; canMore: boolean; onChange: (v: number) => void }) {
  const { label, value, canLess, canMore, onChange } = props;
  return (
    <span className="stepper">
      <button type="button" className="btn small" aria-label={`Less to ${label}`} disabled={!canLess} onClick={() => onChange(value - 1)}>−</button>
      <output className="stepper-value" aria-label={`${label} amount`}>{value}</output>
      <button type="button" className="btn small" aria-label={`More to ${label}`} disabled={!canMore} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

function NumberPicker({ lo, hi, initial, submit }: { lo: number; hi: number; initial: number; submit: (v: number) => void }) {
  const [v, setV] = useState(() => clamp(initial, lo, hi));
  return (
    <>
      <div className="number-row">
        <Stepper label="value" value={v} canLess={v > lo} canMore={v < hi} onChange={(n) => setV(clamp(n, lo, hi))} />
        <input
          type="number"
          className="field"
          aria-label="Number"
          min={lo}
          max={hi}
          value={v}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setV(clamp(Math.trunc(n), lo, hi));
          }}
        />
      </div>
      <Actions><button type="button" className="btn primary" onClick={() => submit(v)}>Confirm</button></Actions>
    </>
  );
}

function bounds(request: RequestMsg): { lo: number; hi: number } {
  return { lo: num(request.extras.min, request.min), hi: num(request.extras.max, request.max) };
}

function IntegerBody({ request, answer }: BodyProps) {
  const { lo, hi } = bounds(request);
  return <NumberPicker lo={lo} hi={hi} initial={num(request.extras.initial, lo)} submit={(value) => answer({ value })} />;
}

function TextBody({ request, answer }: BodyProps) {
  const initial = typeof request.extras.initial === 'string' ? request.extras.initial : '';
  const numeric = request.extras.numeric === true;
  const [text, setText] = useState(initial);

  // Forge offered fixed answers: the engine accepts exactly one of their texts.
  if (request.options.length > 0) {
    return (
      <Actions>
        {request.options.map((o) => (
          <button key={o.id} type="button" className="btn" onClick={() => answer({ text: o.label })}>{o.label}</button>
        ))}
      </Actions>
    );
  }
  // getInteger's "Other..." number arrives as numeric text with bounds. The engine accepts digits only, so never below 0.
  if (numeric && typeof request.extras.min === 'number' && typeof request.extras.max === 'number') {
    const lo = Math.max(request.extras.min, 0);
    const hi = request.extras.max;
    const start = Number.parseInt(initial, 10);
    return <NumberPicker lo={lo} hi={hi} initial={Number.isFinite(start) ? start : Math.max(lo, 0)} submit={(v) => answer({ text: String(v) })} />;
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        answer({ text });
      }}
    >
      <input
        className="field wide"
        aria-label="Answer"
        type={numeric ? 'number' : 'text'}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <Actions><button type="submit" className="btn primary">Confirm</button></Actions>
    </form>
  );
}

// ---------------------------------------------------------------- damage / amount

function AmountBody({ request, cards, answer }: BodyProps) {
  const amount = num(request.extras.amount, 0);
  const targets = (Array.isArray(request.extras.targets) ? request.extras.targets : []) as AmountTarget[];
  const atLeastOne = request.extras.atLeastOne === true;
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(targets.map((t) => [t.id, 0])));
  const total = targets.reduce((sum, t) => sum + (values[t.id] ?? 0), 0);
  const ok = total === amount && (!atLeastOne || targets.every((t) => (values[t.id] ?? 0) >= 1));
  const label = typeof request.extras.label === 'string' ? request.extras.label : 'damage';
  return (
    <>
      <p className="modal-hint">{total} of {amount} {label} assigned</p>
      <ul className="amount-list">
        {targets.map((t) => {
          const v = values[t.id] ?? 0;
          const card = t.cardId ? cards[t.cardId] : undefined;
          return (
            <li key={t.id} className="amount-row">
              {card && <Card card={card} size="stack" glow={false} selectable={false} chosen={false} />}
              <span className="amount-label">{t.label}</span>
              <Stepper
                label={t.label}
                value={v}
                canLess={v > 0}
                canMore={total < amount && v < num(t.max, amount)}
                onChange={(n) => setValues((cur) => ({ ...cur, [t.id]: n }))}
              />
            </li>
          );
        })}
      </ul>
      <Actions>
        {request.extras.maySkip === true && (
          <button type="button" className="btn" onClick={() => answer({ amounts: {} })}>Skip</button>
        )}
        <button type="button" className="btn primary" disabled={!ok} onClick={() => answer({ amounts: values })}>Confirm</button>
      </Actions>
    </>
  );
}
