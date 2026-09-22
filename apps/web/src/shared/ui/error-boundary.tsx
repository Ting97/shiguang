"use client";

/**
 * 全局错误边界（REQ-004 FR-E1.3 / 4-F）：兜住子树渲染错误，展示可重试兜底 UI。
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[error-boundary]", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="glass mx-auto mt-16 max-w-md rounded-2xl p-8 text-center">
          <p className="text-4xl">😵</p>
          <h2 className="mt-3 text-base font-semibold text-ink">页面出了点问题</h2>
          <p className="mt-2 break-all text-[11px] text-ink-dim">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="btn-primary mt-5 rounded-xl px-5 py-2 text-sm font-medium"
          >
            重试
          </button>
          <a href="/" className="mt-3 block text-xs text-ink-mute hover:text-accent">
            返回首页
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}
