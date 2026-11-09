# Original question-form extraction

Source: Bezier/Loom commit `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`, Apache-2.0.

- [QuestionForm](<QuestionForm.tsx>) retains the complete original 1916-line renderer: all 18 question types, step navigation, required/default/streaming reconciliation, custom options, file answers, draft/readiness callbacks, visual-style cards and gallery, submitted summary, explicit skip and timeout behavior.
- [WorkflowCanvasQuestion](<workspace/WorkflowCanvasQuestion.tsx>) retains original parsing and clarification POST behavior. A run+step identity boundary resets submission state for subsequent clarification steps in the same workflow.
- Pure [question parser](<../artifacts/question-form.ts>), [partial JSON repair](<../runtime/partial-json.ts>) and [visual-style catalog](<../runtime/visual-style-catalog.ts>) are unchanged source copies. Original external catalog image URLs remain; no runtime source is loaded from the upstream checkout.
- [Reference choices](<AssetReferenceChoices.tsx>) retain original radio-card DOM, validation and [CSS](<AssetReferenceChoices.module.css>). The excluded global asset store/library navigation/personal-card renderer are replaced by the optional [reference adapter](<question-form-reference-adapter.ts>). Query, authority, revision identities, preview source and picker UI belong to the embedding host. An absent adapter returns `UNSUPPORTED_CAPABILITY`; unresolved choices render unavailable and cannot validate as selected references. No global personal/team library is introduced.
- Original question styles already exist in [composio styles](<../styles/viewer/composio.css#L726-L1930>), and the original filter rail was already present. No new simplified form or stylesheet redesign was introduced.

## Verification

**80 question-related tests pass** (41 parser, 34 original component, 5 adapter/workflow). Together with the 25 HTML viewer/deck/retention tests, the focused extraction suites report **105/105 passing**. TypeScript passes for the complete imported question and viewer closures using the web compiler settings; final whole-app build/runtime validation remains parent-owned.

The original [parser suite](<../../tests/artifacts/question-form.test.ts>) and [component suite](<../../tests/components/QuestionForm.test.tsx>) are retained. Two matcher-only adaptations use `aria-checked` assertions instead of the unavailable jest-dom `toBeChecked` plugin. [Adapter and workflow tests](<../../tests/question-form-reference-adapter.test.tsx>) cover unsupported capability, exact space/revision/deletion validation, real original reference cards, clarification request payload, and next-step state reset. These are local unit/component tests; parent owns real workflow/browser/native runtime verification.
