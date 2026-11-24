import { useAccount, useConnect, useDisconnect, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { erc20Abi } from "viem";
import { rodaFactoryAbi, rodaReputationAbi, testDollarAbi } from "./abi";
import { addresses, chain, explorer, tokens } from "./config";
import { fmt, short, useHashRoute, useTx, type Address } from "./lib";
import { CircleList } from "./CircleList";
import { CirclePage } from "./CirclePage";
import { CreateCircle } from "./CreateCircle";

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

function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <h1>Save together. Get the pot when you need it.</h1>
          <p>
            Roda is the consórcio, chit fund and tanda rebuilt on Arbitrum. Every member pays the same amount each
            round in USDG and one member takes the pot. Deposits are locked in the contract, missed payments are
            covered automatically, and every finished circle builds a reputation you carry to the next one.
          </p>
          <div className="row">
            <a className="button primary" href="#/new">
              Start a circle
            </a>
            <a className="button" href="#circles">
              Browse circles
            </a>
          </div>
        </div>
        <ol className="steps">
          <li>
            <b>Lock a deposit</b>
            <span>Each seat posts a security deposit. The circle starts when the last seat fills.</span>
          </li>
          <li>
            <b>Pay each round</b>
            <span>Miss a payment and the contract takes it from your deposit, so the pot is still whole.</span>
          </li>
          <li>
            <b>Bid for the pot</b>
            <span>Need it early? Offer a discount. The discount is shared among the members who wait.</span>
          </li>
          <li>
            <b>Build reputation</b>
            <span>Clean circles raise your score and unlock circles with a minimum score.</span>
          </li>
        </ol>
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
