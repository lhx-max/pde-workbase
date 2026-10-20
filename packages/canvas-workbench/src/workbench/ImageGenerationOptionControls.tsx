import * as React from 'react';
import { IMAGE_GENERATION_COUNTS } from '@bezier/contracts';
import { Icon } from '../ui/Icon';
import { Button } from '@bezier/components';
import { cr } from '../locales/canvas-remainder';

import {
  requireCanvasPopoverRenderer,
  requireCanvasMenuRenderer,
  useCanvasUiHost,
  type CanvasMenuRenderer,
  type CanvasPopoverRenderProps,
  type CanvasPopoverRenderer,
} from '../platform/ui-host';
import { CanvasSelectionItem } from './CanvasSelectionItem';

export interface ImageGenerationModelOption { value: string; label: string; }

export type ImageGenerationPopoverRenderProps = CanvasPopoverRenderProps;
export type ImageGenerationPopoverRenderer = CanvasPopoverRenderer;

function MiniMaxImageModelIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.52 2 7.26 6.21 4.8 2.71 2.71 4.8 6.2 7.26 2 6.52v2.96l4.21-.74-3.5 2.46 2.1 2.09 2.45-3.5L6.52 14h2.96l-.74-4.21 2.46 3.5 2.09-2.1-3.5-2.45 4.21.74V6.52l-4.21.74 3.5-2.46-2.1-2.09-2.45 3.5L9.48 2H6.52Z" fill="currentColor" /></svg>;
}

export function ImageGenerationOptionControls({
  model, modelOptions, showModel = true, ratio, ratioOptions, selectedRatios = [ratio],
  resolution, resolutionOptions = [], onModelChange, onRatioChange,
  onResolutionChange, onAnyOpen,
  renderPopover,
  renderMenu,
  testIdPrefix, count, onCountChange, onTemplateClick, templateLabel = cr().template,
}: {
  count?: number;
  onCountChange?: (count: number) => void;
  onTemplateClick?: () => void;
  templateLabel?: string;
  model: string;
  showModel?: boolean;
  modelOptions: readonly ImageGenerationModelOption[];
  ratio: string;
  ratioOptions: readonly string[];
  selectedRatios?: readonly string[];
  resolution?: string;
  resolutionOptions?: readonly string[];
  onModelChange: (model: string) => void;
  onRatioChange: (ratio: string) => void;
  onResolutionChange?: (resolution: string) => void;
  onAnyOpen?: () => void;
  renderPopover?: ImageGenerationPopoverRenderer;
  renderMenu?: CanvasMenuRenderer;
  testIdPrefix?: string;
}) {
  const [countOpen, setCountOpen] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [paramsOpen, setParamsOpen] = React.useState(false);
  const uiHost = useCanvasUiHost();
  const popoverRenderer = requireCanvasPopoverRenderer(uiHost, renderPopover);
  const menuRenderer = requireCanvasMenuRenderer(uiHost, renderMenu);
  const selectedModel = modelOptions.find(option => option.value === model);

  const setModelPickerOpen = (next: boolean) => {
    setModelOpen(next);
    if (next) {
      setParamsOpen(false);
      setCountOpen(false);
      onAnyOpen?.();
    }
  };
  const setParamsPickerOpen = (next: boolean) => {
    setParamsOpen(next);
    if (next) {
      setModelOpen(false);
      setCountOpen(false);
      onAnyOpen?.();
    }
  };

  return (
    <div className="minimax-image-generation-options">
      {showModel && <>{menuRenderer({
        open: modelOpen,
        onOpenChange: setModelPickerOpen,
        contentClassName: 'is-model-menu',
        ariaLabel: cr().selectModel,
        selectedValue: model,
        onSelectedValueChange: onModelChange,
        side: 'top',
        align: 'start',
        trigger: <Button variant="ghost" className="minimax-image-chip is-model" aria-expanded={modelOpen} data-testid={testIdPrefix ? `${testIdPrefix}-model` : undefined}>
          <MiniMaxImageModelIcon /><span>{selectedModel?.label ?? cr().modelUnconfigured(model)}</span>
        </Button>,
        label: cr().model,
        items: modelOptions.map(option => ({
          id: option.value,
          value: option.value,
          content: <><MiniMaxImageModelIcon /><span>{option.label}</span></>,
        })),
      })}
      <span className="minimax-image-divider" aria-hidden="true" /></>}
      {popoverRenderer({
        open: paramsOpen,
        onOpenChange: setParamsPickerOpen,
        contentClassName: 'is-params-menu',
        ariaLabel: cr().imageParams,
        trigger: <Button variant="ghost" className="minimax-image-chip is-params" aria-expanded={paramsOpen} data-testid={testIdPrefix ? `${testIdPrefix}-ratio` : undefined}>
          <span className="minimax-ratio-icon" aria-hidden="true" style={{ aspectRatio: ratio.replace(':', ' / '), width: 'auto' }} />
          <span>{ratio}{resolution ? ` · ${resolution}` : ''}</span>
        </Button>,
        children: <>
          <section><strong>{cr().aspectRatio}</strong><div className="minimax-image-option-grid is-ratio">
            {ratioOptions.map(option => <CanvasSelectionItem key={option} selected={selectedRatios.includes(option)} onClick={() => onRatioChange(option)}>{option}</CanvasSelectionItem>)}
          </div></section>
          {resolution && resolutionOptions.length > 0 && onResolutionChange ? <section><strong>{cr().resolution}</strong><div className="minimax-image-option-grid">
            {resolutionOptions.map(option => <CanvasSelectionItem key={option} selected={resolution === option} onClick={() => onResolutionChange(option)}>{option}</CanvasSelectionItem>)}
          </div></section> : null}</>,
      })}
      {count !== undefined && onCountChange && <>
        <span className="minimax-image-divider" aria-hidden="true"/>
        {menuRenderer({ open: countOpen, onOpenChange: open => { setCountOpen(open); if (open) { setModelOpen(false); setParamsOpen(false); onAnyOpen?.(); } }, ariaLabel: cr().generateCount, label: cr().generateCount, contentClassName: 'is-count-menu', side: 'top', selectedValue: String(count), onSelectedValueChange: value => onCountChange(Number(value)), trigger: <Button variant="ghost" className="minimax-image-chip is-count">× {count}</Button>, items: IMAGE_GENERATION_COUNTS.map(value => ({ id: String(value), value: String(value), content: `× ${value}` })) })}
      </>}
      {onTemplateClick && <><span className="minimax-image-divider" aria-hidden="true"/><Button variant="ghost" className="minimax-image-chip" aria-label={cr().chooseImageTemplate} aria-haspopup="dialog" onClick={() => { setCountOpen(false); setModelOpen(false); setParamsOpen(false); onTemplateClick(); }}><Icon name="layers" size={15}/><span>{templateLabel}</span></Button></>}
    </div>
  );
}
