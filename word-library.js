(() => {
  "use strict";

  // Keep accents and ñ intact. Skribbl's hints count their NFC characters.
  function normalizeWord(value, language = "en") {
    return typeof value === "string"
      ? value.normalize("NFC").trim().toLocaleLowerCase(language).normalize("NFC").replace(/\s+/g, " ")
      : "";
  }

  function isLearnableWord(value, language = "en") {
    const word = normalizeWord(value, language);
    const minimum = language === "ja" || language === "ko" ? 1 : 2;
    return word.length >= minimum && word.length <= 40 &&
      /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}\s.&\-'’/]*[\p{L}\p{M}\p{N}])?$/u.test(word);
  }

  function countRevealedLetters(hint, language = "en") {
    // Count revealed letter slots, not separators, digits, punctuation or marks
    // attached to a letter. NFC makes decomposed accents a single letter too.
    return Array.from(normalizeWord(hint, language)).filter(letter => /\p{L}/u.test(letter)).length;
  }

  function countRevealedHints(hint, language = "en") {
    // Called with parseHint's word slots, which exclude .word-length metadata.
    // Revealed digits in words such as R2-D2 are clues just like letters.
    return Array.from(normalizeWord(hint, language)).filter(letter => /[\p{L}\p{N}]/u.test(letter)).length;
  }

  function hasRevealedLetter(hint, language = "en") {
    return countRevealedLetters(hint, language) > 0;
  }

  function matchHint(word, hint, language = "en") {
    const candidate = Array.from(normalizeWord(word, language));
    const pattern = Array.from(normalizeWord(hint, language));
    return pattern.length >= 1 && pattern.includes("_") &&
      candidate.length === pattern.length && pattern.every((letter, index) =>
        letter === "_" ? !/\s/u.test(candidate[index]) : letter === candidate[index]);
  }

  function isHintRefinement(previous, next, language = "en") {
    const before = Array.from(normalizeWord(previous, language));
    const after = Array.from(normalizeWord(next, language));
    return before.length > 0 && before.length === after.length &&
      before.every((letter, index) => letter === "_"
        ? after[index] === "_" || !/\s/u.test(after[index])
        : letter === after[index]);
  }

  function parseHint(element, language = "en") {
    if (!element) return "";
    const nodes = element.querySelectorAll(".hint, .letter, .dash, .space, [class*=\"space\"]");
    if (nodes.length) {
      let hint = "";
      for (const node of nodes) {
        const classes = String(node.className || "").toLowerCase();
        const raw = (node.textContent || "").normalize("NFC");
        const letter = raw.trim();
        if (classes.includes("space") || /^\s+$/u.test(raw) || !letter && classes.includes("separator")) hint += " ";
        else if (classes.includes("dash") || classes.includes("blank") || !letter || letter === "_") hint += "_";
        else if (Array.from(letter).length === 1) hint += letter;
      }
      hint = normalizeWord(hint, language);
      // The live client initially masks separators too; .word-length supplies
      // the lengths of the individual words (for example "3 7").
      const lengthText = element.querySelector?.(".word-length")?.textContent?.trim() || "";
      if (/^\d+(?:\s+\d+)+$/u.test(lengthText)) {
        const lengths = lengthText.split(/\s+/u).map(Number);
        const characters = Array.from(hint);
        if (lengths.every(length => length > 0) &&
            characters.length === lengths.reduce((total, length) => total + length, lengths.length - 1)) {
          let separator = 0;
          for (const length of lengths.slice(0, -1)) {
            separator += length;
            characters[separator++] = " ";
          }
          hint = characters.join("");
        }
      }
      if (hint.length >= 1 && hint.includes("_")) return hint;
    }
    const hint = normalizeWord(element.textContent || "", language);
    return hint.length >= 1 && hint.includes("_") && /^[\p{L}\p{M}\p{N}_.&\-'’/\s]+$/u.test(hint) ? hint : "";
  }

  globalThis.SG_WORD_LIBRARY = Object.freeze({
    normalizeWord, isLearnableWord, countRevealedLetters, countRevealedHints, hasRevealedLetter, matchHint, isHintRefinement, parseHint,
  });
})();
