// scripts/patch_idl.ts
import fs from "fs";
import path from "path";

// adjust if your program name changes
const PROG = "cap_guard";
const PROGRAM_ID = "C8RGfQJMVyUEGS9bMKoMnfvU1mZJYQ35dVdhxQSZ5iqr";

const idlPath = path.resolve(`target/idl/${PROG}.json`);
if (!fs.existsSync(idlPath)) {
  console.error(`IDL not found at ${idlPath}`);
  process.exit(1);
}
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// Inject metadata.address (some builds miss it)
idl.metadata = idl.metadata || { name: PROG, version: "0.1.0", spec: "0.1.0" };
idl.metadata.address = PROGRAM_ID;

// Force full accounts layout for Config (matches your Rust struct)
idl.accounts = [
  {
    name: "Config",
    discriminator: (idl.accounts && idl.accounts[0]?.discriminator) || [155,12,170,224,30,250,204,130],
    type: {
      kind: "struct",
      fields: [
        { name: "authority",   type: "publicKey" },
        { name: "max_percent", type: "u8" },
        { name: "graduated",   type: "bool" }
      ],
      // 8 account discriminator + 32 + 1 + 1 = 42
      size: 42
    }
  }
];

fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2));
console.log(`Patched IDL accounts layout at ${idlPath}`);
