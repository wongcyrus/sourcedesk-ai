import { keywordTerms } from '../src/KeywordSearch.js';

export const DOCUMENT_PREFIX = 'title: none | text: ';
export const QUERY_PREFIX = 'task: search result | query: ';

export function documentInput(chunk) {
  return `title: ${(chunk.embeddingTitle ?? chunk.title) || 'none'} | text: ${chunk.text}`;
}

export function buildKeywordIndex(chunks) {
  const terms = Object.create(null);
  const lengths = [];
  for (let row = 0; row < chunks.length; row++) {
    const frequencies = new Map();
    for (const [text, weight] of [[chunks[row].text, 1], [chunks[row].title, 3]]) {
      for (const term of keywordTerms(text)) frequencies.set(term, (frequencies.get(term) || 0) + weight);
    }
    lengths.push([...frequencies.values()].reduce((sum, count) => sum + count, 0) || 1);
    for (const [term, count] of frequencies) {
      (terms[term] ||= []).push(row, count);
    }
  }
  return {
    format: 'vectorsearch-keywords-v1',
    count: chunks.length,
    averageLength: lengths.reduce((sum, length) => sum + length, 0) / chunks.length,
    lengths,
    terms
  };
}

export function chunkSections(sections, tokenizer, maxTokens = 128, overlapTokens = 16) {
  if (!Number.isInteger(maxTokens) || maxTokens < 32 ||
      !Number.isInteger(overlapTokens) || overlapTokens < 0 || overlapTokens >= maxTokens / 2) {
    throw new Error('Use maxTokens >= 32 and overlapTokens < half of maxTokens.');
  }
  const chunks = [];
  for (const section of sections) {
    const titleIds = tokenizer(section.title, { add_special_tokens: false }).input_ids.data;
    const titleLimit = Math.min(32, Math.floor(maxTokens / 3));
    let embeddingTitle = section.title;
    if (titleIds.length > titleLimit) {
      const half = Math.floor(titleLimit / 2);
      const selected = [...titleIds.slice(0, half), ...titleIds.slice(-(titleLimit - half))];
      embeddingTitle = tokenizer.decode(selected.map(Number), { skip_special_tokens: true });
    }
    const tokenCount = text => tokenizer(documentInput({ ...section, embeddingTitle, text })).input_ids.data.length;
    // Keep the original text (including code whitespace), rather than decoding BERT tokens.
    const words = [...section.text.matchAll(/\S+\s*/g)].map(match => match[0]);
    let start = 0;
    while (start < words.length) {
      let low = start + 1;
      let high = Math.min(words.length, start + maxTokens);
      let end = start;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (tokenCount(words.slice(start, middle).join('').trim()) <= maxTokens) {
          end = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (end === start) {
        const characters = Array.from(words[start]);
        let left = 1;
        let right = characters.length;
        let cut = 0;
        while (left <= right) {
          const middle = Math.floor((left + right) / 2);
          if (tokenCount(characters.slice(0, middle).join('')) <= maxTokens) {
            cut = middle;
            left = middle + 1;
          } else {
            right = middle - 1;
          }
        }
        if (!cut) throw new Error(`Cannot fit a character within the token limit in ${section.sourceUrl}.`);
        words.splice(start, 1, characters.slice(0, cut).join(''), characters.slice(cut).join(''));
        continue;
      }
      chunks.push({
        ...section,
        id: chunks.length + 1,
        text: words.slice(start, end).join('').trim(),
        embeddingTitle,
        title: section.title
      });
      if (end === words.length) break;
      let next = end;
      const prefixTokens = tokenCount('');
      while (next > start + 1 &&
             tokenCount(words.slice(next - 1, end).join('').trim()) - prefixTokens <= overlapTokens) {
        next--;
      }
      start = next;
    }
  }
  return chunks;
}
