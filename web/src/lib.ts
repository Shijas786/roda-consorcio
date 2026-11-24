import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { BaseError, ContractFunctionRevertedError, erc20Abi, formatUnits, type Abi } from "viem";
import { chain } from "./config";

export type Address = `0x${string}`;

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const fmt = (v: bigint | undefined, decimals = 6) =>
  v === undefined
    ? "–"
    : Number(formatUnits(v, decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function duration(seconds: number) {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const errorText: Record<string, string> = {
  ScoreTooLow: "Your reputation score is below this circle's minimum.",
  JoinClosed: "The join window has closed.",
  JoinStillOpen: "The join window is still open.",
  AlreadyJoined: "You already have a seat.",
  AlreadyPaid: "You already paid this round.",
  RoundOpen: "The round has not reached its deadline yet.",
  RoundClosed: "Bidding is closed for this round.",
  NotEligible: "Pay this round first; members who already received the pot or owe debt cannot bid.",
  BidTooLow: "Your bid must beat the current highest bid.",
  BidTooHigh: "Bids are capped at 50% of the pot.",
  NotMember: "You are not a member of this circle.",
  NothingToWithdraw: "Nothing to withdraw.",
  NothingOwed: "You have no debt.",
  TokenNotAllowed: "This token is not on the allowlist.",
  InvalidConfig: "Those settings are outside the allowed range.",
  CooldownActive: "The faucet can be used once per hour.",
};

function explain(e: unknown) {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      return errorText[name] ?? (name || revert.shortMessage);
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

export type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };
type Spend = { token: Address; amount: bigint };

/// Sends a transaction (with an ERC-20 approval first when the allowance is short) and refreshes all reads.
export function useTx() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Address | null>(null);

  const send = useCallback(
    async (label: string, call: Call, spend?: Spend) => {
      if (!address) return;
      setError(null);
      setHash(null);
      try {
        if (chainId !== chain.id) {
          setBusy("Switching to Arbitrum Sepolia");
          await switchChainAsync({ chainId: chain.id });
        }
        if (spend && spend.amount > 0n) {
          const allowance = await readContract(config, {
            address: spend.token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, call.address],
          });
          if (allowance < spend.amount) {
            setBusy("Approving");
            const approval = await writeContract(config, {
              address: spend.token,
              abi: erc20Abi,
              functionName: "approve",
              args: [call.address, spend.amount],
            });
            await waitForTransactionReceipt(config, { hash: approval });
          }
        }
        setBusy(label);
        const tx = await writeContract(config, call as Parameters<typeof writeContract>[1]);
        await waitForTransactionReceipt(config, { hash: tx });
        setHash(tx);
        await queryClient.invalidateQueries();
        return tx;
      } catch (e) {
        setError(explain(e));
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, config, queryClient, switchChainAsync],
  );

  return { send, busy, error, hash };
}

export function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "");
}
