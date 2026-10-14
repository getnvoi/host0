import { Component, type ReactNode } from "react";
import { ErrorState } from "@hz/ui";

// A page that throws while it renders shows its error here; the shell and the other tabs keep working.
export class PageBoundary extends Component<{ children: ReactNode; path?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(before: { path?: string }) {
    if (this.state.error && before.path !== this.props.path) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorState message={error.message} retry={() => this.setState({ error: null })} />;
  }
}
