#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""akshare 数据适配器：从 stdin 读 JSON 请求，向 stdout 写 JSON 响应。

请求格式: {"cmd": "<命令>", "args": {...}}
响应格式: {"ok": true, "data": [...]} 或 {"ok": false, "error": "..."}
"""
import sys
import json

import pandas as pd


def _num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        if pd.isna(v):
            return None
        return float(v)
    return v


def lhb(ak, args):
    """龙虎榜详情（按净买额降序，取前 100）。"""
    df = ak.stock_lhb_detail_em(start_date=args["start"], end_date=args["end"])
    mapping = {
        "代码": "code", "名称": "name", "上榜日": "date", "解读": "interpret",
        "收盘价": "close", "涨跌幅": "changePct", "龙虎榜净买额": "netBuy",
        "龙虎榜买入额": "buyAmount", "龙虎榜卖出额": "sellAmount",
        "换手率": "turnover", "流通市值": "floatMv", "上榜原因": "reason",
    }
    out = []
    for _, r in df.iterrows():
        item = {}
        for cn, en in mapping.items():
            if cn in df.columns:
                item[en] = _num(r[cn])
        out.append(item)
    out.sort(key=lambda x: (x.get("netBuy") if x.get("netBuy") is not None else -1e18), reverse=True)
    return out[:100]


def finance_abstract(ak, args):
    """财务摘要：提取关键指标 + 最近 4 期数值。"""
    df = ak.stock_financial_abstract(symbol=args["code"])
    label_col = df.columns[1]  # 指标名称列
    period_cols = [str(c) for c in df.columns[2:6]]  # 最近 4 期
    keywords = [
        "归母净利润", "营业总收入", "每股收益", "每股净资产", "净资产收益率",
        "毛利率", "净利率", "资产负债率", "同比",
    ]
    rows = []
    for _, r in df.iterrows():
        label = str(r[label_col])
        if not any(k in label for k in keywords):
            continue
        row = {"indicator": label}
        for c in period_cols:
            row[c] = _num(r[c])
        rows.append(row)
    # 摘要里同一指标可能出现多行（不同口径），按指标名去重并保留第一条。
    seen = set()
    unique = []
    for row in rows:
        if row["indicator"] in seen:
            continue
        seen.add(row["indicator"])
        unique.append(row)
    return {"periods": period_cols, "indicators": unique}


def sector_spot(ak, args):
    """行业板块实时快照（含资金流，字段较全）。"""
    df = ak.stock_board_industry_name_em()
    return df.to_dict("records")


def sector_flow(ak, args):
    """同花顺行业/概念板块资金流（净额单位：亿元 → 转成元）。"""
    kind = args.get("type", "industry")
    period = args.get("period", "即时")
    fn = ak.stock_fund_flow_concept if kind == "concept" else ak.stock_fund_flow_industry
    df = fn(symbol=period)
    out = []
    for _, r in df.iterrows():
        name = r.get("行业")
        if not name:
            continue
        net_yi = _num(r.get("净额"))
        in_yi = _num(r.get("流入资金"))
        out_yi = _num(r.get("流出资金"))
        out.append({
            "name": str(name),
            "changePct": _num(r.get("行业-涨跌幅")),
            "mainNetInflow": None if net_yi is None else round(float(net_yi) * 1e8, 2),
            "inflow": None if in_yi is None else round(float(in_yi) * 1e8, 2),
            "outflow": None if out_yi is None else round(float(out_yi) * 1e8, 2),
            "companyCount": _num(r.get("公司家数")),
            "leadName": r.get("领涨股") if isinstance(r.get("领涨股"), str) else "",
            "leadPct": _num(r.get("领涨股-涨跌幅")),
        })
    out.sort(key=lambda x: (x["mainNetInflow"] if x["mainNetInflow"] is not None else -1e18), reverse=True)
    return out


DISPATCH = {
    "lhb": lhb,
    "finance_abstract": finance_abstract,
    "sector_spot": sector_spot,
    "sector_flow": sector_flow,
}


def main():
    try:
        # Windows 控制台默认编码常是 GBK：stdin 必须按 UTF-8 字节解码，
        # 否则中文参数（如 period="即时"）会变成乱码导致 akshare 拒绝。
        raw = sys.stdin.buffer.read().decode("utf-8", "replace")
        req = json.loads(raw)
        cmd = req.get("cmd")
        if cmd not in DISPATCH:
            raise ValueError("unknown cmd: " + str(cmd))
        import akshare as ak
        data = DISPATCH[cmd](ak, req.get("args", {}))
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=True, default=str))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=True))


if __name__ == "__main__":
    main()
