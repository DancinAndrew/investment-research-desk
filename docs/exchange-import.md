# Exchange trade import: design

Status: design only. The exchange-specific adapters described here are **not implemented** in this repository. What exists today is the generic CSV importer in `src/csv-ledger.mjs` (column mapping, preview, duplicate and conflict detection, batch undo) and the stock ledger replay in `src/ledger-core.mjs` / `src/portfolio-core.mjs`.

This document records how dedicated importers for crypto exchange exports (for example Pionex or Binance spot, perpetual futures and trading-bot histories) are meant to plug into the existing ledger without weakening its accounting guarantees.

## Principles

- **Raw exports first, APIs later.** Start from the exchange's own downloadable history files. A read-only API sync is only considered after the file-based event format has been reconciled; an API does not back-fill history or replace reconciliation, and it never needs trading or withdrawal permissions.
- **Keep the original grain.** If an export only contains summaries, store the summary as a summary. Never split aggregates into invented fills.
- **No silent currency coercion.** USDT is not USD. Settlement asset, account, sub-account and product type stay separate; positions are never merged because two venues share a symbol.
- **Unknown stays unknown.** Missing fields are kept as `null`, not zero. Missing opening balances or cost basis mark the period as incomplete instead of producing a total return.

## Why a dedicated importer is needed

- `src/csv-ledger.mjs` is a generic column-mapping importer (2 MB / 10,000 rows per file). It has no native parser for exchange formats, and bot histories can exceed its size assumptions.
- `src/ledger-core.mjs` groups accounting by ticker plus a three-letter currency, and `src/portfolio-core.mjs` also expects three-letter currencies. Derivatives and bot accounting need their own event model; the spot replay engine must not be reused to compute futures P&L.
- Snapshot / execution-evidence records can hold observations, but they are not a complete derivatives ledger.

## Event types to capture

| Category | Records | Purpose |
|---|---|---|
| Spot | Fills with time, pair, trade ID, quantity, price, fee and fee asset | Rebuild trades and asset changes; open or cancelled orders are not fills |
| Perpetual / futures | Fills plus the funding ledger: realized P&L, trading fees, funding fees, transfers, liquidations | Separate open/close, trading P&L and cash movements |
| Trading bots | Bot or strategy ID, start/end, capital added/withdrawn, fills and income ledger | Attribute performance to the strategy without double-counting the underlying fills |
| Account funding | Deposits, withdrawals, internal transfers, conversions | Movements between wallets are not trading profit |
| Reconciliation anchor | Balances, open positions and bot state at a stated time | Check the imported history; a snapshot never substitutes for fills |

## Pipeline

1. **Intake and preservation.** Hash the raw bytes; record platform, account, product, date range, time zone, file type, row count and known gaps. Raw files stay in a git-ignored local folder (`private-inputs/`) and are never bundled into `dist/`.
2. **Per-exchange adapter.** Map raw rows to source-located events: fills, fees, funding, realized P&L, transfers and strategy links. Keep unknown columns. Use exact decimal amounts and keep the original value and unit.
3. **Unified event model.** Settlement asset, account / sub-account, spot vs. linear vs. inverse contracts, side, open/close and contract spec. Bots link to strategies; the underlying fills are still booked per instrument. The existing stock ledger stays compatible; no bulk migration.
4. **Deduplication.** Primary key is platform + account + product + platform trade / event ID. Multiple fills of one order are not merged. Rows without an ID are only flagged as possible duplicates. Summary files and per-fill files are never booked twice, and bot P&L is never added on top of its underlying fills.
5. **Preview and save.** Show new / duplicate / conflict / unsupported / missing-opening-balance rows and the range that can actually be computed. Saving is an explicit, incremental write with a batch receipt, safe undo and backup, using the same whole-ledger revision check as every other write (see `docs/api.md`).
6. **Reconcile before reporting performance.** Per account, currency, product and period, reconcile volume, fees, realized P&L, funding and asset changes. Exchange-reported P&L and recomputed P&L are separate fields, never summed.
7. **Optional API sync.** Only after the file format is verified: evaluate history depth, pagination and rate limits, clock skew, dedupe, credential storage and revocation.

## First acceptance checkpoint

Two real export formats parse; spot, derivatives and bot records are routed separately; re-importing the same file adds nothing; fees and funding keep their original asset; one period with explicit start, end and balance anchor reconciles. Missing bot or derivatives detail is reported as a gap rather than passed on the strength of spot data.
