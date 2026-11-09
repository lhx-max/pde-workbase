'use client';

// Source: Animate UI, primitives/radix/toggle-group.
// Controlled selection and its visual highlight share the Radix value.

import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';

import {
  Highlight,
  HighlightItem,
  type HighlightItemProps,
  type HighlightProps,
} from '@/src/components/animate-ui/primitives/effects/highlight';
import { useControlledState } from '@/src/hooks/use-controlled-state';
import { getStrictContext } from '@/src/lib/get-strict-context';

type ToggleGroupContextType = {
  value: string | string[] | undefined;
  setValue: (value: string | string[] | undefined) => void;
  type: 'single' | 'multiple';
};

const [ToggleGroupProvider, useToggleGroup] =
  getStrictContext<ToggleGroupContextType>('ToggleGroupContext');

type ToggleGroupProps = React.ComponentProps<typeof ToggleGroupPrimitive.Root>;

function ToggleGroup(props: ToggleGroupProps) {
  const [value, setValue] = useControlledState<string | string[] | undefined>({
    value: props.value,
    defaultValue: props.defaultValue,
    onChange: props.onValueChange as (
      value: string | string[] | undefined,
    ) => void,
  });

  return (
    <ToggleGroupProvider value={{ value: props.value !== undefined ? props.value : value, setValue, type: props.type }}>
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        {...props}
        onValueChange={setValue}
      />
    </ToggleGroupProvider>
  );
}

type ToggleGroupItemProps = Omit<
  React.ComponentProps<typeof ToggleGroupPrimitive.Item>,
  'asChild'
> &
  HTMLMotionProps<'button'>;

function ToggleGroupItem({ value, disabled, ...props }: ToggleGroupItemProps) {
  return (
    <ToggleGroupPrimitive.Item value={value} disabled={disabled} asChild>
      <motion.button
        data-slot="toggle-group-item"
        whileTap={{ scale: 0.95 }}
        {...props}
      />
    </ToggleGroupPrimitive.Item>
  );
}

type ToggleGroupHighlightProps = Omit<HighlightProps, 'controlledItems'>;

function ToggleGroupHighlight({
  transition = { type: 'spring', stiffness: 200, damping: 25 },
  ...props
}: ToggleGroupHighlightProps) {
  const { value } = useToggleGroup();

  return (
    <Highlight
      data-slot="toggle-group-highlight"
      controlledItems
      value={typeof value === 'string' ? value : null}
      exitDelay={0}
      transition={transition}
      {...props}
      // Selection belongs to Radix; wrapper clicks must not select disabled items
      // or move the highlight when a controlled change is rejected.
      click={false}
      hover={false}
    />
  );
}

type ToggleGroupHighlightItemProps = HighlightItemProps &
  HTMLMotionProps<'div'> & {
    children: React.ReactElement;
  };

function ToggleGroupHighlightItem({
  children,
  style,
  ...props
}: ToggleGroupHighlightItemProps) {
  const { type, value } = useToggleGroup();

  if (type === 'single') {
    return (
      <HighlightItem
        data-slot="toggle-group-highlight-item"
        style={{ inset: 0, ...style }}
        {...props}
      >
        {children}
      </HighlightItem>
    );
  }

  if (type === 'multiple' && React.isValidElement(children)) {
    const isActive = props.value && value && value.includes(props.value);
    const element = children as React.ReactElement<React.ComponentProps<'div'>>;

    return React.cloneElement(
      children,
      {
        style: {
          ...element.props.style,
          position: 'relative',
        },
        ...element.props,
      },
      <>
        <AnimatePresence>
          {isActive ? (
            <motion.div
              data-slot="toggle-group-highlight-item"
              style={{ position: 'absolute', inset: 0, zIndex: 0, ...style }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              {...props}
            />
          ) : null}
        </AnimatePresence>

        <div style={{ position: 'relative', zIndex: 1 }}>
          {element.props.children}
        </div>
      </>,
    );
  }

  return null;
}

export {
  ToggleGroup,
  ToggleGroupItem,
  ToggleGroupHighlight,
  ToggleGroupHighlightItem,
  useToggleGroup,
  type ToggleGroupProps,
  type ToggleGroupItemProps,
  type ToggleGroupHighlightProps,
  type ToggleGroupHighlightItemProps,
  type ToggleGroupContextType,
};
