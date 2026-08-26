import React from 'react';
import { ModeCrashCard } from './ModeCrashCard';

interface Props { label: string; children: React.ReactNode }
interface State { failed: boolean; nonce: number }

/** Per-mode boundary (#30): one broken page degrades to a themed card instead of
 * whiting out the whole operator console. Header stays outside, so the mode tabs
 * remain the escape hatch. Reload remounts the subtree via a key bump — under the
 * keep-alive contract the crashed mode never unmounts on its own, so a fresh key
 * is the only honest way to clear its state. */
export class ModeErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false, nonce: 0 };
  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  componentDidCatch(error: unknown): void {
    console.error('[helm] operator mode crashed:', this.props.label, error);
  }
  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <ModeCrashCard
          label={this.props.label}
          onReload={() => this.setState((s) => ({ failed: false, nonce: s.nonce + 1 }))}
        />
      );
    }
    return <React.Fragment key={this.state.nonce}>{this.props.children}</React.Fragment>;
  }
}
