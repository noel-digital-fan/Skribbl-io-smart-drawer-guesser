(() => {
  "use strict";
  const upstream = "https://github.com/wlauyeung/Skribblio-Word-Bank/blob/1702cddfc72eb0e38a16447365f4ad485004c235/";
  // Only languages with a packaged, attributed source are offered. Keep the
  // user's ordering when adding verified sources for additional languages.
  globalThis.SG_WORD_CATALOG = Object.freeze([
    {code:"en",label:"English",file:"words.txt",sourceUrl:null},
    {code:"de",label:"German",file:"words-de.txt",count:3978,sourceName:"Skribblio-Word-Bank",sourceUrl:upstream+"words_de_v1.0.0_raw.json"},
    {code:"fr",label:"French",file:"words-fr.txt",count:3788,sourceName:"Skribblio-Word-Bank",sourceUrl:upstream+"words_fr_v1.0.0_raw.json"},
    {code:"ko",label:"Korean",file:"words-ko.txt",count:2248,sourceName:"Skribblio-Word-Bank",sourceUrl:upstream+"words_kr_v1.0.0_raw.json"},
    {code:"pl",label:"Polish",file:"words-pl.txt",count:2238,sourceName:"SkribblHelperPL",sourceUrl:"https://github.com/ErenoGit/SkribblHelperPL/blob/00c12f302ce74c1dc520b3a0a7b586928c2b38d8/PossibleWordsPL.js"},
    {code:"es",label:"Spanish",file:"words-es.txt",count:2338,sourceName:"Skribblio-Word-Bank",sourceUrl:upstream+"words_es_v1.0.0_raw.json"},
  ].map(entry => Object.freeze(entry)));
})();
