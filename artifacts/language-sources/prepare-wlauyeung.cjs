const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = __dirname;
const revision = '1702cddfc72eb0e38a16447365f4ad485004c235';
const definitions = [
  ['en', 'en', 'English', 0],
  ['de', 'de', 'German', 1],
  ['fr', 'fr', 'French', 7],
  ['ko', 'kr', 'Korean', 14],
  ['es', 'es', 'Spanish', 24]
];
const metadata = definitions.map(([lang, sourceTag, name, id]) => {
  const sourceBytes = fs.readFileSync(path.join(root, `wlauyeung-${sourceTag}.json`));
  const words = JSON.parse(sourceBytes.toString('utf8'));
  if (!Array.isArray(words) || words.some(word => typeof word !== 'string' || /[\n\r\u0000]/.test(word) || !word)) {
    throw new Error(`Malformed word list: ${lang}`);
  }
  const unique = [...new Set(words)];
  fs.writeFileSync(path.join(root, `${lang}.txt`), unique.join('\n') + '\n', 'utf8');
  return {
    lang, name, skribblLanguageId: id,
    entryCount: words.length,
    uniqueCount: unique.length,
    source: `https://raw.githubusercontent.com/wlauyeung/Skribblio-Word-Bank/${revision}/words_${sourceTag}_v1.0.0_raw.json`,
    repository: 'https://github.com/wlauyeung/Skribblio-Word-Bank',
    revision,
    license: 'MIT',
    licenseFile: 'LICENSE-wlauyeung.txt',
    sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
    provenance: 'Community Skribbl answer bank; upstream README states exact unmodified words from the Skribbl official word bank. Does not guarantee completeness against the current official server bank.',
    samples: unique.slice(0, 5)
  };
});
fs.writeFileSync(path.join(root, 'wlauyeung-metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(metadata));
