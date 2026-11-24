import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { rodaCircleAbi, rodaReputationAbi } from "./abi";
import { addresses, explorer, tokenOf } from "./config";
import { statusLabel } from "./CircleList";
import { duration, fmt, short, useNow, useTx, type Address, type Call } from "./lib";
import { Wheel, type Seat } from "./Wheel";
import { Activity } from "./Activity";

type Member = {
  joined: boolean;
  received: boolean;
  lateRounds: number;
  paidThrough: number;
  deposit: bigint;
  debt: bigint;
  claimable: bigint;
  paidTotal: bigint;
};

const SETTLE_GRACE = 5;

const fields = [
  "name", "token", "contribution", "size", "period", "depositRequired", "minScore", "joinDeadline", "status",
  "round", "roundDeadline", "roundCollected", "carry", "highestBid", "highestBidder", "members", "creator", "maxBid",
] as const;

export function CirclePage({ address }: { address: Address }) {
  const { address: me } = useAccount();
  const now = useNow();
  const tx = useTx();
  const [bid, setBid] = useState("");
  const [repay, setRepay] = useState("");

  const { data, isLoading, isError } = useReadContracts({
    allowFailure: false,
    contracts: fields.map((functionName) => ({ address, abi: rodaCircleAbi, functionName }) as const),
    query: { refetchInterval: 5000 },
  });
  // Only circles the factory deployed are registered here; anything else must never be offered a token approval.
  const { data: registered } = useReadContract({
    address: addresses.reputation,
    abi: rodaReputationAbi,
    functionName: "isCircle",
    args: [address],
  });
  const members = (data?.[15] ?? []) as readonly Address[];
  const circleToken = data?.[1] as Address | undefined;
  const { data: infos } = useReadContracts({
    allowFailure: false,
    contracts: members.flatMap(
      (m) =>
        [
          { address, abi: rodaCircleAbi, functionName: "memberInfo", args: [m] },
          { address: addresses.reputation, abi: rodaReputationAbi, functionName: "scoreOf", args: [m, circleToken!] },
        ] as const,
    ),
    query: { enabled: members.length > 0, refetchInterval: 5000 },
  });

  if (registered === false) return <p className="error">This address is not a Roda circle.</p>;
  if (isLoading || registered === undefined) return <p className="muted">Loading circle…</p>;
  if (isError || !data) return <p className="error">This address is not a Roda circle.</p>;

  const [
    name, token, contribution, size, period, deposit, minScore, joinDeadline, status, round, roundDeadline,
    roundCollected, carry, highestBid, highestBidder, , creator, maxBid,
  ] = data as unknown as [
    string, Address, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint, bigint, bigint,
    Address, unknown, Address, bigint,
  ];
  const t = tokenOf(token);
  const amt = (v: bigint | undefined) => `${fmt(v, t.decimals)} ${t.symbol}`;
  const info = (i: number) => infos?.[i * 2] as Member | undefined;
  const mine = me ? info(members.findIndex((m) => m.toLowerCase() === me.toLowerCase())) : undefined;
  const isMember = !!mine?.joined;
  const paid = isMember && BigInt(mine!.paidThrough) > round;
  const roundLeft = Number(roundDeadline) - now;
  // The chain's clock trails wall time by a few seconds; wait it out before offering settlement.
  const canSettle = roundLeft <= -SETTLE_GRACE;
  const joinLeft = Number(joinDeadline) - now;
  const call = (functionName: string, args?: readonly unknown[]): Call => ({ address, abi: rodaCircleAbi, functionName, args });
  const act = (label: string, fn: string, args?: readonly unknown[], spend?: bigint) =>
    tx.send(label, call(fn, args), spend ? { token, amount: spend } : undefined);
  const busy = !!tx.busy;
  const seats: Seat[] = Array.from({ length: Number(size) }, (_, i) => {
    const x = info(i);
    const m = members[i];
    if (!m) return { state: "open" };
    const state: Seat["state"] = !x
      ? "waiting"
      : x.debt > 0n
        ? "debt"
        : x.received
          ? "received"
          : status !== 1
            ? "waiting"
            : BigInt(x.paidThrough) > round
              ? "paid"
              : "due";
    return { state, label: short(m), me: m.toLowerCase() === me?.toLowerCase() };
  });
  const wheelProgress =
    status === 1 ? Math.max(0, 1 - roundLeft / Number(period)) : status === 2 ? 1 : members.length / Number(size);

  return (
    <>
      <a className="back" href="#/">
        ← All circles
      </a>
      <section className="circle-head">
        <Wheel size={300} progress={wheelProgress} seats={seats}>
          <label>{status === 1 ? `Round ${round + 1n} of ${size}` : statusLabel[status]}</label>
          <strong>{fmt(status === 1 ? roundCollected + carry : contribution * size, t.decimals)}</strong>
          <span>
            {status === 1
              ? roundLeft > 0
                ? `${t.symbol} in · ${duration(roundLeft)} left`
                : `${t.symbol} in · round over`
              : `${t.symbol} pot`}
          </span>
        </Wheel>
        <div>
          <span className={`pill s${status}`}>{statusLabel[status]}</span>
          <h1 className="title">{name}</h1>
          <p className="muted">
            <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">
              {short(address)}
            </a>{" "}
            · started by {short(creator)} · {t.name}
          </p>
          <div className="pot">
            <label>Pot each round</label>
            <strong>{amt(contribution * size)}</strong>
          </div>
          <ul className="legend">
            <li className="paid">Paid</li>
            <li className="due">Due</li>
            <li className="received">Got the pot</li>
            <li className="debt">In debt</li>
            <li className="open">Open seat</li>
          </ul>
        </div>
      </section>

      <section className="grid stats">
        <div className="card">
          <label>Contribution</label>
          <strong>{amt(contribution)}</strong>
          <span className="muted">every {duration(Number(period))}</span>
        </div>
        <div className="card">
          <label>Security deposit</label>
          <strong>{amt(deposit)}</strong>
          <span className="muted">returned when the circle completes</span>
        </div>
        <div className="card">
          <label>{status === 0 ? "Seats" : "Round"}</label>
          <strong>
            {status === 0 ? `${members.length} of ${size}` : `${status === 2 ? size : round + 1n} of ${size}`}
          </strong>
          <span className="muted">
            {status === 0 && (joinLeft > 0 ? `${duration(joinLeft)} left to join` : "join window closed")}
            {status === 1 && (roundLeft > 0 ? `closes in ${duration(roundLeft)}` : canSettle ? "ready to settle" : "closing…")}
            {status === 2 && "all pots paid"}
            {status === 3 && "deposits unlocked"}
          </span>
        </div>
        <div className="card">
          <label>{status === 1 ? "Collected this round" : "Minimum score"}</label>
          <strong>{status === 1 ? amt(roundCollected + carry) : minScore.toString()}</strong>
          {status === 1 && (
            <span className="muted">
              {highestBid > 0n ? `top bid ${amt(highestBid)} by ${short(highestBidder)}` : "no bids yet"}
            </span>
          )}
        </div>
      </section>

      <section className="card actions">
        <h2>Your seat</h2>
        {!me && <p className="muted">Connect a wallet to join or manage your seat.</p>}

        {me && status === 0 && !isMember && joinLeft > 0 && (
          <div className="action">
            <p>Lock {amt(deposit)} to take a seat. You get it back when the circle completes, or if it never fills.</p>
            <button className="primary" disabled={busy} onClick={() => act("Joining", "join", [], deposit)}>
              Join circle
            </button>
          </div>
        )}
        {me && status === 0 && isMember && (
          <div className="action">
            <p>You have a seat. The circle starts as soon as all {size.toString()} seats are filled.</p>
            <button disabled={busy} onClick={() => act("Leaving", "leave")}>
              Leave and take deposit back
            </button>
          </div>
        )}
        {me && status === 0 && joinLeft <= 0 && (
          <div className="action">
            <p>The circle did not fill in time. Cancel it to unlock every deposit.</p>
            <button disabled={busy} onClick={() => act("Cancelling", "cancel")}>
              Cancel circle
            </button>
          </div>
        )}

        {me && status === 1 && isMember && (
          <>
            <div className="action">
              <p>
                {paid
                  ? `You paid round ${round + 1n}.`
                  : `Round ${round + 1n} is due. If you miss it, ${amt(contribution)} is taken from your deposit.`}
              </p>
              <button className="primary" disabled={busy || paid} onClick={() => act("Paying", "contribute", [round], contribution)}>
                {paid ? "Paid" : `Pay ${amt(contribution)}`}
              </button>
            </div>
            {!mine!.received && mine!.debt === 0n && roundLeft > 0 && (
              <div className="action">
                <p>
                  Want the pot this round? Offer a discount of up to {amt(maxBid)}. The highest offer wins, and the
                  discount is shared among the other members.
                </p>
                <div className="row">
                  <input type="number" min="0" step="any" placeholder={`Discount in ${t.symbol}`} value={bid} onChange={(e) => setBid(e.target.value)} />
                  <button disabled={busy || !paid || !Number(bid)} onClick={() => act("Bidding", "bid", [parseUnits(bid, t.decimals)])}>
                    Bid for the pot
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {status === 1 && me && canSettle && (
          <div className="action">
            <p>The round is over. Anyone can settle it: missed payments are collected and the pot is paid.</p>
            <button className="primary" disabled={busy} onClick={() => act("Settling", "settle")}>
              Settle round
            </button>
          </div>
        )}
        {me && isMember && mine!.debt > 0n && (status === 1 || status === 2) && (
          <div className="action">
            <p className="error">You owe {amt(mine!.debt)}. Unpaid debt at completion is recorded as a default.</p>
            <div className="row">
              <input type="number" min="0" step="any" placeholder={`Amount in ${t.symbol}`} value={repay} onChange={(e) => setRepay(e.target.value)} />
              <button
                disabled={busy || !Number(repay)}
                onClick={() => act("Repaying", "repay", [parseUnits(repay, t.decimals)], parseUnits(repay, t.decimals))}
              >
                Repay
              </button>
            </div>
          </div>
        )}
        {me && mine && mine.claimable > 0n && (
          <div className="action">
            <p>You have {amt(mine.claimable)} ready to withdraw.</p>
            <button className="primary" disabled={busy} onClick={() => act("Withdrawing", "withdraw")}>
              Withdraw {amt(mine.claimable)}
            </button>
          </div>
        )}
        {me && !isMember && status !== 0 && <p className="muted">You are not a member of this circle.</p>}
        {tx.busy && <p className="muted">{tx.busy}… confirm in your wallet.</p>}
        {tx.error && <p className="error">{tx.error}</p>}
        {tx.hash && (
          <p className="ok">
            Done.{" "}
            <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </p>
        )}
      </section>

      <section>
        <h2>Members</h2>
        <div className="card table">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Member</th>
                <th>Score</th>
                <th>This round</th>
                <th>Pot</th>
                <th>Deposit</th>
                <th>Debt</th>
                <th>To withdraw</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => {
                const x = info(i);
                const score = infos?.[i * 2 + 1] as bigint | undefined;
                return (
                  <tr key={m} className={m.toLowerCase() === me?.toLowerCase() ? "me" : ""}>
                    <td>{i + 1}</td>
                    <td>
                      <a href={`${explorer}/address/${m}`} target="_blank" rel="noreferrer">
                        {short(m)}
                      </a>
                      {m.toLowerCase() === me?.toLowerCase() && " (you)"}
                    </td>
                    <td>{score?.toString() ?? "–"}</td>
                    <td>{status !== 1 || !x ? "–" : BigInt(x.paidThrough) > round ? "Paid" : "Due"}</td>
                    <td>{x?.received ? "Received" : "Waiting"}</td>
                    <td>{amt(x?.deposit)}</td>
                    <td className={x && x.debt > 0n ? "error" : ""}>{amt(x?.debt)}</td>
                    <td>{amt(x?.claimable)}</td>
                  </tr>
                );
              })}
              {Array.from({ length: Math.max(0, Number(size) - members.length) }, (_, i) => (
                <tr key={i} className="empty">
                  <td>{members.length + i + 1}</td>
                  <td colSpan={7}>Open seat</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Activity circle={address} />
    </>
  );
}
