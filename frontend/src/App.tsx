import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KeysProvider, useKeys } from "./context/KeysContext";
import { hasCompletedOnboardingTour, runOnboardingTour } from "./lib/onboardingTour";
import { ProtocolLogProvider } from "./context/ProtocolLogContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import { LandingView } from "./components/LandingView";
import { DashboardView } from "./components/DashboardView";
import { FaucetPage } from "./components/FaucetPage";
import { RegistrationWizard } from "./components/RegistrationWizard";
import { SendView } from "./components/SendView";
import { PrivateBalanceView } from "./components/PrivateBalanceView";
import { TransactionHistoryView } from "./components/TransactionHistoryView";
import { ReceiveView } from "./components/ReceiveView";
import { SubENSView } from "./components/SubENSView";
import { ProfileView } from "./components/ProfileView";
import { ProtocolLogPanel } from "./components/ProtocolLogPanel";
import { SchemaStudio } from "./components/SchemaStudio";
import { AttestationManager } from "./components/AttestationManager";
import { MyTraitsView } from "./components/MyTraitsView";
import { ManageView } from "./components/ManageView";
import { Layout, type Tab } from "./components/Layout";
import { NetworkGuard } from "./components/NetworkGuard";
import { useWallet } from "./hooks/useWallet";
import { useRegistrationStatus } from "./hooks/useRegistrationStatus";
import { useVaultStore } from "./store/vaultStore";
import { useGhostAddressStore, useGhostAddressPersistence } from "./store/ghostAddressStore";
import { useGasTankStore } from "./store/gasTankStore";
import { getExplorerTxUrl } from "./lib/explorer";

function AppContent() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [registrationJustCompleted, setRegistrationJustCompleted] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useKeys();
  const { isConnected, address, chainId, isConnecting, connect, disconnect } = useWallet();
  const { isSetup, clearKeys } = useKeys();
  const { isRegistered, isLoading: isRegistrationCheckLoading } = useRegistrationStatus(address, chainId);
  const clearVault = useVaultStore((s) => s.clear);

  useGhostAddressPersistence();

  useEffect(() => {
    useGhostAddressStore.getState().sanitizeGhostAddresses();
  }, []);

  useEffect(() => {
    const requestedTab = (location.state as { tab?: Tab } | null)?.tab;
    if (location.pathname === "/app" && requestedTab) {
      setTab(requestedTab);
      navigate("/app", { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    setRegistrationJustCompleted(false);
  }, [chainId]);

  const showDashboard = isRegistered || registrationJustCompleted;
  const showRegistrationWizard = isSetup && isConnected && address && chainId != null && !showDashboard && !isRegistrationCheckLoading;

  const handleRegistrationComplete = useCallback(() => {
    setRegistrationJustCompleted(true);
  }, []);

  const handleTab = (t: Tab) => {
    if (t === "subens") return;
    setTab(t);
  };

  useEffect(() => {
    if (tab !== "dashboard" || !isConnected || !isSetup || hasCompletedOnboardingTour()) return;
    const timer = setTimeout(() => runOnboardingTour(), 600);
    return () => clearTimeout(timer);
  }, [tab, isConnected, isSetup]);

  useEffect(() => {
    if (!registrationJustCompleted || tab !== "dashboard") return;
    const timer = setTimeout(() => runOnboardingTour(true), 800);
    return () => clearTimeout(timer);
  }, [registrationJustCompleted, tab]);

  const handleConnect = async () => {
    await connect();
  };

  const handleDisconnect = () => {
    clearKeys();
    clearVault();
    useGasTankStore.getState().clear();
    disconnect();
    setTab("dashboard");
  };

  const renderView = () => {
    if (tab === "dashboard") return <DashboardView onNavigate={setTab} address={address ?? undefined} chainId={chainId} />;
    if (tab === "faucet") return <FaucetPage />;
    if (tab === "send") return <SendView />;
    if (tab === "receive") return <ReceiveView onBack={() => setTab("dashboard")} />;
    if (tab === "balance") return <PrivateBalanceView />;
    if (tab === "history") return <TransactionHistoryView />;
    if (tab === "subens") return <SubENSView onBack={() => setTab("dashboard")} />;
    if (tab === "profile") return <ProfileView onNavigate={setTab} onDisconnect={handleDisconnect} />;
    if (tab === "schemas") return <SchemaStudio onNavigate={(t) => setTab(t as Tab)} />;
    if (tab === "attest") return <AttestationManager onNavigate={(t) => setTab(t as Tab)} />;
    if (tab === "my-traits") return <MyTraitsView onNavigate={(t) => setTab(t as Tab)} />;
    if (tab === "manage") return <ManageView onNavigate={(t) => setTab(t as Tab)} />;
    return null;
  };

  if (!isSetup) {
    return (
      <div className="min-h-dvh flex flex-col bg-ink-950 bg-grid-fade bg-size-grid">
        <LandingView />
      </div>
    );
  }

  if (isRegistrationCheckLoading) {
    return (
      <Layout
        tab="dashboard"
        onTabChange={handleTab}
        isConnected={isConnected}
        address={address ?? undefined}
        isConnecting={isConnecting}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        protocolLog={<ProtocolLogPanel />}
      >
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-ink-600 border-t-glow" aria-hidden />
          <p className="text-sm text-mist">Authenticating with protocol…</p>
        </div>
      </Layout>
    );
  }

  if (showRegistrationWizard) {
    return (
      <Layout
        tab={tab}
        onTabChange={handleTab}
        isConnected={isConnected}
        address={address ?? undefined}
        isConnecting={isConnecting}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        protocolLog={<ProtocolLogPanel />}
      >
        <RegistrationWizard onComplete={handleRegistrationComplete} />
      </Layout>
    );
  }

  return (
    <Layout
      tab={tab}
      onTabChange={handleTab}
      isConnected={isConnected}
      address={address ?? undefined}
      isConnecting={isConnecting}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      protocolLog={<ProtocolLogPanel />}
    >
      <NetworkGuard>{renderView()}</NetworkGuard>
    </Layout>
  );
}

const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

function ToastLayer() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-24 md:bottom-16 left-4 right-4 md:left-auto md:right-6 z-50 flex flex-col gap-2 max-w-sm md:ml-auto">
      {toasts.map((t) => {
        const explorerUrl = t.explorerTx ? getExplorerTxUrl(t.explorerTx.chainId, t.explorerTx.txHash) : null;
        return (
          <div
            key={t.id}
            className="rounded-xl border border-ink-700 bg-ink-900/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-lg flex flex-wrap items-center justify-between gap-2"
          >
            <span className="min-w-0 flex-1">{t.message}</span>
            <div className="flex items-center gap-2 shrink-0">
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1 text-xs font-medium text-mist hover:text-white transition-colors"
                >
                  <ExternalLinkIcon />
                  Explorer
                </a>
              )}
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="text-mist/60 hover:text-white p-0.5"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  return (
    <KeysProvider>
      <ProtocolLogProvider>
        <ToastProvider>
          <AppContent />
          <ToastLayer />
        </ToastProvider>
      </ProtocolLogProvider>
    </KeysProvider>
  );
}
