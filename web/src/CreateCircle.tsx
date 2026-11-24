import { useState } from "react";
import { decodeEventLog, parseUnits } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getTransactionReceipt } from "wagmi/actions";
import { rodaFactoryAbi } from "./abi";
import { addresses, tokens } from "./config";
import { fmt, useTx } from "./lib";

const periods = [
  { label: "2 minutes (demo)", seconds: 120 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "1 week", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
];
const windows = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
];

export function CreateCircle() {
  const { address } = useAccount();
  const config = useConfig();
  const tx = useTx();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string>(tokens[0].address);
  const [contribution, setContribution] = useState("100");
  const [size, setSize] = useState(5);
  const [period, setPeriod] = useState(periods[0].seconds);
  const [deposit, setDeposit] = useState("200");
  const [minScore, setMinScore] = useState("0");
  const [joinWindow, setJoinWindow] = useState(windows[1].seconds);

  const t = tokens.find((x) => x.address === token)!;
  const amount = Number(contribution) || 0;
  const dep = Number(deposit) || 0;
  const valid = name.trim().length > 0 && amount > 0 && size >= 3 && size <= 20;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hash = await tx.send("Creating circle", {
      address: addresses.factory,
      abi: rodaFactoryAbi,
      functionName: "createCircle",
      args: [
        {
          token,
          contribution: parseUnits(contribution, t.decimals),
          size: BigInt(size),
          period: BigInt(period),
          deposit: parseUnits(deposit || "0", t.decimals),
          minScore: BigInt(minScore || "0"),
          joinWindow: BigInt(joinWindow),
          name: name.trim(),
        },
      ],
    });
    if (!hash) return;
    const receipt = await getTransactionReceipt(config, { hash });
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: rodaFactoryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "CircleCreated") window.location.hash = `#/circle/${ev.args.circle}`;
      } catch {
        // not a factory event
      }
    }
  }

  return (
    <section className="narrow">
      <h2>Start a circle</h2>
      <p className="muted">
        You set the terms once. They cannot be changed after the circle is created, and nobody, including you, can
        move members' money.
      </p>
      <form className="card form" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="Vila Madalena shop owners" />
        </label>
        <label>
          Currency
          <select value={token} onChange={(e) => setToken(e.target.value)}>
            {tokens.map((x) => (
              <option key={x.address} value={x.address}>
                {x.symbol}: {x.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid two">
          <label>
            Contribution per round
            <input type="number" min="0" step="any" value={contribution} onChange={(e) => setContribution(e.target.value)} />
          </label>
          <label>
            Members
            <input type="number" min={3} max={20} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <label>
            Round length
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {periods.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Security deposit per member
            <input type="number" min="0" step="any" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </label>
          <label>
            Minimum reputation score
            <input type="number" min="0" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </label>
          <label>
            Time to fill the seats
            <select value={joinWindow} onChange={(e) => setJoinWindow(Number(e.target.value))}>
              {windows.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="summary">
          <span>
            Pot each round: <b>{fmt(parseUnits(String(amount * size), 6))} {t.symbol}</b>
          </span>
          <span>
            Deposit covers <b>{amount ? (dep / amount).toFixed(1) : "0"}</b> missed payments
          </span>
          <span>
            Runs for <b>{size}</b> rounds
          </span>
        </div>
        <button className="primary" disabled={!address || !valid || !!tx.busy}>
          {tx.busy ?? (address ? "Create circle" : "Connect a wallet first")}
        </button>
        {tx.error && <p className="error">{tx.error}</p>}
      </form>
    </section>
  );
}
