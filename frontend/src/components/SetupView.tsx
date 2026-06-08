import { useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { getAppChain } from "../lib/chain";
import { useKeys } from "../context/KeysContext";
import { SETUP_MESSAGE } from "../lib/stealth";

export function SetupView() {
  const { setFromSignature, stealthMetaAddressHex, isSetup } = useKeys();
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    setError(null);
    console.log("🔑 [Opaque] Setup: requesting signature…");
    setIsSigning(true);
    try {
      const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!ethereum?.request) {
        throw new Error("No wallet found. Install MetaMask or Rainbow.");
      }
      const client = createWalletClient({
        chain: getAppChain(),
        transport: custom(ethereum as EIP1193Provider),
      });
      const [address] = await client.requestAddresses();
      if (!address) throw new Error("No account selected.");
      console.log("🔑 [Opaque] Setup: wallet address", { address: address.slice(0, 14) + "…" });
      const sig = await client.signMessage({
        account: address,
        message: SETUP_MESSAGE,
      });
      setFromSignature(sig);
      console.log("🔑 [Opaque] Setup: signature received ✅");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to sign";
      console.error("⚠️ [Opaque] Setup failed", { error: msg });
      setError(msg);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="card max-w-lg mx-auto">
      <h2 className="text-lg font-semibold text-white mb-1">
        Key setup
      </h2>
      <p className="text-sm text-neutral-500 mb-6">
        Sign with your wallet to derive your viewing and spending keys. Keys stay in this session only.
      </p>

      {!isSetup && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleSign}
            disabled={isSigning}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-medium btn-primary"
          >
            {isSigning ? "Check your wallet…" : "Connect wallet & sign to derive keys"}
          </button>
          {error && (
            <p className="text-error text-sm">{error}</p>
          )}
        </div>
      )}

      {isSetup && stealthMetaAddressHex && (
        <div className="space-y-3">
          <p className="text-neutral-400 text-sm">Your stealth meta-address:</p>
          <div className="p-3 rounded-lg bg-neutral-900 border border-border font-mono text-address text-neutral-200 break-all">
            {stealthMetaAddressHex}
          </div>
          <p className="text-neutral-600 text-xs">
            Share this with senders. They will use it to generate a one-time stealth address for you.
          </p>
        </div>
      )}
    </div>
  );
}
