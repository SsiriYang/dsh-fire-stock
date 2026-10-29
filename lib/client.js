window.__ModuleLoader__.load({
	id: "dsh-fire-stock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ------------------------------------------------------------------
		// 依赖：react 与官方设置表单原语。原语缺失时整体降级为只读卡片，
		// 绝不让 slot 条目抛异常（抛异常会被宿主整块卸载）。
		// ------------------------------------------------------------------
		const { jsx, jsxs } = require("react/jsx-runtime");
		const React = require("react");

		let primitives = null;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (e) {
			primitives = null;
			console.error("[dsh-fire-stock] 设置表单原语不可用，降级为只读卡片：", e);
		}

		/** 字典命名空间。 */
		const NS = "settings.fireStock";
		/** Host 插件条目 id —— 与 cordis.patch.yml 里 insert 的 id 一致。 */
		const ENTRY_NS = "dsh-fire-stock";
		/** 设置页状态接口（Host 侧由 index.js 注册）。 */
		const OVERVIEW_URL = "/dsh-fire-stock/overview";

		// ------------------------------------------------------------------
		// 可编辑字段：与 Host 侧 src/config.js 的 Config schema 一一对应。
		// ------------------------------------------------------------------
		const FIELDS = [
			{ key: "backtestCount", zh: "回测 K 线根数", zhHint: "40–800，默认 250", en: "Backtest bars", enHint: "40–800, default 250" },
			{ key: "initialCapital", zh: "初始资金（元）", zhHint: "默认 100000", en: "Initial capital", enHint: "Default 100000" },
			{ key: "maFast", zh: "均线快线周期", zhHint: "默认 5", en: "Fast MA", enHint: "Default 5" },
			{ key: "maSlow", zh: "均线慢线周期", zhHint: "默认 20", en: "Slow MA", enHint: "Default 20" },
			{ key: "rsiPeriod", zh: "RSI 周期", zhHint: "默认 14", en: "RSI period", enHint: "Default 14" },
			{ key: "rsiOversold", zh: "RSI 超卖阈值", zhHint: "默认 30", en: "RSI oversold", enHint: "Default 30" },
			{ key: "rsiOverbought", zh: "RSI 超买阈值", zhHint: "默认 70", en: "RSI overbought", enHint: "Default 70" },
			{ key: "kdjPeriod", zh: "KDJ 周期", zhHint: "默认 9", en: "KDJ period", enHint: "Default 9" },
			{ key: "breakoutPeriod", zh: "N 日突破窗口", zhHint: "默认 20", en: "Breakout window", enHint: "Default 20" },
			{ key: "bollPeriod", zh: "布林带周期", zhHint: "默认 20", en: "Bollinger period", enHint: "Default 20" },
			{ key: "watchChangePct", zh: "盯盘涨跌幅阈值（%）", zhHint: "默认 3", en: "Watch change %", enHint: "Default 3" },
			{ key: "watchVolumeRatio", zh: "盯盘放量倍数", zhHint: "默认 2", en: "Watch volume ratio", enHint: "Default 2" },
		];

		const zh = {
			title: "股票助手（FIRE）",
			description: "A 股行情、技术分析、自选股盯盘、选股与回测：21 个工具由 Agent 调用，参数在这里统一设置。",
			statusTitle: "实时状态",
			recentAlertsTitle: "最近告警",
			noAlerts: "（暂无告警）",
			capsTitle: "可用能力",
			paramsTitle: "默认参数",
			paramsNote: "这些是工具未显式传参时的默认值，保存后立即生效，无需重启。",
			watchlistCount: "自选股",
			watchState: "盯盘",
			threshold: "告警规则",
			alertCount: "告警记录",
			watching: "已开启",
			idle: "未开启",
			unitStock: "只",
			unitAlert: "条",
			statusLoading: "正在读取状态…",
			statusUnavailable: "状态暂不可用（不影响参数保存与工具调用）。",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			invalidNumber: "请填数字；留空表示使用默认值。",
		};
		const en = {
			title: "FIRE Stock",
			description: "A-share quotes, technical analysis, watchlist monitoring, screening and backtests — 21 tools for the Agent, tuned here.",
			statusTitle: "Live status",
			recentAlertsTitle: "Recent alerts",
			noAlerts: "(no alerts yet)",
			capsTitle: "Capabilities",
			paramsTitle: "Defaults",
			paramsNote: "Used when a tool call omits the argument. Saving takes effect immediately.",
			watchlistCount: "Watchlist",
			watchState: "Monitor",
			threshold: "Alert rules",
			alertCount: "Alerts",
			watching: "On",
			idle: "Off",
			unitStock: "",
			unitAlert: "",
			statusLoading: "Reading status…",
			statusUnavailable: "Status unavailable (saving and tools still work).",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			invalidNumber: "Enter a number, or leave blank to use the default.",
		};
		for (const f of FIELDS) {
			zh[f.key] = f.zh;
			zh[f.key + "Hint"] = f.zhHint;
			en[f.key] = f.en;
			en[f.key + "Hint"] = f.enHint;
		}

		// ------------------------------------------------------------------
		// 样式：只用宿主主题 token（--dsw-alias-*），跟随明暗主题。
		// ------------------------------------------------------------------
		const S = {
			wrap: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "760px" },
			head: { display: "flex", flexDirection: "column", gap: "4px" },
			title: { margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			desc: { margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)" },
			sectionTitle: { margin: 0, fontSize: "13px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: "8px" },
			cell: { border: "0.5px solid var(--dsw-alias-border-l2)", borderRadius: "8px", padding: "9px 12px", display: "flex", flexDirection: "column", gap: "2px" },
			cellLabel: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" },
			cellValue: { fontSize: "15px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			chips: { display: "flex", flexWrap: "wrap", gap: "6px" },
			chip: { fontSize: "11px", lineHeight: "18px", padding: "0 8px", borderRadius: "999px", border: "0.5px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-tertiary)" },
			note: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" },
			alertList: { display: "flex", flexDirection: "column", gap: "4px" },
			alertRow: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12px", lineHeight: "18px" },
			alertTime: { color: "var(--dsw-alias-label-tertiary)", fontVariantNumeric: "tabular-nums", flex: "0 0 auto" },
			alertText: { color: "var(--dsw-alias-label-primary)", minWidth: 0 },
			block: { display: "flex", flexDirection: "column", gap: "8px" },
		};

		/**
		 * 读取设置页状态接口；失败一律降级为 null，不影响表单。
		 * 30 秒轮询让盯盘开关在页面上保持最新。
		 */
		function useOverview() {
			const [state, setState] = React.useState({ loading: true, data: null });
			React.useEffect(() => {
				let alive = true;
				const load = () => {
					let request;
					try {
						request = fetch(OVERVIEW_URL, { headers: { accept: "application/json" }, credentials: "same-origin" });
					} catch {
						if (alive) setState({ loading: false, data: null });
						return;
					}
					request
						.then((res) => (res && res.ok ? res.json() : Promise.reject(new Error("HTTP " + (res ? res.status : "?")))))
						.then((data) => { if (alive) setState({ loading: false, data: data && data.ok ? data : null }); })
						.catch(() => { if (alive) setState({ loading: false, data: null }); });
				};
				load();
				const timer = setInterval(load, 30000);
				return () => { alive = false; clearInterval(timer); };
			}, []);
			return state;
		}

		/** ISO 时间 → 本地 "MM-DD HH:MM"（告警列表用）。 */
		function alertTimeText(iso) {
			if (!iso) return "--:--";
			const d = new Date(iso);
			if (Number.isNaN(d.getTime())) return String(iso).slice(11, 16) || "--:--";
			const p = (n) => String(n).padStart(2, "0");
			return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
		}

		/** 实时状态 + 能力清单 + 最近告警：纯展示，取不到就显示一行说明。 */
		function StatusBlock(props) {
			const t = props.t;
			const { loading, data } = useOverview();
			if (loading) return jsx("p", { style: S.note, children: t("statusLoading") });
			if (!data) return jsx("p", { style: S.note, children: t("statusUnavailable") });
			const rules = data.watch && data.watch.rules ? data.watch.rules : {};
			const cells = [
				{ label: t("watchlistCount"), value: String(data.watchlistCount == null ? 0 : data.watchlistCount) + " " + t("unitStock") },
				{ label: t("watchState"), value: data.watch && data.watch.enabled ? t("watching") : t("idle") },
				{ label: t("threshold"), value: "±" + (rules.changePctThreshold == null ? 3 : rules.changePctThreshold) + "% / " + (rules.volumeRatio == null ? 2 : rules.volumeRatio) + "x" },
				{ label: t("alertCount"), value: String(data.alertCount == null ? 0 : data.alertCount) + " " + t("unitAlert") },
			];
			const groups = Array.isArray(data.capabilities) ? data.capabilities : [];
			const children = [
				jsx("p", { style: S.sectionTitle, children: t("statusTitle") }, "status"),
				jsxs("div", {
					style: S.grid,
					children: cells.map((cell, i) =>
						jsxs("div", {
							style: S.cell,
							children: [
								jsx("span", { style: S.cellLabel, children: cell.label }),
								jsx("span", { style: S.cellValue, children: cell.value }),
							],
						}, "cell-" + i)),
				}, "cells"),
			];
			if (groups.length > 0) {
				children.push(jsx("p", { style: S.sectionTitle, children: t("capsTitle") }, "caps-title"));
				children.push(jsx("div", {
					style: S.chips,
					children: groups.map((g, i) =>
						jsx("span", { style: S.chip, children: g.group + " · " + (g.tools || []).length }, "chip-" + i)),
				}, "chips"));
			}
			children.push(jsx("p", { style: S.sectionTitle, children: t("recentAlertsTitle") }, "alerts-title"));
			const alerts = Array.isArray(data.recentAlerts) ? data.recentAlerts : [];
			if (alerts.length === 0) {
				children.push(jsx("p", { style: S.note, children: t("noAlerts") }, "alerts-empty"));
			} else {
				children.push(jsx("div", {
					style: S.alertList,
					children: alerts.map((a, i) => jsxs("div", {
						style: S.alertRow,
						children: [
							jsx("span", { style: S.alertTime, children: alertTimeText(a.ts) }),
							jsx("span", {
								style: S.alertText,
								children: (a.name || a.code || "") + (a.code ? "(" + a.code + ")" : "") + " " + (a.message || "") + (a.price != null ? " 现价 " + a.price : "")
							})
						]
					}, "alert-" + i))
				}, "alerts"));
			}
			return jsx("div", { style: S.block, children: children });
		}

		/** 卡片头：标题 + 描述。 */
		function Header(props) {
			return jsxs("div", {
				style: S.head,
				children: [
					jsx("h3", { style: S.title, children: props.t("title") }),
					jsx("p", { style: S.desc, children: props.t("description") }),
				],
			});
		}

		/** 数字字段表单的公共渲染（有原语时）。 */
		function fieldsOf(t, state, props) {
			return FIELDS.map((f) =>
				jsx(primitives.SettingsValueField, {
					id: "plugin-config-fire-stock-" + f.key,
					label: t(f.key),
					hint: t(f.key + "Hint"),
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					invalidLabel: t("invalidNumber"),
					numeric: true,
					disabled: !state.writable,
					...state[f.key],
					onEdit: (text) => { props.edit(f.key, text); },
					onReset: () => { props.resetField(f.key); },
				}, f.key));
		}

		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving"),
			};
		}

		/** 正式卡片：标题、描述、实时状态、能力清单、参数表单。 */
		function FireStockCard(props) {
			const t = typeof props.t === "function" ? props.t : (k) => k;
			// hook 必须无条件调用：同一组件实例会在 summary / page 之间切换。
			const state = props.useFireStockCard((snapshot) => snapshot);
			if (props.view === "summary") return t("description");
			return jsxs("div", {
				style: S.wrap,
				children: [
					jsx(Header, { t }, "head"),
					jsx(StatusBlock, { t }, "status-block"),
					jsxs("div", {
						style: S.block,
						children: [
							jsx("p", { style: S.sectionTitle, children: t("paramsTitle") }, "params-title"),
							jsx("p", { style: S.note, children: t("paramsNote") }, "params-note"),
						],
					}, "params-head"),
					jsx(primitives.SettingsForm, {
						labels: formLabels(t),
						state: state,
						onSave: props.save,
						onDiscard: props.discard,
						children: fieldsOf(t, state, props),
					}, "form"),
				],
			});
		}

		/** 降级卡片：原语不可用时只展示说明与状态，绝不抛异常。 */
		function ReadOnlyCard(props) {
			const t = typeof props.t === "function" ? props.t : (k) => k;
			if (props.view === "summary") return t("description");
			return jsxs("div", {
				style: S.wrap,
				children: [
					jsx(Header, { t }, "head"),
					jsx(StatusBlock, { t }, "status-block"),
					jsx("p", { style: S.note, children: t("statusUnavailable") }, "note"),
				],
			});
		}

		/** 把 `configForms` 的作用域桥接成页面的快照与动作。 */
		class FireStockCardController {
			constructor(scope) {
				this.form = new primitives.SettingsFormModel(
					scope,
					FIELDS.map((f) => primitives.settingsNumberField(f.key)),
				);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				const out = { ...this.form.shell() };
				for (const f of FIELDS) out[f.key] = this.form.field(f.key);
				return out;
			}
			inject() {
				return { hooks: { fireStockCard: this.store }, ...this.form.actions() };
			}
			dispose() {
				this.form.dispose();
			}
		}

		const inject = ["slots", "locale", "configForms"];

		/**
		 * 在宿主服务该配置命名空间期间，把卡片挂到「插件」页。
		 * @param ctx - 浏览器端 cordis 上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-fire-stock: dictionaries");
			const t = ctx.locale.bind(NS);

			let card = null;
			if (primitives) {
				try {
					card = new FireStockCardController(ctx.configForms.get(ENTRY_NS));
					ctx.effect(() => () => card.dispose(), "dsh-fire-stock: form subscription");
				} catch (e) {
					console.error("[dsh-fire-stock] 设置表单初始化失败，降级为只读卡片：", e);
					card = null;
				}
			}

			const component = card ? FireStockCard : ReadOnlyCard;
			const props = card ? () => card.inject() : () => ({});

			ctx.effect(
				() =>
					ctx.configForms.whileServed([ENTRY_NS], () =>
						ctx.slots.inject("plugins.item", () =>
							ctx.slots.register(
								{
									name: "plugins.item",
									id: "fire-stock",
									order: 10,
									label: () => t("title"),
									locale: NS,
									inject: props,
								},
								component,
							),
						),
					),
				"dsh-fire-stock: settings card",
			);
		}

		exports.NS = NS;
		exports.ENTRY_NS = ENTRY_NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
