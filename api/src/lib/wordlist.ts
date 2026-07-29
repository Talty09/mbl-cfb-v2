/**
 * Wordlist for commissioner-issued passphrases.
 *
 * Exactly 256 words, which is the point: one byte from `getRandomValues` maps
 * to exactly one word, so there is no modulo bias to reason about and the
 * entropy is exactly 8 bits per word. Six words = 48 bits.
 *
 * Words are short, concrete, and free of homophones and ambiguous spellings,
 * because these get typed once from a Facebook message.
 */
export const WORDLIST = [
  'amber', 'anchor', 'apple', 'arbor', 'arrow', 'aspen', 'atlas', 'axiom',
  'bacon', 'badge', 'bagel', 'baker', 'balsa', 'banjo', 'barge', 'basin',
  'batch', 'beach', 'beacon', 'beaker', 'bench', 'berry', 'birch', 'bishop',
  'bison', 'blade', 'blaze', 'bloom', 'board', 'bolt', 'bonus', 'boulder',
  'brass', 'bread', 'brick', 'bridge', 'bronze', 'brook', 'brush', 'buckle',
  'bundle', 'burrow', 'butter', 'cabin', 'cable', 'cactus', 'camber', 'candle',
  'canoe', 'canvas', 'canyon', 'carbon', 'cargo', 'carrot', 'castle', 'cedar',
  'cellar', 'chalk', 'charm', 'cheese', 'cherry', 'chess', 'chime', 'cinder',
  'cider', 'circus', 'citrus', 'clamp', 'clasp', 'clay', 'cliff', 'cloak',
  'clover', 'cobalt', 'cocoa', 'comet', 'copper', 'coral', 'cotton', 'cougar',
  'cove', 'crane', 'crate', 'crayon', 'creek', 'crest', 'cricket', 'crown',
  'crystal', 'cubit', 'curl', 'cypress', 'dagger', 'dahlia', 'daisy', 'dapple',
  'dawn', 'delta', 'denim', 'depot', 'desert', 'diesel', 'dime', 'dingo',
  'ditch', 'dock', 'dogwood', 'dollar', 'domain', 'donut', 'dove', 'dragon',
  'drift', 'drum', 'dune', 'dusk', 'eagle', 'earth', 'easel', 'ebony',
  'echo', 'elder', 'ember', 'emerald', 'ermine', 'ether', 'fable', 'falcon',
  'fern', 'ferry', 'fiber', 'fiddle', 'finch', 'flame', 'flask', 'fleece',
  'flint', 'float', 'flour', 'flute', 'foam', 'forge', 'fossil', 'fountain',
  'fox', 'frost', 'fuel', 'gable', 'gadget', 'galley', 'garnet', 'gate',
  'gavel', 'gecko', 'ginger', 'glacier', 'glade', 'glide', 'globe', 'glove',
  'gopher', 'granite', 'gravel', 'grove', 'guitar', 'gulf', 'gully', 'gusto',
  'hammer', 'harbor', 'harvest', 'hazel', 'heather', 'hedge', 'helm', 'hickory',
  'hollow', 'honey', 'hoop', 'hornet', 'hostel', 'hunter', 'hurdle', 'husk',
  'igloo', 'indigo', 'ingot', 'inlet', 'iris', 'ivory', 'jacket', 'jasper',
  'jetty', 'jewel', 'jungle', 'juniper', 'kayak', 'kelp', 'kernel', 'kettle',
  'keystone', 'kindle', 'kite', 'knoll', 'lagoon', 'lance', 'lantern', 'lapis',
  'larch', 'lattice', 'lava', 'ledge', 'legend', 'lemon', 'lentil', 'lever',
  'lichen', 'lilac', 'linen', 'lobby', 'locket', 'lotus', 'lumber', 'lunar',
  'lupine', 'lyric', 'magnet', 'mahogany', 'mallet', 'mango', 'maple', 'marble',
  'marlin', 'marsh', 'meadow', 'medal', 'melon', 'mesa', 'meteor', 'mica',
  'mingle', 'mint', 'mirror', 'mitten', 'moat', 'mocha', 'molten', 'monsoon',
  'moose', 'mortar', 'mosaic', 'moss', 'motel', 'mulberry', 'mural', 'muzzle',
] as const;

/**
 * The zero-bias property above depends on the list being exactly 256 unique
 * words, so assert it at module load rather than trusting the literal.
 */
if (WORDLIST.length !== 256) {
  throw new Error(`Wordlist must be exactly 256 words, got ${WORDLIST.length}`);
}
if (new Set(WORDLIST).size !== WORDLIST.length) {
  throw new Error('Wordlist contains duplicates, which would skew entropy');
}

/** Bits of entropy contributed by each word. */
export const BITS_PER_WORD = 8;
