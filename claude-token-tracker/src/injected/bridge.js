(() => {
	'use strict';

	const CC_MARKER = 'ClaudeCounter';

	const originalFetch = window.fetch;

	const originalPushState = history.pushState.bind(history);
	const originalReplaceState = history.replaceState.bind(history);

	history.pushState = function (...args) {
		const result = originalPushState(...args);
		window.dispatchEvent(new CustomEvent('cc:urlchange'));
		return result;
	};

	history.replaceState = function (...args) {
		const result = originalReplaceState(...args);
		window.dispatchEvent(new CustomEvent('cc:urlchange'));
		return result;
	};

	window.fetch = async (...args) => {
		const url = toAbsoluteUrl(args[0]);
		const opts = args[1] || {};

		if (url && opts.method === 'POST' && (url.includes('/completion') || url.includes('/retry_completion'))) {
			post('cc:generation_start', {});
		}

		const response = await originalFetch.apply(window, args);

		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('event-stream')) {
			handleEventStream(response);
		}

		if (url && url.includes('/chat_conversations/') && url.includes('tree=')) {
			const meta = getConversationMeta(url);
			if (meta) {
				handleConversationResponse(meta, response);
			}
		}

		return response;
	};

	function post(type, payload) {
		window.postMessage({ cc: CC_MARKER, type, payload }, '*');
	}

	function postResponse(requestId, ok, payload, error) {
		window.postMessage({ cc: CC_MARKER, type: 'cc:response', requestId, ok, payload, error }, '*');
	}

	function toAbsoluteUrl(input) {
		if (typeof input === 'string') {
			if (input.startsWith('/')) return `https://claude.ai${input}`;
			return input;
		}
		if (input instanceof URL) return input.href;
		if (input instanceof Request) return input.url;
		return '';
	}

	function getConversationMeta(url) {
		const match = url.match(/^https:\/\/claude\.ai\/api\/organizations\/([^/]+)\/chat_conversations\/([^/?]+)/);
		return match ? { orgId: match[1], conversationId: match[2] } : null;
	}

	async function handleConversationResponse({ orgId, conversationId }, response) {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
			post('cc:conversation', { orgId, conversationId, data });
		} catch {}
	}

	async function handleEventStream(response) {
		try {
			const cloned = response.clone();
			const reader = cloned.body?.getReader?.();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = '';

			// Accumulate token usage across the full stream
			// Claude sends partial usage in message_start and final totals in message_delta
			let streamUsage = {
				input_tokens:            0,
				output_tokens:           0,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r\n|\r|\n/);
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.startsWith('data:')) continue;
					const raw = line.slice(5).trim();
					if (!raw) continue;
					try {
						const json = JSON.parse(raw);

						// Rate limit / session usage
						if (json?.type === 'message_limit' && json.message_limit) {
							post('cc:message_limit', json.message_limit);
						}

						// message_start: has initial input_tokens
						if (json?.type === 'message_start' && json.message?.usage) {
							const u = json.message.usage;
							if (typeof u.input_tokens === 'number')                    streamUsage.input_tokens            = u.input_tokens;
							if (typeof u.cache_read_input_tokens === 'number')         streamUsage.cache_read_input_tokens  = u.cache_read_input_tokens;
							if (typeof u.cache_creation_input_tokens === 'number')     streamUsage.cache_creation_input_tokens = u.cache_creation_input_tokens;
						}

						// message_delta: has final output_tokens
						if (json?.type === 'message_delta' && json.usage) {
							const u = json.usage;
							if (typeof u.output_tokens === 'number') streamUsage.output_tokens = u.output_tokens;
							if (typeof u.input_tokens === 'number')  streamUsage.input_tokens  = u.input_tokens;
							if (typeof u.cache_read_input_tokens === 'number') streamUsage.cache_read_input_tokens = u.cache_read_input_tokens;
							if (typeof u.cache_creation_input_tokens === 'number') streamUsage.cache_creation_input_tokens = u.cache_creation_input_tokens;

							// message_delta is the last meaningful usage event — emit now
							const total = streamUsage.input_tokens + streamUsage.output_tokens;
							if (total > 0) {
								post('cc:token_usage', { ...streamUsage, total_tokens: total });
							}
						}
					} catch {}
				}
			}
		} catch {}
	}

	window.addEventListener('message', async (event) => {
		if (event.source !== window) return;
		const data = event.data;
		if (!data || data.cc !== CC_MARKER || data.type !== 'cc:request') return;

		const { requestId, kind, payload } = data;
		try {
			if (kind === 'hash') {
				const text = typeof payload?.text === 'string' ? payload.text : '';
				if (!text || !crypto?.subtle?.digest) {
					postResponse(requestId, false, null, 'Hash unavailable');
					return;
				}
				const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
				const bytes = new Uint8Array(buffer);
				const hash = Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
				postResponse(requestId, true, { hash }, null);
				return;
			}

			if (kind === 'usage') {
				const orgId = payload?.orgId;
				if (!orgId) throw new Error('Missing orgId');
				const res = await originalFetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
					method: 'GET',
					credentials: 'include'
				});
				const json = await res.json();
				postResponse(requestId, true, json, null);
				return;
			}

			if (kind === 'conversation') {
				const orgId = payload?.orgId;
				const conversationId = payload?.conversationId;
				if (!orgId || !conversationId) throw new Error('Missing orgId/conversationId');
				const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
				const res = await originalFetch(url, { method: 'GET', credentials: 'include' });
				const json = await res.json();
				// FIX #1: Do NOT call post('cc:conversation') here.
				// The intercepted fetch in handleConversationResponse already fires cc:conversation
				// when Claude.ai fetches the conversation naturally. Calling it again here causes
				// computeConversationMetrics to run twice → UI flicker + wasted CPU.
				// Just return the data via postResponse; main.js bridge.on('cc:conversation') handles it.
				postResponse(requestId, true, json, null);
				return;
			}

			throw new Error(`Unknown kind: ${kind}`);
		} catch (e) {
			postResponse(requestId, false, null, e?.message || String(e));
		}
	});
})();
