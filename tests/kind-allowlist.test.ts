import { describe, expect, it } from "vitest";
import { KindAllowlist } from "../src/safety/kind-allowlist.js";

describe("KindAllowlist", () => {
  it("denies everything when empty", () => {
    const a = new KindAllowlist([]);
    expect(a.isAllowed(1)).toBe(false);
    expect(a.check(1).ok).toBe(false);
  });

  it("allows configured kinds, denies others", () => {
    const a = new KindAllowlist([1, 30017, 30018]);
    expect(a.isAllowed(1)).toBe(true);
    expect(a.isAllowed(30017)).toBe(true);
    expect(a.isAllowed(0)).toBe(false);
    expect(a.isAllowed(5)).toBe(false);
  });

  it("check() returns a structured error with the allowed list", () => {
    const a = new KindAllowlist([1, 4]);
    const r = a.check(0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/kind 0/);
      expect(r.reason).toMatch(/NOSTR_ALLOWED_KINDS/);
    }
  });

  it("entries() returns kinds sorted", () => {
    const a = new KindAllowlist([30018, 1, 30017, 4]);
    expect(a.entries).toEqual([1, 4, 30017, 30018]);
  });
});
