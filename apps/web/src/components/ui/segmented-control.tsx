import type { ComponentPropsWithoutRef } from 'react';

import {
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupProps,
} from '@/src/components/animate-ui/components/radix/toggle-group';

type ToggleGroupRootProps = ToggleGroupProps;

export type SegmentedControlProps = Omit<
  ToggleGroupRootProps,
  'type' | 'value' | 'defaultValue' | 'onValueChange'
> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function SegmentedControl({
  className,
  value,
  onValueChange,
  ...props
}: SegmentedControlProps) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(next) => {
        // Radix emits an empty string when the selected item is pressed again.
        // A segmented single-select must always retain one active value.
        if (next) onValueChange(next);
      }}
      data-ui-segmented-control=""
      className={className}
      {...props}
    />
  );
}

export type SegmentedControlItemProps = ComponentPropsWithoutRef<
  typeof ToggleGroupItem
>;

export const SegmentedControlItem = ToggleGroupItem;
