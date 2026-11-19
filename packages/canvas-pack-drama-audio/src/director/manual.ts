import content from './manual-content.json';

export type ManualSection = { title: string; entry?: string; kind?: string; steps: string[]; result?: string; note?: string };
export type ManualTopic = { id: string; title: string; summary: string; keywords: string; sections: ManualSection[] };
export const manual: { title: string; version: string; intro: string; topics: ManualTopic[] } = content;
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();

/** Search the same text that the reader can open, plus common synonyms. */
export function searchManual(query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return manual.topics.filter(topic => {
    const text = normalize([topic.title, topic.summary, topic.keywords, ...topic.sections.flatMap(section =>
      [section.title, section.entry ?? '', ...section.steps, section.result ?? '', section.note ?? ''])].join(' '));
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    const rank = (topic: ManualTopic) => terms.length === 0 ? 0
      : terms.every(term => normalize(topic.title).includes(term)) ? 2
      : topic.sections.some(section => terms.every(term => normalize(section.title).includes(term))) ? 1 : 0;
    return rank(b) - rank(a);
  });
}
