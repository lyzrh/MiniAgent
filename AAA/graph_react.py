# 第2课：ReAct 循环 + 工具调用（核心）
import re
from datetime import datetime
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

MAX_STEPS = 5


# ---------- 工具：普通函数，输入输出都是字符串 ----------
def calculator(expression: str) -> str:
    if not re.fullmatch(r"[\d+\-*/().\s]+", expression):
        return f"[tool error] bad chars: {expression}"
    try:
        return str(eval(expression))  # 教学用，生产请换表达式解析库
    except Exception as exc:
        return f"[tool error] {exc}"


def get_time() -> str:
    return datetime.now().isoformat(timespec="seconds")


TOOLS = {"calculator": calculator, "get_time": get_time}


# ---------- 状态 ----------
class AgentState(TypedDict):
    question: str
    messages: Annotated[list, add_messages]  # 内置 reducer，按 id 追加/更新
    tool_call: dict | None                   # 本轮要执行的工具调用
    observation: str | None                  # 工具返回结果
    steps: int                               # 防死循环


# ---------- 模拟模型：真实项目里换成 LLM ----------
def agent(state: AgentState) -> dict:
    if state["observation"] is not None:
        return {
            "tool_call": None,
            "messages": [AIMessage(content=f"answer: {state['observation']}")],
        }
    q = state["question"]
    if "time" in q:
        return {"tool_call": {"name": "get_time", "args": {}}}
    if re.search(r"[\d+\-*/]", q):
        return {"tool_call": {"name": "calculator", "args": {"expression": q}}}
    return {"tool_call": None, "messages": [AIMessage(content="no tool needed")]}


# ---------- 工具节点 ----------
def run_tool(state: AgentState) -> dict:
    call = state["tool_call"]
    tool = TOOLS.get(call["name"])
    if tool is None:
        obs = f"[error] unknown tool {call['name']}"
    else:
        try:
            obs = tool(**call["args"])
        except Exception as exc:
            obs = f"[tool error] {exc}"
    return {
        "observation": obs,
        "messages": [ToolMessage(content=obs, tool_call_id=call["name"])],
        "steps": state["steps"] + 1,
    }


# ---------- 条件边：决定继续调工具还是结束 ----------
def should_continue(state: AgentState) -> str:
    if state["steps"] >= MAX_STEPS:
        return "end"
    return "tool" if state["tool_call"] else "end"


def build_agent():
    graph = StateGraph(AgentState)

    graph.add_node("agent", agent)
    graph.add_node("run_tool", run_tool)

    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, {"tool": "run_tool", "end": END})
    graph.add_edge("run_tool", "agent")  # ← 这就是"环"

    return graph.compile()


if __name__ == "__main__":
    app = build_agent()
    for q in ["what time is it", "1+2*3", "hello world"]:
        st = app.invoke({
            "question": q,
            "messages": [],
            "tool_call": None,
            "observation": None,
            "steps": 0,
        })
        print(q, "->", st["messages"][-1].content, "steps=", st["steps"])