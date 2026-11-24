# Roda

Rotating savings circles in USDG on Arbitrum.

A savings circle is the oldest group finance product there is: *consórcio* in Brazil, *chit fund* in India,
*tanda* in Mexico, *susu* in West Africa. A group pays the same amount every round, and each round one member
takes the whole pot. It works without a bank, but it runs on trust: the organizer can run off with the money,
and a member who already took the pot can stop paying.

Roda removes both risks. The contract holds the money, nobody can move it, and every member locks a security
deposit that pays their share automatically if they miss a round.

## How a circle works

1. **Create.** Anyone sets the terms: currency, contribution, number of members, round length, security
   deposit, minimum reputation score. Terms are fixed at creation and the creator has no special powers.
2. **Join.** Each member locks the deposit. The circle starts when the last seat fills. If it does not fill in
   time, anyone can cancel it and every deposit is unlocked.
3. **Pay.** Each round every member pays the contribution.
4. **Bid (optional).** A member who needs the pot early offers a discount, up to 50% of the pot. The highest
   offer wins the round, and the discount is split among the members in good standing. With no bids, the pot
   goes to the next member in join order.
5. **Settle.** After the round deadline anyone can call `settle()`. A missed payment is taken from that
   member's deposit; anything the deposit cannot cover becomes debt, which is netted from their own payout.
6. **Complete.** After as many rounds as there are members, everyone has received the pot once. Deposits are
   released and each member's outcome is written to the reputation ledger.

Reputation is a public record per address: circles completed, clean circles, late rounds, defaults, volume.
A clean circle is worth 10 points, a circle with late rounds 4, and a default sets the score to 0. Circles can
require a minimum score, so a good record unlocks larger circles with smaller deposits.

## Why USDG, why Arbitrum

A savings circle only works in money that holds its value for the months a circle runs. USDG (Paxos Global
Dollar) is the default currency: a regulated dollar stablecoin native to Arbitrum. Fees matter too. A member
makes one small payment per round, so a round costs a fraction of a cent on Arbitrum.

## Deployment (Arbitrum Sepolia, chain 421614)

| Contract | Address |
| --- | --- |
| RodaFactory | [`0x4966dD6e5521BF9f04213B9C5C9A929c7D79EAfB`](https://sepolia.arbiscan.io/address/0x4966dD6e5521BF9f04213B9C5C9A929c7D79EAfB) |
| RodaCircle (implementation) | [`0xD7E7CB1E5d22f8B9a17426a35bB5AFB181875b91`](https://sepolia.arbiscan.io/address/0xD7E7CB1E5d22f8B9a17426a35bB5AFB181875b91) |
| RodaReputation | [`0x53C806d9747843417Ac8Cb52c8ccd0fAe3B9488f`](https://sepolia.arbiscan.io/address/0x53C806d9747843417Ac8Cb52c8ccd0fAe3B9488f) |
| TestDollar (tUSD faucet token) | [`0xaE79b73E813b129055aa0b95Ef4f09D88e912Ee7`](https://sepolia.arbiscan.io/address/0xaE79b73E813b129055aa0b95Ef4f09D88e912Ee7) |
| USDG (Paxos, allowlisted) | [`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) |

Sources are verified on Sourcify. tUSD exists so anyone can try the app without sourcing testnet USDG: it has
a public faucet of 1,000 tUSD per hour.

## Contracts

| File | Purpose |
| --- | --- |
| `contracts/src/RodaFactory.sol` | Deploys circles as EIP-1167 minimal proxies, keeps the token allowlist and the circle registry. |
| `contracts/src/RodaCircle.sol` | One circle: seats, deposits, rounds, bids, settlement, debt, withdrawals. |
| `contracts/src/RodaReputation.sol` | Append-only reputation ledger. Only circles deployed by the factory can write to it. |
| `contracts/src/TestDollar.sol` | Testnet faucet token. |

Design notes:

- **No admin over funds.** The factory owner can only edit the token allowlist for future circles. There is no
  pause, no upgrade and no withdrawal path other than a member's own `withdraw()`.
- **Pull payments.** Payouts, shared discounts and released deposits accrue to `claimable` and are withdrawn by
  the member. Settlement never pushes tokens, so one bad recipient cannot block a round.
- **Solvency invariant.** Token balance equals deposits + claimable + carry + current round collections, at all
  times. Checked by an invariant test with a randomized handler.
- **Bounded loops.** A circle has at most 20 members, so settlement gas is bounded.
- **Reentrancy.** State-changing functions that move tokens use a transient-storage reentrancy guard and
  follow checks-effects-interactions.
- **Allowlisted tokens only.** Fee-on-transfer and rebasing tokens would break the accounting, so the factory
  only accepts tokens its owner has reviewed.

## Run it

Contracts (requires [Foundry](https://getfoundry.sh)):

```sh
git clone --recurse-submodules <this repo>
cd contracts
forge test
```

23 tests: unit tests for every path, fuzz tests over payment and bid patterns, and an invariant suite.

Deploy:

```sh
USDG=0xFFC95faa3d63Cde504a05B567C600B78C0b41892 DEPLOY_TEST_DOLLAR=true \
  forge script script/Deploy.s.sol --rpc-url https://sepolia-rollup.arbitrum.io/rpc --private-key $KEY --broadcast
```

Web app (Node 20+):

```sh
cd web
npm install
npm run dev
```

The app is React, Vite, wagmi and viem, with no backend: every number on screen is read from the chain.

## Known limits

- Debt beyond the deposit is not recoverable onchain; it costs the member their reputation. Creators choose the
  deposit size against that risk, and the app shows how many missed payments the deposit covers.
- Reputation is per address, so a new address starts at zero rather than with a bad record. Minimum-score
  circles are what make an old address worth keeping.
- The contracts have not been audited.

## License

MIT
