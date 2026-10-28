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
    return {"periods": period_cols, "indicators": rows}


def sector_spot(ak, args):
    """行业板块实时快照（含资金流，字段较全）。"""
    df = ak.stock_board_industry_name_em()
    return df.to_dict("records")


DISPATCH = {
    "lhb": lhb,
    "finance_abstract": finance_abstract,
    "sector_spot": sector_spot,
}


def main():
    try:
        req = json.loads(sys.stdin.read())
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
