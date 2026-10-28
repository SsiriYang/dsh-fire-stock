window.__ModuleLoader__.load({
	id: "dsh-fire-stock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ------------------------------------------------------------------
		// 排障信标：浏览器控制台拿不到时，把每一步的结果 POST 到本地监听端口，
		// 宿主/浏览器任一侧静默失败都能留下证据。失败也不影响任何主线逻辑。
		// ------------------------------------------------------------------
		const BEACON = "http://127.0.0.1:7899/diag";
		function beacon(stage, extra) {
			try {
				const body = JSON.stringify({ stage: stage, extra: extra || null });
				if (typeof navigator !== "undefined" && navigator.sendBeacon) {
					navigator.sendBeacon(BEACON, body);
					return;
				}
				fetch(BEACON, { method: "POST", mode: "no-cors", body: body }).catch(function () {});
			} catch (e) {
				/* 信标失败不影响插件 */
			}
		}
		beacon("module-start", { href: String((typeof location !== "undefined" && location.href) || "").slice(0, 120) });

		// ------------------------------------------------------------------
		// 依赖全部容错加载：任何一个 require 失败都不能让模块加载中断，
		// 否则浏览器只会往控制台丢一行错，页面上什么都看不到。
		// ------------------------------------------------------------------
		const diag = { primitives: "", jsx: "", configForms: "", locale: "", card: "", error: "" };
		function errText(e) {
			if (!e) return "unknown";
			return String((e && e.message) || e);
		}

		let primitives = null;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
			diag.primitives = "ok";
		} catch (e) {
			diag.primitives = "失败: " + errText(e);
		}

		let h = null; // jsx 工厂
		try {
			const rt = require("react/jsx-runtime");
			h = { jsx: rt.jsx, jsxs: rt.jsxs };
			diag.jsx = "ok (react/jsx-runtime)";
		} catch (e) {
			try {
				const react = require("react");
				h = { jsx: react.createElement, jsxs: react.createElement };
				diag.jsx = "ok (react.createElement 兜底)";
			} catch (e2) {
				diag.jsx = "失败: " + errText(e) + " / " + errText(e2);
			}
		}

		const LOCALE_NS = "settings.fireStock";
		const ENTRY_NS = "dsh-fire-stock";
		beacon("require-done", { primitives: diag.primitives, jsx: diag.jsx });

		const FIELDS = [
			{ key: "backtestCount", zh: "回测 K 线根数", zhHint: "40–800，默认 250", en: "Backtest bars" },
			{ key: "initialCapital", zh: "初始资金（元）", zhHint: "默认 100000", en: "Initial capital" },
			{ key: "maFast", zh: "均线快线周期", zhHint: "默认 5", en: "Fast MA" },
			{ key: "maSlow", zh: "均线慢线周期", zhHint: "默认 20", en: "Slow MA" },
			{ key: "rsiPeriod", zh: "RSI 周期", zhHint: "默认 14", en: "RSI period" },
			{ key: "rsiOversold", zh: "RSI 超卖阈值", zhHint: "默认 30", en: "RSI oversold" },
			{ key: "rsiOverbought", zh: "RSI 超买阈值", zhHint: "默认 70", en: "RSI overbought" },
			{ key: "kdjPeriod", zh: "KDJ 周期", zhHint: "默认 9", en: "KDJ period" },
			{ key: "breakoutPeriod", zh: "N 日突破窗口", zhHint: "默认 20", en: "Breakout window" },
			{ key: "bollPeriod", zh: "布林带周期", zhHint: "默认 20", en: "Bollinger period" },
			{ key: "watchChangePct", zh: "盯盘涨跌幅阈值（%）", zhHint: "默认 3", en: "Watch change %" },
			{ key: "watchVolumeRatio", zh: "盯盘放量倍数", zhHint: "默认 2", en: "Watch volume ratio" },
		];

		const zh = {
			title: "股票助手（FIRE）",
			description: "财富自由 FIRE · A 股行情、技术分析、自选股与盯盘参数",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			invalidNumber: "请填数字；留空表示使用默认值。",
		};
		const en = { title: "FIRE Stock", description: "Wealth freedom (FIRE): A-share quotes and analysis" };
		for (const f of FIELDS) {
			zh[f.key] = f.zh;
			zh[f.key + "Hint"] = f.zhHint;
			en[f.key] = f.en;
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

		/** 正式卡片：12 个数字字段。任何异常都以文本形式显示，绝不静默消失。 */
		let renderBeaconed = "";
		function FireStockCard(props) {
			try {
				const view = String((props && props.view) || "");
				if (renderBeaconed !== view) {
					renderBeaconed = view;
					beacon("card-render", { view, props: Object.keys(props || {}).slice(0, 24) });
				}
				const t = (props && props.t) || ((k) => k);
				if (view === "summary") {
					let text = "";
					try {
						text = props && props.t ? String(props.t("description") || "") : "";
					} catch {
						text = "";
					}
					if (!text || text === "description") text = "A 股行情、技术分析、自选股与盯盘参数";
					beacon("summary-text", { text });
					return text;
				}
				const hook = props && props.useFireStockCard;
				if (typeof hook !== "function") throw new Error("props.useFireStockCard 缺失");
				const state = hook((snapshot) => snapshot);
				const fields = FIELDS.map((f) =>
					h.jsx(
						primitives.SettingsValueField,
						{
							id: "plugin-config-fire-stock-" + f.key,
							label: t(f.key),
							hint: t(f.key + "Hint"),
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							numeric: true,
							disabled: !state.writable,
							...state[f.key],
							onEdit: (text) => props.edit(f.key, text),
							onReset: () => props.resetField(f.key),
						},
						f.key,
					),
				);
				return h.jsxs(primitives.SettingsForm, {
					labels: formLabels(t),
					state,
					onSave: props.save,
					onDiscard: props.discard,
					children: fields,
				});
			} catch (e) {
				beacon("card-error", { error: errText(e), view: String((props && props.view) || "") });
				return "股票助手：渲染出错（" + errText(e) + "）";
			}
		}

		/** 诊断卡片：把每个环节的结果直接写在页面上。 */
		function DiagCard(props) {
			if (props.view === "summary") return "诊断：" + diag.card;
			const lines = [
				"插件 dsh-fire-stock",
				"primitives：" + diag.primitives,
				"jsx：" + diag.jsx,
				"configForms：" + diag.configForms,
				"locale：" + diag.locale,
				"卡片：" + diag.card,
				diag.error ? "异常：" + diag.error : "",
			].filter(Boolean);
			return lines.join(" ｜ ");
		}

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
		const noopFace = () => ({
			hooks: { fireStockCard: () => ({ writable: false }) },
			save() {},
			discard() {},
			edit() {},
			resetField() {},
		});

		function apply(ctx) {
			beacon("apply-enter", {
				keys: ctx && typeof ctx === "object" ? Object.keys(ctx).slice(0, 40) : String(ctx),
			});
			const get = (name) => {
				try {
					return ctx.get ? ctx.get(name) : ctx[name];
				} catch {
					return undefined;
				}
			};

			// ① 先注册卡片：这是唯一必须成功的一件事，放在最前面。
			let card = null;
			try {
				const cf = get("configForms");
				diag.configForms = cf ? "ok" : "不可用";
				if (cf && primitives) {
					card = new FireStockCardController(cf.get(ENTRY_NS));
					ctx.effect(() => () => card.dispose(), "dsh-fire-stock: form subscription");
					diag.card = "ok（可编辑表单）";
				} else {
					diag.card = "降级（诊断卡片）";
				}
			} catch (e) {
				diag.configForms = "异常: " + errText(e);
				diag.card = "降级（诊断卡片）";
			}

			const component = card ? FireStockCard : DiagCard;
			const face = card ? () => card.inject() : noopFace;
			let labelBeaconed = false;
			const label = () => {
				if (!labelBeaconed) {
					labelBeaconed = true;
					beacon("label-called", {});
				}
				try {
					const locale = get("locale");
					const s = locale ? locale.bind(LOCALE_NS)("title") : "";
					return s || "股票助手（FIRE）";
				} catch {
					return "股票助手（FIRE）";
				}
			};

			try {
				ctx.effect(
					() =>
						ctx.slots.inject("plugins.item", () =>
							ctx.slots.register(
								{
									name: "plugins.item",
									id: "fire-stock",
									order: 10,
									label,
									locale: LOCALE_NS,
									inject: face,
								},
								component,
							),
						),
					"dsh-fire-stock: settings card",
				);
				beacon("register-ok", { card: diag.card, configForms: diag.configForms });
			} catch (e) {
				diag.error = "注册异常: " + errText(e);
				beacon("register-throw", { error: diag.error, card: diag.card });
				try {
					ctx.slots.register(
						{ name: "plugins.item", id: "fire-stock", order: 10, label, locale: LOCALE_NS, inject: face },
						component,
					);
					diag.card = "ok（直接注册）";
					beacon("register-direct-ok", {});
				} catch (e2) {
					diag.card = "注册失败: " + errText(e2);
				}
			}

			// ② 字典：失败不影响卡片。
			try {
				const locale = get("locale");
				if (locale) {
					ctx.effect(() => locale.register(LOCALE_NS, { zh, en }), "dsh-fire-stock: dictionaries");
					diag.locale = "ok";
				} else {
					diag.locale = "不可用";
				}
			} catch (e) {
				diag.locale = "异常: " + errText(e);
			}

			// ②b 独立设置分节：不依赖"插件"页的清单加载（离线时那张列表可能整个不渲染）。
			try {
				ctx.slots.inject("settings.section", () =>
					ctx.slots.register(
						{
							name: "settings.section",
							id: "fire-stock",
							order: 40,
							label,
							locale: LOCALE_NS,
							inject: face,
						},
						component,
					),
				);
				beacon("section-ok", {});
			} catch (e) {
				beacon("section-throw", { error: errText(e) });
			}

			// ③ 延迟复核：注册之后条目是否还在注册表里、页面有没有读 label。
			try {
				setTimeout(() => {
					try {
						const entries = ctx.slots.entries("plugins.item");
						beacon("registry-later", {
							locale: diag.locale,
							count: entries.length,
							ids: entries.map((e) => (e && e.options ? e.options.id : "?")),
							version: typeof ctx.slots.getVersion === "function" ? ctx.slots.getVersion("plugins.item") : "n/a",
						});
					} catch (e) {
						beacon("registry-later-error", { error: errText(e) });
					}
				}, 4000);
			} catch {
				/* 忽略 */
			}
		}

		exports.NS = LOCALE_NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
