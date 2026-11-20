// ============================================================
// 一个最小的 Agent（ReAct 模式）
// 从上往下读即可，按"骨架"分成了 6 部分：
//   1. 类型定义（先搞清楚数据结构长啥样）
//   2. 工具（Agent 能用的"手"）
//   3. LLM（Agent 的大脑，先 Mock 后真）
//   4. 解析模型回复（把文本变成能操作的对象）
//   5. Agent 主循环（Thought → Action → Observation → 循环）
//   6. 运行
// ============================================================

// ------------------------------------------------------------
// 【第 1 部分】类型定义
// ------------------------------------------------------------
// TS 里的 type 就是给"某种数据结构"起名字、规定它包含哪些字段。
// 写清楚类型后，后面用起来编辑器会提示你有哪些字段可写，写错了也会报错。

// 一条聊天消息
// role 只能是 "system"、"user"、"assistant" 三者之一
// 这是 TS 的"字面量类型"，比写 string 更严格
type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

// 一个工具（Agent 能调用的功能）长啥样
type Tool = {
  name: string;                              // 工具名（模型用它来调用）
  description: string;                       // 描述（告诉模型这工具干啥用）
  run: (input: string) => Promise<string>;   // 执行函数：输入字符串，返回字符串
};

// ------------------------------------------------------------
// 【第 2 部分】定义工具
// ------------------------------------------------------------
// 咱们先做两个小工具：算数、看时间。
// 注意 run 前面加 async，返回的就是 Promise<string>。
// async 函数内部可以用 await，await 就是"等一等，等它完成"。

const calculatorTool: Tool = {
  name: "calculator",
  description: "计算一个数学表达式，比如 (1+2)*3",
  async run(input: string): Promise<string> {
    // 简单校验：只允许数字、+ - * / ( ) . 和空格
    // /^...$/ 是正则，test 就是"匹配上了吗"
    if (!/^[\d+\-*/().\s]+$/.test(input)) {
      // throw 就是"报错"，外面可以 try/catch 接住
      throw new Error(`表达式里有非法字符：${input}`);
    }
    // ⚠️ eval 不安全，这里只是教学简化
    // 生产环境要用专门的表达式解析库
    const result = eval(input);
    return String(result);
  },
};

const timeTool: Tool = {
  name: "get_time",
  description: "获取当前时间，不需要参数",
  async run(): Promise<string> {
    return new Date().toISOString();
  },
};

// 把所有工具放进一个普通对象里
// key 是工具名，value 是工具
// Record<string, Tool> 意思就是"键是字符串、值是 Tool 的对象"
const tools: Record<string, Tool> = {
  calculator: calculatorTool,
  get_time: timeTool,
};

// 把所有工具的描述拼成一段文字，等会塞进 prompt 告诉模型
// Object.values(tools) 拿出所有工具，.map 对每个处理一下，.join 拼成一个字符串
function describeTools(): string {
  return Object.values(tools)
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}

// ------------------------------------------------------------
// 【第 3 部分】调用 LLM
// ------------------------------------------------------------
// 这一层把"发消息、拿回复"封装成一个函数。
// 先给你一个 Mock 版本，不用 API Key 就能跑。

// 预设的回复，像剧本一样一句一句往下读
const mockReplies: string[] = [
  "Thought: 先算一下 1+2\nAction: calculator\nAction Input: 1+2",
  "Thought: 得到 3，再乘以 3\nAction: calculator\nAction Input: 3*3",
  "Thought: 算出来了\nFinal Answer: (1+2)*3 = 9",
];

// 记录当前读到第几条
let mockIndex = 0;

// 调用 LLM 的函数：输入一整个消息列表，返回模型的一句话
async function callLLM(messages: Message[]): Promise<string> {
  // 模拟一点网络延迟，更像真的
  await new Promise((r) => setTimeout(r, 100));

  // 从剧本里拿下一句
  const reply = mockReplies[mockIndex];

  // 注意：strict 模式下，数组越界拿到的是 undefined
  // 所以要判断一下
  if (reply === undefined) {
    throw new Error("Mock 剧本用完了");
  }

  mockIndex += 1;
  return reply;

  // ============================================================
  // 想换成真的模型（比如 OpenAI）？把上面这几行删掉，换成下面这段：
  //
  //   const res = await fetch("https://api.openai.com/v1/chat/completions", {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //       Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  //     },
  //     body: JSON.stringify({
  //       model: "gpt-4o-mini",
  //       messages: messages,
  //     }),
  //   });
  //   if (!res.ok) throw new Error(`HTTP ${res.status}`);
  //   const data: any = await res.json();
  //   return data.choices[0].message.content;
  //
  // 运行时用：OPENAI_API_KEY=sk-xxx npx tsx agent.ts
  // ============================================================
}

// ------------------------------------------------------------
// 【第 4 部分】解析模型的回复
// ------------------------------------------------------------
// 模型只会吐"文本"，我们要把它拆成能操作的对象。
// 三种可能：
//   - 想调工具  → { kind: "action", action, actionInput }
//   - 想给答案  → { kind: "final", finalAnswer }
//   - 乱答一通  → { kind: "error", reason }
//
// 这个写法叫"可辨识联合"，就是"用 kind 这个字段区分类型"。
// 后面写 if (parsed.kind === "action") 时，TS 会自动知道有哪些字段可用。

type ParseResult =
  | { kind: "action"; action: string; actionInput: string }
  | { kind: "final"; finalAnswer: string }
  | { kind: "error"; reason: string };

function parseReply(reply: string): ParseResult {
  // ① 找 "Final Answer: xxx"（中英文冒号都支持）
  // match 匹配成功会返回一个数组，[0] 是整段，[1] 是括号里的内容
  const finalMatch = reply.match(/Final Answer\s*[:：]\s*([\s\S]*)/i);
  if (finalMatch) {
    return { kind: "final", finalAnswer: finalMatch[1].trim() };
  }

  // ② 找 "Action: 工具名" 和 "Action Input: 输入"
  const actionMatch = reply.match(/Action\s*[:：]\s*(\w+)/i);
  const inputMatch = reply.match(/Action Input\s*[:：]\s*([\s\S]*)/i);

  if (actionMatch && inputMatch) {
    return {
      kind: "action",
      action: actionMatch[1].trim(),
      actionInput: inputMatch[1].trim(),
    };
  }

  // ③ 都没有 → 格式不对
  return { kind: "error", reason: "既没有 Final Answer 也没有 Action" };
}

// ------------------------------------------------------------
// 【第 5 部分】Agent 主循环
// ------------------------------------------------------------
// 核心就是一个 for 循环，最多跑 MAX_STEPS 步。
// 每一步：
//   1) 调模型拿一句话
//   2) 解析这句话
//   3) 根据解析结果分三种情况处理

async function runAgent(task: string): Promise<string> {
  // 消息历史，一开始有两条：
  //   system：给模型的"说明书"（包含工具清单、回答格式）
  //   user：用户的任务
  const messages: Message[] = [
    {
      role: "system",
      content: `你是一个会用工具的助手。可用工具：
${describeTools()}

请严格按以下格式回答：

【需要用工具时】
Thought: 你的思考
Action: 工具名
Action Input: 工具输入

【可以直接回答时】
Thought: 你的思考
Final Answer: 最终答案

一次只输出一个 Action，不要自己编造 Observation。`,
    },
    { role: "user", content: task },
  ];

  const MAX_STEPS = 8;

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n========== 第 ${step} 步 ==========`);

    // ------- 1. 调模型 -------
    let reply: string;
    try {
      reply = await callLLM(messages);
    } catch (err) {
      // 用 unknown 接住错误再判断，是 TS 里处理 catch 的标准做法
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`第 ${step} 步调用 LLM 失败：${msg}`);
    }

    console.log("🤖 模型说：\n" + reply);

    // 把模型的回复也记进历史，让它下一轮能看到自己说过啥
    messages.push({ role: "assistant", content: reply });

    // ------- 2. 解析 -------
    const parsed = parseReply(reply);

    // ------- 3. 分三种情况处理 -------

    // 3a. 拿到最终答案 → 直接返回
    if (parsed.kind === "final") {
      return parsed.finalAnswer;
    }

    // 3b. 格式不对 → 不抛错，把原因喂回给模型，让它重写
    if (parsed.kind === "error") {
      console.log(`⚠️ 格式错误：${parsed.reason}`);
      messages.push({
        role: "user",
        content: `Observation: [格式错误] ${parsed.reason}。请按约定格式重新回答。`,
      });
      continue; // 进入下一轮
    }

    // 3c. 要调用工具
    const tool = tools[parsed.action];
    let observation: string;

    if (!tool) {
      // 工具名不存在 → 也是给模型一个反馈
      observation = `[错误] 工具 "${parsed.action}" 不存在。可用工具：${Object.keys(tools).join(", ")}`;
    } else {
      // 执行工具。工具报错也接住，转成一句话给模型看
      try {
        observation = await tool.run(parsed.actionInput);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        observation = `[工具报错] ${msg}`;
      }
    }

    console.log(`🔧 工具结果：${observation}`);

    // 把 observation 作为"用户消息"塞回历史，进入下一轮
    messages.push({ role: "user", content: `Observation: ${observation}` });
  }

  // 循环跑完还没答案
  throw new Error(`跑了 ${MAX_STEPS} 步还没得到答案，可能陷入死循环了`);
}

// ------------------------------------------------------------
// 【第 6 部分】运行
// ------------------------------------------------------------

// top-level await：直接在文件顶层用 await，tsx 支持
const answer = await runAgent("请计算 (1+2)*3 的值");

console.log("\n✅ 最终答案：");
console.log(answer);