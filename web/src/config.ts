import { createConfig, http } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const chain = arbitrumSepolia;

export const addresses = {
  factory: "0x2Dbcc0d7815dF11020C188943760b4d92AE2ac05",
  reputation: "0x42Efbc1d5f67025D29C72b8d7AC4de07a02E2e75",
  usdg: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
  tusd: "0xaE79b73E813b129055aa0b95Ef4f09D88e912Ee7",
} as const;

// Block the factory was deployed in: event queries start here.
export const deployBlock = 0x13d076dcn;

export const tokens = [
  { address: addresses.usdg, symbol: "USDG", name: "Global Dollar (Paxos)", decimals: 6, faucet: false },
  { address: addresses.tusd, symbol: "tUSD", name: "Roda Test Dollar", decimals: 6, faucet: true },
] as const;

export const tokenOf = (address?: string) =>
  tokens.find((t) => t.address.toLowerCase() === address?.toLowerCase()) ?? {
    address: address as `0x${string}`,
    symbol: "TOKEN",
    name: "Token",
    decimals: 6,
    faucet: false,
  };

export const explorer = "https://sepolia.arbiscan.io";

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http() },
});
