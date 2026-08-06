import React from 'react';

interface Props { fallback: React.ReactNode; resetKey: string; children: React.ReactNode }
interface State { failed: boolean }

/** The only error boundary in the app (BUG-009): a crash in a view must degrade the
 *  output to the plain slides render, never blank a screen the congregation is watching.
 *  Re-arms when resetKey (the payload's view) changes, so switching away and back retries. */
export class OutputErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: unknown): void { console.error('[helm] output view crashed, falling back to slides:', error); }
  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render(): React.ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}
