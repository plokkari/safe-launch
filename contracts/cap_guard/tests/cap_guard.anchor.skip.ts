import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import {
  Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Connection
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  TOKEN_2022_PROGRAM_ID, getAccount
} from "@solana/spl-token";
import fs from "fs";

describe("cap_guard — Anchor methods test", () => {
  const DEVNET_URL = "https://api.devnet.solana.com";
  const idJson = fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(idJson)));
  const connection = new Connection(DEVNET_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const programId = new PublicKey("C8RGfQJMVyUEGS9bMKoMnfvU1mZJYQ35dVdhxQSZ5iqr");
  const idlPath = process.cwd() + "/target/idl/cap_guard.json";
  const idl: any = JSON.parse(fs.readFileSync(idlPath, "utf8"));

    // Safety override: skip building account clients entirely.
  // (We don't need them to call .methods.* and it avoids idl.accounts[*].type.size crashes.)
  idl.accounts = [];


  const program = new anchor.Program(idl as anchor.Idl, programId, provider);

  const authority = payer.publicKey;
  const config = Keypair.generate();
  let mint: PublicKey, ownerAta: PublicKey, destAta: PublicKey;
  const recipient = Keypair.generate();
  const decimals = 6;

  async function airdropIfNeeded(minSol = 1.5) {
    const bal = await connection.getBalance(authority);
    if (bal < minSol * LAMPORTS_PER_SOL) {
      try {
        await connection.requestAirdrop(authority, Math.ceil(minSol * LAMPORTS_PER_SOL));
        await new Promise(r => setTimeout(r, 4000));
      } catch {}
    }
  }

  it("sets up Token-2022 mint + ATAs + mints", async () => {
    await airdropIfNeeded(2);

    mint = await createMint(connection, payer, authority, null, decimals, undefined, undefined, TOKEN_2022_PROGRAM_ID);

    ownerAta = (await getOrCreateAssociatedTokenAccount(
      connection, payer, mint, authority, true, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
    )).address;

    destAta = (await getOrCreateAssociatedTokenAccount(
      connection, payer, mint, recipient.publicKey, true, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
    )).address;

    const supply = 100n * BigInt(10 ** decimals);
    await mintTo(connection, payer, mint, ownerAta, authority, Number(supply), [], undefined, TOKEN_2022_PROGRAM_ID);

    const bal = await getAccount(connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log("Owner initial token balance:", bal.amount.toString());
  });

  it("init_config(max_percent=5)", async () => {
    const sig = await program.methods
      .initConfig(5)
      .accounts({ config: config.publicKey, authority, systemProgram: SystemProgram.programId })
      .signers([config])
      .rpc();
    console.log("init_config sig:", sig);

    const info = await connection.getAccountInfo(config.publicKey);
    if (!info) throw new Error("Config not created");
  });

  it("blocks guarded_transfer before graduation when over cap", async () => {
    await program.methods.setGraduated(false).accounts({ config: config.publicKey, authority }).rpc();

    const ownerBefore = await getAccount(connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const ownerBal = BigInt(ownerBefore.amount.toString());
    const amount = (ownerBal * 9n) / 10n; // 90%

    let blocked = false;
    try {
      await program.methods
        .guardedTransfer(new BN(amount.toString()))
        .accounts({
          config: config.publicKey,
          from: ownerAta,
          destination: destAta,
          mint,
          owner: authority,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    } catch (e:any) {
      blocked = true;
      console.log("Blocked (expected):", e.message);
    }
    if (!blocked) throw new Error("Expected over-cap transfer to be blocked");
  });

  it("allows guarded_transfer after graduation", async () => {
    await program.methods.setGraduated(true).accounts({ config: config.publicKey, authority }).rpc();

    const ownerBefore = await getAccount(connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const ownerBal = BigInt(ownerBefore.amount.toString());
    const amount = (ownerBal * 9n) / 10n;

    const sig = await program.methods
      .guardedTransfer(new BN(amount.toString()))
      .accounts({
        config: config.publicKey,
        from: ownerAta,
        destination: destAta,
        mint,
        owner: authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log("Graduated transfer sig:", sig);

    const destAfter = await getAccount(connection, destAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log("Recipient balance after:", destAfter.amount.toString());
  });
});
