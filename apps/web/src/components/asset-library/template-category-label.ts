// Pure display taxonomy extracted from upstream 319e5eee; no product registry.
import type { useT } from '../../i18n';
const labels = {
  'student-coursework': 'pluginsHome.commercialCategory.student-coursework',
  'corporate-strategy': 'pluginsHome.commercialCategory.corporate-strategy',
  'professional-training': 'pluginsHome.commercialCategory.professional-training',
  'b2b-sales': 'pluginsHome.commercialCategory.b2b-sales',
  'academic-research': 'pluginsHome.commercialCategory.academic-research',
  'marketing-gtm': 'pluginsHome.commercialCategory.marketing-gtm',
  'data-finance': 'pluginsHome.commercialCategory.data-finance',
  'fundraising-pitch': 'pluginsHome.commercialCategory.fundraising-pitch',
  'government-policy': 'pluginsHome.commercialCategory.government-policy',
  'product-management': 'pluginsHome.commercialCategory.product-management',
  'consulting': 'pluginsHome.commercialCategory.consulting',
  'career': 'pluginsHome.commercialCategory.career',
  'ai-literacy': 'pluginsHome.commercialCategory.ai-literacy',
  'life': 'pluginsHome.commercialCategory.life',
  'design-craft': 'pluginsHome.commercialCategory.design-craft',
  'business-dashboards': 'pluginsHome.subfacet.business-dashboards',
  'app-prototypes': 'pluginsHome.subfacet.app-prototypes',
  'landing-marketing': 'pluginsHome.subfacet.landing-marketing',
  'developer-tools': 'pluginsHome.subfacet.developer-tools',
  'docs-reports': 'pluginsHome.subfacet.docs-reports',
  'brand-design': 'pluginsHome.subfacet.brand-design',
  'pitch-business': 'pluginsHome.subfacet.pitch-business',
  'course-training': 'pluginsHome.subfacet.course-training',
  'reports-briefings': 'pluginsHome.subfacet.reports-briefings',
  'product-sales': 'pluginsHome.subfacet.product-sales',
  'engineering-talks': 'pluginsHome.subfacet.engineering-talks',
  'creative-decks': 'pluginsHome.subfacet.creative-decks',
  'ui-product-mockups': 'pluginsHome.subfacet.ui-product-mockups',
  'brand-visuals': 'pluginsHome.subfacet.brand-visuals',
  'storyboards-motion-refs': 'pluginsHome.subfacet.storyboards-motion-refs',
  'social-content': 'pluginsHome.subfacet.social-content',
  'avatar-portrait': 'pluginsHome.subfacet.avatar-portrait',
  'illustration-style': 'pluginsHome.subfacet.illustration-style',
  'motion-effects': 'pluginsHome.subfacet.motion-effects',
  'social-short-form': 'pluginsHome.subfacet.social-short-form',
  'marketing-product': 'pluginsHome.subfacet.marketing-product',
  'data-explainers': 'pluginsHome.subfacet.data-explainers',
  'cinematic-story': 'pluginsHome.subfacet.cinematic-story',
} as const;
export function templateCategoryLabel(locale: string, category: string, t: ReturnType<typeof useT>): string {
  const key = labels[category as keyof typeof labels];
  if (key) return t(key);
  if (locale.startsWith('zh')) {
    if (category === 'brand-page') return t('community.subtype.brandPage');
    if (category === 'hyperframes') return t('community.subtype.motion');
  }
  return category;
}
