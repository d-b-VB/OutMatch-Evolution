import assert from "node:assert/strict";
import test from "node:test";
import { BREEDING_PRNG_VERSION, SplitMix64 } from "../../src/evolution/prng.js";

test("SplitMix64 matches canonical seed-zero vectors", () => {
  const random = new SplitMix64("0");
  assert.equal(random.version, BREEDING_PRNG_VERSION);
  assert.deepEqual(Array.from({ length: 5 }, () => random.nextUint64().toString(16).padStart(16, "0")), [
    "e220a8397b1dcdaf",
    "6e789e6aa1b965f4",
    "06c45d188009454f",
    "f88bb8a8724c81ec",
    "1b39896a51a8749b"
  ]);
});

test("R29 historical breeding seed has a frozen reproducible sequence", () => {
  const first = new SplitMix64("202608231655");
  const second = new SplitMix64("202608231655");
  const values = Array.from({ length: 4 }, () => first.nextUint64());
  assert.deepEqual(values, Array.from({ length: 4 }, () => second.nextUint64()));
  assert.deepEqual(values.map(value => value.toString(16).padStart(16, "0")), [
    "99a1d0bec96a7346", "7b62655e6961fce6", "c64020b2c42cda43", "f264976ba284fe06"
  ]);
});

test("unit-interval samples are deterministic and remain below one", () => {
  const first = new SplitMix64("42");
  const second = new SplitMix64("42");
  const values = Array.from({ length: 1_000 }, () => first.nextFloat());
  assert.ok(values.every(value => value >= 0 && value < 1));
  assert.deepEqual(values, Array.from({ length: 1_000 }, () => second.nextFloat()));
  assert.throws(() => new SplitMix64("-1"), /unsigned decimal/);
  assert.throws(() => new SplitMix64("18446744073709551616"), /exceeds 64 bits/);
});

test("bounded integers and continuous ranges are deterministic and validated", () => {
  const integers = new SplitMix64("9");
  assert.deepEqual(Array.from({ length: 8 }, () => integers.nextInteger(7)), [2, 2, 6, 0, 5, 1, 6, 3]);
  const ranges = new SplitMix64("9");
  const values = Array.from({ length: 20 }, () => ranges.nextRange(-2, 3));
  assert.ok(values.every(value => value >= -2 && value < 3));
  assert.equal(ranges.nextRange(4, 4), 4);
  assert.throws(() => integers.nextInteger(0), /positive safe integer/);
  assert.throws(() => ranges.nextRange(2, 1), /ascending bounds/);
});
