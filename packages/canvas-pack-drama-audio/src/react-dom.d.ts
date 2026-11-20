// 卡包只用到 react-dom 的 createPortal；声明它即可，不必为此新增 @types/react-dom 依赖。
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
