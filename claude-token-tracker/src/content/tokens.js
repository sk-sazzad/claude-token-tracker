(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

	/* ── Serialization ── */
	function stableStringify(value) {
		const seen = new WeakSet();
		const normalize = (v) => {
			if (v === null || typeof v !== 'object') return v;
			if (seen.has(v)) return '[Circular]';
			seen.add(v);
			if (Array.isArray(v)) return v.map(normalize);
			const out = {};
			for (const key of Object.keys(v).sort()) out[key] = normalize(v[key]);
			return out;
		};
		try { return JSON.stringify(normalize(value)); } catch { return ''; }
	}

	/* ── Tokenizer ──
	   Script-aware tokenizer with correct per-script ratios.
	   Claude uses byte-pair encoding (BPE). Each script has very different
	   token density:
	     • ASCII/Latin    ~3.5 chars/token  (most efficient)
	     • CJK            ~1.5 chars/token  (each char ~1 token)
	     • Bengali/Arabic/Devanagari ~0.35 chars/token
	       (each character = 3-4 tokens because BPE splits Unicode bytes)

	   FIX #3: Whitespace and punctuation are now counted separately
	   to avoid overestimating latin token count in mixed-script text.
	── */
	function countTokens(text) {
		if (!text) return 0;

		const len = text.length;
		if (len === 0) return 0;

		// Count characters by script
		const bengali    = (text.match(/[\u0980-\u09FF]/g) || []).length;
		const arabic     = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length;
		const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
		const cjk        = (text.match(/[\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length;

		// FIX #3: Separate whitespace and punctuation from latin
		const whitespace  = (text.match(/\s+/g) || []).join('').length;
		const punctuation = (text.match(/[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g) || []).length;
		const latin       = len - bengali - arabic - devanagari - cjk - whitespace - punctuation;

		// Calculate tokens per script
		// Bengali/Arabic/Devanagari: BPE splits each char into ~3-4 byte-tokens
		const denseTokens = (bengali + arabic + devanagari) * 3.2;
		// CJK: roughly 1 token per character
		const cjkTokens   = cjk * 0.67;
		// Latin/ASCII: ~3.5 chars per token
		const latinTokens = Math.max(0, latin) / 3.5;
		// Whitespace collapses in BPE, ~4 chars per token
		const wsTokens    = whitespace / 4;
		// Most punctuation = 1 token each, but sequences merge
		const punctTokens = punctuation / 2;

		return Math.ceil(denseTokens + cjkTokens + latinTokens + wsTokens + punctTokens);
	}

	/* ── Conversation trunk (active branch) ── */
	function buildTrunk(conversation) {
		const messages = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : [];
		const byId = new Map();
		for (const msg of messages) {
			if (msg?.uuid) byId.set(msg.uuid, msg);
		}
		const leaf = conversation?.current_leaf_message_uuid;
		if (!leaf) return [];
		const trunk = [];
		let currentId = leaf;
		while (currentId && currentId !== ROOT_MESSAGE_ID) {
			const msg = byId.get(currentId);
			if (!msg) break;
			trunk.push(msg);
			currentId = msg.parent_message_uuid;
		}
		trunk.reverse();
		return trunk;
	}

	/* ── Content item helpers ── */
	function stringifyContentItem(item) {
		if (!item || typeof item !== 'object') return { text: '', extraTokens: 0 };
		if (typeof item.type !== 'string') return { text: '', extraTokens: 0 };

		// Thinking blocks: not sent back to model, don't count
		if (item.type === 'thinking' || item.type === 'redacted_thinking') {
			return { text: '', extraTokens: 0 };
		}

		// Images: Claude bills a fixed token amount per image
		if (item.type === 'image') {
			return { text: '', extraTokens: CC.CONST.IMAGE_TOKEN_ESTIMATE };
		}

		// Documents/files — corrected token estimate
		// Claude extracts text from PDFs, so raw bytes / 3.5 was a huge overestimate.
		// Realistic ratio after text extraction: ~1 token per 6 bytes of raw PDF data.
		if (item.type === 'document') {
			if (typeof item.source?.data === 'string' && item.source.data.length > 0) {
				// base64 → raw bytes, then realistic post-extraction token estimate
				const byteLen = Math.ceil(item.source.data.length * 0.75);
				return { text: '', extraTokens: Math.ceil(byteLen / 6) };
			}
			if (typeof item.text === 'string' && item.text) {
				return { text: item.text, extraTokens: 0 };
			}
			return { text: '', extraTokens: 500 };
		}

		// Plain text (most common)
		if (item.type === 'text' && typeof item.text === 'string') {
			return { text: item.text, extraTokens: 0 };
		}

		// Tool use blocks
		if (item.type === 'tool_use') {
			return {
				text: stableStringify({ id: item.id, name: item.name, input: item.input }),
				extraTokens: 0,
			};
		}

		// Tool result blocks
		if (item.type === 'tool_result') {
			return {
				text: stableStringify({ tool_use_id: item.tool_use_id, is_error: item.is_error, content: item.content }),
				extraTokens: 0,
			};
		}

		// Generic fallback
		const minimal = {};
		if (typeof item.text === 'string') minimal.text = item.text;
		if (typeof item.title === 'string') minimal.title = item.title;
		if (typeof item.url === 'string') minimal.url = item.url;
		if (typeof item.content === 'string') minimal.content = item.content;
		if (Array.isArray(item.content)) minimal.content = item.content;
		if (Object.keys(minimal).length === 0) return { text: '', extraTokens: 0 };
		return { text: stableStringify(minimal), extraTokens: 0 };
	}

	function getMessageCountables(message) {
		let textParts = [];
		let extraTokens = 0;

		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			const { text, extraTokens: et } = stringifyContentItem(item);
			if (text) textParts.push(text);
			extraTokens += et;
		}

		const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
		for (const a of attachments) {
			// FIX #8: Skip image attachments — they are counted separately via files[]
			const isImage = a?.file_type?.startsWith('image/') || a?.content_type?.startsWith('image/');
			if (isImage) continue;

			if (typeof a?.extracted_content === 'string' && a.extracted_content) {
				textParts.push(a.extracted_content);
			} else if (a?.file_size && !a?.extracted_content) {
				extraTokens += Math.ceil((a.file_size || 0) / 6);
			}
		}

		const files = Array.isArray(message?.files) ? message.files : [];
		for (const f of files) {
			if (f?.file_kind === 'image' || f?.content_type?.startsWith('image/')) {
				extraTokens += CC.CONST.IMAGE_TOKEN_ESTIMATE;
			}
		}

		return { text: textParts.join('\n'), extraTokens };
	}

	/* ── Token cache (avoid re-counting unchanged messages) ── */
	function lightFingerprint(text, extraTokens) {
		if (!text && !extraTokens) return null;
		const sample = text.length > 0
			? `${text.charCodeAt(0)}${text.charCodeAt(Math.floor(text.length / 2))}${text.charCodeAt(text.length - 1)}`
			: '0';
		return `${text.length}:${extraTokens}:${sample}`;
	}

	async function hashString(str) {
		if (CC.bridge?.requestHash) {
			try {
				const res = await CC.bridge.requestHash(str);
				if (res?.hash) return res.hash;
			} catch { /* fall through to light fingerprint */ }
		}
		return lightFingerprint(str, 0);
	}

	async function fingerprint(text, extraTokens) {
		if (!text && !extraTokens) return null;
		const hash = await hashString(text);
		if (!hash) return lightFingerprint(text, extraTokens);
		return `${text.length}:${extraTokens}:${hash}`;
	}

	class TokenCache {
		constructor() { this._map = new Map(); }

		async get(msgId, text, extraTokens) {
			const fp = await fingerprint(text, extraTokens);
			if (!fp) return countTokens(text) + extraTokens;
			const cached = this._map.get(msgId);
			if (cached && cached.fp === fp) return cached.tokens;
			const tokens = countTokens(text) + extraTokens;
			this._map.set(msgId, { fp, tokens });
			return tokens;
		}

		prune(keepIds) {
			const keep = new Set(keepIds);
			for (const id of this._map.keys()) {
				if (!keep.has(id)) this._map.delete(id);
			}
		}
	}

	const tokenCache = new TokenCache();

	/* ── Main export ── */
	async function computeConversationMetrics(conversation) {
		const trunk = buildTrunk(conversation);
		const trunkIds = trunk.map((m) => m.uuid).filter(Boolean);
		tokenCache.prune(trunkIds);

		let totalTokens = CC.CONST.SYSTEM_PROMPT_TOKENS;
		let lastAssistantMs = null;
		let imageCount = 0;
		let docCount = 0;

		for (const msg of trunk) {
			if (msg?.sender === 'assistant' && msg?.created_at) {
				const t = Date.parse(msg.created_at);
				if (!lastAssistantMs || t > lastAssistantMs) lastAssistantMs = t;
			}

			const content = Array.isArray(msg?.content) ? msg.content : [];
			for (const item of content) {
				if (item?.type === 'image') imageCount++;
				if (item?.type === 'document') docCount++;
			}

			const { text, extraTokens } = getMessageCountables(msg);
			const msgTokens = msg?.uuid
				? await tokenCache.get(msg.uuid, text, extraTokens)
				: countTokens(text) + extraTokens;
			totalTokens += msgTokens;
		}

		// cachedUntil based on last assistant message time (approximation)
		const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;

		return {
			trunkMessageCount: trunk.length,
			totalTokens,
			lastAssistantMs,
			cachedUntil,
			imageCount,
			docCount,
		};
	}

	CC.tokens = { computeConversationMetrics };
})();
