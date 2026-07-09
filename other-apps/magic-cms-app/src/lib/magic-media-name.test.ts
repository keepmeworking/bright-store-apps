import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildMagicMediaFileName, isMagicMediaFileName, MAGIC_MEDIA_NAME_PREFIX } from "./magic-media-name.ts";

test("builds fixed bymagic-media-daikcell-india filenames", () => {
  const result = buildMagicMediaFileName("k9x2m1ab01");
  assert.equal(result.id, "k9x2m1ab01");
  assert.equal(result.fileName, "bymagic-media-daikcell-india-k9x2m1ab01.webp");
  assert.equal(result.fileName.startsWith(`${MAGIC_MEDIA_NAME_PREFIX}-`), true);
});

test("never uses original upload names", () => {
  const a = buildMagicMediaFileName("abc1234567");
  const b = buildMagicMediaFileName("xyz9876543");
  assert.notEqual(a.fileName, b.fileName);
  assert.match(a.fileName, /^bymagic-media-daikcell-india-[a-z0-9]+\.webp$/);
});

test("validates magic media filenames", () => {
  assert.equal(isMagicMediaFileName("bymagic-media-daikcell-india-abc1234567.webp"), true);
  assert.equal(isMagicMediaFileName("bymagic-media-my-photo_abc.webp"), false);
  assert.equal(isMagicMediaFileName("hero.png"), false);
});
