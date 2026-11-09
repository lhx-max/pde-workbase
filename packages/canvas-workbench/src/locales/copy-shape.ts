// Preserve locale key and formatter parity while allowing translated text.
export type CopyShape<T> = T extends (...args: infer Args) => infer Result
  ? (...args: Args) => CopyShape<Result>
  : T extends string
    ? string
    : T extends readonly (infer Item)[]
      ? readonly CopyShape<Item>[]
      : T extends object
        ? { [Key in keyof T]: CopyShape<T[Key]> }
        : T;
