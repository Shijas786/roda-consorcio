import { createConfig, http } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const chain = arbitrumSepolia;

export const addresses = {
  factory: "0x4966dD6e5521BF9f04213B9C5C9A929c7D79EAfB",
  reputation: "0x53C806d9747843417Ac8Cb52c8ccd0fAe3B9488f",
  usdg: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
  tusd: "0xaE79b73E813b129055aa0b95Ef4f09D88e912Ee7",
} as const;

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
