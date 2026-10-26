// skills: canvas
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  H1,
  H3,
  Row,
  setCustomTheme,
  Stack,
  Text,
  TextInput,
  useCanvasAction,
  useCanvasState,
  useHostTheme,
} from "codeflicker/canvas";

type SelectionMap = Record<string, string[]>;
type CustomAnswerMap = Record<string, string>;

// ────── 画布自身的视觉风格（与下方 themePresets 无关）──────
// Canvas style source: references/website-design/themes/A-enterprise-light.md
// 企业亮色风：极浅灰页底 + 白卡 + 中性产品蓝强调，干净克制的「大厂风」。
// 注意：setCustomTheme 会让画布配色固定，不再跟随 IDE 的 dark/light 切换。
setCustomTheme({
  kind: "light",
  palette: {
    // 文字层级 ← --color-text-primary / body / secondary / disabled
    foreground: "#1A1A2E",
    foregroundSecondary: "#4B4D63",
    foregroundTertiary: "#9395A8",
    foregroundQuaternary: "#C0C2CF",
    // 背景层级 ← --color-bg-page / card
    editor: "#F7F8FA",
    chrome: "#FFFFFF",
    sidebar: "#F0F1F5",
    elevated: "#FFFFFF",
    // 填充层级 ← --color-bg-subtle / hover / card
    fillPrimary: "#DFE0E8",
    fillSecondary: "#EBF1FE",
    fillTertiary: "#FFFFFF",
    fillQuaternary: "#F0F1F5",
    // 边框与分隔 ← --color-gray-300 / --color-border / --color-divider
    strokePrimary: "#C0C2CF",
    strokeSecondary: "#DFE0E8",
    strokeTertiary: "#F0F1F5",
    // 品牌主色 ← --color-primary / --color-primary-600
    accent: "#3B6CF4",
    buttonBackground: "#3B6CF4",
    buttonForeground: "#FFFFFF",
    buttonHoverBackground: "#1E54D4",
    link: "#1E54D4",
  },
});

/** A 主题专属常量：8px 圆角、选中浅蓝底、主色边框。 */
const ENTERPRISE = {
  radiusSm: 6,
  radiusMd: 8,
  labelFont: '"Inter", -apple-system, "PingFang SC", "Helvetica Neue", sans-serif',
  labelTracking: "0.06em",
  accentSoft: "#EBF1FE",
  borderStrong: "#3B6CF4",
} as const;

// 生成实际澄清画布时必须替换这里：
// 1. 先实际读取 references/website-design/website-design.md；
// 2. 再实际读取至少一个匹配的 references/website-design/themes/*.md；
// 3. 如用户提供品牌倾向，优先合并用户品牌倾向；
// 4. 在下方写明 Theme source 具体文件，不要只写“来自 website-design”；
// 5. 最多输出 6 个视觉主题，每项使用清晰中文标签，可附带一个 #RRGGBB 代表色用于预览。
// Theme source: references/website-design/themes/A-enterprise-light.md
const themePresets = [
  { label: "蓝色", value: "#3B6CF4" },
  { label: "绿", value: "#18A058" },
  { label: "橙", value: "#F0800A" },
];

/**
 * 把用户输入的颜色统一解析成 #RRGGBB。
 * 支持：#RGB、#RRGGBB（可省略 #）、"25, 25, 25"、"rgb(25 25 25)"。
 * 无法识别或数值越界时返回空字符串。
 */
function parseColorInput(raw: string): string {
  const input = raw.trim();
  if (!input) return "";

  const toHex = (r: number, g: number, b: number) =>
    "#" +
    [r, g, b]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

  const hex = input.replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex
      .split("")
      .map((char) => char + char)
      .join("")
      .toUpperCase()}`;
  }

  const rgbBody = input.replace(/^rgba?\s*\(/i, "").replace(/\)\s*$/, "");
  const channels = rgbBody
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 3);

  if (channels.length === 3 && channels.every((part) => /^\d{1,3}$/.test(part))) {
    const values = channels.map(Number);
    if (values.every((value) => value <= 255)) {
      return toHex(values[0], values[1], values[2]);
    }
  }

  return "";
}

type BriefQuestion = {
  id: string;
  question: string;
  hint: string;
  multi: boolean;
  options: { label: string; value: string }[];
};

const questions: BriefQuestion[] = [
  {
    id: "goal",
    question: "这个页面/网站最重要的目标是什么？",
    hint: "确认首要产品目标",
    multi: false,
    options: [
      { label: "品牌展示 / 作品介绍", value: "brand" },
      { label: "产品介绍 / 转化落地", value: "conversion" },
      { label: "工具型流程 / 数据操作", value: "tool" },
      { label: "内容阅读 / 信息聚合", value: "content" },
      { label: "让 AI 根据需求判断", value: "ai_decide" },
    ],
  },
  {
    id: "audience",
    question: "主要用户是谁？",
    hint: "定义信息密度和表达方式",
    multi: false,
    options: [
      { label: "普通访客 / 消费者", value: "consumer" },
      { label: "业务客户 / 决策者", value: "business" },
      { label: "内部运营 / 管理人员", value: "operator" },
      { label: "创作者 / 社区用户", value: "creator" },
      { label: "暂不确定", value: "unknown" },
    ],
  },
  {
    id: "modules",
    question: "首版必须包含哪些模块？",
    hint: "可多选",
    multi: true,
    options: [
      { label: "首屏核心信息", value: "hero" },
      { label: "功能 / 服务说明", value: "features" },
      { label: "列表 / 卡片内容", value: "list" },
      { label: "表单 / 输入流程", value: "form" },
      { label: "数据图表 / 指标", value: "data" },
      { label: "行动按钮 / 联系入口", value: "cta" },
    ],
  },
  {
    id: "tone",
    question: "整体视觉气质更接近哪类？",
    hint: "影响字体、色彩、空间和组件风格",
    multi: false,
    options: [
      { label: "专业克制", value: "professional" },
      { label: "年轻活跃", value: "playful" },
      { label: "科技感", value: "tech" },
      { label: "内容型 / 编辑感", value: "editorial" },
      { label: "工具型 / 高效率", value: "utility" },
      { label: "让 AI 选择但避免通用模板感", value: "ai_decide" },
    ],
  },
  {
    id: "interaction",
    question: "需要哪些交互能力？",
    hint: "可多选",
    multi: true,
    options: [
      { label: "搜索 / 筛选", value: "search_filter" },
      { label: "表单提交", value: "form_submit" },
      { label: "登录 / 用户状态", value: "auth" },
      { label: "图表联动", value: "chart" },
      { label: "动画 / 状态反馈", value: "motion" },
      { label: "保持静态展示", value: "static" },
    ],
  },
  {
    id: "content",
    question: "内容素材怎么处理？",
    hint: "确认文案、图片和数据来源",
    multi: false,
    options: [
      { label: "我会提供真实内容", value: "user_provided" },
      { label: "先用合理占位内容", value: "placeholder" },
      { label: "AI 先补一版可替换内容", value: "ai_draft" },
    ],
  },
  {
    id: "delivery",
    question: "这次交付到什么程度？",
    hint: "定义完成边界",
    multi: false,
    options: [
      { label: "本地可运行页面", value: "local" },
      { label: "可交互原型", value: "prototype" },
      { label: "接入真实数据 / 登录", value: "real_data" },
      { label: "部署上线", value: "deploy" },
    ],
  },
];

function OptionChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const { tokens } = useHostTheme();

  return (
    <div
      onClick={onClick}
      style={{
        padding: "7px 14px",
        borderRadius: ENTERPRISE.radiusMd,
        border: `1px solid ${selected ? ENTERPRISE.borderStrong : tokens.stroke.secondary}`,
        background: selected ? ENTERPRISE.accentSoft : tokens.fill.tertiary,
        fontSize: 13,
        color: selected ? tokens.text.primary : tokens.text.secondary,
        cursor: "pointer",
        userSelect: "none",
        transition: "border-color 0.12s ease, background 0.12s ease",
        fontWeight: selected ? 500 : 400,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          background: selected ? tokens.accent.primary : tokens.stroke.primary,
        }}
      />
      {label}
    </div>
  );
}

export default function InteractiveBriefTemplate() {
  const { tokens } = useHostTheme();
  const dispatch = useCanvasAction();
  const [selections, setSelections] = useCanvasState<SelectionMap>(
    "website-brief-selections",
    {}
  );
  const [customAnswers, setCustomAnswers] = useCanvasState<CustomAnswerMap>(
    "website-brief-custom-answers",
    {}
  );
  const [themeColor, setThemeColor] = useCanvasState<string>(
    "website-brief-theme-color",
    ""
  );

  const normalizedColor = parseColorInput(themeColor);

  function toggle(questionId: string, value: string, multi: boolean) {
    setSelections((prev) => {
      const current = prev[questionId] ?? [];
      if (multi) {
        return {
          ...prev,
          [questionId]: current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value],
        };
      }
      return { ...prev, [questionId]: [value] };
    });
  }

  function setCustom(questionId: string, value: string) {
    setCustomAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const answeredCount = questions.filter(
    (question) =>
      (selections[question.id] ?? []).length > 0 ||
      (customAnswers[question.id] ?? "").trim().length > 0
  ).length;
  const totalCount = questions.length + 1;
  const completedCount = answeredCount + (normalizedColor ? 1 : 0);

  function buildSummary() {
    const lines = questions
      .map((question) => {
        const selectedValues = selections[question.id] ?? [];
        const custom = (customAnswers[question.id] ?? "").trim();
        if (selectedValues.length === 0 && custom.length === 0) return null;

        const selectedLabels = question.options
          .filter((option) => selectedValues.includes(option.value))
          .map((option) => option.label)
          .join("、");

        const parts = [selectedLabels, custom ? `补充：${custom}` : ""].filter(
          Boolean
        );

        return `${question.question} → ${parts.join("；")}`;
      })
      .filter(Boolean);

    const colorCustom = (customAnswers.themeColor ?? "").trim();
    if (normalizedColor || colorCustom) {
      const colorParts = [
        normalizedColor ? `主题色 ${normalizedColor}` : "",
        colorCustom ? `补充：${colorCustom}` : "",
      ].filter(Boolean);
      lines.push(`主题色偏好 → ${colorParts.join("；")}`);
    }

    return `网站需求确认：\n${lines.join("\n")}`;
  }

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text
          style={{
            fontFamily: ENTERPRISE.labelFont,
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: ENTERPRISE.labelTracking,
            color: tokens.accent.primary,
          }}
        >
          Website Brief
        </Text>
        <H1>网站需求确认</H1>
        <Text tone="secondary">
          点击选项选择，也可在输入框里自定义补充。底部操作条会一直跟随滚动。
        </Text>
      </Stack>

      <Divider />

      {questions.map((question, index) => (
        <Stack key={question.id} gap={10}>
          <Stack gap={2}>
            <Row gap={10} style={{ alignItems: "baseline" }}>
              <Text
                style={{
                  fontFamily: ENTERPRISE.labelFont,
                  fontSize: 11,
                  fontWeight: 700,
                  color: tokens.accent.primary,
                  letterSpacing: ENTERPRISE.labelTracking,
                }}
              >
                Q{index + 1}
              </Text>
              <H3>{question.question}</H3>
            </Row>
            <Text tone="tertiary" size="small" style={{ paddingLeft: 28 }}>
              {question.hint}
            </Text>
          </Stack>
          <Row gap={8} style={{ flexWrap: "wrap", paddingLeft: 28 }}>
            {question.options.map((option) => (
              <OptionChip
                key={option.value}
                label={option.label}
                selected={(selections[question.id] ?? []).includes(option.value)}
                onClick={() => toggle(question.id, option.value, question.multi)}
              />
            ))}
          </Row>
          <div style={{ paddingLeft: 28 }}>
            <TextInput
              value={customAnswers[question.id] ?? ""}
              onChange={(value) => setCustom(question.id, value)}
              placeholder="自定义回答（可选，优先于上方选项）"
            />
          </div>
        </Stack>
      ))}

      <Stack gap={10}>
        <Stack gap={2}>
          <Row gap={10} style={{ alignItems: "baseline" }}>
            <Text
              style={{
                fontFamily: ENTERPRISE.labelFont,
                fontSize: 11,
                fontWeight: 700,
                color: tokens.accent.primary,
                letterSpacing: ENTERPRISE.labelTracking,
              }}
            >
              Q{questions.length + 1}
            </Text>
            <H3>视觉主题想用哪个？</H3>
          </Row>
          <Text tone="tertiary" size="small" style={{ paddingLeft: 28 }}>
            预设主题应按需求从 website-design 中挑选，最多 6 个；色块只是主题代表色，也可取色或直接输入 #3B6CF4 / 25, 25, 25 / rgb(25,25,25)
          </Text>
        </Stack>

        <Row gap={8} style={{ flexWrap: "wrap", paddingLeft: 28 }}>
          {themePresets.map((preset) => {
            const selected = normalizedColor === preset.value;
            return (
              <div
                key={preset.value}
                onClick={() => setThemeColor(preset.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: ENTERPRISE.radiusMd,
                  border: `1px solid ${selected ? ENTERPRISE.borderStrong : tokens.stroke.secondary}`,
                  background: selected
                    ? ENTERPRISE.accentSoft
                    : tokens.fill.tertiary,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: preset.value,
                    border: `1px solid ${tokens.stroke.secondary}`,
                  }}
                />
                <Text size="small" tone={selected ? "primary" : "secondary"}>
                  {preset.label}
                </Text>
              </div>
            );
          })}
        </Row>

        <Row gap={10} style={{ alignItems: "center", paddingLeft: 28 }}>
          <input
            type="color"
            value={normalizedColor || themePresets[0]?.value || "#3B6CF4"}
            onChange={(event) =>
              setThemeColor(event.target.value.toUpperCase())
            }
            style={{
              width: 40,
              height: 28,
              padding: 0,
              borderRadius: ENTERPRISE.radiusSm,
              border: `1px solid ${tokens.stroke.secondary}`,
              background: tokens.fill.tertiary,
              cursor: "pointer",
            }}
          />
          <div style={{ width: 170 }}>
            <TextInput
              value={themeColor}
              onChange={setThemeColor}
              placeholder="#1D4ED8 或 29, 78, 216"
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 10px",
              borderRadius: ENTERPRISE.radiusSm,
              border: `1px solid ${tokens.stroke.secondary}`,
              background: tokens.fill.tertiary,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: normalizedColor || "transparent",
                border: `1px solid ${tokens.stroke.secondary}`,
              }}
            />
            <Text
              size="small"
              tone={normalizedColor ? "primary" : "tertiary"}
              style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
            >
              {normalizedColor ||
                (themeColor.trim() ? "无法识别" : "未选择")}
            </Text>
          </div>
        </Row>

        <div style={{ paddingLeft: 28 }}>
          <TextInput
            value={customAnswers.themeColor ?? ""}
            onChange={(value) => setCustom("themeColor", value)}
            placeholder="自定义补充（如：跟品牌色、高饱和度、需要深浅两套）"
          />
        </div>
      </Stack>

      <Divider />

      <Card>
        <CardHeader>
          <Text
            style={{
              fontFamily: ENTERPRISE.labelFont,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.01em",
              color: tokens.text.primary,
            }}
          >
            AI 默认假设（如果你直接开始）
          </Text>
        </CardHeader>
        <CardBody>
          <Stack gap={6}>
            {[
              "优先保证首屏目标清楚，并让主要行动入口在首屏可见",
              "使用符合场景的视觉系统，避免通用 AI 模板感",
              "先做完整可运行体验，真实内容不足时使用可替换占位内容",
              "需要交互时先完成关键路径，再补充次要状态",
            ].map((assumption, index) => (
              <Row key={index} gap={10} style={{ alignItems: "flex-start" }}>
                <Text
                  style={{
                    fontFamily: ENTERPRISE.labelFont,
                    fontSize: 11,
                    fontWeight: 700,
                    color: tokens.accent.primary,
                    letterSpacing: ENTERPRISE.labelTracking,
                    flexShrink: 0,
                    lineHeight: "20px",
                  }}
                >
                  {index + 1}
                </Text>
                <Text tone="secondary" size="small">
                  {assumption}
                </Text>
              </Row>
            ))}
          </Stack>
        </CardBody>
      </Card>

      {/* 吸底操作条：位于内容末尾（符合阅读顺序），但滚动时始终可见。
          bottom 必须为 0：sticky 的偏移是相对可视滚动区域计算的，写成负值会把操作条
          顶到可视区域下方而被裁切（按钮显示不全）。
          左右负 margin 抵消 canvas runtime 给 #root 的默认左右 padding（32px），
          让背景横向铺满、滚动时不漏边；底部负 margin 抵消 24px 下 padding，
          同时在 padding-bottom 里补回同样的 24px，保证操作条自身高度完整。 */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginBottom: -24,
          marginLeft: -32,
          marginRight: -32,
          padding: "14px 32px 38px",
          background: tokens.bg.chrome,
          borderTop: `1px solid ${tokens.stroke.secondary}`,
          zIndex: 10,
        }}
      >
        <Row gap={12} style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Button
            onClick={() =>
              dispatch({ type: "appendToAgentInput", text: buildSummary() })
            }
            disabled={completedCount === 0}
          >
            提交我的选择
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              dispatch({
                type: "appendToAgentInput",
                text: "按 AI 默认假设直接开始做网站",
              })
            }
          >
            按默认假设直接开始
          </Button>
          <div style={{ flex: 1 }} />
          <div
            style={{
              padding: "3px 12px",
              borderRadius: 999,
              background:
                completedCount === totalCount
                  ? ENTERPRISE.accentSoft
                  : tokens.fill.quaternary,
              border: `1px solid ${
                completedCount === totalCount
                  ? tokens.accent.primary
                  : tokens.stroke.secondary
              }`,
              fontFamily: ENTERPRISE.labelFont,
              fontSize: 12,
              fontWeight: 500,
              color:
                completedCount === totalCount
                  ? tokens.accent.primary
                  : tokens.text.tertiary,
            }}
          >
            {completedCount} / {totalCount} 已回答
          </div>
        </Row>
      </div>
    </Stack>
  );
}
