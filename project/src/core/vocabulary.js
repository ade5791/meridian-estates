// Event vocabulary - MUST match the table in ARCHITECTURE.md exactly.
// The contract conformance test parses ARCHITECTURE.md and diffs against this
// object AND against every event actually emitted during seeded games.

export const EVENTS = {
  'turn:begin':        ['player', 'round'],
  'dice:rolled':       ['player', 'd1', 'd2', 'doubles', 'doubleCount'],
  'token:moved':       ['player', 'from', 'to', 'path', 'passedStart'],
  'tile:landed':       ['player', 'tile'],
  'offer:buy':         ['player', 'tile', 'price'],
  'property:bought':   ['player', 'tile', 'price'],
  'auction:started':   ['tile', 'bidders'],
  'auction:won':       ['tile', 'player', 'price'],
  'auction:passed':    ['tile'],
  'rent:paid':         ['from', 'to', 'tile', 'amount'],
  'card:drawn':        ['player', 'deck', 'cardId', 'text'],
  'tax:paid':          ['player', 'tile', 'amount'],
  'jail:entered':      ['player', 'reason'],
  'jail:exited':       ['player', 'method'],
  'build:changed':     ['player', 'tile', 'houses'],
  'mortgage:changed':  ['player', 'tile', 'mortgaged'],
  'trade:proposed':    ['from', 'to', 'give', 'get'],
  'trade:resolved':    ['from', 'to', 'accepted'],
  'cash:changed':      ['player', 'delta', 'balance', 'reason'],
  'player:bankrupt':   ['player', 'creditor'],
  'turn:end':          ['player'],
  'game:over':         ['winner', 'reason', 'rounds'],
  'state:loaded':      ['source'],
  'pending:changed':   ['pending'],
  'phase:changed':     ['phase', 'player'],
};
