import * as React from 'react';
import type { Transition } from 'motion/react';

import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsTrigger as TabsTriggerPrimitive,
  TabsContent as TabsContentPrimitive,
  TabsContents as TabsContentsPrimitive,
  TabsHighlight as TabsHighlightPrimitive,
  TabsHighlightItem as TabsHighlightItemPrimitive,
  type TabsProps as TabsPrimitiveProps,
  type TabsListProps as TabsListPrimitiveProps,
  type TabsTriggerProps as TabsTriggerPrimitiveProps,
  type TabsContentProps as TabsContentPrimitiveProps,
  type TabsContentsProps as TabsContentsPrimitiveProps,
} from '@/src/components/animate-ui/primitives/radix/tabs';
import { cn } from '@/src/lib/utils';
import './tabs.css';

type TabsProps = TabsPrimitiveProps;

function Tabs({ className, ...props }: TabsProps) {
  return (
    <TabsPrimitive
      className={cn('ui-tabs', className)}
      data-ui="tabs"
      {...props}
    />
  );
}

type TabsListProps = TabsListPrimitiveProps & {
  highlightMode?: 'children' | 'parent';
  highlightTransition?: Transition;
  /** Disable the overlay when the consumer paints selection on the trigger. */
  animateHighlight?: boolean;
};

function TabsList({ className, highlightMode, highlightTransition, animateHighlight = true, ...props }: TabsListProps) {
  return (
    <TabsHighlightPrimitive
      className="ui-tabs__highlight"
      enabled={animateHighlight}
      mode={highlightMode}
      transition={highlightTransition}
    >
      <TabsListPrimitive
        className={cn(
          'ui-tabs__list',
          className,
        )}
        {...props}
      />
    </TabsHighlightPrimitive>
  );
}

type TabsTriggerProps = TabsTriggerPrimitiveProps;

function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsHighlightItemPrimitive value={props.value} className="ui-tabs__item">
      <TabsTriggerPrimitive
        className={cn(
          'ui-tabs__trigger',
          className,
        )}
        {...props}
      />
    </TabsHighlightItemPrimitive>
  );
}

type TabsContentsProps = TabsContentsPrimitiveProps;

function TabsContents(props: TabsContentsProps) {
  return <TabsContentsPrimitive {...props} />;
}

type TabsContentProps = TabsContentPrimitiveProps;

function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsContentPrimitive
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContents,
  TabsContent,
  type TabsProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsContentsProps,
  type TabsContentProps,
};
