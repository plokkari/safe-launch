// src/App.tsx
// must be first
import "./polyfills";
import { Buffer } from "buffer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  MINT_SIZE,
  getAssociatedTokenAddressSync,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToCheckedInstruction,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";

const DEVNET = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("C8RGfQJMVyUEGS9bMKoMnfvU1mZJYQ35dVdhxQSZ5iqr");

/* ---------- tiny helpers ---------- */
function pretty(n?: number | bigint | null, decimals?: number) {
  if (n === undefined || n === null) return "—";
  try {
    if (decimals === undefined) return n.toString();
    const bi = BigInt(n.toString());
    const d = BigInt(10) ** BigInt(decimals);
    const whole = bi / d;
    const frac = (bi % d).toString().padStart(decimals, "0");
    return `${whole.toString()}${decimals ? `.${frac.replace(/0+$/, "") || "0"}` : ""}`;
  } catch {
    return String(n);
  }
}

// IDL-based raw encoding helpers (no Anchor coder)
function getIxDisc(idl: any, name: string): Uint8Array {
  const ix = (idl?.instructions || []).find((i: any) => i.name === name);
  if (!ix || !Array.isArray(ix.discriminator)) {
    throw new Error(`Discriminator for ${name} not found in IDL`);
  }
  return Uint8Array.from(ix.discriminator);
}
function u8(n: number): Uint8Array { return Uint8Array.of(n & 0xff); }
function bool(b: boolean): Uint8Array { return Uint8Array.of(b ? 1 : 0); }
function u64le(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let x = n;
  for (let i = 0; i < 8; i++) { buf[i] = Number(x & 0xffn); x >>= 8n; }
  return buf;
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Low-level send with wallet (fresh blockhash & friendly dup handling)
async function sendWithWallet(
  connection: Connection,
  wallet: ReturnType<typeof useWallet>,
  ixs: anchor.web3.TransactionInstruction[],
  signers: anchor.web3.Signer[] = []
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = wallet.publicKey!;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = blockhash;

  if (signers.length) tx.partialSign(...signers);
  const signed = await wallet.signTransaction!(tx);

  try {
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  } catch (e: any) {
    const msg = (e?.message || "").toLowerCase();
    // Treat duplicates as success: we'll refresh state at call sites
    if (msg.includes("already been processed") || msg.includes("duplicate")) {
      return "DUPLICATE_TX";
    }
    throw e;
  }
}

/* ---------- PercentRing UI ---------- */
function PercentRing({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const R = 42;
  const C = 2 * Math.PI * R;
  const off = C - (p / 100) * C;

  return (
    <svg width="110" height="110" viewBox="0 0 110 110" className="ring">
      <g transform="translate(55,55)">
        <circle r={R} stroke="#e5e7eb" strokeWidth="18" fill="none" />
        <circle
          r={R}
          stroke="#6366f1"
          strokeWidth="18"
          fill="none"
          strokeDasharray={`${C} ${C}`}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform="rotate(-90)"
        />
        <text x="0" y="6" textAnchor="middle" className="ring-text">
          {p}%
        </text>
      </g>
    </svg>
  );
}

/* ---------- Roadmap (new) ---------- */
function Roadmap() {
  return (
    <section className="card" style={{ borderLeft: "4px solid #6366f1" }}>
      <h2>SafeLaunch — Roadmap</h2>

      <h3 style={{ marginTop: 8 }}>Mission</h3>
      <p className="help">
        Make first-purchases on Solana safer and fairer for newcomers by enforcing supply caps and
        transparent rules at launch—so people can try new coins without being insta-rugged by bots
        or dev wallets.
      </p>

      <h3 style={{ marginTop: 12 }}>Problem</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>Bots and insiders scooping huge supply at launch.</li>
        <li>Devs holding outsized supply via alt wallets.</li>
        <li>No consistent, transparent guardrails for new buyers.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Approach</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li><b>Hard caps:</b> default 2% combined creator cap, 1% per buyer during guarded phase.</li>
        <li><b>On-chain enforcement:</b> transfers over cap fail (program checks, not just UI).</li>
        <li><b>Graduation:</b> when conditions are met, caps lift and the token behaves normally.</li>
        <li><b>Transparency:</b> clear UI, on-chain config, public metrics.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>What exists today (MVP)</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>Token-2022 mint + owner ATA creation.</li>
        <li>Config account with % cap and <code>graduated</code> flag.</li>
        <li><code>guarded_transfer</code> instruction that blocks over-cap transfers.</li>
        <li>Demo UI with a step-by-step flow.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Phase 1 — Public Alpha (0–1 month)</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>Add creator-group cap (combined ≤2%).</li>
        <li>UI soft-guard for per-wallet buys (≤1%) with clear errors.</li>
        <li>Optional first-buy smoothing (auto-split to treasury to keep buyer ≤ cap).</li>
        <li>Better errors (duplicate tx, auth, ATA idempotency), metrics in UI.</li>
        <li>Public devnet demo anyone can try with a dev wallet.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Phase 2 — Guarded Launch (1–2 months)</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>On-chain per-wallet buy cap via a controlled mint path.</li>
        <li>Cooldowns to reduce bot spamming.</li>
        <li>Graduation conditions (time/holders/manual).</li>
        <li>Creator-group management + event logs.</li>
        <li>Holder analytics in UI; invariants tests.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Phase 3 — Mainnet Beta (2–4 months)</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>Independent audit + bug bounty.</li>
        <li>Rate limits/fees tuned to deter abuse.</li>
        <li>Wallet & explorer integrations.</li>
        <li>Creator onboarding docs & examples.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Phase 4 — Scale & Governance (4–6 months)</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>Optional governance hooks (pause/resume graduation, future caps).</li>
        <li>Launch checklists (liquidity lock, vesting, disclosures).</li>
        <li>Education hub for newcomers; public metrics page.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Guardrails (defaults)</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li><b>Creator group cap:</b> 2% combined during guarded phase.</li>
        <li><b>Per-wallet cap:</b> 1% during guarded phase.</li>
        <li>Alt-wallet abuse mitigated by group cap + per-wallet cap (not perfect, but visible & costly).</li>
        <li>Caps lift only at graduation (transparent on-chain).</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Success Metrics</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>Largest holder ≤2% at graduation (majority of launches).</li>
        <li>Over-cap transfers blocked (prevented harm).</li>
        <li>Holder count & graduation time medians.</li>
        <li>Repeat participation from new users; zero criticals post-audit.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Use of Funds (Grant)</h3>
      <ul className="help" style={{ marginLeft: 18 }}>
        <li>Founder time to ship Phases 1–2 quickly.</li>
        <li>Bring on co-dev (CS degree) for core features.</li>
        <li>Audit + bug bounty; infra, UX polish, docs.</li>
      </ul>

      <h3 style={{ marginTop: 12 }}>Live Demo Flow</h3>
      <ol className="help" style={{ marginLeft: 18 }}>
        <li>Create token</li>
        <li>Create config (cap %)</li>
        <li>Buy (UI explains cap behavior)</li>
        <li>Guarded transfer (on-chain reject if over cap)</li>
        <li>Graduation toggle preview</li>
      </ol>
    </section>
  );
}

/* ---------- Main Panel ---------- */
function Panel() {
  const creatingRef = useRef(false);
  const buyingRef = useRef(false);
  const connection = useMemo(() => new Connection(DEVNET, "confirmed"), []);
  const wallet = useWallet();

  const [idlJson, setIdlJson] = useState<any | null>(null);

  // Demo state
  const [mint, setMint] = useState<PublicKey | null>(null);
  const [decimals] = useState<number>(6);
  const [ownerAta, setOwnerAta] = useState<PublicKey | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);

  const [config, setConfig] = useState<PublicKey | null>(null);
  const [maxPercent, setMaxPercent] = useState<number>(30);
  const [graduated, setGraduated] = useState<boolean>(false);

  const [recipient, setRecipient] = useState("");
  const [recipientAta, setRecipientAta] = useState<PublicKey | null>(null);

  const [buyAmt, setBuyAmt] = useState<number>(10_000_000); // raw units
  const [sendAmt, setSendAmt] = useState<number>(1_000_000); // raw units

  const [creating, setCreating] = useState(false);
  const [buying, setBuying] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((m: string) => {
    setLogs((x) => [new Date().toLocaleTimeString() + " — " + m, ...x].slice(0, 150));
  }, []);

  // Load IDL once — use BASE_URL so it works in preview or GH Pages
  useEffect(() => {
    (async () => {
      try {
        const url = `${import.meta.env.BASE_URL}idl/cap_guard.json`;
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`IDL HTTP ${r.status} at ${url}`);
        const idl = await r.json();
        idl.metadata = idl.metadata || {};
        idl.metadata.address = PROGRAM_ID.toBase58();
        setIdlJson(idl);
        log("IDL loaded.");
      } catch (e: any) {
        log("Failed to load IDL: " + (e.message || e));
      }
    })();
  }, [log]);

  // Refresh balances/supply from chain
  const refresh = useCallback(async () => {
    try {
      if (ownerAta) {
        const tk = await getAccount(connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
        setBalance(BigInt(tk.amount.toString()));
      }
      if (mint) {
        // supply u64 LE at offset 36..44 in token-2022 mint
        const info = await connection.getAccountInfo(mint);
        if (info?.data) {
          const d = info.data.slice(36, 44);
          let s = 0n;
          for (let i = 0; i < 8; i++) s += BigInt(d[i]) << (8n * BigInt(i));
          setSupply(s);
        }
      }
      log("Balances refreshed.");
    } catch (e: any) {
      log("Refresh failed: " + (e.message || e));
    }
  }, [connection, mint, ownerAta, log]);

  // Derived visuals
  const capAllowed: bigint | null = supply !== null ? (BigInt(maxPercent) * supply) / 100n : null;
  const sharePct: number =
    supply && balance ? Math.min(100, Math.round((Number(balance) / Number(supply)) * 100)) : 0;

  /* 1) Create Token — ONLY initialize mint & ATA, DO NOT MINT */
  const createTokenMint = useCallback(async () => {
    if (!wallet.connected) return log("Connect Phantom first.");
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      log("Creating mint (decimals=6) and your ATA…");

      const owner = wallet.publicKey!;
      const mintKp = anchor.web3.Keypair.generate();
      const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

      const createMintIx = SystemProgram.createAccount({
        fromPubkey: owner,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_2022_PROGRAM_ID,
      });

      const initMintIx = createInitializeMint2Instruction(
        mintKp.publicKey,
        decimals,
        owner,
        null,
        TOKEN_2022_PROGRAM_ID
      );

      const ata = getAssociatedTokenAddressSync(mintKp.publicKey, owner, true, TOKEN_2022_PROGRAM_ID);
      const createAtaIx = createAssociatedTokenAccountInstruction(
        owner, ata, owner, mintKp.publicKey, TOKEN_2022_PROGRAM_ID
      );

      const sig1 = await sendWithWallet(connection, wallet, [createMintIx, initMintIx], [mintKp]);
      log(sig1 === "DUPLICATE_TX" ? "✔ Mint account created (dup): refreshed." : "✔ Mint account created: " + sig1);

      const sig2 = await sendWithWallet(connection, wallet, [createAtaIx]);
      log(sig2 === "DUPLICATE_TX" ? "✔ ATA created (dup): refreshed." : "✔ ATA created (no tokens minted): " + sig2);

      setMint(mintKp.publicKey);
      setOwnerAta(ata);
      await refresh();
    } catch (e: any) {
      log("Create mint failed: " + (e.message || e));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [wallet, connection, decimals, refresh, log]);

  /* 2) Buy — mints buyAmt to your ATA; UI cap guard applies once supply > 0 */
  const buy = useCallback(async () => {
    if (!wallet.connected) return log("Connect Phantom first.");
    if (!mint) return log("Create the token mint first.");
    if (buyingRef.current) return;
    buyingRef.current = true;
    setBuying(true);

    try {
      // Ensure owner ATA exists (create on the fly if missing)
      let ataPk = ownerAta;
      if (!ataPk) {
        const owner = wallet.publicKey!;
        ataPk = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
        const createAtaIx = createAssociatedTokenAccountInstruction(
          owner, ataPk, owner, mint, TOKEN_2022_PROGRAM_ID
        );
        const sigAta = await sendWithWallet(connection, wallet, [createAtaIx]);
        log(sigAta === "DUPLICATE_TX" ? "✔ Your ATA already existed (dup) — refreshed." : "✔ Your ATA was created: " + sigAta);
        setOwnerAta(ataPk);
      }

      // Soft guard: after some supply exists, prevent buys that exceed cap
      if (config && !graduated && balance !== null && supply !== null && supply > 0n) {
        const projectedBalance = balance + BigInt(buyAmt);
        const projectedSupply = supply + BigInt(buyAmt);
        const projectedCap = (BigInt(maxPercent) * projectedSupply) / 100n;
        if (projectedBalance > projectedCap) {
          log(
            `❌ Buy blocked: before graduation you can hold at most ` +
            `${projectedCap.toString()} units (${maxPercent}% of supply).`
          );
          return;
        }
      }

      const mintToIx = createMintToCheckedInstruction(
        mint, ataPk!, wallet.publicKey!, BigInt(buyAmt), decimals, [], TOKEN_2022_PROGRAM_ID
      );
      const sig = await sendWithWallet(connection, wallet, [mintToIx]);
      if (sig === "DUPLICATE_TX") {
        log("✔ Bought tokens (duplicate detected) — refreshing balance…");
      } else {
        log("✔ Bought tokens: " + sig);
      }
      await refresh();
    } catch (e: any) {
      log("Buy failed: " + (e.message || e));
    } finally {
      buyingRef.current = false;
      setBuying(false);
    }
  }, [
    wallet, mint, ownerAta, balance, supply, buyAmt, maxPercent,
    config, graduated, connection, decimals, refresh, log
  ]);

  /* 2b) Create on-chain config (init_config) */
  const createConfig = useCallback(async () => {
    if (!idlJson) return log("IDL not loaded.");
    if (!wallet.connected) return log("Connect wallet first.");
    try {
      const cfg = anchor.web3.Keypair.generate();
      setConfig(cfg.publicKey);
      log("Creating config on-chain…");

      const data = concatBytes(getIxDisc(idlJson, "init_config"), u8(maxPercent));
      const keys = [
        { pubkey: cfg.publicKey,      isSigner: true,  isWritable: true  },
        { pubkey: wallet.publicKey!,  isSigner: true,  isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];
      const ix = new anchor.web3.TransactionInstruction({
        programId: PROGRAM_ID,
        keys,
        data: Buffer.from(data),
      });
      const sig = await sendWithWallet(connection, wallet, [ix], [cfg]);
      log(sig === "DUPLICATE_TX" ? "✔ init_config (dup): refreshed." : "✔ init_config tx: " + sig);

      setGraduated(false);
      await refresh();
    } catch (e: any) {
      log("init_config failed: " + (e.message || e));
    }
  }, [idlJson, wallet, maxPercent, connection, refresh, log]);

  /* set_graduated */
  const setGrad = useCallback(async (flag: boolean) => {
    if (!idlJson) return log("IDL not loaded.");
    if (!wallet.connected || !config) return log("Missing config.");
    try {
      const data = concatBytes(getIxDisc(idlJson, "set_graduated"), bool(flag));
      const keys = [
        { pubkey: config,            isSigner: false, isWritable: true  },
        { pubkey: wallet.publicKey!, isSigner: true,  isWritable: false },
      ];
      const ix = new anchor.web3.TransactionInstruction({
        programId: PROGRAM_ID,
        keys,
        data: Buffer.from(data),
      });
      const sig = await sendWithWallet(connection, wallet, [ix]);
      log(sig === "DUPLICATE_TX" ? `✔ set_graduated(${flag}) (dup): refreshed.` : `✔ set_graduated(${flag}) tx: ${sig}`);
      setGraduated(flag);
    } catch (e: any) {
      log("set_graduated failed: " + (e.message || e));
    }
  }, [idlJson, wallet, config, connection, log]);

  /* 3) Prepare recipient ATA (idempotent + nicer errors) */
  const prepareRecipientAta = useCallback(async () => {
    if (!wallet.connected || !mint || !recipient) return;

    let recip: PublicKey;
    try {
      recip = new PublicKey(recipient.trim());
    } catch {
      log("Recipient ATA error: Invalid wallet address.");
      return;
    }

    try {
      const ata = getAssociatedTokenAddressSync(mint, recip, true, TOKEN_2022_PROGRAM_ID);

      // Prefer idempotent create if available
      // @ts-ignore - types sometimes lag
      const { createAssociatedTokenAccountIdempotentInstruction } = await import("@solana/spl-token");

      const ix =
        typeof createAssociatedTokenAccountIdempotentInstruction === "function"
          ? createAssociatedTokenAccountIdempotentInstruction(
              wallet.publicKey!, ata, recip, mint, TOKEN_2022_PROGRAM_ID
            )
          : createAssociatedTokenAccountInstruction(
              wallet.publicKey!, ata, recip, mint, TOKEN_2022_PROGRAM_ID
            );

      const sig = await sendWithWallet(connection, wallet, [ix]);
      if (sig === "DUPLICATE_TX") {
        // If dup, ensure it exists:
        try {
          await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
          setRecipientAta(ata);
          log("✔ Recipient ATA already exists — continuing.");
        } catch {
          log("Recipient ATA duplicate detected, but look-up failed.");
        }
      } else {
        setRecipientAta(ata);
        log("✔ Recipient ATA ready: " + ata.toBase58() + " (" + sig + ")");
      }
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();

      if (msg.includes("duplicate") || e?.message === "DUPLICATE_TX") {
        try {
          const ata = getAssociatedTokenAddressSync(mint, new PublicKey(recipient.trim()), true, TOKEN_2022_PROGRAM_ID);
          await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
          setRecipientAta(ata);
          log("✔ Recipient ATA already exists — continuing.");
          return;
        } catch {/* ignore */}
      }

      if (msg.includes("not been authorized") || msg.includes("unauthorized") || msg.includes("user rejected")) {
        log(
          "Recipient ATA error: Wallet isn’t authorized for this account.\n" +
          "Fix: Disconnect (wallet button), remove the connected app in Phantom, then reconnect the same account."
        );
        return;
      }

      log("Recipient ATA error: " + (e.message || e));
    }
  }, [wallet, connection, mint, recipient, log]);

  /* guarded_transfer (on-chain cap enforcement) */
  const guardedTransfer = useCallback(async () => {
    if (!idlJson) return log("IDL not loaded.");
    if (!wallet.connected || !config || !ownerAta || !recipientAta || !mint)
      return log("Missing fields.");
    try {
      const data = concatBytes(getIxDisc(idlJson, "guarded_transfer"), u64le(BigInt(sendAmt)));
      const keys = [
        { pubkey: config,            isSigner: false, isWritable: true  },
        { pubkey: ownerAta,          isSigner: false, isWritable: true  },
        { pubkey: recipientAta,      isSigner: false, isWritable: true  },
        { pubkey: mint,              isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey!, isSigner: true,  isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ];
      const ix = new anchor.web3.TransactionInstruction({
        programId: PROGRAM_ID,
        keys,
        data: Buffer.from(data),
      });
      const sig = await sendWithWallet(connection, wallet, [ix]);
      log(sig === "DUPLICATE_TX" ? "✔ guarded_transfer (dup): refreshed." : "✔ guarded_transfer tx: " + sig);
      await refresh();
    } catch (e: any) {
      log("guarded_transfer failed: " + (e.message || e));
    }
  }, [idlJson, wallet, config, ownerAta, recipientAta, mint, sendAmt, connection, refresh, log]);

  const connected = wallet.connected;
  const TARGET_TOTAL_SUPPLY_TOKENS = 1_000_000_000;

  return (
    <div className="wrap">
      <header className="header">
        <h1>CapGuard demo</h1>
        <WalletMultiButton />
      </header>

      {/* 👇 Step 2: render the roadmap right under the header */}
      <Roadmap />

      {/* Step-by-step Guide */}
      <section className="card" style={{ borderLeft: "4px solid #6366f1" }}>
        <h2>How this demo works (Step by step)</h2>
        <ol className="help" style={{ lineHeight: 1.6, marginLeft: 18 }}>
          <li><b>Connect Phantom</b> (Devnet).</li>
          <li><b>Create Token</b>: initializes a Token-2022 mint (decimals=6) and your ATA. <i>No tokens are minted yet.</i></li>
          <li><b>Create Config</b>: sets a <b>cap %</b>. Before graduation, the cap is enforced on <b>transfers</b>.</li>
          <li><b>Buy Tokens</b>: mints to your wallet. The UI prevents buys that would exceed your cap once there’s some supply.</li>
          <li><b>Send (guarded_transfer)</b>: on-chain guard rejects transfers that would put the recipient over the cap.</li>
          <li><b>Graduation</b>: when set to true, the transfer cap is lifted.</li>
        </ol>
      </section>

      <div className="grid">
        {/* CREATE + BUY */}
        <section className="card">
          <h2>1) Create Token / Buy</h2>
          <p className="help">
            Token-2022; <b>{decimals}</b> decimals. We aim for a <b>1B token</b> supply model. <br />
            <b>Create Token</b> just initializes the mint (supply stays <b>0</b>). <b>Buy Tokens</b> mints into your wallet.
          </p>

          <div className="row">
            <button disabled={!connected || creating} onClick={createTokenMint}>
              {creating ? "Creating…" : "Create Token (1B model)"}
            </button>
            <button onClick={refresh}>Refresh</button>
          </div>

          <div className="row">
            <label>Buy amount (raw units)</label>
            <input
              type="number"
              value={buyAmt}
              onChange={(e) => setBuyAmt(Number(e.target.value || 0))}
            />
            <button disabled={!connected || !mint || buying} onClick={buy}>
              {buying ? "Buying…" : "Buy Tokens"}
            </button>
          </div>

          <div className="meta">
            <div>Mint: <span className="mono">{mint?.toBase58() ?? "—"}</span></div>
            <div>ATA: <span className="mono">{ownerAta?.toBase58() ?? "—"}</span></div>
            <div>
              Balance:&nbsp;
              <b>{pretty(balance)}</b>&nbsp;
              ({pretty(balance ?? 0n, decimals)} tokens)
            </div>
            <div>
              Supply:&nbsp;
              <b>{pretty(supply)}</b>&nbsp;
              ({pretty(supply ?? 0n, decimals)} tokens)&nbsp;
              <span className="muted">/ target {TARGET_TOTAL_SUPPLY_TOKENS.toLocaleString()} tokens</span>
            </div>
          </div>
        </section>

        {/* CONFIG */}
        <section className="card">
          <h2>2) Config (cap before graduation)</h2>
          <p className="help">
            Before graduation, a transfer is rejected if the recipient would hold more than{" "}
            <b>{maxPercent}%</b> of total supply. After graduation, the cap is lifted.
          </p>

          <div className="row">
            <label>Max percent allowed</label>
            <input
              type="number"
              value={maxPercent}
              onChange={(e) => setMaxPercent(Number(e.target.value || 0))}
            />
            <button disabled={!connected} onClick={createConfig}>Create Config</button>
            <div>Config: <span className="mono">{config?.toBase58() ?? "—"}</span></div>
          </div>

          <div className="row">
            <label>Graduated</label>
            <span className={`pill ${graduated ? "ok" : "warn"}`}>{String(graduated)}</span>
            <button disabled={!connected || !config} onClick={() => setGrad(false)}>set false</button>
            <button disabled={!connected || !config} onClick={() => setGrad(true)}>set true</button>
          </div>

          <div className="capbox">
            <PercentRing percent={sharePct} />
            <div className="captext">
              <div>
                Your balance: <b>{pretty(balance)}</b>{" "}
                ({pretty(balance ?? 0n, decimals)} tokens)
              </div>
              <div>
                Total supply: <b>{pretty(supply)}</b>{" "}
                ({pretty(supply ?? 0n, decimals)} tokens)
              </div>
              {supply !== null && supply > 0n ? (
                <div>
                  Max allowed before graduation:{" "}
                  <b>{capAllowed !== null ? capAllowed.toString() : "—"}</b>{" "}
                  (<b>{capAllowed !== null ? pretty(capAllowed, decimals) : "—"}</b> tokens) — {maxPercent}%
                </div>
              ) : (
                <div className="help">
                  Cap is enforced on <b>transfers</b>. It becomes meaningful once some supply exists.
                  Buys are allowed while total supply is 0.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* TRANSFER */}
        <section className="card">
          <h2>3) Transfer (guarded_transfer)</h2>
          <div className="row">
            <label>Recipient wallet</label>
            <input
              placeholder="Paste wallet pubkey"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
            <button disabled={!connected || !mint} onClick={prepareRecipientAta}>
              Prepare recipient ATA
            </button>
          </div>

          <div className="row">
            <label>Recipient ATA</label>
            <div className="mono">{recipientAta?.toBase58() ?? "—"}</div>
          </div>

          <div className="row">
            <label>Amount (raw units)</label>
            <input
              type="number"
              value={sendAmt}
              onChange={(e) => setSendAmt(Number(e.target.value || 0))}
            />
            <button
              disabled={!connected || !config || !ownerAta || !recipientAta || !mint}
              onClick={guardedTransfer}
            >
              Send (guarded_transfer)
            </button>
          </div>
        </section>

        {/* LOGS */}
        <section className="card">
          <h2>Logs</h2>
          <div className="logs">
            {logs.map((l, i) => (
              <div key={i}>• {l}</div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={DEVNET}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Panel />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
