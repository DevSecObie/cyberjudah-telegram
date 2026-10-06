import { test } from "node:test";
import assert from "node:assert/strict";
import { imageKey } from "../src/images.mjs";

test("portraits and Timeline paintings map to images/ in R2", () => {
  assert.equal(imageKey("people/moses-exo-2-10-128.webp"), "images/people/moses-exo-2-10-128.webp");
  assert.equal(imageKey("people/jesus-isa-7-14-256.webp"), "images/people/jesus-isa-7-14-256.webp");
  assert.equal(imageKey("timeline/periods/divided-kingdom.webp"), "images/timeline/periods/divided-kingdom.webp");
  assert.equal(imageKey("timeline/leaders/bishop-nathanyel-128.webp"), "images/timeline/leaders/bishop-nathanyel-128.webp");
  assert.equal(imageKey("timeline/leaders/bishop-nathanyel-512.webp"), "images/timeline/leaders/bishop-nathanyel-512.webp");
});

test("nothing else in the bucket can be read through /api/img/", () => {
  for (const p of ["recordings/catalog.json", "photos/x.webp", "people/moses-64.webp", "people/../recordings/a.webp", "people/Moses-128.webp", "people/moses-128.png", "images/people/moses-128.webp", "", "people/moses-128.webp/x"]) {
    assert.equal(imageKey(p), null, p);
  }
});
