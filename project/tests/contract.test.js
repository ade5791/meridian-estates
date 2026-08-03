// Event-contract conformance:
// 1. vocabulary.js matches the table in ARCHITECTURE.md exactly.
// 2. Every event emitted during seeded AI games matches the declared payload
//    keys exactly (no missing keys, no undeclared keys, no undeclared events).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EVENTS } from '../src/core/vocabulary.js';
import { EventBus } from '../src/core/bus.js';
import { Engine } from '../src/rules/engine.js';
import { aiStep } from '../src/game/ai.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArchitectureTable() {
  const md = readFileSync(join(root, 'ARCHITECTURE.md'), 'utf8');
  const lines = md.split('\n');
  const out = {};
  let inTable = false;
  for (const line of lines) {
    if (/^\|\s*event\s*\|/.test(line)) { inTable = true; continue; }
    if (inTable) {
      if (/^\|\s*---/.test(line)) continue;
      const m = line.match(/^\|\s*([a-z:]+)\s*\|\s*(.+?)\s*\|/);
      if (!m) { if (line.trim() === '' || !line.startsWith('|')) inTable = false; continue; }
      out[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

describe('event contract', () => {
  it('vocabulary.js matches the ARCHITECTURE.md table exactly', () => {
    const doc = parseArchitectureTable();
    expect(Object.keys(doc).length).toBeGreaterThan(20);
    expect(Object.keys(doc).sort()).toEqual(Object.keys(EVENTS).sort());
    for (const ev of Object.keys(doc)) {
      expect(EVENTS[ev].slice().sort(), `payload keys for ${ev}`).toEqual(doc[ev].slice().sort());
    }
  });

  it('every event emitted in seeded AI games conforms to the vocabulary', () => {
    const violations = [];
    for (const seed of [1, 7, 99]) {
      const bus = new EventBus();
      bus.onAny((event, payload) => {
        if (!EVENTS[event]) { violations.push(`${seed}: undeclared event ${event}`); return; }
        const declared = EVENTS[event].slice().sort();
        const actual = Object.keys(payload || {}).sort();
        if (JSON.stringify(declared) !== JSON.stringify(actual)) {
          violations.push(`${seed}: ${event} keys [${actual}] != declared [${declared}]`);
        }
      });
      const eng = new Engine(bus);
      eng.newGame({
        seed,
        players: [
          { name: 'A', ai: true }, { name: 'B', ai: true },
          { name: 'C', ai: true }, { name: 'D', ai: true },
        ],
      });
      let steps = 0;
      while (eng.state.phase !== 'gameOver' && steps++ < 60000) {
        if (!aiStep(eng)) break;
      }
      expect(eng.state.phase).toBe('gameOver');
    }
    expect(violations).toEqual([]);
  });
});
