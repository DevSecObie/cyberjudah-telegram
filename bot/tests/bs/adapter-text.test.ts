import assert from 'node:assert/strict';
import test from 'node:test';
import { passageLink } from '../../src/bs/core.ts';
import { strongGloss, strongText } from '../../src/bs/strongs.ts';

// Open Scriptures' fields as published, including their leading spaces.
const G2316 = { derivation: 'of uncertain affinity; a deity, especially (with G3588 (ὁ)) the supreme Divinity;', def: ' figuratively, a magistrate; by Hebraism, very', kjv: 'X exceeding, God, god(-ly, -ward)' };
const G2983 = { derivation: 'a prolonged form of a primary verb, which is use only as an alternate in certain tenses; to take (in very many applications, literally and figuratively (properly objective or active, to get hold of; whereas G1209 (δέχομαι) is rather subjective or passive, to have offered to one;', def: ' while G138 (αἱρέομαι) is more violent, to seize or remove))', kjv: 'accept' };

test('Strong text reads in Strong’s own order and the gloss keeps the start of the definition', () => {
  assert.equal(strongText(G2316), 'of uncertain affinity; a deity, especially (with G3588 (ὁ)) the supreme Divinity; figuratively, a magistrate; by Hebraism, very');
  assert.equal(strongGloss('G2316', G2316), 'a deity, especially (with G3588 (ὁ)) the supreme Divinity; figuratively, a magistrate; by Hebraism, very');
  assert.match(strongGloss('G2983', G2983), /^to take \(in very many applications/);
  assert.equal(strongGloss('G1615', { derivation: 'from G1537 (ἐκ) and G5055 (τελέω);', def: ' to complete fully', kjv: 'finish' }), 'to complete fully');
  assert.equal(strongGloss('G2022', { derivation: 'from G1909 (ἐπί) and (to pour);', def: ' ', kjv: '--to pour upon:--pour in' }), '--to pour upon:--pour in');
  // Hebrew derivations carry name meanings, which stay out of the gloss.
  assert.equal(strongGloss('H22', { derivation: 'from H1 (אָב) and H410 (אֵל); father (i.e. possessor) of God;', def: 'Abiel, the name of two Israelites', kjv: 'Abiel.' }), 'Abiel, the name of two Israelites');
});

test('precept links open every verse they name in the app reader', () => {
  assert.equal(passageLink({ verses: '6-18', label: 'Job 20:6-18', url: '/bible/job/20#v6' }), '<a href="bible://Job.20.6-Job.20.18">Job 20:6-18</a>');
  assert.equal(passageLink({ verses: '46', label: 'Lamentations 3:46', url: '/bible/lamentations/3#v46' }), '<a href="bible://Lam.3.46">Lamentations 3:46</a>');
  assert.equal(passageLink({ verses: '', label: 'Luke 18', url: '/bible/luke/18' }), '<a href="bible://Luke.18">Luke 18</a>');
  assert.equal(passageLink({ verses: '1,3-4', label: 'Psalms 1:1, 3-4', url: '/bible/psalms/1#v1' }), '<a href="bible://Ps.1.1,Ps.1.3-Ps.1.4">Psalms 1:1, 3-4</a>');
  assert.equal(passageLink({ verses: '4-6', label: 'Rest of Esther 10:4-6', url: '/bible/esther-greek/10#v4' }), '<a href="bible://GkEsth.10.4-GkEsth.10.6">Rest of Esther 10:4-6</a>');
  assert.equal(passageLink({ verses: '3', label: '2 Maccabees 7:3', url: '/bible/2-maccabees/7#v3' }), '<a href="bible://2Macc.7.3">2 Maccabees 7:3</a>');
  // Anything unexpected keeps the site link rather than guessing a passage.
  assert.equal(passageLink({ verses: '6-10:2', label: 'Isaiah 9:6-10:2', url: '/bible/isaiah/9#v6' }), '<a href="https://cyberjudah.io/bible/isaiah/9#v6">Isaiah 9:6-10:2</a>');
  assert.equal(passageLink({ verses: '1', label: 'x', url: '/bible/unknown/1' }), '<a href="https://cyberjudah.io/bible/unknown/1">x</a>');
});
