# 第1课：State / Node / 条件边
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


# State：整张图共享的数据。
# Annotated[list, reducer] 里的 reducer 决定"节点返回值怎么合并进旧值"。
# 不写 reducer 时节点返回的字段是【覆盖】，这里写成了【追加】。
class MathState(TypedDict):
    number: int
    trace: Annotated[list[str], lambda old, new: old + new]


def classify(state: MathState) -> dict:
    parity = "even" if state["number"] % 2 == 0 else "odd"
    return {"trace": [f"classify: {state['number']} is {parity}"]}


def double_it(state: MathState) -> dict:
    return {"trace": [f"double: {state['number'] * 2}"]}


def square_it(state: MathState) -> dict:
    return {"trace": [f"square: {state['number'] ** 2}"]}


def route(state: MathState) -> str:
    """条件边的路由函数：返回字符串，决定下一个节点。"""
    return "even" if state["number"] % 2 == 0 else "odd"


def build_graph():
    graph = StateGraph(MathState)

    graph.add_node("classify", classify)
    graph.add_node("double_it", double_it)
    graph.add_node("square_it", square_it)

    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", route, {"even": "double_it", "odd": "square_it"})
    graph.add_edge("double_it", END)
    graph.add_edge("square_it", END)

    return graph.compile()


if __name__ == "__main__":
    app = build_graph()
    for num in (7, 8):
        result = app.invoke({"number": num, "trace": []})
        print(num, "->", result["trace"])
