# Word list sources

The language selector changes the extension's suggestions, automatic guesses,
learned words and ranking history. Set the Skribbl room to the same language;
the extension does not change the room's language. Selection persists locally.

Only languages with a suitable available source are offered, in the user's
requested order after omissions: **English, German, French, Korean, Polish,
Spanish**. All source text is packaged locally; no runtime translation or remote
word service is used. These community projects are not official partners of
Skribbl.io, and completeness of the current server database is unverified.

| Language | Packaged file | Original entries | Distinct normalized entries | Source |
| --- | --- | ---: | ---: | --- |
| English | `words.txt` | 4,290 | 4,290 | Existing extension collection, preserved |
| German | `words-de.txt` | 3,978 | 3,978 | Skribblio-Word-Bank, MIT |
| French | `words-fr.txt` | 3,788 | 3,784 | Skribblio-Word-Bank, MIT |
| Korean | `words-ko.txt` | 2,248 | 2,248 | Skribblio-Word-Bank, MIT |
| Polish | `words-pl.txt` | 2,238 | 2,237 | SkribblHelperPL, MPL-2.0 |
| Spanish | `words-es.txt` | 2,338 | 2,333 | Skribblio-Word-Bank, MIT |

Normalization removes repeated spellings that differ only in case, whitespace
or canonical Unicode representation. The original packaged files retain all
source spellings and entries.

## German, French and Korean

The pinned [Skribblio-Word-Bank repository](https://github.com/wlauyeung/Skribblio-Word-Bank/tree/1702cddfc72eb0e38a16447365f4ad485004c235)
provides these raw banks:

- [German](https://github.com/wlauyeung/Skribblio-Word-Bank/blob/1702cddfc72eb0e38a16447365f4ad485004c235/words_de_v1.0.0_raw.json)
- [French](https://github.com/wlauyeung/Skribblio-Word-Bank/blob/1702cddfc72eb0e38a16447365f4ad485004c235/words_fr_v1.0.0_raw.json)
- [Korean](https://github.com/wlauyeung/Skribblio-Word-Bank/blob/1702cddfc72eb0e38a16447365f4ad485004c235/words_kr_v1.0.0_raw.json)

The source uses `kr` in its Korean filename; the selector/storage use standard
language code `ko`. These arrays were converted to UTF-8 lines, preserving each
entry. The MIT notice is in `licenses/Skribblio-Word-Bank-MIT.txt`.
The [skribbliohints maintainer](https://github.com/skribbliohints/skribbliohints.github.io)
documents using this bank in 2025.

## Polish

`words-pl.txt` is the flattened word array from
[SkribblHelperPL's PossibleWordsPL.js](https://github.com/ErenoGit/SkribblHelperPL/blob/00c12f302ce74c1dc520b3a0a7b586928c2b38d8/PossibleWordsPL.js),
at commit `00c12f302ce74c1dc520b3a0a7b586928c2b38d8` (November 6, 2024).
Source order and word spelling are unchanged. The
[author's README](https://github.com/ErenoGit/SkribblHelperPL/blob/00c12f302ce74c1dc520b3a0a7b586928c2b38d8/README.md)
states that the words were collected from Skribbl.io with
[SkribblWordsSaver](https://github.com/ErenoGit/SkribblWordsSaver).
The README's count is 2,239; the actual pinned array has 2,238 entries, reducing to
2,237 after normalization. The MPL-2.0 license is included in
`licenses/SkribblHelperPL-MPL-2.0.txt`. The packaged text remains editable source;
the original upstream source and notices are also included in `licenses/`.

## Spanish

`words-es.txt` packages the 2,338 entries from the MIT-licensed
[Skribblio-Word-Bank raw Spanish bank](https://github.com/wlauyeung/Skribblio-Word-Bank/blob/1702cddfc72eb0e38a16447365f4ad485004c235/words_es_v1.0.0_raw.json),
at commit `1702cddfc72eb0e38a16447365f4ad485004c235` (file last changed June 15, 2023).
Only the container changes from a JSON array to UTF-8 lines; the packaged entries
retain their exact source spelling. The matcher normalizes case, Unicode NFC and
whitespace, preserving accents, ü and ñ. No words were translated or generated.
The upstream MIT notice is included in `licenses/Skribblio-Word-Bank-MIT.txt`.

This is a community collection for Skribbl.io, **not a download from an official
API and not a verified complete copy of the current server database**.
The [skribbliohints README](https://github.com/skribbliohints/skribbliohints.github.io)
describes historical collection by a bot and its 2025 switch to
Skribblio-Word-Bank. Its Spanish file matches these 2,338 entries.
The [original collector](https://github.com/aseemrb/skribbl) documents observing
words in games. Comparison with that historical collection verifies 2,328 of the
bank's entries as observed words; the collection adds ten entries without that
historical observation metadata. The upstream project's description is not an
independent guarantee of current completeness.

On October 3, 2026, investigation of the published
[current game client](https://skribbl.io/js/game.js) and
[archived January 2022 client](https://web.archive.org/web/20220115193748id_/https://skribbl.io/js/game.js)
found word choices and reveals arriving from the server for individual turns.
Neither client contains the full Spanish bank or exposes a full-bank API.
This does not prove that no such endpoint exists privately; no public official
complete download was found. The Spanish panel links directly to the packaged
source and states that completeness is unverified, as do the other new languages.

The packaged list works offline after installation. New words revealed in games
are learned locally for the selected language, including custom-room words.
Import, export and reset affect that language only. English uses the original
`extraWords` and `guesserStatsV160` keys; other languages use separate keys
suffixed with their code (`:de`, `:fr`, `:ko`, `:pl`, `:es`). Learned words for those
languages are not sent to the existing English cloud sync service.

## English

`words.txt` is the extension's existing English collection. This change preserves
that file and existing English learned words and success history.

## Omitted languages

Bulgarian, Czech, Danish, Dutch, Finnish, Estonian, Greek, Hebrew, Hungarian,
Italian, Japanese, Latvian, Macedonian, Norwegian, Portuguese, Romanian, Russian,
Serbian, Slovakian, Swedish, Tagalog and Turkish are omitted. A bounded search did
not find suitable documented, redistributable Skribbl word sources for them.
Unlicensed/undocumented copies, generic vocabulary and generated translations
were not substituted. This is a record of this search, not a claim that no
community collection exists anywhere. Future additions can be placed in the
requested order through `word-catalog.js` after their source is verified.

## Verification

Run `node scripts/test-guess-languages.cjs` for Unicode hint matching, language
selection/reload, storage isolation, learned words, cloud sync isolation and
asynchronous language switches. Run `node scripts/test-panel-experience.cjs`
for the shared Guess/Draw panel and drawing controls.
