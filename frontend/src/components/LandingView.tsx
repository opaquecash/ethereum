import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom, encodeFunctionData, type EIP1193Provider } from "viem";
import { getAppChain, getChain } from "../lib/chain";
import { useKeys } from "../context/KeysContext";
import { useWallet } from "../hooks/useWallet";
import { isRegistered, getRegistryAddress, STEALTH_REGISTRY_ABI } from "../lib/registry";
import { SCHEME_ID_SECP256K1 } from "../lib/contracts";
import { getConfigForChain } from "../contracts/contract-config";
import {
  getRememberSignaturePreference,
  loadSignatureSession,
  saveSignatureSession,
  setRememberSignaturePreference,
} from "../lib/signatureSession";
import { SETUP_MESSAGE } from "../lib/stealth";

type Phase = "idle" | "restoring" | "connecting" | "signing" | "checking" | "register" | "registering" | "done" | "error";

export function LandingView() {
  const { setFromSignature, isSetup, stealthMetaAddressHex } = useKeys();
  const { isConnected, address, chainId, isConnecting, connect } = useWallet();
  const currentConfig = getConfigForChain(chainId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [rememberSession, setRememberSession] = useState<boolean>(() => getRememberSignaturePreference());
  const attemptedRestoreKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setRememberSignaturePreference(rememberSession);
  }, [rememberSession]);

  useEffect(() => {
    if (isSetup || !isConnected || !address || chainId == null) return;
    const walletKey = `${address.toLowerCase()}:${chainId}`;
    if (attemptedRestoreKeysRef.current.has(walletKey)) return;
    attemptedRestoreKeysRef.current.add(walletKey);

    let cancelled = false;
    const run = async () => {
      setPhase("restoring");
      const signatureHex = await loadSignatureSession({
        address,
        chainId,
        message: SETUP_MESSAGE,
      });
      if (cancelled) return;
      if (signatureHex) {
        setFromSignature(signatureHex);
        return;
      }
      setPhase("idle");
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isSetup, isConnected, address, chainId, setFromSignature]);

  const handleEnterVault = async () => {
    setError(null);
    setTxHash(null);

    if (!isConnected || !address) {
      setPhase("connecting");
      try {
        await connect();
        if (!(window as unknown as { ethereum?: EIP1193Provider }).ethereum?.request) {
          throw new Error("No wallet found.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to connect");
        setPhase("error");
        return;
      }
      setPhase("idle");
      return;
    }

    let signatureHex: `0x${string}` | null = null;
    if (chainId != null) {
      signatureHex = await loadSignatureSession({
        address,
        chainId,
        message: SETUP_MESSAGE,
      });
    }

    if (!signatureHex) {
      setPhase("signing");
      try {
        const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
        if (!ethereum?.request) throw new Error("No wallet found.");
        const client = createWalletClient({
          chain: chainId != null ? getChain(chainId) : getAppChain(),
          transport: custom(ethereum as EIP1193Provider),
        });
        const [acc] = await client.requestAddresses();
        if (!acc) throw new Error("No account selected.");
        const sig = await client.signMessage({ account: acc, message: SETUP_MESSAGE });
        signatureHex = sig;
        if (chainId != null) {
          await saveSignatureSession({
            signatureHex: sig,
            address: acc,
            chainId,
            message: SETUP_MESSAGE,
            remember: rememberSession,
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Signature failed");
        setPhase("error");
        return;
      }
    }
    setFromSignature(signatureHex);

    setPhase("checking");
    let registered: boolean;
    try {
      registered = await isRegistered(address, chainId);
    } catch (e) {
      setError("Failed to check registration.");
      setPhase("error");
      return;
    }

    if (registered) {
      setPhase("done");
      return;
    }

    setPhase("register");
  };

  const handleRegister = async () => {
    if (!stealthMetaAddressHex || !address || chainId == null || !currentConfig) return;
    const registryAddress = getRegistryAddress(chainId);
    if (!registryAddress) return;
    setError(null);
    setTxHash(null);
    setPhase("registering");
    try {
      const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!ethereum?.request) throw new Error("No wallet found.");
      const client = createWalletClient({
        chain: getChain(chainId),
        transport: custom(ethereum),
      });
      const calldata = encodeFunctionData({
        abi: STEALTH_REGISTRY_ABI,
        functionName: "registerKeys",
        args: [SCHEME_ID_SECP256K1, stealthMetaAddressHex],
      });
      const hash = await client.sendTransaction({
        account: address,
        to: registryAddress,
        data: calldata,
        value: 0n,
      });
      setTxHash(hash);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      setPhase("register");
    }
  };

  if (isSetup) return null;

  const showSpinner =
    phase === "restoring" ||
    phase === "connecting" ||
    phase === "signing" ||
    phase === "checking" ||
    phase === "registering";

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 sm:px-8 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
          Opaque<span className="text-glow">.</span>
        </h1>

        <p className="mt-4 text-mist">
          Derive your stealth keys to begin. Keys are generated on-device and never
          leave your browser.
        </p>

        {phase === "idle" && (
          <>
            <button
              type="button"
              onClick={handleEnterVault}
              disabled={isConnecting}
              className="mt-8 w-full rounded-xl bg-glow px-6 py-3.5 text-sm font-semibold text-ink-950 transition-all hover:shadow-[0_0_32px_rgba(94,234,212,0.25)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {!isConnected ? "Connect wallet & initialize" : "Initialize protocol"}
            </button>
            <label className="mt-3 inline-flex items-center gap-2 text-xs text-mist cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-900 accent-glow"
              />
              Remember signature for this tab (about 30 minutes)
            </label>
          </>
        )}

        {showSpinner && (
          <div className="mt-8 flex flex-col items-center gap-3">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-glow" />
            <p className="text-sm text-mist">
              {phase === "connecting" && "Check your wallet to connect…"}
              {phase === "restoring" && "Restoring your saved session…"}
              {phase === "signing" && "Sign the message in your wallet…"}
              {phase === "checking" && "Checking registry…"}
              {phase === "registering" && "Confirm the transaction…"}
            </p>
          </div>
        )}

        {phase === "register" && (
          <div className="mt-8 rounded-2xl border border-ink-700 bg-ink-900/40 p-6 text-left">
            <h2 className="font-display text-lg font-bold text-white">
              Register privacy keys
            </h2>
            <p className="mt-2 text-sm text-mist">
              One-time on-chain step so others can send to your ETH address.
            </p>
            {error && <p className="mt-3 text-sm text-error">{error}</p>}
            <button
              type="button"
              onClick={handleRegister}
              disabled={!currentConfig}
              className="mt-4 w-full rounded-xl bg-glow px-6 py-3 text-sm font-semibold text-ink-950 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Register
            </button>
          </div>
        )}

        {phase === "done" && (
          <p className="mt-8 text-sm text-glow">Setup complete — entering dashboard…</p>
        )}

        {phase === "error" && error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-left text-sm text-red-200">
            {error}
          </div>
        )}

        {txHash && (
          <p className="mt-4 font-mono text-xs text-mist/60 break-all">{txHash}</p>
        )}
      </div>
    </div>
  );
}
