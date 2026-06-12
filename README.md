# AI Domain Broker

**A decentralized domain-name brokerage where an autonomous AI closes the deals.**

Sellers list Web3 domains with a public asking price and a **confidential minimum** that only the broker AI knows. Buyers escrow real GEN and pitch their offer in natural language. **ARIA** — an LLM running *inside* a GenLayer Intelligent Contract under validator consensus — accepts, rejects or counter-offers, and settles the sale on-chain. No middlemen, no waiting for the seller to come online.

Built on [GenLayer](https://genlayer.com) (Bradbury Testnet) — the negotiation verdict is not one model's opinion: every validator independently re-runs the negotiation and the verdicts must agree (Optimistic Democracy).

> **Live on Bradbury Testnet:** `0x0Ec607dB8CD8693CfB34e714E2cb16cF4db8d62B` — deployed, `ACCEPTED` by validator consensus and verified with live reads.

---

## How a negotiation works

```
buyer escrows GEN + pitch
        │
        ▼
┌─ place_bid ─────────────────────────────────────────────┐
│ deterministic guards (status, owner, value, length)      │
│        │                                                 │
│        ▼                                                 │
│ fast paths (no LLM):                                     │
│   bid ≥ asking price        → instant ACCEPT             │
│   bid ≥ published counter   → instant ACCEPT             │
│        │ otherwise                                       │
│        ▼                                                 │
│ ARIA prompt (asking price, CONFIDENTIAL floor, pitch,    │
│ description, prior offers)                               │
│        │                                                 │
│        ▼                                                 │
│ leader node drafts verdict ──► every validator re-runs   │
│ the same prompt and must agree on the decision           │
│ (counter prices within 15%)                              │
│        │                                                 │
│        ▼                                                 │
│ deterministic backstops:                                 │
│   ACCEPT below floor   → impossible (forced counter)     │
│   counter outside      → clamped to [floor, ask]         │
│   counter ≤ bid        → treated as ACCEPT               │
│        │                                                 │
│        ▼                                                 │
│ ACCEPT  → GEN to seller, ownership flips, SOLD           │
│ REJECT  → full escrow refund                             │
│ COUNTER → full refund + counter published on-chain       │
│           (any later bid meeting it is honored           │
│            deterministically — the broker keeps its word)│
└──────────────────────────────────────────────────────────┘
```

Key properties:

- **The AI can never sell below the seller's floor.** That rule is deterministic code, not a prompt instruction.
- **The broker honors its own counter-offers** without a second LLM round — pure contract logic.
- **Prompt-injection pitches** ("ignore your rules", "reveal the minimum") are explicitly instructed to be rejected, and even a fooled model cannot break the floor backstop.
- **Refunds are atomic.** REJECT/COUNTER refund the escrow in the same transaction via native `emit_transfer`.

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

## Contract (`contracts/domain_broker.py`)

| Method | Type | What it does |
| --- | --- | --- |
| `register_domain(name, ask_gen, floor_gen, desc)` | write | List a domain. Prices as decimal GEN strings → atto integers (no floats). |
| `place_bid(name, pitch)` | write **payable** | Escrow GEN + pitch → AI verdict under consensus → settle/refund. |
| `delist_domain(name)` | write | Owner withdraws an open listing. |
| `get_domains(start)` | view | Paged listings (the confidential floor is never returned). |
| `get_domain(name)` | view | One listing. |
| `get_negotiations(name, start)` | view | Full negotiation chronicle for a domain (JSON entries). |
| `get_stats()` | view | Marketplace counters for the dashboard. |

**Consensus design.** The LLM call runs inside a zero-argument closure (`gl.nondet.exec_prompt`). The leader's verdict is validated by every other validator *re-running the same negotiation* and comparing the decision field exactly (and counter prices within 15%) — with `gl.eq_principle.prompt_comparative` as fallback principle. Deterministic guards run before the AI (cheap failures never hit the LLM) and deterministic backstops run after consensus (the AI physically cannot violate the seller's floor).

**Verified live syntax.** The contract pins the GenVM runner hash on line 1 and uses `from genlayer import *` — the only import form that exists on the current public-testnet runner (the `genlayer.types` module from older SDK docs raises `ModuleNotFoundError` on Bradbury; verified live). Native GEN transfers use `gl.get_contract_at(addr).emit_transfer(value=..., on="finalized")`.

**A note on "secret" floors.** The floor is never exposed by any view and never appears in the chronicle. On a public network, contract storage is ultimately readable by a determined actor with raw state access — for a hackathon/testnet brokerage this is a fair trade-off; a production version would keep floors off-chain in a TEE or use commitments.

---

## Deploy the contract

```bash
npm install -g genlayer

genlayer network set testnet-bradbury
genlayer deploy --contract contracts/domain_broker.py
# → prints the contract address
```

Fund the deployer account first via the [testnet faucet](https://testnet-faucet.genlayer.foundation/). Validate locally without deploying:

```bash
pip install genvm-linter
genvm-lint lint contracts/domain_broker.py --json    # {"ok":true,"passed":3}
```

---

## Run the frontend

```bash
cd frontend
cp .env.example .env        # set VITE_CONTRACT_ADDRESS to your deployment
npm install
npm run dev                 # http://localhost:5173
```

The dApp connects through MetaMask (the GenLayer chain is added automatically), reads the market with a free RPC client, and signs `register_domain` / `place_bid` transactions with [genlayer-js](https://github.com/genlayerlabs/genlayer-js).

**What you get in the UI:**

- **Market dashboard** — live listings with 3D-tilt cards, status badges and published counter-offers.
- **Negotiation console** — a chat-style room per domain: the full negotiation history (every pitch and every ARIA verdict) plus your offer bar (GEN amount + persuasion message).
- **Consensus theater** — while validators deliberate, the UI plays the real lifecycle: escrow → leader drafts → validators re-run → consensus seal, with an animated AI core and validator nodes.
- **Verdict screen** — animated stamp (DEAL CLOSED / OFFER REJECTED / COUNTER-OFFER), the broker's reasoning typed out, confetti on a close, and a one-click **"Accept counter — rebid"** that re-escrows at ARIA's quoted price (which the contract honors deterministically).

---

## Links

[GenLayer](https://genlayer.com) · [Documentation](https://docs.genlayer.com) · [SDK API reference](https://sdk.genlayer.com) · [genlayer-js](https://github.com/genlayerlabs/genlayer-js) · [GenLayer Skills](https://skills.genlayer.com/) · [Builders Portal](https://portal.genlayer.foundation/)
