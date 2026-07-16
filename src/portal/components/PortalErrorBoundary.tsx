import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

// A render crash anywhere in the portal otherwise unmounts the entire React
// tree — a blank white page with no way back. This catches it, keeps the
// user oriented, and offers a reload.
export default class PortalErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[portal] render crash:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#09090B] text-[#FAFAFA] flex flex-col items-center justify-center gap-4 p-8 text-center">
          <img src="/brand/latech-symbol.svg" alt="" className="h-10 w-auto opacity-60" />
          <div className="font-display font-bold text-xl">Something went wrong</div>
          <p className="text-sm text-[#A1A1AA] max-w-sm">
            The portal hit an unexpected error. Your data is safe — reloading usually fixes it.
          </p>
          <Button
            onClick={() => window.location.reload()}
            className="bg-[#DFE104] text-black hover:bg-[#c9cb04]"
          >
            Reload portal
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
