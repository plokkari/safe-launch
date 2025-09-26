import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";

/** === Discriminators from your IDL (exact bytes) === */
const DISC = {
  guarded_transfer: Uint8Array.from([101,14,194,73,126,140,118,221]),
  init_config:      Uint8Array.from([23,235,115,232,168,96,1,231]),
  set_graduated:    Uint8Array.from([195,104,1,112,166,85,22,115]),
};

/** === Helpers to encode tiny args === */
const leU64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return new Uint8Array(b);
};
const u8 = (n: number) => Uint8Array.from([n & 0xff]);
const boolByte = (v: boolean) => Uint8Array.from([v ? 1 : 0]);

/** === Instruction builders (pure web3.js) === */
function ixInitConfig(programId: PublicKey, cfgPk: PublicKey, authority: PublicKey, maxPercent: number) {
  const data = new Uint8Array([...DISC.init_config, ...u8(maxPercent)]);
  const keys = [
    { pubkey: cfgPk,      isSigner: true,  isWritable: true },
    { pubkey: authority,  isSigner: true,  isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

function ixSetGraduated(programId: PublicKey, cfgPk: PublicKey, authority: PublicKey, graduated: boolean) {
  const data = new Uint8Array([...DISC.set_graduated, ...boolByte(graduated)]);
  const keys = [
    { pubkey: cfgPk,     isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true,  isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

function ixGuardedTransfer(programId: PublicKey, cfgPk: PublicKey, from: PublicKey, dest: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint) {
  const data = new Uint8Array([...DISC.guarded_transfer, ...leU64(amount)]);
  const keys = [
    { pubkey: cfgPk,            isSigner: false, isWritable: true },
    { pubkey: from,             isSigner: false, isWritable: true },
    { pubkey: dest,             isSigner: false, isWritable: true },
    { pubkey: mint,             isSigner: false, isWritable: false },
    { pubkey: owner,            isSigner: true,  isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

describe("cap_guard — end-to-end SPL Token-2022 smoke test (raw web3.js)", () => {
  const DEVNET_URL = "https://api.devnet.solana.com";
  const idJson = fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(idJson)));

  const connection = new Connection(DEVNET_URL, "confirmed");
  const authority = payer.publicKey;
  const programId = new PublicKey("C8RGfQJMVyUEGS9bMKoMnfvU1mZJYQ35dVdhxQSZ5iqr");

  const config = Keypair.generate(); // init signer account
  let mint: PublicKey;
  let ownerAta: PublicKey;
  let destAta: PublicKey;
  const recipient = Keypair.generate();
  const decimals = 6;

  async function airdropIfNeeded(minSol = 1.5) {
    const bal = await connection.getBalance(authority);
    if (bal < minSol * LAMPORTS_PER_SOL) {
      try {
        await connection.requestAirdrop(authority, Math.ceil(minSol * LAMPORTS_PER_SOL));
        await new Promise(r => setTimeout(r, 4000));
      } catch {
        console.warn("Devnet airdrop skipped (flaky).");
      }
    }
  }

  it("sets up Token-2022 mint + ATAs and mints to owner", async () => {
    await airdropIfNeeded(2);

    mint = await createMint(
      connection,
      payer,
      authority,
      null,
      decimals,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const o = await getOrCreateAssociatedTokenAccount(
      connection, payer, mint, authority, true, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
    );
    ownerAta = o.address;

    const d = await getOrCreateAssociatedTokenAccount(
      connection, payer, mint, recipient.publicKey, true, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
    );
    destAta = d.address;

    const supply = 100n * BigInt(10 ** decimals);
    await mintTo(connection, payer, mint, ownerAta, authority, Number(supply), [], undefined, TOKEN_2022_PROGRAM_ID);

    const bal = await getAccount(connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log("Owner initial token balance:", bal.amount.toString());
  });

  it("init_config(max_percent=5)", async () => {
    const tx = new Transaction().add(ixInitConfig(programId, config.publicKey, authority, 5));
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, config], { commitment: "confirmed" });
    console.log("init_config sig:", sig);

    // confirm config account was created
    const cfgInfo = await connection.getAccountInfo(config.publicKey);
    console.log("Config account exists?", !!cfgInfo);
    if (!cfgInfo) throw new Error("Config account was not created.");
  });

  it("blocks guarded_transfer when over cap and not graduated", async () => {
    // set graduated=false
    {
      const tx = new Transaction().add(ixSetGraduated(programId, config.publicKey, authority, false));
      await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    }

    const ownerBefore = await getAccount(connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const ownerBal = BigInt(ownerBefore.amount.toString());
    const amount = (ownerBal * 9n) / 10n; // 90%

    let blocked = false;
    try {
      const tx = new Transaction().add(
        ixGuardedTransfer(programId, config.publicKey, ownerAta, destAta, mint, authority, amount)
      );
      await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    } catch (e: any) {
      blocked = true;
      console.log("Blocked as expected (over cap, not graduated):", e.message);
    }
    if (!blocked) throw new Error("Expected transfer to be blocked by cap.");
  });

  it("allows guarded_transfer after graduation", async () => {
    // set graduated=true
    {
      const tx = new Transaction().add(ixSetGraduated(programId, config.publicKey, authority, true));
      await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    }

    const ownerBefore = await getAccount(connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const ownerBal = BigInt(ownerBefore.amount.toString());
    const amount = (ownerBal * 9n) / 10n; // 90%

    const tx = new Transaction().add(
      ixGuardedTransfer(programId, config.publicKey, ownerAta, destAta, mint, authority, amount)
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    console.log("Graduated transfer sig:", sig);

    const destAfter = await getAccount(connection, destAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log("Recipient balance after:", destAfter.amount.toString());
  });
});
