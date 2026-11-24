import { useAccount, useConnect, useDisconnect, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { erc20Abi } from "viem";
import { rodaFactoryAbi, rodaReputationAbi, testDollarAbi } from "./abi";
import { addresses, chain, explorer, tokens } from "./config";
import { fmt, short, useHashRoute, useTx, type Address } from "./lib";
import { CircleList } from "./CircleList";
import { CirclePage } from "./CirclePage";
import { CreateCircle } from "./CreateCircle";
import { Wheel, type Seat } from "./Wheel";

export function App() {
  const route = useHashRoute();
  const circle = /^circle\/(0x[0-9a-fA-F]{40})$/.exec(route)?.[1] as Address | undefined;

  return (
    <>
      <Header />
      <main>
        {circle ? <CirclePage address={circle} /> : route === "new" ? <CreateCircle /> : <Home />}
      </main>
      <footer>
        <span>Roda runs on Arbitrum Sepolia. Testnet funds only.</span>
        <a href={`${explorer}/address/${addresses.factory}`} target="_blank" rel="noreferrer">
          Factory contract
        </a>
      </footer>
    </>
  );
}

function Header() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const hasWallet = typeof window !== "undefined" && "ethereum" in window;

  return (
    <header>
      <a className="brand" href="#/">
        <img src="./favicon.svg" alt="" width={28} height={28} />
        Roda
      </a>
      <nav>
        <a href="#/">Circles</a>
        <a href="#/new">Start a circle</a>
      </nav>
      {!isConnected ? (
        hasWallet ? (
          <button className="primary" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>
            Connect wallet
          </button>
        ) : (
          <a className="button" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            Install a wallet
          </a>
        )
      ) : chainId !== chain.id ? (
        <button className="warn" onClick={() => switchChain({ chainId: chain.id })}>
          Switch to Arbitrum Sepolia
        </button>
      ) : (
        <button onClick={() => disconnect()} title="Disconnect">
          {short(address)}
        </button>
      )}
    </header>
  );
}

const heroSeats: Seat[] = ["received", "received", "received", "paid", "paid", "due", "paid", "paid"].map((state, i) => ({
  state: state as Seat["state"],
  me: i === 3,
}));

function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">Consórcio · Chit fund · Tanda · Susu</span>
          <h1>
            Save together.
            <br />
            <em>Take the pot</em> when you need it.
          </h1>
          <p>
            The world's oldest way to save, without the organizer who can run off with the money. Everyone pays in
            USDG each round, one member takes the pot, and the contract enforces the rest.
          </p>
          <div className="row">
            <a className="button primary big" href="#/new">
              Start a circle
            </a>
            <a className="button big ghost" href="#circles">
              Browse circles
            </a>
          </div>
          <div className="chips">
            <span>Built on Arbitrum</span>
            <span>Paid in USDG</span>
            <span>No admin keys</span>
          </div>
        </div>
        <div className="hero-art">
          <Wheel seats={heroSeats} progress={0.62} size={380}>
            <label>This round's pot</label>
            <strong>2,000</strong>
            <span>USDG to seat 4</span>
          </Wheel>
        </div>
      </section>
      <section className="steps">
        <div>
          <i>1</i>
          <b>Lock a deposit</b>
          <span>Every seat posts a security deposit. The circle starts when the last seat fills.</span>
        </div>
        <div>
          <i>2</i>
          <b>Pay each round</b>
          <span>Miss one and the contract pays it from your deposit, so the pot is always whole.</span>
        </div>
        <div>
          <i>3</i>
          <b>Bid for the pot</b>
          <span>Need it early? Offer a discount. It goes to the members who wait.</span>
        </div>
        <div>
          <i>4</i>
          <b>Build reputation</b>
          <span>Clean circles raise your score and unlock bigger circles.</span>
        </div>
      </section>
      <Wallet />
      <CircleList />
    </>
  );
}

function Wallet() {
  const { address } = useAccount();
  const tx = useTx();
  const { data } = useReadContracts({
    allowFailure: true,
    contracts: [
      ...tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address!] }) as const),
      { address: addresses.reputation, abi: rodaReputationAbi, functionName: "scoreOf", args: [address!] } as const,
      { address: addresses.reputation, abi: rodaReputationAbi, functionName: "recordOf", args: [address!] } as const,
    ],
    query: { enabled: !!address },
  });
  const { data: count } = useReadContract({ address: addresses.factory, abi: rodaFactoryAbi, functionName: "circleCount" });

  const record = data?.[tokens.length + 1]?.result as
    | { circlesCompleted: bigint; cleanCircles: bigint; lateRounds: bigint; defaults: bigint; volume: bigint }
    | undefined;

  return (
    <section className="grid stats">
      <div className="card">
        <label>Circles onchain</label>
        <strong>{count?.toString() ?? "–"}</strong>
      </div>
      {tokens.map((t, i) => (
        <div className="card" key={t.address}>
          <label>Your {t.symbol}</label>
          <strong>{address ? fmt(data?.[i]?.result as bigint | undefined, t.decimals) : "–"}</strong>
          {t.faucet ? (
            <button
              disabled={!address || !!tx.busy}
              onClick={() => tx.send("Minting", { address: t.address, abi: testDollarAbi, functionName: "faucet" })}
            >
              {tx.busy ?? "Get 1,000 test dollars"}
            </button>
          ) : (
            <a href="https://docs.paxos.com/guides/stablecoin/usdg" target="_blank" rel="noreferrer">
              About USDG
            </a>
          )}
          {t.faucet && tx.error && <p className="error">{tx.error}</p>}
        </div>
      ))}
      <div className="card">
        <label>Your reputation</label>
        <strong>{address ? ((data?.[tokens.length]?.result as bigint | undefined)?.toString() ?? "–") : "–"}</strong>
        <span className="muted">
          {record
            ? `${record.cleanCircles} clean of ${record.circlesCompleted} circles, ${record.defaults} defaults`
            : "Connect a wallet to see your record"}
        </span>
      </div>
    </section>
  );
}
