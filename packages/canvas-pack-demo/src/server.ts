/** 服务端挂载入口：只声明卡片元数据与动作 handler，不引入 React。
 * 画布服务端 `apps/server/src/card-packs.ts` 从这里取 kinds/ops 做注册；
 * 渲染组件仍由前端 `packs.ts` 挂 `./index`。 */
const demoPackServer = {
  packId: 'demo',
  name: '@bezier/canvas-pack-demo',
  cards: [
    { kind: 'card.demo.memo' },
  ],
};

export default demoPackServer;
