import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page render failed', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="text-lg font-bold">This page could not be displayed</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            The link may be damaged or the song data is incomplete.
          </p>
          <a href="/" className="mt-4 inline-block text-sm underline">
            Back to home
          </a>
        </div>
      )
    }
    return this.props.children
  }
}
