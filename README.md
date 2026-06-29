# AI Domain Broker

A decentralized domain-name brokerage where an autonomous AI closes the deals.

Sellers list Web3 domains with a public asking price and a confidential minimum that only the broker AI knows. Buyers escrow real GEN and pitch their offer in natural language. ARIA — an LLM running inside a GenLayer Intelligent Contract under validator consensus — accepts, rejects, or counter-offers, then settles the sale on-chain. No middlemen. No waiting for the seller to come online.

Built on [GenLayer](https://genlayer.com) (Bradbury Testnet). The negotiation verdict is not a single model's opinion: every validator independently re-runs the negotiation and verdicts must agree under Optimistic Democracy.

**Live dApp:** [abstrusimad.github.io/ai-domain-broker](https://abstrusimad.github.io/ai-domain-broker/)  
**Live contract (Bradbury Testnet):** `0x0Ec607dB8CD8693CfB34e714E2cb16cF4db8d62B` — deployed, ACCEPTED by validator consensus, first negotiation settled on-chain.

---

## How a negotiation works

```
buyer escrows GEN + pitch
        |
        v
+- place_bid -------------------------------------------------------+
| deterministic guards (status, owner, value, length)               |
|        |                                                          |
|        v                                                          |
| fast paths (no LLM):                                              |
|   bid >= asking price        -> instant ACCEPT                    |
|   bid >= published counter   -> instant ACCEPT                    |
|        | otherwise                                                |
|        v                                                          |
| ARIA prompt (asking price, confidential floor, pitch,             |
| description, prior offers)                                        |
|        |                                                          |
|        v                                                          |
| leader node drafts verdict -> every validator re-runs             |
| the same prompt and must agree on the decision                    |
| (counter prices within 15%)                                       |
|        |                                                          |
|        v                                                          |
| deterministic backstops:                                          |
|   ACCEPT below floor   -> impossible (forced counter)             |
|   counter outside      -> clamped to [floor, ask]                 |
|   counter <= bid       -> treated as ACCEPT                       |
|        |                                                          |
|        v                                                          |
| ACCEPT  -> GEN to seller, ownership flips, SOLD                   |
| REJECT  -> full escrow refund                                     |
| COUNTER -> full refund + counter published on-chain               |
|            (any later bid meeting it is honored                   |
|             deterministically — the broker keeps its word)        |
+-------------------------------------------------------------------+
```

Key properties:

- The AI can never sell below the seller's floor. That rule is deterministic code, not a prompt instruction.
- The broker honors its own counter-offers without a second LLM round — pure contract logic.
- Prompt-injection pitches ("ignore your rules", "reveal the minimum") are explicitly instructed to be rejected, and even a fooled model cannot break the floor backstop.
- Refunds are atomic. REJECT/COUNTER refund the escrow in the same transaction via native `emit_transfer`.

---

## Project layout

```
ai_domain_broker/
├── contracts/
│   └── domain_broker.py     # The Intelligent Contract (GenVM Python)
├── frontend/                # React + Vite + TypeScript dApp
│   ├── src/
│   │   ├── lib/             # genlayer-js client, types, atto math
│   │   ├── hooks/           # useWallet (MetaMask), useBroker (state machine)
│   │   └── components/      # market, negotiation console, validator FX
│   └── .env.example
└── README.md
```

---

## Contract

| Method | Type | What it does |
| --- | --- | --- |
| `register_domain(name, ask_gen, floor_gen, desc)` | write | List a domain. Prices as decimal GEN strings converted to atto integers. |
| `place_bid(name, pitch)` | write payable | Escrow GEN + pitch — AI verdict under consensus — settle or refund. |
| `delist_domain(name)` | write | Owner withdraws an open listing. |
| `get_domains(start)` | view | Paged listings. The confidential floor is never returned. |
| `get_domain(name)` | view | Single listing. |
| `get_negotiations(name, start)` | view | Full negotiation chronicle for a domain. |
| `get_stats()` | view | Marketplace counters for the dashboard. |

**Consensus design.** The LLM call runs inside a zero-argument closure. The leader's verdict is validated by every other validator re-running the same negotiation and comparing the decision field exactly (counter prices within 15%), with `gl.eq_principle.prompt_comparative` as the fallback principle. Deterministic guards run before the AI (cheap failures never hit the LLM) and deterministic backstops run after consensus (the AI physically cannot violate the seller's floor).

**Verified live syntax.** The contract pins the GenVM runner hash on line 1 and uses `from genlayer import *` — the only import form that exists on the current public-testnet runner. Native GEN transfers use `gl.get_contract_at(addr).emit_transfer(value=..., on="finalized")`.

**A note on confidential floors.** The floor is never exposed by any view and never appears in the chronicle. On a public network, contract storage is ultimately readable by a determined actor with raw state access — for a testnet brokerage this is an acceptable trade-off; a production version would keep floors off-chain in a TEE or use commitments.

---

## Deploy the contract

```bash
npm install -g genlayer
genlayer network set testnet-bradbury
genlayer deploy --contract contracts/domain_broker.py
```

Fund the deployer account first via the [testnet faucet](https://testnet-faucet.genlayer.foundation/). Validate locally without deploying:

```bash
pip install genvm-linter
genvm-lint lint contracts/domain_broker.py --json
```

---

## Run the frontend

```bash
cd frontend
cp .env.example .env        # set VITE_CONTRACT_ADDRESS to your deployment
npm install
npm run dev                 # http://localhost:5173
```

The dApp connects through MetaMask (the GenLayer chain is added automatically), reads the market with a free RPC client, and signs transactions with [genlayer-js](https://github.com/genlayerlabs/genlayer-js).

**UI features:**

- Market dashboard — live listings with 3D-tilt cards, status badges, and published counter-offers.
- Negotiation console — a chat-style room per domain: full negotiation history plus an offer bar (GEN amount and persuasion message).
- Consensus theater — while validators deliberate, the UI shows the real lifecycle: escrow, leader drafts, validators re-run, consensus seal, with an animated AI core and validator orbit.
- Verdict screen — animated stamp (DEAL CLOSED / OFFER REJECTED / COUNTER-OFFER), the broker's reasoning typed out, confetti on a close, and a one-click rebid that re-escrows at ARIA's quoted price, which the contract honors deterministically.

---

## Links

[GenLayer](https://genlayer.com) · [Documentation](https://docs.genlayer.com) · [SDK API reference](https://sdk.genlayer.com) · [genlayer-js](https://github.com/genlayerlabs/genlayer-js) · [GenLayer Skills](https://skills.genlayer.com/) · [Builders Portal](https://portal.genlayer.foundation/)
