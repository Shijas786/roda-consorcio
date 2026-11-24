# Submission write-up: Roda

**One line:** Rotating savings circles (consórcio) in USDG on Arbitrum, where locked deposits and onchain
reputation replace the trusted organizer.

## Problem

Hundreds of millions of people save through rotating circles: consórcio in Brazil, chit funds in India, tandas
in Mexico. A group pays in every round and one member takes the pot. They are popular because they give
people without bank credit a way to get a lump sum. They fail in two ways: the organizer holding the money
disappears, or a member who already took the pot stops paying. Formal versions fix this with an administrator
who charges a fee and decides who is allowed in.

## What Roda does

- The contract holds the money. There is no organizer and no admin key over funds.
- Every member locks a security deposit. A missed payment is taken from it automatically, so the pot is whole
  every round.
- A member who needs the pot early bids a discount. The discount is paid to the members who wait, which gives
  patient savers a yield and urgent borrowers a price.
- Every finished circle writes each member's record to a public reputation ledger. Circles can require a
  minimum score, so a good record unlocks bigger circles with smaller deposits.

## Why USDG

A circle runs for months, so it needs money that holds its value and that members can cash out. USDG is the
default currency of every circle in the app, and the Paxos USDG contract is allowlisted in the factory at
deployment.

## Why Arbitrum

A member makes one small payment per round. That only makes sense where a transaction costs a fraction of a
cent and confirms in about a second.

## What is built

- Three contracts (factory, circle, reputation), deployed and source-verified on Arbitrum Sepolia.
- 26 Foundry tests including fuzzing and an invariant suite that checks the contract always holds exactly what
  it owes.
- A web app with no backend: create a circle, join, pay, bid, settle, repay, withdraw, and see every member's
  standing and score.
- A finished circle and open circles on testnet, so judges can see every state without waiting.

## Judging criteria

| Criterion | Where to look |
| --- | --- |
| Smart contract quality | `contracts/src/RodaCircle.sol`, the test suite, "Design notes" in the README |
| Product-market fit | An existing habit with a known failure mode; the product removes the failure and the fee |
| Innovation | Pot auction with the discount shared among savers; portable reputation gating |
| Real problem solving | Organizer theft and post-payout default are both handled in the contract |
| USDG | Default currency; allowlisted at deployment |

## Links

- Repository: https://github.com/Shijas786/roda-consorcio
- Live app: https://shijas786.github.io/roda-consorcio/
- Demo video: TBD
- Factory: https://sepolia.arbiscan.io/address/0x2Dbcc0d7815dF11020C188943760b4d92AE2ac05

## What is live, what is not

| Live on Arbitrum Sepolia now | Not built yet |
| --- | --- |
| Factory, circle and reputation contracts, source-verified | Mainnet deployment |
| Create, join, pay, bid, settle, repay, withdraw in the web app | Passkey sign-in and sponsored gas (a wallet and test ETH are still needed) |
| USDG allowlisted, one USDG circle open | Real USDG volume: the demo circles run on the tUSD faucet token |
| Live event feed and counters read straight from the chain | Audit |

## Next (during the event window)

Past Open House winners were DeFi primitives that used Arbitrum's newest technology, and ETHGlobal finalists
show the product working live with the crypto hidden behind a habit people already have. The event-window work:

- **Join from a link, no wallet.** A circle invite opens with a passkey, gas is sponsored, and the first payment
  is the first thing the member sees. This is what makes a chit fund group move over from WhatsApp.
- **Round night.** A full-screen projector view of one circle: the wheel turns as payments land, bids appear
  live, and settlement plays the payout sound and lights the winner's seat. This is the demo's centrepiece.
- Reputation scoring in Stylus (Rust): weighs volume, lateness and recency, which is too expensive to do per
  join in the EVM.
- Robinhood Chain testnet deployment with its USDG (one prize per track is reserved for it).
- Under-collateralized seats for high-score members: deposit shrinks as score grows.
