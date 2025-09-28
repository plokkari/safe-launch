import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: "buffer",
      process: "process/browser",
    },
  },
  define: {
    "process.env": {},   // some libs expect it
    global: "globalThis" // make `global` work in browser
  },
  optimizeDeps: {
    include: [
      "buffer",
      "process",
      "@solana/web3.js",
      "@solana/spl-token",
      "@coral-xyz/anchor"
    ],
  },
});
