// Thin facade over nostr-tools NIP-19 encode/decode so tool implementations
// don't need to know the library's exact module layout.

import { nip19 } from "nostr-tools";

export type DecodeResult =
  | { type: "npub"; pubkey_hex: string }
  | { type: "nsec"; private_key_hex?: string; warning: string }
  | { type: "note"; event_id_hex: string }
  | {
      type: "nevent";
      event_id_hex: string;
      author_hex?: string;
      relays?: string[];
      kind?: number;
    }
  | {
      type: "naddr";
      identifier: string;
      pubkey_hex: string;
      kind: number;
      relays?: string[];
    }
  | { type: "nprofile"; pubkey_hex: string; relays?: string[] };

export function decode(bech32: string, opts: { allowNsecDecode: boolean }): DecodeResult {
  const raw = nip19.decode(bech32);
  switch (raw.type) {
    case "npub":
      return { type: "npub", pubkey_hex: raw.data };
    case "nsec": {
      const warning =
        "nsec decoded — DO NOT log, return, or share this value. NOSTR_ALLOW_NSEC_DECODE protects against accidental key disclosure.";
      if (!opts.allowNsecDecode) {
        return { type: "nsec", warning };
      }
      // nostr-tools returns the private key as Uint8Array — convert to hex.
      const hex = Buffer.from(raw.data).toString("hex");
      return { type: "nsec", private_key_hex: hex, warning };
    }
    case "note":
      return { type: "note", event_id_hex: raw.data };
    case "nevent":
      return {
        type: "nevent",
        event_id_hex: raw.data.id,
        author_hex: raw.data.author,
        relays: raw.data.relays,
        kind: raw.data.kind,
      };
    case "naddr":
      return {
        type: "naddr",
        identifier: raw.data.identifier,
        pubkey_hex: raw.data.pubkey,
        kind: raw.data.kind,
        relays: raw.data.relays,
      };
    case "nprofile":
      return {
        type: "nprofile",
        pubkey_hex: raw.data.pubkey,
        relays: raw.data.relays,
      };
    default:
      throw new Error(`unsupported NIP-19 type: ${(raw as { type: string }).type}`);
  }
}

export type EncodeInput =
  | { type: "npub"; pubkey_hex: string }
  | { type: "note"; event_id_hex: string }
  | { type: "nevent"; event_id_hex: string; author_hex?: string; relays?: string[]; kind?: number }
  | { type: "naddr"; identifier: string; pubkey_hex: string; kind: number; relays?: string[] }
  | { type: "nprofile"; pubkey_hex: string; relays?: string[] };

export function encode(input: EncodeInput): string {
  switch (input.type) {
    case "npub":
      return nip19.npubEncode(input.pubkey_hex);
    case "note":
      return nip19.noteEncode(input.event_id_hex);
    case "nevent":
      return nip19.neventEncode({
        id: input.event_id_hex,
        author: input.author_hex,
        relays: input.relays,
        kind: input.kind,
      });
    case "naddr":
      return nip19.naddrEncode({
        identifier: input.identifier,
        pubkey: input.pubkey_hex,
        kind: input.kind,
        relays: input.relays,
      });
    case "nprofile":
      return nip19.nprofileEncode({
        pubkey: input.pubkey_hex,
        relays: input.relays,
      });
  }
}

export function npubFromHex(pubkey_hex: string): string {
  return nip19.npubEncode(pubkey_hex);
}
