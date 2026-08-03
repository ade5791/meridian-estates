// Meridian Estates board data. ALL names original (no Hasbro IP).
// 40 tiles, 8 color groups, 4 transit lines, 2 utilities, 2 tax tiles,
// 2 card decks (Fortune / Ledger), 4 corners.
// Rent arrays: [base, 1h, 2h, 3h, 4h, hotel].

export const GROUP_COLORS = {
  harbor:  0x6b4f2a,
  grove:   0x9ad1e8,
  midtown: 0xc85c8e,
  foundry: 0xe8862a,
  arts:    0xd23b3b,
  uptown:  0xe8d23b,
  summit:  0x3bab5a,
  crown:   0x2d4b9a,
};

export const TILES = [
  { id: 0,  type: 'start',   name: 'Launch Point' },
  { id: 1,  type: 'prop',    name: 'Dockside Row',      group: 'harbor',  price: 60,  house: 50,  rent: [2, 10, 30, 90, 160, 250] },
  { id: 2,  type: 'card',    name: 'Fortune',           deck: 'fortune' },
  { id: 3,  type: 'prop',    name: 'Wharf Lane',        group: 'harbor',  price: 60,  house: 50,  rent: [4, 20, 60, 180, 320, 450] },
  { id: 4,  type: 'tax',     name: 'Levy Office',       amount: 200 },
  { id: 5,  type: 'rail',    name: 'North Meridian Line', price: 200 },
  { id: 6,  type: 'prop',    name: 'Cedar Grove Ave',   group: 'grove',   price: 100, house: 50,  rent: [6, 30, 90, 270, 400, 550] },
  { id: 7,  type: 'card',    name: 'Ledger',            deck: 'ledger' },
  { id: 8,  type: 'prop',    name: 'Willow Bend',       group: 'grove',   price: 100, house: 50,  rent: [6, 30, 90, 270, 400, 550] },
  { id: 9,  type: 'prop',    name: 'Maple Hollow',      group: 'grove',   price: 120, house: 50,  rent: [8, 40, 100, 300, 450, 600] },
  { id: 10, type: 'jail',    name: 'Holding House' },
  { id: 11, type: 'prop',    name: 'Rosetta Street',    group: 'midtown', price: 140, house: 100, rent: [10, 50, 150, 450, 625, 750] },
  { id: 12, type: 'util',    name: 'Meridian Power Co', price: 150 },
  { id: 13, type: 'prop',    name: 'Vermeer Court',     group: 'midtown', price: 140, house: 100, rent: [10, 50, 150, 450, 625, 750] },
  { id: 14, type: 'prop',    name: 'Calliope Plaza',    group: 'midtown', price: 160, house: 100, rent: [12, 60, 180, 500, 700, 900] },
  { id: 15, type: 'rail',    name: 'East Meridian Line', price: 200 },
  { id: 16, type: 'prop',    name: 'Foundry Walk',      group: 'foundry', price: 180, house: 100, rent: [14, 70, 200, 550, 750, 950] },
  { id: 17, type: 'card',    name: 'Fortune',           deck: 'fortune' },
  { id: 18, type: 'prop',    name: 'Anvil Street',      group: 'foundry', price: 180, house: 100, rent: [14, 70, 200, 550, 750, 950] },
  { id: 19, type: 'prop',    name: 'Bessemer Yard',     group: 'foundry', price: 200, house: 100, rent: [16, 80, 220, 600, 800, 1000] },
  { id: 20, type: 'parking', name: 'Overlook Commons' },
  { id: 21, type: 'prop',    name: 'Gallery Row',       group: 'arts',    price: 220, house: 150, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 22, type: 'card',    name: 'Ledger',            deck: 'ledger' },
  { id: 23, type: 'prop',    name: 'Mural Avenue',      group: 'arts',    price: 220, house: 150, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 24, type: 'prop',    name: 'Soundstage Blvd',   group: 'arts',    price: 240, house: 150, rent: [20, 100, 300, 750, 925, 1100] },
  { id: 25, type: 'rail',    name: 'South Meridian Line', price: 200 },
  { id: 26, type: 'prop',    name: 'Beacon Heights',    group: 'uptown',  price: 260, house: 150, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 27, type: 'prop',    name: 'Larkspur Terrace',  group: 'uptown',  price: 260, house: 150, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 28, type: 'util',    name: 'Aqua Meridian Works', price: 150 },
  { id: 29, type: 'prop',    name: 'Pinnacle Drive',    group: 'uptown',  price: 280, house: 150, rent: [24, 120, 360, 850, 1025, 1200] },
  { id: 30, type: 'gotojail', name: 'Court Summons' },
  { id: 31, type: 'prop',    name: 'Summit Ridge',      group: 'summit',  price: 300, house: 200, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 32, type: 'prop',    name: 'Aurora Crest',      group: 'summit',  price: 300, house: 200, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 33, type: 'card',    name: 'Fortune',           deck: 'fortune' },
  { id: 34, type: 'prop',    name: 'Zenith Point',      group: 'summit',  price: 320, house: 200, rent: [28, 150, 450, 1000, 1200, 1400] },
  { id: 35, type: 'rail',    name: 'West Meridian Line', price: 200 },
  { id: 36, type: 'card',    name: 'Ledger',            deck: 'ledger' },
  { id: 37, type: 'prop',    name: 'Regent Parade',     group: 'crown',   price: 350, house: 200, rent: [35, 175, 500, 1100, 1300, 1500] },
  { id: 38, type: 'tax',     name: 'Grand Assessment',  amount: 100 },
  { id: 39, type: 'prop',    name: 'Crown Meridian',    group: 'crown',   price: 400, house: 200, rent: [50, 200, 600, 1400, 1700, 2000] },
];

export const GROUPS = {};
for (const t of TILES) {
  if (t.type === 'prop') (GROUPS[t.group] = GROUPS[t.group] || []).push(t.id);
}
export const RAILS = TILES.filter((t) => t.type === 'rail').map((t) => t.id);
export const UTILS = TILES.filter((t) => t.type === 'util').map((t) => t.id);

// Card decks - all original text. Effects are data-driven.
export const FORTUNE_CARDS = [
  { id: 'f01', text: 'Tailwind at the docks. Advance to Launch Point and collect 200.', fx: { goto: 0 } },
  { id: 'f02', text: 'Zoning windfall. Collect 150 from the bank.', fx: { cash: 150 } },
  { id: 'f03', text: 'Advance to Crown Meridian.', fx: { goto: 39 } },
  { id: 'f04', text: 'Advance to Rosetta Street. If unowned, you may buy it.', fx: { goto: 11 } },
  { id: 'f05', text: 'Ride the nearest Meridian Line. Advance to the next transit stop.', fx: { nearestRail: true } },
  { id: 'f06', text: 'Street repairs: pay 25 per house and 100 per hotel you own.', fx: { repairs: [25, 100] } },
  { id: 'f07', text: 'Go back three spaces.', fx: { move: -3 } },
  { id: 'f08', text: 'Court summons. Go directly to the Holding House.', fx: { jail: true } },
  { id: 'f09', text: 'Release writ. Keep this card to leave the Holding House free.', fx: { jailFree: true } },
  { id: 'f10', text: 'Speeding fine on Pinnacle Drive. Pay 15.', fx: { cash: -15 } },
  { id: 'f11', text: 'Dividend from Meridian Holdings. Collect 50.', fx: { cash: 50 } },
  { id: 'f12', text: 'You are elected block steward. Pay each player 50.', fx: { payEach: 50 } },
];

export const LEDGER_CARDS = [
  { id: 'l01', text: 'Ledger error in your favor. Collect 200.', fx: { cash: 200 } },
  { id: 'l02', text: 'Clinic bill. Pay 50.', fx: { cash: -50 } },
  { id: 'l03', text: 'Advance to Launch Point and collect 200.', fx: { goto: 0 } },
  { id: 'l04', text: 'Annual audit refund. Collect 20.', fx: { cash: 20 } },
  { id: 'l05', text: 'It is your founding day. Collect 10 from each player.', fx: { collectEach: 10 } },
  { id: 'l06', text: 'Insurance premium due. Pay 100.', fx: { cash: -100 } },
  { id: 'l07', text: 'Release writ. Keep this card to leave the Holding House free.', fx: { jailFree: true } },
  { id: 'l08', text: 'Court summons. Go directly to the Holding House.', fx: { jail: true } },
  { id: 'l09', text: 'Civic assessment: pay 40 per house and 115 per hotel.', fx: { repairs: [40, 115] } },
  { id: 'l10', text: 'Consulting fee. Collect 25.', fx: { cash: 25 } },
  { id: 'l11', text: 'Second prize in the harvest fair. Collect 10.', fx: { cash: 10 } },
  { id: 'l12', text: 'Inheritance from a distant cousin. Collect 100.', fx: { cash: 100 } },
];
