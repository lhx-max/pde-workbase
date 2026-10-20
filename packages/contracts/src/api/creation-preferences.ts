/** Independent, space-scoped creation preference jobs. Images keep their legacy IDs. */
export const CREATION_PREFERENCE_TYPES = ['image', 'slides', 'webpage', 'text'] as const;
export type CreationPreferenceType = typeof CREATION_PREFERENCE_TYPES[number];
export type CreationPreferenceSectionKey = `${'confirmed' | 'suggested'}-${CreationPreferenceType}-behavior`;

export function isCreationPreferenceType(value: unknown): value is CreationPreferenceType {
  return typeof value === 'string' && (CREATION_PREFERENCE_TYPES as readonly string[]).includes(value);
}
export function creationPreferenceSkill(type: CreationPreferenceType): string {
  return `${type}-behavior-preferences`;
}
export function creationPreferenceTypeForSkill(skill: unknown): CreationPreferenceType | undefined {
  return CREATION_PREFERENCE_TYPES.find(type => creationPreferenceSkill(type) === skill);
}
export function creationPreferenceTypeForSection(key: string): CreationPreferenceType | undefined {
  return CREATION_PREFERENCE_TYPES.find(type => key === `confirmed-${type}-behavior` || key === `suggested-${type}-behavior`);
}
export function isPreferenceSynthesisSkill(skill: unknown): boolean {
  return skill === 'space-preference-synthesis' || skill === 'image-preference-extraction' || creationPreferenceTypeForSkill(skill) !== undefined;
}
