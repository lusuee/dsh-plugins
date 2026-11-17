/**
 * Browser half of `dsh-plugin-session-quick-switch`.
 *
 * One surface, one job: a frame-wide palette (Ctrl+E) that lists sessions with
 * the running ones pinned to the top, lets you filter by title or directory, and
 * opens the chosen session in the existing main view.
 *
 * Rules this file follows:
 * - It imports no Harness Client package. Only `react` from the browser module
 *   table, so a Host upgrade can never turn the slot entry into a blank frame.
 * - It reads session data through the framework-provided selector hooks
 *   (`useSessions`, `useSessionStatus`) on slot props, never by subscribing or
 *   scanning itself.
 * - It renders with theme tokens only (`--dsw-alias-*`, each with a literal
 *   fallback) and registers everything inside `ctx.effect` / `ctx.slots.inject`.
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-session-quick-switch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		//#region constants
		/** Locale namespace and the key every string in this file goes through. */
		const NS = "session-quick-switch";

		/** Keyboard command id; also the id the keybinding settings show. */
		const COMMAND_ID = "session-quick-switch.open";

		/** Slot entry id inside `shell.overlay`. */
		const SLOT_ID = "session-quick-switch";

		/** Attribute that scopes this plugin's CSS without touching host classes. */
		const OWN = "data-session-quick-switch";

		/** How many host-list rows one palette build inspects. */
		const SCAN_LIMIT = 200;

		/** How many idle sessions the palette lists after the running ones. */
		const RECENT_LIMIT = 30;

		/** How often the open palette re-reads the clock, so "just now" ages. */
		const TIME_TICK_MS = 30000;

		/** DOM ids that wire the combobox input to its listbox, for assistive tech. */
		const LIST_ID = "session-quick-switch-list";
		const OPTION_ID_PREFIX = "session-quick-switch-option-";

		/**
		 * The overlay is rendered at the frame root, outside the conversation
		 * surface, so it cannot inherit a predictable body font: state one.
		 */
		const FONT_STACK =
			'-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif';
		const MONO_STACK = '"SFMono-Regular", "Cascadia Mono", "Consolas", "Liberation Mono", monospace';

		const EMPTY_IDS = [];
		const EMPTY_BY_ID = {};
		const EMPTY_STATUSES = new Map();
		//#endregion

		//#region dictionaries
		const zh = {
			"command.open": "快速切换会话",
			"palette.title": "切换会话",
			"palette.placeholder": "筛选会话：标题或目录",
			"palette.empty": "没有匹配的会话",
			"palette.none": "还没有可切换的会话",
			"group.waiting": "需要你",
			"group.running": "进行中",
			"group.recent": "最近",
			"time.now": "刚刚",
			"time.minutes": "{n} 分钟前",
			"time.hours": "{n} 小时前",
			"time.days": "{n} 天前",
			"footer.select": "选择",
			"footer.open": "打开",
			"footer.close": "关闭",
			"footer.total": "共 {total} 个",
			"footer.matched": "匹配 {total} 个",
		};

		const en = {
			"command.open": "Quick switch session",
			"palette.title": "Switch session",
			"palette.placeholder": "Filter sessions: title or folder",
			"palette.empty": "No matching session",
			"palette.none": "No session to switch to yet",
			"group.waiting": "Needs you",
			"group.running": "Running",
			"group.recent": "Recent",
			"time.now": "just now",
			"time.minutes": "{n} min ago",
			"time.hours": "{n} h ago",
			"time.days": "{n} d ago",
			"footer.select": "select",
			"footer.open": "open",
			"footer.close": "close",
			"footer.total": "{total} total",
			"footer.matched": "{total} matched",
		};
		//#endregion

		//#region helpers
		/** @param value - any value. @returns the value when it is a string, else ''. */
		function textOf(value) {
			return typeof value === "string" ? value : "";
		}

		/**
		 * Last non-empty path segment, so a row can say which project it belongs to.
		 * @param path - absolute cwd of a session.
		 * @returns the folder name, or '' when there is none.
		 */
		function baseName(path) {
			const segments = textOf(path).split(/[\\/]+/);
			for (let index = segments.length - 1; index >= 0; index -= 1) {
				if (segments[index] !== "") return segments[index];
			}
			return "";
		}

		/**
		 * Absolute time as a short "how long ago" label.
		 * @param t - translator.
		 * @param updatedAt - row timestamp in ms.
		 * @param now - current time in ms.
		 * @returns the label.
		 */
		function relativeTime(t, updatedAt, now) {
			const elapsed = Math.max(0, now - updatedAt);
			const minute = 60000;
			if (elapsed < minute) return t("time.now");
			if (elapsed < 60 * minute) return t("time.minutes", { n: Math.floor(elapsed / minute) });
			if (elapsed < 24 * 60 * minute) return t("time.hours", { n: Math.floor(elapsed / (60 * minute)) });
			return t("time.days", { n: Math.floor(elapsed / (24 * 60 * minute)) });
		}

		/**
		 * How badly a row wants the user: blocked first, then working, then done
		 * but not yet read, then everything else.
		 */
		const STATE_RANK = { waiting: 0, running: 1, unread: 2, idle: 3 };

		/** @param state - row state. @returns its sort rank, idle when unknown. */
		function rankOf(state) {
			const rank = STATE_RANK[state];
			return typeof rank === "number" ? rank : STATE_RANK.idle;
		}

		/**
		 * Interaction kinds that have a surface the user can answer from. The
		 * workspace sidebar filters by the same list, so a domain-owned request
		 * with any other kind is not something the palette may advertise.
		 */
		const PENDING_KINDS = ["approval", "plan-review", "question"];

		/**
		 * Folds the live status into one bucket. `pendingInteraction` means the
		 * session stopped and is asking the user something; `completionUnread`
		 * means it finished and the result has not been looked at.
		 * @param running - effective running flag for the row.
		 * @param status - the row's live `SessionStatus`, when the host has one.
		 * @returns `'waiting' | 'running' | 'unread' | 'idle'`.
		 */
		function stateOf(running, status) {
			const live = status === undefined || status === null ? EMPTY_STATUSES : status;
			// A session blocked on the user may already report `running: false`, so
			// the ask outranks every other flag instead of sitting inside "running".
			if (asksForUser(live.pendingInteraction)) return "waiting";
			if (running === true) return "running";
			return isSet(live.completionUnread) ? "unread" : "idle";
		}

		/** @param value - a possibly absent flag. @returns whether it is set. */
		function isSet(value) {
			return value !== undefined && value !== null && value !== false;
		}

		/**
		 * Whether a pending interaction is one the user can answer here. A
		 * subagent-internal request carries a kind this palette has no surface
		 * for, so it stays inside "running" instead of claiming attention.
		 * @param pending - the session's `pendingInteraction`, if any.
		 * @returns whether it is an ask this palette should show.
		 */
		function asksForUser(pending) {
			if (!isSet(pending) || typeof pending !== "object") return false;
			const kind = pending.kind;
			return typeof kind === "string" && PENDING_KINDS.indexOf(kind) !== -1;
		}

		/**
		 * The palette's one ordering rule, kept pure so the offline harness can
		 * exercise it: live status wins over the list's own flag; sessions waiting
		 * for the user come first, then ones still working, then everything else
		 * by recency (unread completions ahead of plain idle). Subagent rows and
		 * blank New-Session placeholders are not destinations.
		 * @param list - `{ ids, byId }` slice of the session list.
		 * @param statuses - live `SessionStatus` map from the framework hook.
		 * @param query - raw filter text.
		 * @returns `{ waiting, running, recent, total }` rows.
		 */
		function buildRows(list, statuses, query) {
			const source = list === undefined || list === null ? EMPTY_BY_ID : list;
			const ids = Array.isArray(source.ids) ? source.ids : EMPTY_IDS;
			const byId = source.byId !== undefined && source.byId !== null && typeof source.byId === "object" ? source.byId : EMPTY_BY_ID;
			const needle = textOf(query).trim().toLowerCase();
			const rows = [];
			// A filtered search must be able to reach a match anywhere in the list;
			// the cap only exists to bound the unfiltered build.
			const scanLimit = needle === "" ? SCAN_LIMIT : ids.length;
			for (let index = 0; index < ids.length && index < scanLimit; index += 1) {
				const id = ids[index];
				const row = byId[id];
				if (row === undefined || row === null) continue;
				if (row.origin === "subagent") continue;
				if (row.blank === true) continue;
				const live = statuses !== undefined && statuses !== null && typeof statuses.get === "function" ? statuses.get(id) : undefined;
				const running = live !== undefined && live !== null && typeof live.running === "boolean" ? live.running : row.running === true;
				const state = stateOf(running, live);
				const title = textOf(row.displayTitle) !== "" ? row.displayTitle : textOf(row.title) !== "" ? row.title : id;
				const cwd = textOf(row.cwd);
				if (needle !== "" && title.toLowerCase().indexOf(needle) === -1 && cwd.toLowerCase().indexOf(needle) === -1) continue;
				rows.push({
					id,
					title,
					path: cwd,
					folder: baseName(cwd),
					running,
					state,
					updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
				});
			}
			rows.sort((left, right) => {
				const rank = rankOf(left.state) - rankOf(right.state);
				if (rank !== 0) return rank;
				return right.updatedAt - left.updatedAt;
			});
			const waiting = [];
			const running = [];
			const recent = [];
			for (const row of rows) {
				if (row.state === "waiting") waiting.push(row);
				else if (row.state === "running") running.push(row);
				else if (recent.length < RECENT_LIMIT) recent.push(row);
			}
			return { waiting, running, recent, total: rows.length };
		}

		/**
		 * Splits `text` at case-insensitive occurrences of `needle`.
		 * @param text - the string to scan.
		 * @param needle - the already-trimmed, lower-cased filter text.
		 * @returns the segments in order, each flagged when it matched.
		 */
		function matchSegments(text, needle) {
			const value = textOf(text);
			if (needle === "" || value === "") return [{ text: value, match: false }];
			const haystack = value.toLowerCase();
			const segments = [];
			let from = 0;
			for (;;) {
				const at = haystack.indexOf(needle, from);
				if (at === -1) break;
				if (at > from) segments.push({ text: value.slice(from, at), match: false });
				segments.push({ text: value.slice(at, at + needle.length), match: true });
				from = at + needle.length;
			}
			if (segments.length === 0) return [{ text: value, match: false }];
			if (from < value.length) segments.push({ text: value.slice(from), match: false });
			return segments;
		}

		/**
		 * Steps the row cursor, wrapping at both ends.
		 * @param index - the currently highlighted row index.
		 * @param length - how many rows the palette holds.
		 * @param step - `1` for down, `-1` for up.
		 * @returns the next index, always inside `[0, length)`.
		 */
		function stepIndex(index, length, step) {
			if (length <= 0) return 0;
			const next = index + step;
			if (next < 0) return length - 1;
			if (next >= length) return 0;
			return next;
		}

		/**
		 * Minimal external store for "is the palette open". The slot framework
		 * turns it into a `useSessionQuickSwitchOpen(selector)` prop.
		 * @returns the store.
		 */
		function createOpenStore() {
			let value = false;
			const subscribers = new Set();
			return {
				getSnapshot() {
					return value;
				},
				subscribe(listener) {
					subscribers.add(listener);
					return () => {
						subscribers.delete(listener);
					};
				},
				set(next) {
					if (next === value) return;
					value = next;
					for (const listener of Array.from(subscribers)) {
						try {
							listener();
						} catch (error) {
							/* one bad subscriber must not keep the palette stuck */
						}
					}
				},
			};
		}
		//#endregion

		//#region styles
		const layerStyle = {
			position: "fixed",
			inset: 0,
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "center",
			// The frame reports its top strip through `--dsh-frame-top-clearance`
			// (48px for the macOS traffic lights, the Windows caption height). On
			// macOS the overlay layer starts at the window edge, so the floor keeps
			// the panel below the lights even in a short window.
			padding: "max(min(14vh, 132px), calc(var(--dsh-frame-top-clearance, 0px) + 12px)) 24px 24px",
			zIndex: 30,
			pointerEvents: "auto",
			background: "var(--dsw-alias-bg-mask-2, rgba(15, 23, 42, 0.12))",
		};

		const panelStyle = {
			position: "relative",
			display: "flex",
			flexDirection: "column",
			width: "min(560px, 100%)",
			maxHeight: "min(520px, 68vh)",
			overflow: "hidden",
			borderRadius: "16px",
			background: "var(--dsw-alias-bg-layer-1, #ffffff)",
			color: "var(--dsw-alias-label-primary, #1b1b1c)",
			border: "1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12))",
			boxShadow: "0 32px 72px -24px rgba(15, 23, 42, 0.42), 0 8px 24px -8px rgba(15, 23, 42, 0.18)",
			fontFamily: FONT_STACK,
			fontSize: "13px",
			// macOS renders light-on-dark type thin without this; harmless elsewhere.
			WebkitFontSmoothing: "antialiased",
			MozOsxFontSmoothing: "grayscale",
			outline: "none",
		};

		const headerStyle = {
			display: "flex",
			alignItems: "center",
			gap: "10px",
			minHeight: "52px",
			padding: "0 16px",
			borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))",
		};

		const searchIconStyle = {
			flex: "0 0 auto",
			width: "16px",
			height: "16px",
			color: "var(--dsw-alias-label-tertiary, #81858c)",
		};

		const inputStyle = {
			flex: "1 1 auto",
			minWidth: 0,
			border: "none",
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: "15px",
			lineHeight: "22px",
			padding: "14px 0",
		};

		const listStyle = {
			flex: "1 1 auto",
			minHeight: 0,
			overflowY: "auto",
			padding: "5px 6px 8px",
		};

		const sectionStyle = {
			position: "sticky",
			top: 0,
			zIndex: 1,
			display: "flex",
			alignItems: "baseline",
			gap: "6px",
			padding: "9px 10px 5px",
			background: "var(--dsw-alias-bg-layer-1, #ffffff)",
			fontSize: "11px",
			lineHeight: "16px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-tertiary, #81858c)",
			userSelect: "none",
		};

		const sectionCountStyle = {
			fontWeight: 500,
			color: "var(--dsw-alias-label-caption, #adb2b8)",
			fontVariantNumeric: "tabular-nums",
		};

		const rowStyle = {
			display: "flex",
			alignItems: "center",
			gap: "10px",
			minWidth: 0,
			padding: "8px 10px",
			borderRadius: "8px",
			cursor: "pointer",
			scrollMarginTop: "30px",
		};

		const dotBaseStyle = {
			flex: "0 0 auto",
			width: "7px",
			height: "7px",
			boxSizing: "border-box",
			borderRadius: "50%",
		};

		/**
		 * Paints the status dot: amber asks you something, green is still working,
		 * a hollow blue ring finished unread, grey is resting.
		 * @param state - row state from `buildRows`.
		 * @returns the dot's style.
		 */
		function dotStyleOf(state) {
			if (state === "waiting") return Object.assign({}, dotBaseStyle, { background: "var(--dsw-alias-state-warn-primary, #f59e0b)" });
			if (state === "running") return Object.assign({}, dotBaseStyle, { background: "var(--dsw-alias-state-success-primary, #22c55e)" });
			if (state === "unread") {
				return Object.assign({}, dotBaseStyle, {
					background: "transparent",
					border: "1.5px solid var(--dsw-alias-state-business-primary, #4176e6)",
				});
			}
			return Object.assign({}, dotBaseStyle, { background: "var(--dsw-alias-label-dimmed, #e1e5ee)" });
		}

		const titleCellStyle = {
			display: "flex",
			alignItems: "baseline",
			gap: "12px",
			minWidth: 0,
			flex: "1 1 auto",
		};

		const titleStyle = {
			flex: "1 1 auto",
			minWidth: 0,
			fontSize: "14px",
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary, #1b1b1c)",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis",
		};

		const metaStyle = {
			flex: "0 1 auto",
			minWidth: 0,
			maxWidth: "48%",
			textAlign: "right",
			fontSize: "11.5px",
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary, #81858c)",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis",
		};

		const matchStyle = {
			color: "var(--dsw-alias-state-business-primary, #4176e6)",
			fontWeight: 600,
		};

		const footerStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: "16px",
			padding: "7px 14px",
			borderTop: "1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))",
			background: "var(--dsw-alias-bg-layer-1, #ffffff)",
			fontSize: "11.5px",
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary, #81858c)",
		};

		const hintsStyle = {
			display: "flex",
			alignItems: "center",
			gap: "12px",
			minWidth: 0,
			overflow: "hidden",
		};

		const hintStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: "4px",
			whiteSpace: "nowrap",
		};

		const kbdStyle = {
			fontFamily: MONO_STACK,
			fontSize: "10px",
			lineHeight: "14px",
			padding: "1px 5px",
			borderRadius: "4px",
			border: "1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))",
			background: "var(--dsw-alias-bg-base, #ffffff)",
			color: "var(--dsw-alias-label-secondary, #61666b)",
		};

		const countStyle = {
			flex: "0 0 auto",
			fontVariantNumeric: "tabular-nums",
		};

		const emptyStyle = {
			padding: "36px 16px",
			textAlign: "center",
			fontSize: "12.5px",
			color: "var(--dsw-alias-label-tertiary, #81858c)",
		};

		/** Pseudo-element, animation and hover rules cannot live in inline styles. */
		const CSS_TEXT = [
			'@keyframes sqs-in{from{opacity:0;transform:translateY(-6px) scale(0.99);}to{opacity:1;transform:none;}}',
			'@keyframes sqs-pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,0.5);}70%{box-shadow:0 0 0 5px rgba(34,197,94,0);}100%{box-shadow:0 0 0 0 rgba(34,197,94,0);}}',
			'@keyframes sqs-wait{0%{box-shadow:0 0 0 0 rgba(245,158,11,0.45);}70%{box-shadow:0 0 0 5px rgba(245,158,11,0);}100%{box-shadow:0 0 0 0 rgba(245,158,11,0);}}',
			'[' + OWN + '="panel"]{animation:sqs-in 120ms cubic-bezier(0.2,0,0,1);}',
			'[' + OWN + '="dot"][data-state="running"]{animation:sqs-pulse 2s ease-out infinite;}',
			'[' + OWN + '="dot"][data-state="waiting"]{animation:sqs-wait 2.4s ease-out infinite;}',
			'@media (prefers-reduced-motion:reduce){[' + OWN + '="panel"]{animation:none;}[' + OWN + '="dot"]{animation:none;}}',
			'[' + OWN + '="row"]{position:relative;transition:background-color 90ms ease;}',
			'[' + OWN + '="row"][data-active="true"]::before{content:"";position:absolute;left:0;top:7px;bottom:7px;width:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4176e6);}',
			'[' + OWN + '="query"]::placeholder{color:var(--dsw-alias-label-caption,#adb2b8);opacity:1;}',
			'[' + OWN + '="query"]{outline:none;}',
			'[' + OWN + '="row"]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,0.06));}',
			'[' + OWN + '="row"][data-active="true"]{background:var(--dsw-alias-interactive-bg-hover-accent,rgba(38,49,72,0.14));}',
			'[' + OWN + '="list"]{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l1,#e5e5e5) transparent;}',
			'[' + OWN + '="list"]::-webkit-scrollbar{width:10px;}',
			'[' + OWN + '="list"]::-webkit-scrollbar-track{background:transparent;}',
			'[' + OWN + '="list"]::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l1,#e5e5e5);border-radius:5px;border:3px solid transparent;background-clip:content-box;}',
			'[' + OWN + '="list"]::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l1,#d4d4d4);border:3px solid transparent;background-clip:content-box;}',
		].join("\n");
		//#endregion

		//#region component
		/**
		 * The palette. Reads sessions through the slot's own selector hooks, keeps
		 * only the open flag / filter text / cursor in local state, and hands the
		 * chosen session id back to the plugin body, which owns navigation.
		 * @param props - slot props plus this plugin's injected face.
		 * @returns the overlay tree, or null while closed.
		 */
		function SessionQuickSwitch(props) {
			const t = typeof props.t === "function" ? props.t : (key) => key;
			const useOpen = typeof props.useSessionQuickSwitchOpen === "function" ? props.useSessionQuickSwitchOpen : () => false;
			const useSessions = typeof props.useSessions === "function" ? props.useSessions : () => undefined;
			const useSessionStatus = typeof props.useSessionStatus === "function" ? props.useSessionStatus : () => undefined;

			const isOpen = useOpen((value) => value) === true;
			const ids = useSessions((state) => (state === undefined || state === null ? EMPTY_IDS : state.ids)) || EMPTY_IDS;
			const byId = useSessions((state) => (state === undefined || state === null ? EMPTY_BY_ID : state.byId)) || EMPTY_BY_ID;
			const statuses = useSessionStatus((state) => state) || EMPTY_STATUSES;

			const [query, setQuery] = react.useState("");
			const [activeId, setActiveId] = react.useState(null);
			// "just now" has to keep ageing while the palette stays open, so the
			// clock is state rather than a render-time read.
			const [now, setNow] = react.useState(function () {
				return Date.now();
			});
			const inputRef = react.useRef(null);
			const rowRefs = react.useRef({});

			react.useEffect(() => {
				if (!isOpen) {
					setQuery("");
					setActiveId(null);
					return undefined;
				}
				const previous = typeof document === "undefined" ? null : document.activeElement;
				const input = inputRef.current;
				if (input !== null && input !== undefined && typeof input.focus === "function") input.focus();
				// Hand focus back to whatever had it, so the composer caret survives a
				// dismissal. `isConnected` covers the element having been replaced.
				return () => {
					if (previous === null || previous === undefined) return;
					if (previous.isConnected === false) return;
					if (typeof previous.focus !== "function") return;
					try {
						previous.focus();
					} catch (error) {
						/* a detached composer is not worth reporting */
					}
				};
			}, [isOpen]);

			react.useEffect(() => {
				if (!isOpen) return undefined;
				setNow(Date.now()); // catch up on the time spent closed
				if (typeof setInterval !== "function") return undefined;
				const timer = setInterval(() => setNow(Date.now()), TIME_TICK_MS);
				return () => {
					clearInterval(timer);
				};
			}, [isOpen]);

			const groups = react.useMemo(
				() => buildRows({ ids, byId }, statuses, isOpen ? query : ""),
				[ids, byId, statuses, isOpen, query],
			);
			let cursor = 0;
			const ordered = groups.waiting.concat(groups.running, groups.recent);
			for (let index = 0; index < ordered.length; index += 1) {
				if (ordered[index].id === activeId) {
					cursor = index;
					break;
				}
			}
			const current = ordered.length === 0 ? null : ordered[Math.min(cursor, ordered.length - 1)];
			const currentId = current === null ? null : current.id;

			react.useEffect(() => {
				if (currentId === null) return;
				const node = rowRefs.current[currentId];
				if (node !== null && node !== undefined && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
			}, [currentId, ordered.length]);

			// React's synthetic stopPropagation cannot stop native listeners that the
			// host installed on document/window, so Escape is also caught natively
			// while the palette is open.
			react.useEffect(() => {
				if (!isOpen) return undefined;
				if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
				const onEscape = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					if (typeof event.stopPropagation === "function") event.stopPropagation();
					if (typeof props.closeSessionQuickSwitch === "function") props.closeSessionQuickSwitch();
				};
				document.addEventListener("keydown", onEscape, true);
				return () => {
					document.removeEventListener("keydown", onEscape, true);
				};
			}, [isOpen]);

			if (!isOpen) return null;

			const move = (step) => {
				if (ordered.length === 0) return;
				// Row 0 is already the visual selection while `activeId` is null, so the
				// cursor index is the only thing to step from — stepping from a
				// "nothing selected" sentinel would land back on row 0 and look dead.
				setActiveId(ordered[stepIndex(cursor, ordered.length, step)].id);
			};

			const choose = (row) => {
				if (row === null || row === undefined) return;
				if (typeof props.selectSession === "function") props.selectSession(row.id);
			};

			const dismiss = () => {
				if (typeof props.closeSessionQuickSwitch === "function") props.closeSessionQuickSwitch();
			};

			const onKeyDown = (event) => {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					move(1);
					return;
				}
				if (event.key === "ArrowUp") {
					event.preventDefault();
					move(-1);
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					choose(current);
					return;
				}
				if (event.key === "Tab") {
					event.preventDefault();
					move(event.shiftKey === true ? -1 : 1);
				}
			};

			const onKeyDownCapture = (event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				if (typeof event.stopPropagation === "function") event.stopPropagation();
				dismiss();
			};

			const needle = isOpen ? textOf(query).trim().toLowerCase() : "";
			const renderHighlight = (text, keyPrefix) =>
				matchSegments(text, needle).map((segment, index) =>
					segment.match ? h("span", { key: keyPrefix + index, style: matchStyle }, segment.text) : segment.text,
				);
			const renderRow = (row, position) => {
				const isActive = position === cursor;
				const folder = row.folder === "" ? row.path : row.folder;
				const timeText = relativeTime(t, row.updatedAt, now);
				const metaNodes = [];
				if (folder !== "") {
					metaNodes.push(h("span", { key: "folder" }, renderHighlight(folder, "mf")));
					if (timeText !== "") metaNodes.push(h("span", { key: "sep" }, " · "));
				}
				if (timeText !== "") metaNodes.push(h("span", { key: "time" }, timeText));
				return h(
					"div",
					{
						key: "row:" + row.id,
						ref: (node) => {
							if (node === null || node === undefined) delete rowRefs.current[row.id];
							else rowRefs.current[row.id] = node;
						},
						role: "option",
						id: OPTION_ID_PREFIX + row.id,
						"aria-selected": isActive ? "true" : "false",
						tabIndex: -1,
						[OWN]: "row",
						"data-active": isActive ? "true" : "false",
						style: rowStyle,
						onMouseEnter: () => {
							if (!isActive) setActiveId(row.id);
						},
						onMouseDown: (event) => {
							event.preventDefault();
						},
						onClick: () => choose(row),
					},
					h("span", { key: "dot", [OWN]: "dot", "data-state": row.state, style: dotStyleOf(row.state) }),
					h(
						"span",
						{ key: "cell", style: titleCellStyle },
						h("span", { key: "title", [OWN]: "title", style: titleStyle, title: row.title }, renderHighlight(row.title, "mt")),
						metaNodes.length === 0 ? null : h("span", { key: "meta", style: metaStyle }, metaNodes),
					),
				);
			};

			const nodes = [];
			let position = 0;
			const sectionLabel = (key, count) =>
				h(
					"div",
					{ key: "group:" + key, role: "presentation", [OWN]: "group", style: sectionStyle },
					h("span", { key: "label" }, t(key)),
					h("span", { key: "count", style: sectionCountStyle }, String(count)),
				);
			const pushGroup = (key, rows) => {
				if (rows.length === 0) return;
				nodes.push(sectionLabel(key, rows.length));
				for (const row of rows) {
					nodes.push(renderRow(row, position));
					position += 1;
				}
			};
			pushGroup("group.waiting", groups.waiting);
			pushGroup("group.running", groups.running);
			pushGroup("group.recent", groups.recent);

			const body =
				nodes.length > 0
					? nodes
					: [h("div", { key: "empty", style: emptyStyle }, t(needle !== "" ? "palette.empty" : "palette.none"))];

			const hint = (label, keys) =>
				h(
					"span",
					{ key: "hint:" + label, style: hintStyle },
					h("kbd", { [OWN]: "kbd", style: kbdStyle }, keys),
					t(label),
				);

			return h(
				"div",
				{
					key: "layer",
					[OWN]: "layer",
					style: layerStyle,
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) dismiss();
					},
					onKeyDownCapture,
				},
				h("style", { key: "css" }, CSS_TEXT),
				h(
					"div",
					{
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("palette.title"),
						[OWN]: "panel",
						style: panelStyle,
						onMouseDown: (event) => {
							event.stopPropagation();
						},
					},
					h(
						"div",
						{ key: "header", style: headerStyle },
						h(
							"svg",
							{ key: "icon", style: searchIconStyle, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", focusable: "false" },
							h("circle", { cx: "6.75", cy: "6.75", r: "4.25", stroke: "currentColor", strokeWidth: "1.5" }),
							h("path", { d: "M9.9 9.9 13.1 13.1", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
						),
						h("input", {
							key: "query",
							ref: inputRef,
							[OWN]: "query",
							type: "text",
							role: "combobox",
							"aria-expanded": "true",
							"aria-controls": LIST_ID,
							"aria-autocomplete": "list",
							"aria-activedescendant": currentId === null ? undefined : OPTION_ID_PREFIX + currentId,
							value: query,
							placeholder: t("palette.placeholder"),
							"aria-label": t("palette.placeholder"),
							autoComplete: "off",
							spellCheck: false,
							style: inputStyle,
							onChange: (event) => {
								setQuery(event.target.value);
								setActiveId(null);
							},
							onKeyDown,
						}),
					),
					h("div", { key: "list", id: LIST_ID, [OWN]: "list", role: "listbox", "aria-label": t("palette.title"), style: listStyle }, body),
					h(
						"div",
						{ key: "footer", style: footerStyle },
						h(
							"span",
							{ key: "hints", style: hintsStyle },
							hint("footer.select", "↑↓"),
							hint("footer.open", "↵"),
							hint("footer.close", "Esc"),
						),
						h(
							"span",
							{ key: "count", style: countStyle, "aria-live": "polite" },
							t(needle === "" ? "footer.total" : "footer.matched", { total: groups.total }),
						),
					),
				),
			);
		}
		//#endregion

		//#region plugin
		/** Required client services: the slot registry and the copy. */
		const inject = ["slots", "locale"];

		/**
		 * Client plugin body: owns the open flag, the keyboard command and the
		 * navigation callback, so the component itself never touches `ctx`.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const store = createOpenStore();

			ctx.effect(
				() =>
					ctx.locale.register(NS, {
						zh,
						en,
					}),
				"session-quick-switch: dictionaries",
			);

			const t = typeof ctx.locale.bind === "function" ? ctx.locale.bind(NS) : (key) => key;

			// A full list pull re-projects every session and re-renders the workspace
			// tree, so landing one while the user is picking a row makes the jump feel
			// janky. Live list events already keep the catalog current, which makes
			// this pull a backstop — once a minute is plenty.
			const REFRESH_INTERVAL_MS = 60000;
			let lastRefreshAt = 0;

			/** Ask the Host for a fresh list, throttled so a jump never races it. */
			const refreshSessions = () => {
				const sessions = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
				if (sessions === undefined || sessions === null || typeof sessions.refresh !== "function") return;
				const now = Date.now();
				if (now - lastRefreshAt < REFRESH_INTERVAL_MS) return;
				lastRefreshAt = now;
				try {
					const pending = sessions.refresh();
					if (pending !== undefined && pending !== null && typeof pending.catch === "function") pending.catch(() => {});
				} catch (error) {
					/* the cached list is still worth showing */
				}
			};

			const openPalette = () => {
				refreshSessions();
				store.set(true);
			};

			const closePalette = () => {
				store.set(false);
			};

			/** Id waiting for the next frame; a newer pick supersedes it. */
			let pendingOpen = null;

			const selectSession = (sessionId) => {
				if (typeof sessionId !== "string" || sessionId === "") return;
				closePalette();
				const workspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined;
				if (workspace === undefined || workspace === null || typeof workspace.openSession !== "function") return;
				pendingOpen = sessionId;
				const open = () => {
					if (pendingOpen !== sessionId) return;
					pendingOpen = null;
					try {
						workspace.openSession(sessionId);
					} catch (error) {
						/* staying on the current view is a safe failure */
					}
				};
				// Both stores update inside one event handler, so React batches them:
				// unmounting the overlay and mounting the target session land in a
				// single commit, and the palette's disappearance is stuck behind the
				// expensive view swap. Closing in this commit and swapping on the next
				// frame lets the palette vanish immediately.
				if (typeof requestAnimationFrame === "function") requestAnimationFrame(open);
				else open();
			};

			ctx.inject(["shortcuts"], (scope) => {
				scope.effect(() => {
					try {
						return scope.shortcuts.register({
							id: COMMAND_ID,
							label: () => t("command.open"),
							aliases: ["sessions", "switch session", "recent sessions", "切换会话", "会话"],
							// Desktop: ⌘E / Ctrl+E. Browser profiles take the alt chord
							// because the bare combination belongs to the browser there
							// (Cmd+E is "use selection for find" in Safari and Chrome).
							// `web:linux` is deliberately absent: a Web binding on Linux must
							// be one of the three combinations `isWebBindingAllowed` admits
							// (⌘/ , ⌘/⇧, ⌘/⇧.), and registration validates every declared
							// profile, so an inadmissible default fails the command on all
							// platforms — Linux Web users rebind it in Settings → Keyboard.
							defaults: {
								"desktop:macos": { code: "KeyE", modifiers: ["primary"] },
								"desktop:windows": { code: "KeyE", modifiers: ["primary"] },
								"desktop:linux": { code: "KeyE", modifiers: ["primary"] },
								"web:macos": { code: "KeyE", modifiers: ["primary", "alt"] },
								"web:windows": { code: "KeyE", modifiers: ["primary", "alt"] },
							},
							regions: ["page", "editable"],
							modals: [],
							resolve: () => {
								if (store.getSnapshot()) {
									closePalette();
									return { status: "handled", run: () => {} };
								}
								return { status: "handled", run: openPalette };
							},
						});
					} catch (error) {
						// `register` validates every declared profile and throws on a
						// reserved or duplicate chord; letting that escape would abort
						// the whole plugin and take the palette's slot with it.
						console.warn("[session-quick-switch] shortcut registration rejected:", error);
						return () => {};
					}
				}, "session-quick-switch: shortcut");
			});

			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{
						name: "shell.overlay",
						id: SLOT_ID,
						order: 40,
						locale: NS,
						inject: () => ({
							hooks: { sessionQuickSwitchOpen: store },
							closeSessionQuickSwitch: closePalette,
							selectSession,
						}),
					},
					SessionQuickSwitch,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		/**
		 * Test seam: the pure helpers the offline harness exercises without a
		 * browser. The app itself only reads `apply` and `inject`.
		 */
		exports.__internals = { buildRows, baseName, relativeTime, matchSegments, stepIndex };
		return module.exports;
	},
});
