// src/polyfills.ts
// Make Node-style globals available in the browser **before** any other imports.
import { Buffer } from "buffer";
import process from "process";

if (!(globalThis as any).global) (globalThis as any).global = globalThis;
if (!(globalThis as any).process) (globalThis as any).process = process;
if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;
