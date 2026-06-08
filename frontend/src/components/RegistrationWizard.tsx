/**
 * Onboarding wizard when the user is not registered on the current chain.
 * Step 1: Info → Step 2: Generate Stealth Keys (sign) → Step 3: Register on-chain with progress.
 * On success: "Vault Unlocked" animation, then onComplete() to transition to dashboard.
 */

import { useEffect, useState } from "react";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  encodeFunctionData,
  type EIP1193Provider,
  type Hash,
} from "viem";
import { motion, AnimatePresence } from "framer-motion";
import { getChain, getRpcUrl } from "../lib/chain";
import { useKeys } from "../context/KeysContext";
import { useWallet } from "../hooks/useWallet";
import {
  getRegistryAddress,
  STEALTH_REGISTRY_ABI,
} from "../lib/registry";
import { SCHEME_ID_SECP256K1 } from "../lib/contracts";
import { getConfigForChain, isChainSupported } from "../contracts/contract-config";
import { SwitchNetworkModal } from "./SwitchNetworkModal";
import {
  getRememberSignaturePreference,
  loadSignatureSession,
  saveSignatureSession,
  setRememberSignaturePreference,
} from "../lib/signatureSession";
import { SETUP_MESSAGE } from "../lib/stealth";

type Step = "info" | "generate" | "register" | "success";
type RegisterPhase = "idle" | "deriving" | "broadcasting" | "mining";

export type RegistrationWizardProps = {
  onComplete: () => void;
};

export function RegistrationWizard({ onComplete }: RegistrationWizardProps) {
  const { setFromSignature, stealthMetaAddressHex } = useKeys();
  const { address, chainId } = useWallet();
  const currentConfig = getConfigForChain(chainId);
  const [step, setStep] = useState<Step>("info");
  const [signing, setSigning] = useState(false);
  const [registerPhase, setRegisterPhase] = useState<RegisterPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, setTxHash] = useState<Hash | null>(null);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [rememberSession, setRememberSession] = useState<boolean>(() => getRememberSignaturePreference());

  useEffect(() => {
    setRememberSignaturePreference(rememberSession);
  }, [rememberSession]);

  const wrongNetwork = chainId != null && !isChainSupported(chainId);
  const networkName = chainId != null ? getChain(chainId).name : "this network";

  const handleGenerateKeys = async () => {
    if (!address || !(window as unknown as { ethereum?: EIP1193Provider }).ethereum?.request) {
      setError("No wallet found.");
      return;
    }
    setError(null);
    setSigning(true);
    try {
      let sig = chainId != null
        ? await loadSignatureSession({
            address,
            chainId,
            message: SETUP_MESSAGE,
          })
        : null;
      if (!sig) {
        const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
        const client = createWalletClient({
          chain: chainId != null ? getChain(chainId) : getChain(11155111),
          transport: custom(ethereum as EIP1193Provider),
        });
        const [acc] = await client.requestAddresses();
        if (!acc) throw new Error("No account selected.");
        sig = await client.signMessage({ account: acc, message: SETUP_MESSAGE });
        if (chainId != null) {
          await saveSignatureSession({
            signatureHex: sig,
            address: acc,
            chainId,
            message: SETUP_MESSAGE,
            remember: rememberSession,
          });
        }
      }
      setFromSignature(sig);
      setStep("register");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signature failed");
    } finally {
      setSigning(false);
    }
  };

  const handleRegister = async () => {
    if (!stealthMetaAddressHex || !address || chainId == null || !currentConfig) return;
    const registryAddress = getRegistryAddress(chainId);
    if (!registryAddress) return;
    setError(null);
    setTxHash(null);
    setRegisterPhase("deriving");
    // Brief moment so UI shows "Deriving Keys" (keys already derived, but we show the step)
    await new Promise((r) => setTimeout(r, 400));
    setRegisterPhase("broadcasting");
    try {
      const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!ethereum?.request) throw new Error("No wallet found.");
      const chain = getChain(chainId);
      const walletClient = createWalletClient({
        chain,
        transport: custom(ethereum),
      });
      const calldata = encodeFunctionData({
        abi: STEALTH_REGISTRY_ABI,
        functionName: "registerKeys",
        args: [SCHEME_ID_SECP256K1, stealthMetaAddressHex],
      });
      const hash = await walletClient.sendTransaction({
        account: address,
        to: registryAddress,
        data: calldata,
        value: 0n,
      });
      setTxHash(hash);
      setRegisterPhase("mining");
      const rpcUrl = getRpcUrl(chain);
      if (!rpcUrl) {
        setError("No RPC URL configured");
        setRegisterPhase("idle");
        return;
      }
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setRegisterPhase("idle");
      setStep("success");
      // Success animation visible for 1.8s then transition
      setTimeout(() => {
        onComplete();
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      setRegisterPhase("idle");
    }
  };

  const registerInProgress = registerPhase !== "idle";
  const progressSteps: { label: string; active: boolean; done: boolean }[] = [
    { label: "Deriving Keys", active: registerPhase === "deriving", done: registerPhase !== "deriving" && (registerPhase === "broadcasting" || registerPhase === "mining" || step === "success") },
    { label: "Broadcasting Transaction", active: registerPhase === "broadcasting", done: registerPhase === "mining" || step === "success" },
    { label: "Mining…", active: registerPhase === "mining", done: step === "success" },
  ];

  return (
    <div className="w-full max-w-lg mx-auto">
      <AnimatePresence mode="wait">
        {step === "success" ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="card flex flex-col items-center justify-center py-12 px-6 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-20 h-20 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center mb-6"
              aria-hidden
            >
              <svg
                className="w-10 h-10 text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                />
              </svg>
            </motion.div>
            <h2 className="text-xl font-semibold text-white mb-1">Vault Unlocked</h2>
            <p className="text-sm text-neutral-500">Taking you to your dashboard…</p>
          </motion.div>
        ) : (
          <motion.div
            key="wizard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="card"
          >
            <h2 className="text-lg font-semibold text-white mb-1">Registration required</h2>

            {step === "info" && (
              <div className="space-y-4">
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Your wallet is not yet registered on this chain. To receive private payments, you
                  need to generate and publish your Stealth Meta-Address. This is a one-time setup
                  per network.
                </p>
                <button
                  type="button"
                  onClick={() => setStep("generate")}
                  className="w-full py-3 px-4 rounded-lg text-sm font-medium btn-primary"
                >
                  Continue
                </button>
              </div>
            )}

            {step === "generate" && (
              <div className="space-y-4 mb-0">
                <p className="text-sm text-neutral-400">
                  Sign a message in your wallet to derive your spending and viewing keys. Keys are
                  generated locally and never leave your device.
                </p>
                <label className="inline-flex items-center gap-2 text-xs text-mist cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberSession}
                    onChange={(e) => setRememberSession(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-900 accent-glow"
                  />
                  Remember signature for this tab (about 30 minutes)
                </label>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                  type="button"
                  onClick={handleGenerateKeys}
                  disabled={signing}
                  className="w-full py-3 px-4 rounded-lg text-sm font-medium bg-white text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {signing ? "Check your wallet…" : "Generate Stealth Keys"}
                </button>
              </div>
            )}

            {step === "register" && (
              <div className="space-y-4 mb-0">
                {wrongNetwork && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                    <p className="text-sm text-amber-200">
                      Wrong network: registration is available on Sepolia (11155111) only.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowSwitchModal(true)}
                      className="w-full py-2 px-3 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30"
                    >
                      Switch network
                    </button>
                    {showSwitchModal && (
                      <div
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md"
                        role="dialog"
                        aria-modal="true"
                        onClick={() => setShowSwitchModal(false)}
                      >
                        <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                          <SwitchNetworkModal
                            title="Switch network"
                            description="Switch to Sepolia to register your stealth meta-address."
                            showClose
                            onClose={() => setShowSwitchModal(false)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-sm text-neutral-400">
                  Publish your Stealth Meta-Address on-chain so others can send to you by your ETH
                  address.
                </p>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <div className="space-y-2">
                  {progressSteps.map(({ label, active, done }) => (
                    <div
                      key={label}
                      className={`flex items-center gap-2 text-sm ${
                        active ? "text-white" : done ? "text-emerald-500/80" : "text-neutral-500"
                      }`}
                    >
                      {done ? (
                        <span className="text-emerald-500" aria-hidden>✓</span>
                      ) : active ? (
                        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-neutral-600" aria-hidden />
                      )}
                      {label}
                    </div>
                  ))}
                </div>
                {!registerInProgress && (
                  <button
                    type="button"
                    onClick={handleRegister}
                    disabled={!currentConfig || wrongNetwork}
                    className="w-full py-3 px-4 rounded-lg text-sm font-medium btn-primary disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                  >
                    Register on {networkName}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
