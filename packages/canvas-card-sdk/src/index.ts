/** 卡片包开发 SDK —— FDE 包只依赖这一个纯类型包，不依赖 canvas-workbench。
 * 协议真源：docs/canvas-card-pack.zh-CN.md */

/** 卡片节点（平台信封）：字段由平台管，包只读；data 黑盒归包。 */
export interface CardPackNode {
  id: string;
  kind: string;
  title?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  projectFilePath?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 渲染器拿到的 props：平台信封只读，改内容走 onPatch。 */
export interface CardRenderProps {
  node: CardPackNode;
  selected: boolean;
  /** 唯一改卡入口：补丁进画布持久化；data 字段黑盒自管。 */
  onPatch: (patch: { data?: Record<string, unknown>; [field: string]: unknown }) => void;
  /** 宿主打开 projectFilePath 的回调（一期可空）。 */
  onOpenFile?: (path: string) => void;
}

/** 渲染器类型：函数签名即可（React 组件天然兼容 JSX 返回值）。 */
export type CardRenderer = (props: CardRenderProps) => unknown;

/** 服务端动作 handler：返回值是要合入节点/data 的补丁。 */
export type CardPackOpHandler = (
  node: Record<string, unknown> & { id: string },
  params: Record<string, unknown>,
  ctx: {
    projectId: string;
    files: {
      read(projectId: string, relative: string): Promise<string | null>;
      write(projectId: string, relative: string, content: string): Promise<void>;
      /** 二进制文件口（媒体字节）：平台可选能力，未提供时 op 必须显式报错，不得降级为文本写入。 */
      readBytes?(projectId: string, relative: string): Promise<Uint8Array | null>;
      writeBytes?(projectId: string, relative: string, bytes: Uint8Array): Promise<void>;
    };
  },
) => Promise<{ data?: Record<string, unknown>; [field: string]: unknown } | void>
  | { data?: Record<string, unknown>; [field: string]: unknown } | void;

/** 动作注册：裸 handler 只打本 kind；{targets} 可瞄准别的 kind（如核心卡）。 */
export type CardPackOp = CardPackOpHandler | { handler: CardPackOpHandler; targets?: string };

export interface CardPackCard {
  /** `card.<团队>.<名>`；核心 kind（text/image/…）则为覆盖渲染。 */
  kind: string;
  render: CardRenderer;
  ops?: Record<string, CardPackOp>;
}

export interface CardPack {
  name: string;
  cards: CardPackCard[];
}
