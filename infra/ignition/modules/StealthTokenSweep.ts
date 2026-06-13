import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Gasless ERC-20 sweep forwarder (spec/relayer-market.md, fee-in-token). Stateless and
// constructor-less; one instance serves every token and relayer.
export default buildModule("StealthTokenSweepModule", (m) => {
  const stealthTokenSweep = m.contract("StealthTokenSweep");
  return { stealthTokenSweep };
});
