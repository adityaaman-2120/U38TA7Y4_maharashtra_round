"use client";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { ChainClockProvider } from "@/lib/hooks";
import { ToastProvider } from "./Toasts";
import { UnlockedKeyProvider } from "./KeyProvider";
import { I18nBridge } from "./I18nBridge";
import { ServerWaking } from "./ServerWaking";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1 } } }));
  return (
    <WagmiProvider config={config}>
      <I18nBridge />
      <ServerWaking />
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ChainClockProvider><UnlockedKeyProvider>{children}</UnlockedKeyProvider></ChainClockProvider>
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
