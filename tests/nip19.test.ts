import { describe, expect, it } from "vitest";
import { decode, encode, npubFromHex } from "../src/lib/nip19.js";

// Test vector: LLMOps.Pro's npub from CLAUDE.md.
const LLMOPS_NPUB =
  "npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw";
const LLMOPS_HEX = "bb5058aa4c762326b2c02390063f99ace7a7e4c34955d810fb5f44b8de48f355";

describe("NIP-19", () => {
  it("decodes a known npub", () => {
    const r = decode(LLMOPS_NPUB, { allowNsecDecode: false });
    expect(r.type).toBe("npub");
    if (r.type === "npub") expect(r.pubkey_hex).toBe(LLMOPS_HEX);
  });

  it("encodes hex pubkey to npub roundtrip", () => {
    expect(npubFromHex(LLMOPS_HEX)).toBe(LLMOPS_NPUB);
    expect(encode({ type: "npub", pubkey_hex: LLMOPS_HEX })).toBe(LLMOPS_NPUB);
  });

  it("refuses nsec decoding by default — returns the type and warning but no key material", () => {
    // Generate a throwaway nsec for the test. nostr-tools accepts a bytes/hex
    // private key. We hand-craft a known-valid bech32-encoded nsec by
    // encoding then decoding — proves the safety gate, no real key risk.
    const { nip19 } = require("nostr-tools") as typeof import("nostr-tools");
    const sk = new Uint8Array(32).fill(1); // dummy 32 bytes
    const nsec = nip19.nsecEncode(sk);
    const r = decode(nsec, { allowNsecDecode: false });
    expect(r.type).toBe("nsec");
    if (r.type === "nsec") {
      expect(r.private_key_hex).toBeUndefined();
      expect(r.warning).toMatch(/DO NOT log/);
    }
  });

  it("decodes nsec when explicitly opted in", () => {
    const { nip19 } = require("nostr-tools") as typeof import("nostr-tools");
    const sk = new Uint8Array(32).fill(2);
    const nsec = nip19.nsecEncode(sk);
    const r = decode(nsec, { allowNsecDecode: true });
    expect(r.type).toBe("nsec");
    if (r.type === "nsec") {
      expect(r.private_key_hex).toBe(
        "0202020202020202020202020202020202020202020202020202020202020202",
      );
    }
  });

  it("encodes naddr with all required fields", () => {
    const naddr = encode({
      type: "naddr",
      identifier: "my-stall",
      pubkey_hex: LLMOPS_HEX,
      kind: 30017,
      relays: ["wss://relay.example.com"],
    });
    expect(naddr).toMatch(/^naddr1/);
    const decoded = decode(naddr, { allowNsecDecode: false });
    expect(decoded.type).toBe("naddr");
    if (decoded.type === "naddr") {
      expect(decoded.identifier).toBe("my-stall");
      expect(decoded.pubkey_hex).toBe(LLMOPS_HEX);
      expect(decoded.kind).toBe(30017);
    }
  });
});
