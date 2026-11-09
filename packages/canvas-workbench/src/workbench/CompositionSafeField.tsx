'use client';

import React from 'react';
import {
  Input,
  Textarea,
  type InputProps,
  type TextareaProps,
} from '@bezier/components';

type CompositionSafeValueProps = {
  value: string;
  onValueChange: (value: string) => void;
  onValueCommit?: (value: string) => void;
};

type SafeInputProps = CompositionSafeValueProps & Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'onCompositionStart' | 'onCompositionEnd'
>;

type SafeTextareaProps = CompositionSafeValueProps & Omit<
  TextareaProps,
  'value' | 'defaultValue' | 'onChange' | 'onCompositionStart' | 'onCompositionEnd'
>;

function useCompositionSafeValue({ value, onValueChange, onValueCommit }: CompositionSafeValueProps) {
  const [draft, setDraft] = React.useState(value);
  const composingRef = React.useRef(false);
  const latestExternalValueRef = React.useRef(value);
  const lastEmittedValueRef = React.useRef(value);

  latestExternalValueRef.current = value;

  React.useEffect(() => {
    if (composingRef.current) return;
    setDraft(value);
    lastEmittedValueRef.current = value;
  }, [value]);

  const emit = React.useCallback((nextValue: string, commit = false) => {
    setDraft(nextValue);
    if (nextValue !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = nextValue;
      onValueChange(nextValue);
    }
    if (commit) onValueCommit?.(nextValue);
  }, [onValueChange, onValueCommit]);

  const onChange = React.useCallback((nextValue: string) => {
    setDraft(nextValue);
    if (!composingRef.current) emit(nextValue);
  }, [emit]);

  const onCompositionStart = React.useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = React.useCallback((nextValue: string) => {
    composingRef.current = false;
    emit(nextValue, true);
  }, [emit]);

  const onBlur = React.useCallback(() => {
    if (composingRef.current) return;
    if (draft !== latestExternalValueRef.current || draft !== lastEmittedValueRef.current) {
      emit(draft, true);
      return;
    }
    onValueCommit?.(draft);
  }, [draft, emit, onValueCommit]);

  return {
    composingRef,
    draft,
    onBlur,
    onChange,
    onCompositionEnd,
    onCompositionStart,
  };
}

function isNativeComposition(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, composing: boolean) {
  return composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export const CompositionSafeTextarea = React.forwardRef<HTMLTextAreaElement, SafeTextareaProps>(function CompositionSafeTextarea({
  value,
  onValueChange,
  onValueCommit,
  onBlur,
  onKeyDown,
  ...props
}, forwardedRef) {
  const safe = useCompositionSafeValue({ value, onValueChange, onValueCommit });
  return (
    <Textarea
      {...props}
      ref={forwardedRef}
      value={safe.draft}
      onChange={event => safe.onChange(event.currentTarget.value)}
      onCompositionStart={safe.onCompositionStart}
      onCompositionEnd={event => safe.onCompositionEnd(event.currentTarget.value)}
      onBlur={event => {
        safe.onBlur();
        onBlur?.(event);
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (isNativeComposition(event, safe.composingRef.current)) return;
        onKeyDown?.(event);
      }}
    />
  );
});

export const CompositionSafeInput = React.forwardRef<HTMLInputElement, SafeInputProps>(function CompositionSafeInput({
  value,
  onValueChange,
  onValueCommit,
  onBlur,
  onKeyDown,
  ...props
}, forwardedRef) {
  const safe = useCompositionSafeValue({ value, onValueChange, onValueCommit });
  return (
    <Input
      {...props}
      ref={forwardedRef}
      value={safe.draft}
      onChange={event => safe.onChange(event.currentTarget.value)}
      onCompositionStart={safe.onCompositionStart}
      onCompositionEnd={event => safe.onCompositionEnd(event.currentTarget.value)}
      onBlur={event => {
        safe.onBlur();
        onBlur?.(event);
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (isNativeComposition(event, safe.composingRef.current)) return;
        onKeyDown?.(event);
      }}
    />
  );
});
