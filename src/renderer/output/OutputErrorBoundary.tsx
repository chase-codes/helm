import React from 'react';

interface Props { fallback: React.ReactNode; resetKey: string; children: React.ReactNode; logMessage?: string }
interface State { failed: boolean; failedKey: string | null }

/** Output boundary (BUG-009): a crash in a view must degrade the
 *  output to the plain slides render, never blank a screen the congregation is watching.
 *  Re-arms once resetKey (the payload's view) moves away from the view that failed — not on
 *  any resetKey change — because a crash and a resetKey change often land in the same commit
 *  (the crashing view IS the newly-switched-to view); comparing prev/next props there would
 *  immediately un-trip the boundary and re-render the still-crashing child, double-firing
 *  componentDidCatch. Recording which key failed avoids that. */
export class OutputErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false, failedKey: null };
  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  componentDidCatch(error: unknown): void {
    console.error(this.props.logMessage ?? '[helm] output view crashed, falling back to slides:', error);
    this.setState({ failedKey: this.props.resetKey });
  }
  componentDidUpdate(): void {
    if (this.state.failed && this.state.failedKey !== null && this.props.resetKey !== this.state.failedKey) {
      this.setState({ failed: false, failedKey: null });
    }
  }
  render(): React.ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}
