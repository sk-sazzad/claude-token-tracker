(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	/* ── Utilities ── */
	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	/* Multiple fallback strategies to find orgId */
	function getOrgIdFromCookie() {
		try {
			// Strategy 1: lastActiveOrg cookie (original)
			const fromCookie = document.cookie
				.split('; ')
				.find((row) => row.startsWith('lastActiveOrg='))
				?.split('=')[1];
			if (fromCookie) return fromCookie;

			// Strategy 2: URL path may contain orgId (UUID format)
			const urlMatch = window.location.href.match(
				/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
			);
			if (urlMatch) return urlMatch[1];

			// Strategy 3: localStorage fallback
			const fromStorage = localStorage.getItem('lastActiveOrg');
			if (fromStorage) return fromStorage;

			return null;
		} catch { return null; }
	}

	function observeUrlChanges(callback) {
		let lastPath = window.location.pathname;
		const fireIfChanged = () => {
			const current = window.location.pathname;
			if (current !== lastPath) { lastPath = current; callback(); }
		};
		window.addEventListener('cc:urlchange', fireIfChanged);
		window.addEventListener('popstate',     fireIfChanged);
		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate',     fireIfChanged);
		};
	}

	/* ── Usage data parsers ── */
	function parseUsageFromUsageEndpoint(raw) {
		if (!raw || typeof raw !== 'object') return null;
		const norm = (w, hours) => {
			if (!w || typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const raw_u = w.utilization;
			const util  = raw_u <= 1 ? raw_u * 100 : raw_u;
			return {
				utilization:  Math.max(0, Math.min(100, util)),
				resets_at:    typeof w.resets_at === 'string' ? w.resets_at : null,
				window_hours: hours,
			};
		};
		const five_hour = norm(raw.five_hour, 5);
		const seven_day = norm(raw.seven_day, 24 * 7);
		if (!five_hour && !seven_day) return null;
		return { five_hour, seven_day };
	}

	function parseUsageFromMessageLimit(raw) {
		if (!raw?.windows || typeof raw.windows !== 'object') return null;
		const norm = (w, hours) => {
			if (!w || typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const resets_at = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)
				? new Date(w.resets_at * 1000).toISOString()
				: null;
			const raw_u = w.utilization;
			const util  = raw_u <= 1 ? raw_u * 100 : raw_u;
			return {
				utilization:  Math.max(0, Math.min(100, util)),
				resets_at,
				window_hours: hours,
			};
		};
		const five_hour = norm(raw.windows['5h'], 5);
		const seven_day = norm(raw.windows['7d'], 24 * 7);
		if (!five_hour && !seven_day) return null;
		return { five_hour, seven_day };
	}

	/* ── State ── */
	let currentConversationId = null;
	let currentOrgId          = null;
	let usageState            = null;
	let usageResetMs          = { five_hour: null, seven_day: null };
	let lastUsageSseMs        = 0;
	let usageFetchInFlight    = false;
	let lastUsageUpdateMs     = 0;
	const rolloverHandled     = { five_hour: null, seven_day: null };

	/* Track last generation time for accurate cache timer */
	let lastGenerationMs = null;

	/* ── UI ── */
	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => { await refreshUsage(); },
	});
	ui.initialize();

	const bridgeReady = CC.injectBridgeOnce();

	/* ── Usage helpers ── */
	function applyUsageUpdate(normalized, source) {
		if (!normalized) return;
		const now = Date.now();
		usageState        = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
		usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
		ui.setUsage(normalized);
	}

	function updateOrgIdIfNeeded(newOrgId) {
		if (newOrgId && typeof newOrgId === 'string' && newOrgId !== currentOrgId) {
			currentOrgId = newOrgId;
		}
	}

	/* FIX #4: refreshUsage with retry when orgId not yet available */
	async function refreshUsage(retryCount = 0) {
		await bridgeReady;
		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) {
			// OrgId not available yet (e.g. fresh login) — retry with backoff
			if (retryCount < 3) {
				setTimeout(() => refreshUsage(retryCount + 1), 2000 * (retryCount + 1));
			}
			return;
		}
		updateOrgIdIfNeeded(orgId);
		if (usageFetchInFlight) return;
		usageFetchInFlight = true;
		let raw;
		try { raw = await CC.bridge.requestUsage(orgId); }
		catch { return; }
		finally { usageFetchInFlight = false; }
		const parsed = parseUsageFromUsageEndpoint(raw);
		applyUsageUpdate(parsed, 'usage');
	}

	async function refreshConversation() {
		await bridgeReady;
		if (!currentConversationId) { ui.setConversationMetrics(); return; }
		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);
		try { await CC.bridge.requestConversation(orgId, currentConversationId); } catch {}
	}

	/* ── Bridge event handlers ── */
	CC.bridge.on('cc:generation_start', () => {
		if (currentConversationId) ui.setPendingCache(true);
	});

	CC.bridge.on('cc:conversation', async ({ orgId, conversationId, data }) => {
		if (!conversationId || conversationId !== currentConversationId) return;
		updateOrgIdIfNeeded(orgId);
		if (!data) return;
		const metrics = await CC.tokens.computeConversationMetrics(data);

		// Use last generation time for cache (more accurate than conversation history)
		const cachedUntil = lastGenerationMs
			? lastGenerationMs + CC.CONST.CACHE_WINDOW_MS
			: metrics.cachedUntil;

		ui.setConversationMetrics({
			totalTokens: metrics.totalTokens,
			cachedUntil,
			imageCount:  metrics.imageCount,
			docCount:    metrics.docCount,
		});
	});

	CC.bridge.on('cc:message_limit', (messageLimit) => {
		const parsed = parseUsageFromMessageLimit(messageLimit);
		applyUsageUpdate(parsed, 'sse');
	});

	/* SSE token usage — use for breakdown display ONLY, not totalTokens.
	   The SSE stream gives us exact tokens for THIS turn only, not the full
	   conversation. We use it to:
	   1. Update the cache timer (generation just happened = cache starts now)
	   2. Show the real input/output breakdown in the tooltip
	   3. Mark the count as "real" so tooltip shows the source correctly
	   We do NOT overwrite totalTokens with this — the conversation API data is the
	   accurate source for the full context window count. */
	CC.bridge.on('cc:token_usage', (usage) => {
		if (!usage || typeof usage.input_tokens !== 'number') return;

		// Update cache timer — generation just finished, cache starts now
		lastGenerationMs = Date.now();
		const cachedUntil = lastGenerationMs + CC.CONST.CACHE_WINDOW_MS;

		// Pass the real breakdown info to UI (for tooltip only)
		ui.updateRealTokenBreakdown({
			cachedUntil,
			cacheReadTokens:     usage.cache_read_input_tokens     || 0,
			cacheCreationTokens: usage.cache_creation_input_tokens || 0,
			outputTokens:        usage.output_tokens               || 0,
			inputTokens:         usage.input_tokens                || 0,
		});

		// Trigger conversation refresh to get accurate full-context count
		setTimeout(() => refreshConversation(), 500);
	});

	/* ── Input wrapper finding ── */
	function findInputWrapper() {
		for (const sel of CC.DOM.INPUT_WRAPPER_SELECTORS) {
			try {
				const el = document.querySelector(sel);
				if (el) return el;
			} catch {}
		}

		for (const sel of CC.DOM.INPUT_FIELD_SELECTORS) {
			try {
				const input = document.querySelector(sel);
				if (!input) continue;
				let node = input.parentElement;
				for (let i = 0; i < 8 && node && node !== document.body; i++) {
					const rect = node.getBoundingClientRect();
					if (rect.width > 300) return node;
					node = node.parentElement;
				}
			} catch {}
		}

		try {
			const editable = document.querySelector('[contenteditable="true"]');
			if (editable) {
				let node = editable.parentElement;
				for (let i = 0; i < 10 && node && node !== document.body; i++) {
					const rect = node.getBoundingClientRect();
					if (rect.width > 300 && rect.bottom > window.innerHeight * 0.5) return node;
					node = node.parentElement;
				}
			}
		} catch {}

		return null;
	}

	/* ── Strip attach with exponential back-off ── */
	let stripAttachAttempts = 0;
	const MAX_STRIP_ATTEMPTS = 20;

	function tryAttachStrip() {
		ui.attachToInputWrapper(null);
		stripAttachAttempts = 0;
	}

	function attachStripToInput() {
		document.querySelector('.cc-bottom-strip')?.remove();
		const ccRoot = document.getElementById('cc-root');
		if (ccRoot) ccRoot.innerHTML = '';
		stripAttachAttempts = 0;
		tryAttachStrip();
	}

	let stripObserver    = null;
	let reattachDebounce = null;

	function watchForInputAreaChanges() {
		stripObserver?.disconnect();
		// FIX #7: Cancel any pending reattach debounce before starting fresh
		clearTimeout(reattachDebounce);
		reattachDebounce = null;

		stripObserver = new MutationObserver(() => {
			if (document.querySelector('.cc-bottom-strip')) return;
			clearTimeout(reattachDebounce);
			reattachDebounce = setTimeout(tryAttachStrip, 250);
		});
		if (document.body) {
			stripObserver.observe(document.body, { childList: true, subtree: true });
		}
	}

	/* ── URL change handler ── */
	async function handleUrlChange() {
		// FIX #2: Disconnect branchObserver AND cancel its timeout
		if (branchObserver) { branchObserver.disconnect(); branchObserver = null; }
		if (branchTimeoutId) { clearTimeout(branchTimeoutId); branchTimeoutId = null; }

		currentConversationId = getConversationId();
		// Reset generation time on navigation
		lastGenerationMs = null;
		attachStripToInput();
		watchForInputAreaChanges();

		if (!currentConversationId) { ui.setConversationMetrics(); return; }
		updateOrgIdIfNeeded(getOrgIdFromCookie());
		if (!document.hidden) await refreshConversation();
		if (!usageState) await refreshUsage();
	}

	/* ── Branch navigation (Previous / Next buttons) ── */
	let branchObserver  = null;
	let branchTimeoutId = null; // FIX #2: track timeout so we can cancel it

	const unobserveUrl = observeUrlChanges(handleUrlChange);
	window.addEventListener('beforeunload', unobserveUrl);
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"]');
		if (!btn) return;
		const container = btn.closest('.inline-flex');
		const indicator = Array.from(container?.querySelectorAll('span') || [])
			.find((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent.trim()));
		if (!indicator) return;

		const originalText = indicator.textContent;
		branchObserver?.disconnect();
		// FIX #2: Cancel previous timeout before starting a new one
		if (branchTimeoutId) { clearTimeout(branchTimeoutId); branchTimeoutId = null; }

		branchObserver = new MutationObserver(() => {
			if (indicator.textContent !== originalText) {
				branchObserver.disconnect();
				branchObserver = null;
				if (branchTimeoutId) { clearTimeout(branchTimeoutId); branchTimeoutId = null; }
				refreshConversation();
			}
		});
		branchObserver.observe(indicator, { childList: true, characterData: true, subtree: true });
		branchTimeoutId = setTimeout(() => {
			branchObserver?.disconnect();
			branchObserver    = null;
			branchTimeoutId   = null;
		}, 300_000);
	});

	/* ── 1-second ticker: cache countdown + periodic usage refresh ── */
	const ONE_HOUR_MS = 60 * 60 * 1000;
	setInterval(() => {
		ui.tick();
		const now = Date.now();

		for (const key of ['five_hour', 'seven_day']) {
			if (usageResetMs[key] && now >= usageResetMs[key] && rolloverHandled[key] !== usageResetMs[key]) {
				rolloverHandled[key] = usageResetMs[key];
				refreshUsage();
			}
		}

		if (!document.hidden &&
			(now - lastUsageSseMs) > ONE_HOUR_MS &&
			(now - lastUsageUpdateMs) > ONE_HOUR_MS) {
			refreshUsage();
		}
	}, 1000);

	// Kick off
	handleUrlChange();
})();
