import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

/**
 * A drawing bug must not blank the whole window: the engine keeps the game going, so this shows what broke
 * and a Retry that draws the table again from the latest state.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('render error:', error, info.componentStack ?? '');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 32 }}>
        <h1>Something went wrong drawing the table</h1>
        <p>Your game is still running. Retry to draw it again.</p>
        <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.7 }}>{error.message}</pre>
        <button onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
