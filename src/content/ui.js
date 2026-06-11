(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	/* ── Helpers ── */
	function formatSeconds(totalSec) {
		return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
	}

	function formatResetCountdown(ms) {
		const diff = ms - Date.now();
		if (diff <= 0) return '0m';
		const m = Math.round(diff / 60_000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60), rm = m % 60;
		if (h < 24) return `${h}h ${rm}m`;
		const d = Math.floor(h / 24);
		return `${d}d ${h % 24}h`;
	}

	function pct(n) { return Math.round(Math.max(0, Math.min(100, n))); }

	function barColor(p) {
		if (p >= 90) return '#ef4444';
		if (p >= 75) return '#f59e0b';
		return '#4f8ef7';
	}

	/* Build 5 chunked segments for a given percentage */
	function buildSegs(p) {
		// 5 segments, each = 20%
		const filled = p / 20;
		let html = '';
		for (let i = 0; i < 5; i++) {
			let cls = 'cc-bs-seg';
			if (filled >= i + 1) {
				if (p >= 90) cls += ' cc-seg-danger';
				else if (p >= 75) cls += ' cc-seg-warn';
				else cls += ' cc-seg-on';
			} else if (filled > i) {
				cls += ' cc-seg-half';
			}
			html += `<div class="${cls}"></div>`;
		}
		return html;
	}

	/* ── Tooltip ── */
	function makeTooltip() {
		const t = document.createElement('div');
		t.className = 'cc-tooltip';
		document.body.appendChild(t);
		return t;
	}

	function attachTooltip(el, tip, positionAbove = true) {
		if (!el || !tip || el.hasAttribute('data-cc-tip')) return;
		el.setAttribute('data-cc-tip', '1');
		const show = () => {
			tip.style.opacity = '1';
			const r = el.getBoundingClientRect();
			const tr = tip.getBoundingClientRect();
			let left = r.left + r.width / 2;
			if (left + tr.width / 2 > window.innerWidth) left = window.innerWidth - tr.width / 2 - 10;
			if (left - tr.width / 2 < 0) left = tr.width / 2 + 10;
			const top = positionAbove ? r.top - tr.height - 8 : r.bottom + 8;
			tip.style.left = `${left}px`;
			tip.style.top = `${top}px`;
			tip.style.transform = 'translateX(-50%)';
		};
		const hide = () => { tip.style.opacity = '0'; };
		el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(); });
		el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
	}

	/* ══════════════════════════════════════════
	   CounterUI — Glass Strip
	══════════════════════════════════════════ */
	class CounterUI {
		constructor({ onUsageRefresh } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;

			this._strip      = null;
			this._dot        = null;
			this._tokText    = null;
			this._ctxFill    = null;
			this._cacheChip  = null;
			this._usageEl    = null;
			this._sSegs      = null;
			this._sPct       = null;
			this._sReset     = null;
			this._wSegs      = null;
			this._wPct       = null;
			this._wReset     = null;
			this._tokTip     = null;
			this._usageTip   = null;

			this._totalTokens      = null;
			this._cachedUntil      = null;
			this._pendingCache     = false;
			this._imageCount       = 0;
			this._docCount         = 0;
			this._realBreakdown    = null;
			this._hasRealBreakdown = false;
			this._usage            = null;
			this._usageResetMs     = { five_hour: null, seven_day: null };
		}

		initialize() {
			this._tokTip   = makeTooltip();
			this._usageTip = makeTooltip();
		}

		attachHeader()    {}
		attachUsageLine() {}

		attachToInputWrapper(wrapper) {
			if (document.querySelector('.cc-bottom-strip')) return;

			const strip = document.createElement('div');
			strip.className = 'cc-bottom-strip';
			strip.innerHTML = `
				<div class="cc-bs-token">
					<div class="cc-bs-token-top">
						<div class="cc-bs-dot"></div>
						<span class="cc-bs-token-text">—</span>
						<span class="cc-bs-token-sub">/ 200k</span>
					</div>
					<div class="cc-bs-bar-wrap">
						<div class="cc-bs-bar-fill" style="width:0%"></div>
					</div>
				</div>

				<div class="cc-bs-div"></div>

				<div class="cc-bs-usage">
					<div class="cc-bs-pill">
						<div class="cc-bs-pill-top">
							<span class="cc-bs-pill-label">5h</span>
							<div class="cc-bs-segs cc-s-segs">${buildSegs(0)}</div>
							<span class="cc-bs-pill-pct cc-sp">—</span>
						</div>
						<span class="cc-bs-pill-reset cc-sr"></span>
					</div>

					<div class="cc-bs-pill">
						<div class="cc-bs-pill-top">
							<span class="cc-bs-pill-label">7d</span>
							<div class="cc-bs-segs cc-w-segs">${buildSegs(0)}</div>
							<span class="cc-bs-pill-pct cc-wp">—</span>
						</div>
						<span class="cc-bs-pill-reset cc-wr"></span>
					</div>
				</div>

				<div class="cc-bs-div cc-bs-cache-div cc-hidden"></div>
				<div class="cc-bs-cache-chip cc-hidden">⚡ —</div>
			`;

			let ccRoot = document.getElementById('cc-root');
			if (!ccRoot) {
				ccRoot = document.createElement('div');
				ccRoot.id = 'cc-root';
				ccRoot.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:0;z-index:99998;pointer-events:none;';
				document.documentElement.appendChild(ccRoot);
			}
			ccRoot.appendChild(strip);

			this._strip     = strip;
			this._dot       = strip.querySelector('.cc-bs-dot');
			this._tokText   = strip.querySelector('.cc-bs-token-text');
			this._ctxFill   = strip.querySelector('.cc-bs-bar-fill');
			this._cacheChip = strip.querySelector('.cc-bs-cache-chip');
			this._cacheDivEl = strip.querySelector('.cc-bs-cache-div');
			this._usageEl   = strip.querySelector('.cc-bs-usage');
			this._sSegs     = strip.querySelector('.cc-s-segs');
			this._sPct      = strip.querySelector('.cc-sp');
			this._sReset    = strip.querySelector('.cc-sr');
			this._wSegs     = strip.querySelector('.cc-w-segs');
			this._wPct      = strip.querySelector('.cc-wp');
			this._wReset    = strip.querySelector('.cc-wr');

			attachTooltip(strip.querySelector('.cc-bs-token'), this._tokTip, false);
			attachTooltip(this._usageEl, this._usageTip, false);

			if (this.onUsageRefresh) {
				this._usageEl.addEventListener('click', () => {
					this._usageEl.classList.add('cc-dim');
					Promise.resolve(this.onUsageRefresh()).finally(() => {
						this._usageEl.classList.remove('cc-dim');
					});
				});
			}

			this._renderToken();
			this._renderUsage();
		}

		/* ── Public setters ── */

		setConversationMetrics(data) {
			if (!data) {
				this._totalTokens      = null;
				this._cachedUntil      = null;
				this._imageCount       = 0;
				this._docCount         = 0;
				this._realBreakdown    = null;
				this._hasRealBreakdown = false;
			} else {
				const next = data.totalTokens ?? null;
				if (next !== null && next !== this._totalTokens && this._tokText) {
					this._tokText.classList.remove('cc-flash');
					void this._tokText.offsetWidth;
					this._tokText.classList.add('cc-flash');
				}
				this._totalTokens = next;
				this._cachedUntil = data.cachedUntil ?? this._cachedUntil ?? null;
				this._imageCount  = data.imageCount  ?? this._imageCount  ?? 0;
				this._docCount    = data.docCount    ?? this._docCount    ?? 0;
			}
			this._pendingCache = false;
			this._renderToken();
		}

		updateRealTokenBreakdown(data) {
			if (!data) return;
			if (data.cachedUntil) this._cachedUntil = data.cachedUntil;
			this._realBreakdown = {
				inputTokens:         data.inputTokens         || 0,
				outputTokens:        data.outputTokens        || 0,
				cacheReadTokens:     data.cacheReadTokens     || 0,
				cacheCreationTokens: data.cacheCreationTokens || 0,
			};
			this._hasRealBreakdown = true;
			this._pendingCache = false;
			this._renderToken();
		}

		setPendingCache(v) {
			this._pendingCache = !!v;
			this._renderToken();
		}

		setUsage(normalized) {
			this._usage = normalized;
			if (normalized?.five_hour?.resets_at) this._usageResetMs.five_hour = Date.parse(normalized.five_hour.resets_at);
			if (normalized?.seven_day?.resets_at)  this._usageResetMs.seven_day  = Date.parse(normalized.seven_day.resets_at);
			this._renderUsage();
		}

		/* ── Render ── */
		_renderToken() {
			if (!this._strip) return;

			if (this._totalTokens == null) {
				if (this._tokText) { this._tokText.textContent = '—'; this._tokText.classList.remove('cc-warn'); }
				if (this._dot)     this._dot.classList.remove('cc-warn');
				if (this._ctxFill) this._ctxFill.style.width = '0%';
				if (this._cacheChip)  this._cacheChip.classList.add('cc-hidden');
				if (this._cacheDivEl) this._cacheDivEl.classList.add('cc-hidden');
				return;
			}

			const tokens = this._totalTokens;
			const limit  = CC.CONST.CONTEXT_LIMIT_TOKENS;
			const util   = (tokens / limit) * 100;
			const warn   = util >= 80;
			const p      = pct(util);

			if (this._tokText) {
				const fmt = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
				this._tokText.textContent = this._hasRealBreakdown ? fmt : `~${fmt}`;
				this._tokText.classList.toggle('cc-warn', warn);
			}
			if (this._dot) this._dot.classList.toggle('cc-warn', warn);
			if (this._ctxFill) {
				this._ctxFill.style.width      = `${p}%`;
				this._ctxFill.style.background = barColor(p);
			}

			/* Cache chip (right side) */
			if (this._cacheChip) {
				if (this._pendingCache) {
					this._cacheChip.innerHTML = '⚡ caching…';
					this._cacheChip.classList.remove('cc-hidden');
					this._cacheDivEl?.classList.remove('cc-hidden');
				} else if (this._cachedUntil && this._cachedUntil > Date.now()) {
					this._cacheChip.classList.remove('cc-hidden');
					this._cacheDivEl?.classList.remove('cc-hidden');
					this._updateCacheTimer();
				} else {
					this._cacheChip.classList.add('cc-hidden');
					this._cacheDivEl?.classList.add('cc-hidden');
				}
			}

			/* Tooltip */
			if (this._tokTip) {
				const sourceLabel = this._hasRealBreakdown ? '✓ verified (from Claude)' : '~ estimated';
				let tip = `${tokens.toLocaleString()} / ${limit.toLocaleString()} tokens  ${sourceLabel}\n${util.toFixed(1)}% of context window`;

				if (this._hasRealBreakdown && this._realBreakdown) {
					const bd = this._realBreakdown;
					tip += `\n\nLast turn breakdown:`;
					tip += `\n  Input:         ${bd.inputTokens.toLocaleString()}`;
					if (bd.outputTokens)        tip += `\n  Output:        ${bd.outputTokens.toLocaleString()}`;
					if (bd.cacheReadTokens)     tip += `\n  Cache read:    ${bd.cacheReadTokens.toLocaleString()}`;
					if (bd.cacheCreationTokens) tip += `\n  Cache created: ${bd.cacheCreationTokens.toLocaleString()}`;
				} else {
					tip += `\n\n~${CC.CONST.SYSTEM_PROMPT_TOKENS.toLocaleString()} system prompt (estimate)`;
					if (this._imageCount > 0) tip += `\n~${(this._imageCount * CC.CONST.IMAGE_TOKEN_ESTIMATE).toLocaleString()} from ${this._imageCount} image(s)`;
					if (this._docCount > 0)   tip += `\n+ ${this._docCount} doc(s) estimated`;
				}
				this._tokTip.textContent = tip;
			}
		}

		_updateCacheTimer() {
			if (!this._cacheChip || !this._cachedUntil) return;
			const rem = this._cachedUntil - Date.now();
			if (rem <= 0) {
				this._cachedUntil      = null;
				this._hasRealBreakdown = false;
				this._cacheChip.classList.add('cc-hidden');
				this._cacheDivEl?.classList.add('cc-hidden');
				return;
			}
			this._cacheChip.textContent = `⚡ ${formatSeconds(Math.ceil(rem / 1000))}`;
		}

		_renderUsage() {
			if (!this._strip) return;
			const u = this._usage;
			if (!u) {
				if (this._sPct) this._sPct.textContent = '—';
				if (this._wPct) this._wPct.textContent = '—';
				return;
			}

			const applyPill = (segsEl, pctEl, resetEl, utilization, resetMs) => {
				const p = pct(utilization);
				if (segsEl) segsEl.innerHTML = buildSegs(p);
				if (pctEl) {
					pctEl.textContent = `${p}%`;
					pctEl.classList.toggle('cc-warn', p >= 80);
				}
				if (resetEl) {
					const r = resetMs ? formatResetCountdown(resetMs) : '';
					resetEl.textContent = r ? `resets ${r}` : '';
				}
			};

			if (u.five_hour) applyPill(this._sSegs, this._sPct, this._sReset, u.five_hour.utilization, this._usageResetMs.five_hour);
			if (u.seven_day)  applyPill(this._wSegs, this._wPct, this._wReset, u.seven_day.utilization,  this._usageResetMs.seven_day);

			if (this._usageTip && u.five_hour && u.seven_day) {
				const s  = pct(u.five_hour.utilization);
				const w  = pct(u.seven_day.utilization);
				const sr = this._usageResetMs.five_hour ? formatResetCountdown(this._usageResetMs.five_hour) : '—';
				const wr = this._usageResetMs.seven_day  ? formatResetCountdown(this._usageResetMs.seven_day)  : '—';
				this._usageTip.textContent = `5h session: ${s}%  (resets in ${sr})\n7d weekly:  ${w}%  (resets in ${wr})\n\nClick to refresh`;
			}
		}

		tick() {
			this._updateCacheTimer();
			this._updateResetTimers();
		}

		_updateResetTimers() {
			const sr = this._usageResetMs.five_hour ? formatResetCountdown(this._usageResetMs.five_hour) : '';
			const wr = this._usageResetMs.seven_day  ? formatResetCountdown(this._usageResetMs.seven_day)  : '';
			if (this._sReset) this._sReset.textContent = sr ? `resets ${sr}` : '';
			if (this._wReset) this._wReset.textContent = wr ? `resets ${wr}` : '';
		}
	}

	CC.ui = { CounterUI };
})();
