#!/usr/bin/env python3
"""Build js/quotes.js: hand-picked quotations plus excerpts from public-domain
books on Project Gutenberg.

Every entry is 10-40 words. Excerpts are whole sentences, filtered so they read
well on their own and make solvable cryptograms. Run from the repo root:

    python3 tools/build_quotes.py            # downloads books into .cache/
    python3 tools/build_quotes.py --total 5000
"""
import argparse
import hashlib
import json
import os
import random
import re
import time
import unicodedata
import urllib.request

# (Gutenberg id, author, title). Titles are checked against each file's header.
BOOKS = [
    (1342, "Jane Austen", "Pride and Prejudice"),
    (158, "Jane Austen", "Emma"),
    (161, "Jane Austen", "Sense and Sensibility"),
    (105, "Jane Austen", "Persuasion"),
    (2701, "Herman Melville", "Moby Dick"),
    (98, "Charles Dickens", "A Tale of Two Cities"),
    (1400, "Charles Dickens", "Great Expectations"),
    (46, "Charles Dickens", "A Christmas Carol"),
    (730, "Charles Dickens", "Oliver Twist"),
    (766, "Charles Dickens", "David Copperfield"),
    (1661, "Arthur Conan Doyle", "The Adventures of Sherlock Holmes"),
    (2852, "Arthur Conan Doyle", "The Hound of the Baskervilles"),
    (244, "Arthur Conan Doyle", "A Study in Scarlet"),
    (11, "Lewis Carroll", "Alice's Adventures in Wonderland"),
    (12, "Lewis Carroll", "Through the Looking-Glass"),
    (84, "Mary Shelley", "Frankenstein"),
    (345, "Bram Stoker", "Dracula"),
    (205, "Henry David Thoreau", "Walden"),
    (74, "Mark Twain", "The Adventures of Tom Sawyer"),
    (86, "Mark Twain", "A Connecticut Yankee in King Arthur's Court"),
    (174, "Oscar Wilde", "The Picture of Dorian Gray"),
    (844, "Oscar Wilde", "The Importance of Being Earnest"),
    (1260, "Charlotte Bronte", "Jane Eyre"),
    (768, "Emily Bronte", "Wuthering Heights"),
    (64317, "F. Scott Fitzgerald", "The Great Gatsby"),
    (2600, "Leo Tolstoy", "War and Peace"),
    (1399, "Leo Tolstoy", "Anna Karenina"),
    (2554, "Fyodor Dostoyevsky", "Crime and Punishment"),
    (28054, "Fyodor Dostoyevsky", "The Brothers Karamazov"),
    (135, "Victor Hugo", "Les Miserables"),
    (1184, "Alexandre Dumas", "The Count of Monte Cristo"),
    (1257, "Alexandre Dumas", "The Three Musketeers"),
    (120, "Robert Louis Stevenson", "Treasure Island"),
    (43, "Robert Louis Stevenson", "Strange Case of Dr Jekyll and Mr Hyde"),
    (36, "H. G. Wells", "The War of the Worlds"),
    (35, "H. G. Wells", "The Time Machine"),
    (16, "J. M. Barrie", "Peter Pan"),
    (55, "L. Frank Baum", "The Wonderful Wizard of Oz"),
    (514, "Louisa May Alcott", "Little Women"),
    (113, "Frances Hodgson Burnett", "The Secret Garden"),
    (2814, "James Joyce", "Dubliners"),
    (5200, "Franz Kafka", "Metamorphosis"),
    (2680, "Marcus Aurelius", "Meditations"),
    (1497, "Plato", "The Republic"),
    (19942, "Voltaire", "Candide"),
    (996, "Miguel de Cervantes", "Don Quixote"),
    (1727, "Homer", "The Odyssey"),
    (2199, "Homer", "The Iliad"),
    (1232, "Niccolo Machiavelli", "The Prince"),
    (4363, "Friedrich Nietzsche", "Beyond Good and Evil"),
    (5827, "Bertrand Russell", "The Problems of Philosophy"),
    (2944, "Ralph Waldo Emerson", "Essays, First Series"),
    (3600, "Michel de Montaigne", "Essays"),
    (2591, "Brothers Grimm", "Grimms' Fairy Tales"),
    (1952, "Charlotte Perkins Gilman", "The Yellow Wallpaper"),
    (215, "Jack London", "The Call of the Wild"),
    (910, "Jack London", "White Fang"),
    (2148, "Edgar Allan Poe", "The Works of Edgar Allan Poe, Volume 2"),
    (408, "W. E. B. Du Bois", "The Souls of Black Folk"),
    (23, "Frederick Douglass", "Narrative of the Life of Frederick Douglass"),
    (1934, "William Blake", "Songs of Innocence and of Experience"),
    (45, "L. M. Montgomery", "Anne of Green Gables"),
    (160, "Kate Chopin", "The Awakening"),
    (541, "Edith Wharton", "The Age of Innocence"),
    (432, "Henry James", "The Ambassadors"),
    (3207, "Thomas Hobbes", "Leviathan"),
    (3300, "Adam Smith", "The Wealth of Nations"),
    (1228, "Charles Darwin", "On the Origin of Species"),
    (147, "Thomas Paine", "Common Sense"),
    (2130, "Thomas More", "Utopia"),
    (829, "Jonathan Swift", "Gulliver's Travels"),
    (521, "Daniel Defoe", "Robinson Crusoe"),
    (6130, "Homer", "The Iliad (Pope translation)"),
]

# Words that should never appear in a puzzle (slurs and the like).
BLOCKLIST = {
    "nigger", "niggers", "nigga", "negro", "negroes", "darkey", "darkeys", "darky", "coon", "coons",
    "squaw", "squaws", "redskin", "redskins", "savage", "savages", "jew", "jews", "jewess",
    "gypsy", "gypsies", "chinaman", "kaffir", "hottentot", "hottentots", "wench", "whore",
    "whores", "harlot", "bastard", "bastards", "faggot", "queer", "cripple", "idiot", "idiots",
    "lunatic", "lunatics", "retard", "slave", "slaves", "rape", "raped", "ravish", "ravished",
}

ABBREV = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|Messrs|Mme|Mlle|M|Capt|Col|Gen|Lt|Rev|Prof|No|vs|viz|etc|i\.e|e\.g|ch|vol)\.$")
ALLOWED = re.compile(r"^[A-Za-z ,.;:'!?\-—]+$")


def fetch(book_id, cache):
    path = os.path.join(cache, f"pg{book_id}.txt")
    if not os.path.exists(path):
        url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
        req = urllib.request.Request(url, headers={"User-Agent": "aristo-wars-quote-builder"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
        time.sleep(1.0)  # be polite to Gutenberg
    with open(path, "rb") as f:
        return f.read().decode("utf-8", errors="replace")


def body(text):
    start = re.search(r"\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*?\*\*\*", text, re.I | re.S)
    end = re.search(r"\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG", text, re.I)
    return text[start.end() if start else 0: end.start() if end else len(text)]


def title_ok(text, title):
    m = re.search(r"^Title:\s*(.+)$", text, re.M)
    if not m:
        return False
    fold = lambda t: unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    want = re.sub(r"[^a-z]", "", fold(title).split("(")[0])[:12]
    have = re.sub(r"[^a-z]", "", fold(m.group(1)))
    return want[:8] in have


def normalize(s):
    s = (s.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
          .replace("—", "—").replace("--", "—").replace("_", ""))
    return re.sub(r"\s+", " ", s).strip()


def sentences(paragraph):
    # Split after . ! ? (optionally followed by a closing quote), skipping abbreviations.
    out, buf = [], ""
    for piece in re.split(r"(?<=[.!?])\s+(?=[\"'A-Z])", paragraph):
        buf = f"{buf} {piece}".strip() if buf else piece
        if ABBREV.search(buf):
            continue
        out.append(buf)
        buf = ""
    if buf:
        out.append(buf)
    return out


def clean_sentence(s):
    s = s.strip()
    # A whole quoted utterance: drop the outer quotes.
    if s.startswith('"') and s.count('"') == 2 and re.search(r'[.!?]"$', s):
        s = s[1:-1].strip()
    if '"' in s or s.startswith("'") or s.endswith("'"):
        return None
    if not ALLOWED.match(s) or not s[0].isupper() or s[-1] not in ".!?":
        return None
    if s.count("(") != s.count(")"):
        return None
    words = s.split()
    if not 10 <= len(words) <= 40:
        return None
    lower = [re.sub(r"[^a-z]", "", w.lower()) for w in words]
    if any(w in BLOCKLIST for w in lower):
        return None
    if any(len(w) > 1 and w.isupper() and w not in ("I", "O") for w in (re.sub(r"[^A-Za-z]", "", x) for x in words)):
        return None
    if re.search(r"\b(chapter|gutenberg|ebook|illustration|footnote|transcriber)\b", s, re.I):
        return None
    if len(set(re.sub(r"[^a-z]", "", s.lower()))) < 12:
        return None
    if words[0].lower() in ("and", "but", "or", "nor", "so", "then", "yet"):
        return None
    # Too many capitalized words mid-sentence usually means a list of names.
    caps = sum(1 for w in words[1:] if w[:1].isupper() and w != "I")
    if caps > len(words) // 4:
        return None
    return s


def candidates(text):
    seen = set()
    for para in re.split(r"\n\s*\n", body(text)):
        para = normalize(para)
        if len(para) < 40:
            continue
        for s in sentences(para):
            c = clean_sentence(s)
            if c and c not in seen:
                seen.add(c)
                yield c


def word_count(t):
    return len(t.split())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--total", type=int, default=5000)
    ap.add_argument("--cache", default=".cache/gutenberg")
    ap.add_argument("--out", default="js/quotes.js")
    ap.add_argument("--curated", default="tools/curated_quotes.json")
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    curated = json.load(open(args.curated))
    curated = [q for q in curated if 10 <= word_count(q["text"]) <= 40]
    print(f"curated quotes kept: {len(curated)}")

    pools = []
    for book_id, author, title in BOOKS:
        try:
            text = fetch(book_id, args.cache)
        except Exception as e:  # noqa: BLE001
            print(f"  skip {book_id} {title}: download failed ({e})")
            continue
        if not title_ok(text, title):
            m = re.search(r"^Title:\s*(.+)$", text, re.M)
            print(f"  skip {book_id}: expected {title!r}, file says {m.group(1).strip() if m else '?'}")
            continue
        pool = list(candidates(text))
        rng = random.Random(int(hashlib.md5(str(book_id).encode()).hexdigest(), 16))
        rng.shuffle(pool)
        pools.append((f"{author}, {title}", pool))
        print(f"  {title}: {len(pool)} usable sentences")

    need = args.total - len(curated)
    # Take round-robin from every book so no single book dominates.
    picked, idx = [], 0
    used = {q["text"] for q in curated}
    while len(picked) < need and any(pools[i][1] for i in range(len(pools))):
        src, pool = pools[idx % len(pools)]
        if pool:
            t = pool.pop()
            if t not in used:
                used.add(t)
                picked.append({"text": t, "author": src})
        idx += 1
    if len(picked) < need:
        raise SystemExit(f"only found {len(picked)} excerpts, need {need}")

    entries = curated + picked
    sources = sorted({e["author"] for e in entries})
    sidx = {s: i for i, s in enumerate(sources)}
    rows = ",\n".join(json.dumps([e["text"], sidx[e["author"]]], ensure_ascii=False) for e in entries)
    with open(args.out, "w") as f:
        f.write(
            "// Generated by tools/build_quotes.py. Do not edit by hand: change\n"
            "// tools/curated_quotes.json or the book list and rerun the script.\n"
            f"// {len(entries)} entries, 10-40 words each: hand-picked quotations plus\n"
            "// excerpts from public-domain books on Project Gutenberg.\n"
            f"const QUOTE_SOURCES = {json.dumps(sources, ensure_ascii=False, indent=0)};\n"
            f"const QUOTES = [\n{rows}\n].map(([text, s]) => ({{ text, author: QUOTE_SOURCES[s] }}));\n"
        )
    lengths = [word_count(e["text"]) for e in entries]
    print(f"wrote {len(entries)} entries from {len(sources)} sources to {args.out} "
          f"(words: min {min(lengths)}, max {max(lengths)}, avg {sum(lengths) / len(lengths):.1f})")


if __name__ == "__main__":
    main()
