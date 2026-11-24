import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseEventLogs } from "viem";
import { rodaCircleAbi, rodaFactoryAbi } from "./abi";
import { addresses, chain, deployBlock, explorer, tokenOf } from "./config";
import { fmt, short, useNow, type Address } from "./lib";
import { play } from "./sound";

const abi = [...rodaFactoryAbi, ...rodaCircleAbi].filter((x) => x.type === "event");
const SHOWN = 12;

type Item = { id: string; tx: Address; block: bigint; circle: Address; name: string; args: Record<string, unknown> };

/// Reads every Roda event straight from the chain. The app has no backend or indexer.
function useEvents() {
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({
    queryKey: ["roda-events"],
    refetchInterval: 6000,
    queryFn: async () => {
      const created = parseEventLogs({
        abi: rodaFactoryAbi,
        eventName: "CircleCreated",
        logs: await client!.getLogs({ address: addresses.factory, fromBlock: deployBlock }),
      });
      const circles = new Map(created.map((l) => [l.args.circle.toLowerCase(), l.args]));
      const raw = created.length
        ? await client!.getLogs({ address: created.map((l) => l.args.circle), fromBlock: deployBlock })
        : [];
      const logs = parseEventLogs({ abi, logs: [...created, ...raw] }) as unknown as {
        eventName: string; args: Record<string, unknown>; address: Address; transactionHash: Address; blockNumber: bigint; logIndex: number;
      }[];
      const items: Item[] = logs
        .filter((l) => l.eventName !== "Initialized")
        .map((l) => ({
          id: `${l.transactionHash}-${l.logIndex}`,
          tx: l.transactionHash,
          block: l.blockNumber,
          circle: (l.eventName === "CircleCreated" ? l.args.circle : l.address) as Address,
          name: l.eventName,
          args: l.args ?? {},
        }))
        .sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? 1 : -1));

      const times = new Map<bigint, number>();
      await Promise.all(
        [...new Set(items.slice(0, SHOWN * 2).map((i) => i.block))].map(async (n) =>
          times.set(n, Number((await client!.getBlock({ blockNumber: n })).timestamp)),
        ),
      );
      return { items, circles, times };
    },
    enabled: !!client,
  });
}

const ago = (s: number) => (s < 60 ? `${Math.max(s, 0)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`);

export function Activity({ circle }: { circle?: Address }) {
  const { data } = useEvents();
  const now = useNow();
  const seen = useRef<string | undefined>(undefined);
  const items = (data?.items ?? []).filter((i) => !circle || i.circle.toLowerCase() === circle.toLowerCase());
  const newest = items[0];

  useEffect(() => {
    if (!newest) return;
    if (seen.current && seen.current !== newest.id) play(newest.name === "RoundSettled" ? "payout" : "tick");
    seen.current = newest.id;
  }, [newest]);

  const info = (c: Address) => data?.circles.get(c.toLowerCase());
  const amt = (i: Item, v: unknown) => {
    const t = tokenOf(info(i.circle)?.token);
    return `${fmt(v as bigint, t.decimals)} ${t.symbol}`;
  };
  const text = (i: Item): [string, string] => {
    const a = i.args;
    const who = short(a.member as string);
    switch (i.name) {
      case "CircleCreated": return ["new", `${short(a.creator as string)} started a circle`];
      case "Joined": return ["join", `${who} took seat ${Number(a.position) + 1}`];
      case "Left": return ["left", `${who} left before the start`];
      case "Started": return ["start", "All seats filled. Round 1 is open"];
      case "Cancelled": return ["left", "Circle cancelled, deposits unlocked"];
      case "Contributed": return ["pay", `${who} paid ${amt(i, a.amount)} for round ${Number(a.round) + 1}`];
      case "BidPlaced": return ["bid", `${who} offered ${amt(i, a.amount)} off to take the pot`];
      case "Missed": return ["miss", `${who} missed round ${Number(a.round) + 1}: ${amt(i, a.fromDeposit)} taken from deposit`];
      case "RoundSettled": return ["pot", `${short(a.winner as string)} took the round ${Number(a.round) + 1} pot: ${amt(i, a.payout)}`];
      case "Repaid": return ["pay", `${who} repaid ${amt(i, a.amount)} of debt`];
      case "Withdrawn": return ["out", `${who} withdrew ${amt(i, a.amount)}`];
      case "Completed": return ["done", "Circle completed. Deposits released, reputation recorded"];
      default: return ["", i.name];
    }
  };

  const all = data?.items ?? [];
  const sum = (name: string, key: string) =>
    all.filter((i) => i.name === name).reduce((s, i) => s + (i.args[key] as bigint), 0n);

  return (
    <section className="activity">
      {!circle && (
        <div className="counters">
          <div>
            <strong>{data ? data.circles.size : "–"}</strong>
            <label>circles</label>
          </div>
          <div>
            <strong>{data ? all.filter((i) => i.name === "Joined").length - all.filter((i) => i.name === "Left").length : "–"}</strong>
            <label>seats taken</label>
          </div>
          <div>
            <strong>{data ? all.filter((i) => i.name === "RoundSettled").length : "–"}</strong>
            <label>pots paid</label>
          </div>
          <div>
            <strong>{data ? `$${fmt(sum("RoundSettled", "pot"))}` : "–"}</strong>
            <label>paid out</label>
          </div>
          <div>
            <strong>{data ? all.length : "–"}</strong>
            <label>onchain events</label>
          </div>
        </div>
      )}
      <div className="row between">
        <h2>
          <span className="live" /> {circle ? "History" : "Live on Arbitrum"}
        </h2>
        <span className="muted">Every line is a transaction. Click to verify.</span>
      </div>
      <ol className="feed card">
        {!data && <li className="muted">Reading events from Arbitrum…</li>}
        {data && items.length === 0 && <li className="muted">Nothing yet.</li>}
        {items.slice(0, SHOWN).map((i) => {
          const [kind, line] = text(i);
          const t = data?.times.get(i.block);
          return (
            <li key={i.id}>
              <a href={`${explorer}/tx/${i.tx}`} target="_blank" rel="noreferrer">
                <i className={`dot ${kind}`} />
                <span>
                  {line}
                  {!circle && <em>{info(i.circle)?.name}</em>}
                </span>
                <time>{t ? ago(now - t) : ""}</time>
                <b>{i.tx.slice(0, 8)}… ↗</b>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
