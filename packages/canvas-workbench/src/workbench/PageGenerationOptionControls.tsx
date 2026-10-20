import React from 'react';
import { Button } from '@bezier/components';
import { CanvasLengthMenu } from './CanvasLengthMenu';
import { cr } from '../locales/canvas-remainder';
import type { CanvasBasicNode } from './BasicCanvasNode';
import { PresentationTemplateResourcePicker, WebpageTemplateResourcePicker, CanvasDesignSystemResourcePicker, type PresentationTemplateReference, type WebpageTemplateReference, type CanvasDesignSystemReference } from './ImageReferenceResourcePicker';

function PresentationTemplateIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.25" /><path d="M5 5.5h6M5 8h4M5 10.5h2.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
}

function DesignSystemIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2a5.8 5.8 0 1 0 0 11.6h1.1a1.3 1.3 0 0 0 .2-2.6h-.7a1 1 0 0 1 0-2h1.5A3.7 3.7 0 0 0 13.8 5.5C13.8 3.4 11.2 2.2 8 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="5.2" cy="5.7" r=".7" fill="currentColor" /><circle cx="8" cy="4.6" r=".7" fill="currentColor" /><circle cx="10.7" cy="5.7" r=".7" fill="currentColor" /></svg>;
}

/** The same template, length and design-system controls on canvas and workflows. */
export function PageGenerationOptionControls({ isPresentation, presentationOptions, webpageOptions, onPresentationOptionsChange, onWebpageOptionsChange }: {
  isPresentation: boolean;
  presentationOptions: NonNullable<CanvasBasicNode['presentationOptions']>;
  webpageOptions: NonNullable<CanvasBasicNode['webpageOptions']>;
  onPresentationOptionsChange: (value: NonNullable<CanvasBasicNode['presentationOptions']>) => void;
  onWebpageOptionsChange: (value: NonNullable<CanvasBasicNode['webpageOptions']>) => void;
}) {
  const [lengthOpen, setLengthOpen] = React.useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = React.useState(false);
  const [designSystemPickerOpen, setDesignSystemPickerOpen] = React.useState(false);
  const copy = cr();
  const presentationLengths = [
    { value: 'concise' as const, label: copy.lengthBrief, detail: copy.lengthBriefCompact },
    { value: 'standard' as const, label: copy.lengthMedium, detail: copy.lengthMediumCompact },
    { value: 'detailed' as const, label: copy.lengthDetailed, detail: copy.lengthDetailedCompact },
  ];
  const selectedLength = presentationLengths.find(option => option.value === presentationOptions.length) ?? presentationLengths[1]!;
  const selectedTemplateTitle = presentationOptions.template !== 'smart' ? presentationOptions.templateTitle || copy.template : copy.template;
  const selectedWebTemplateTitle = webpageOptions.templateTitle || 'Template';
  const selectedDesignSystemTitle = webpageOptions.designSystemTitle || 'Design system';
  return <>
            {isPresentation ? <div className="basic-output-options">
              <CanvasLengthMenu open={lengthOpen} onOpenChange={setLengthOpen} value={selectedLength.value} triggerLabel={selectedLength.label}
                options={presentationLengths} onChange={length => onPresentationOptionsChange({ ...presentationOptions, length })} />
              <i className="minimax-image-divider" />
              <Button variant="ghost" className="minimax-image-chip basic-output-option-chip" aria-haspopup="dialog" aria-expanded={templatePickerOpen} onClick={() => { setLengthOpen(false); setTemplatePickerOpen(true); }}>
                <PresentationTemplateIcon /><span>{selectedTemplateTitle}</span>
              </Button>
            </div> : <div className="basic-output-options">
              <Button variant="ghost" className="minimax-image-chip basic-output-option-chip" aria-haspopup="dialog" aria-expanded={templatePickerOpen} onClick={() => { setDesignSystemPickerOpen(false); setTemplatePickerOpen(true); }}>
                <PresentationTemplateIcon /><span>{selectedWebTemplateTitle}</span>
              </Button>
              <i className="minimax-image-divider" />
              <Button variant="ghost" className="minimax-image-chip basic-output-option-chip" aria-haspopup="dialog" aria-expanded={designSystemPickerOpen} onClick={() => { setTemplatePickerOpen(false); setDesignSystemPickerOpen(true); }}>
                <DesignSystemIcon /><span>{selectedDesignSystemTitle}</span>
              </Button>
            </div>}
        {isPresentation && <PresentationTemplateResourcePicker
          open={templatePickerOpen}
          selectedId={presentationOptions.template}
          onClose={() => setTemplatePickerOpen(false)}
          onSelect={(template: PresentationTemplateReference) => onPresentationOptionsChange({
            ...presentationOptions,
            template: template.id,
            templateTitle: template.title,
            templateDescription: template.description,
            templateReferencePath: template.referencePath,
            templatePrompt: template.prompt,
          })}
        />}
        {!isPresentation && <WebpageTemplateResourcePicker
          open={templatePickerOpen}
          selectedId={webpageOptions.template}
          onClose={() => setTemplatePickerOpen(false)}
          onSelect={(template: WebpageTemplateReference) => onWebpageOptionsChange({
            ...webpageOptions,
            template: template.id,
            templateTitle: template.title,
            templateDescription: template.description,
            templateReferencePath: template.referencePath,
            templatePrompt: template.prompt,
          })}
        />}
        {!isPresentation && <CanvasDesignSystemResourcePicker
          open={designSystemPickerOpen}
          selectedId={webpageOptions.designSystemId}
          onClose={() => setDesignSystemPickerOpen(false)}
          onSelect={(system: CanvasDesignSystemReference | null) => {
            if (system) {
              onWebpageOptionsChange({
                ...webpageOptions,
                designSystemId: system.id,
                designSystemTitle: system.title,
              });
              return;
            }
            const {
              designSystemId: _designSystemId,
              designSystemTitle: _designSystemTitle,
              ...projectDefaultOptions
            } = webpageOptions;
            onWebpageOptionsChange(projectDefaultOptions);
          }}
        />}
  </>;
}
