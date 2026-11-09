import React from 'react';
import { Button } from '@bezier/components';
import { type ArtifactTextOptions } from '@bezier/contracts';
import { FileText } from 'lucide-react';
import { CanvasLengthMenu } from './CanvasLengthMenu';
import { cr } from '../locales/canvas-remainder';
import { TextTemplateResourcePicker } from './ImageReferenceResourcePicker';

export function TextGenerationOptionControls({ value, onChange }: {
  value: ArtifactTextOptions; onChange: (value: ArtifactTextOptions) => void;
}) {
  const [lengthOpen, setLengthOpen] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const copy = cr();
  const textLengths = [
    { value: 'auto' as const, label: copy.textLengthAuto, detail: copy.textLengthAutoCompact, menuLabel: copy.automaticLength },
    { value: 'short' as const, label: copy.textLengthShort, detail: copy.textLengthShortDetail, menuLabel: copy.textLengthShort },
    { value: 'medium' as const, label: copy.textLengthMedium, detail: copy.textLengthMediumDetail, menuLabel: copy.textLengthMedium },
    { value: 'long' as const, label: copy.textLengthLong, detail: copy.textLengthLongDetail, menuLabel: copy.textLengthLong },
  ];
  const selected = textLengths.find(option => option.value === value.length) ?? textLengths[0]!;
  return <div className="basic-output-options">
    <CanvasLengthMenu open={lengthOpen} onOpenChange={setLengthOpen} value={selected.value} triggerLabel={selected.label}
      options={textLengths.map(option => ({ ...option, label: option.menuLabel }))}
      onChange={length => onChange({ ...value, length })} />
    <Button variant="ghost" className="minimax-image-chip basic-output-option-chip" aria-haspopup="dialog" aria-expanded={templateOpen} onClick={() => { setLengthOpen(false); setTemplateOpen(true); }}><FileText size={15}/><span>{value.templateTitle || copy.template}</span></Button>
    <TextTemplateResourcePicker open={templateOpen} selectedId={value.templateId} onClose={() => setTemplateOpen(false)} onSelect={template => { onChange({ ...value, templateId: template.id, templateTitle: template.title, templatePrompt: template.prompt }); }}/>
  </div>;
}
