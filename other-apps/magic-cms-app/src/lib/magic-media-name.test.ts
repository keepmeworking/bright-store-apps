import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildMagicMediaFileName, slugifyMediaBaseName } from "./magic-media-name.ts";

test("slugifies messy upload names", () => {
  assert.equal(slugifyMediaBaseName("My Photo (1).PNG"), "my-photo-1");
  assert.equal(slugifyMediaBaseName("  Hello___World!!  "), "hello-world");
});

test("builds bymagic-media cleaned filenames", () => {
  const result = buildMagicMediaFileName("My Photo (1).PNG", "k9x2m1ab");
  assert.equal(result.id, "k9x2m1ab");
  assert.equal(result.fileName, "bymagic-media-my-photo-1_k9x2m1ab.webp");
});

test("falls back when name is empty", () => {
  const result = buildMagicMediaFileName("!!!", "abc12345");
  assert.equal(result.fileName, "bymagic-media-image_abc12345.webp");
});
