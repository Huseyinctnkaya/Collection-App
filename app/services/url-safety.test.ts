import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isPrivateAddress, validateFetchUrl } from "./url-safety.ts";

describe("validateFetchUrl", () => {
  test("accepts a normal https file URL", () => {
    const result = validateFetchUrl("https://cdn.example.com/feed/products.csv");
    assert.equal(result.ok, true);
  });

  test("accepts an explicit :443", () => {
    assert.equal(validateFetchUrl("https://example.com:443/a.csv").ok, true);
  });

  test("rejects http, which a redirect could also downgrade to", () => {
    const result = validateFetchUrl("http://example.com/a.csv");
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /https/);
  });

  test("rejects other schemes", () => {
    for (const raw of ["file:///etc/passwd", "ftp://example.com/a.csv", "gopher://x"]) {
      assert.equal(validateFetchUrl(raw).ok, false, raw);
    }
  });

  test("rejects a non-standard port", () => {
    // Port scanning is the other thing an unrestricted fetcher is good for.
    assert.equal(validateFetchUrl("https://example.com:8080/a.csv").ok, false);
    assert.equal(validateFetchUrl("https://example.com:22/a.csv").ok, false);
  });

  test("rejects localhost by name", () => {
    assert.equal(validateFetchUrl("https://localhost/a.csv").ok, false);
    assert.equal(validateFetchUrl("https://api.localhost/a.csv").ok, false);
  });

  test("rejects nonsense", () => {
    assert.equal(validateFetchUrl("not a url").ok, false);
    assert.equal(validateFetchUrl("").ok, false);
  });
});

describe("isPrivateAddress", () => {
  test("blocks cloud instance metadata", () => {
    // The address this whole check exists for.
    assert.equal(isPrivateAddress("169.254.169.254"), true);
  });

  test("blocks loopback and private ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "0.0.0.0",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  test("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"]) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  test("blocks private IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "fec0::1"]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  test("allows public IPv6", () => {
    assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
    assert.equal(isPrivateAddress("2a00:1450:4001:c1f::64"), false);
  });

  test("sees through IPv4-mapped IPv6", () => {
    // ::ffff:127.0.0.1 reaches loopback just as surely as 127.0.0.1 does.
    assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
    assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  });

  test("treats anything unparseable as private", () => {
    // Failing closed: an address we cannot classify is one we do not fetch.
    for (const ip of ["", "   ", "not-an-ip", "1.2.3", "1.2.3.4.5", "999.1.1.1"]) {
      assert.equal(isPrivateAddress(ip), true, JSON.stringify(ip));
    }
  });
});
