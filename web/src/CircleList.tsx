import { useReadContract, useReadContracts } from "wagmi";
import { rodaCircleAbi, rodaFactoryAbi } from "./abi";
import { addresses, tokenOf } from "./config";
import { duration, fmt, type Address } from "./lib";

export const statusLabel = ["Forming", "Active", "Completed", "Cancelled"] as const;

const fields = ["name", "token", "contribution", "size", "period", "depositRequired", "status", "round", "memberCount", "minScore"] as const;

export function CircleList() {
  const { data: list, isLoading } = useReadContract({
    address: addresses.factory,
    abi: rodaFactoryAbi,
    functionName: "circles",
    args: [0n, 100n],
  });
  const circles = [...(list ?? [])].reverse() as Address[];
  const { data } = useReadContracts({
    allowFailure: false,
    contracts: circles.flatMap((address) => fields.map((functionName) => ({ address, abi: rodaCircleAbi, functionName }) as const)),
    query: { enabled: circles.length > 0 },
  });

  return (
    <section id="circles">
      <div className="row between">
        <h2>Circles</h2>
        <a className="button" href="#/new">
          Start a circle
        </a>
      </div>
      {isLoading && <p className="muted">Loading circles…</p>}
      {!isLoading && circles.length === 0 && <p className="muted">No circles yet. Start the first one.</p>}
      <div className="grid circles">
        {data &&
          circles.map((address, i) => {
            const v = data.slice(i * fields.length, (i + 1) * fields.length);
            const [name, token, contribution, size, period, deposit, status, round, count, minScore] = v as [
              string, Address, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint,
            ];
            const t = tokenOf(token);
            return (
              <a className="card circle" key={address} href={`#/circle/${address}`}>
                <div className="row between">
                  <h3>{name}</h3>
                  <span className={`pill s${status}`}>{statusLabel[status]}</span>
                </div>
                <strong>
                  {fmt(contribution * size, t.decimals)} {t.symbol} <small>pot</small>
                </strong>
                <dl>
                  <dt>Each round</dt>
                  <dd>
                    {fmt(contribution, t.decimals)} {t.symbol} every {duration(Number(period))}
                  </dd>
                  <dt>Seats</dt>
                  <dd>
                    {count.toString()} of {size.toString()} filled
                  </dd>
                  <dt>Deposit</dt>
                  <dd>
                    {fmt(deposit, t.decimals)} {t.symbol}
                  </dd>
                  <dt>{status === 1 ? "Round" : "Min. score"}</dt>
                  <dd>{status === 1 ? `${round + 1n} of ${size}` : minScore.toString()}</dd>
                </dl>
              </a>
            );
          })}
      </div>
    </section>
  );
}
