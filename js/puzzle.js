// Puzzle generation. Everything is driven by a numeric seed so that both
// players build the exact same cryptogram from the same (quoteIndex, seed).
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// A substitution alphabet where no letter stands for itself.
function derangement(rng) {
  for (;;) {
    const a = shuffle(ALPHA.split(""), rng);
    if (a.every((c, i) => c !== ALPHA[i])) return a;
  }
}

function normalize(text) {
  return text
    .toUpperCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}

function buildPuzzle(quoteIndex, seed) {
  const q = QUOTES[quoteIndex];
  const rng = mulberry32(seed);
  const perm = derangement(rng);
  const enc = {}, sol = {};
  ALPHA.split("").forEach((p, i) => { enc[p] = perm[i]; sol[perm[i]] = p; });

  const plain = normalize(q.text);
  const cipherText = [...plain].map((ch) => enc[ch] || ch).join("");
  const letters = [...new Set([...cipherText].filter((ch) => sol[ch]))];

  return { quoteIndex, seed, plain, author: q.author, cipherText, sol, letters };
}
