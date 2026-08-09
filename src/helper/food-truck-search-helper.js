const escapeRegExp = (value = '') =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSearchPhrase = (value = '') =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase();

const getSearchTerms = (value = '') => {
  const phrase = normalizeSearchPhrase(value);
  const phrasePattern = phrase.split(' ').map(escapeRegExp).join('\\s+');
  const broadTokens = [...new Set(phrase.split(' ').filter((word) => word.length >= 3))];
  return {
    phrase,
    allowPhraseSubstring: phrase.length >= 3,
    phraseRegex: new RegExp(phrasePattern, 'i'),
    exactPhraseRegex: new RegExp(`^\\s*${phrasePattern}\\s*$`, 'i'),
    broadTokens,
    tokenRegexes: broadTokens.map((word) => new RegExp(escapeRegExp(word), 'i')),
  };
};

const scoreFoodTruckSearchResult = (truck = {}, search = '') => {
  const { phrase, broadTokens, allowPhraseSubstring } = getSearchTerms(search);
  if (!phrase) return 0;
  const name = normalizeSearchPhrase(truck.name);
  const menu = truck.menu || [];
  if (name === phrase) return 1000;
  let score = allowPhraseSubstring && name.includes(phrase) ? 500 : 0;
  score += broadTokens.filter((token) => name.includes(token)).length * 50;
  menu.forEach((item) => {
    const itemName = normalizeSearchPhrase(item.name);
    const description = normalizeSearchPhrase(item.description);
    if (allowPhraseSubstring && itemName.includes(phrase)) score += 20;
    if (allowPhraseSubstring && description.includes(phrase)) score += 10;
    score += broadTokens.filter((token) => itemName.includes(token)).length * 3;
    score += broadTokens.filter((token) => description.includes(token)).length;
  });
  return score;
};

module.exports = { getSearchTerms, normalizeSearchPhrase, scoreFoodTruckSearchResult };
