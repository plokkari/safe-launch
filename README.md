# Safe Launch — CapGuard (Devnet Beta)

**CapGuard** is a Solana program that enforces a per-account transfer cap on a Token-2022 mint **until “graduation”**. It helps projects avoid early whale drain while still allowing transfers. After graduation, the cap is lifted.

- **Cluster:** Devnet  
- **Program ID:** `C8RGfQJMVyUEGS9bMKoMnfvU1mZJYQ35dVdhxQSZ5iqr`  
- **Upgrade Loader:** `BPFLoaderUpgradeab1e11111111111111111111111`  
- **ProgramData:** `B9aJpNrqapwoohJQYXdgdcyk78B72MJ6jNin59k9o2D8`  
- **Authority wallet (local path):** `/home/plokkari/.config/solana/id.json` (NOT in repo)

---

## What it does

- `init_config(max_percent)`: creates a config account with `authority`, `max_percent`, and `graduated=false`.  
- `set_graduated(bool)`: authority flips the graduation flag.  
- `guarded_transfer(amount)`: before graduation, rejects if recipient balance would exceed `max_percent` of mint supply; after graduation, allows.

---

## Artifacts (for clients)

- IDL: `contracts/cap_guard/target/idl/cap_guard.json`  
- Types: `contracts/cap_guard/target/types/cap_guard.ts`

---

## Build

```bash
cd contracts/cap_guard
# build the program and patch the IDL
npm run build:idl
