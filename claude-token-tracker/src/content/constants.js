(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		BRIDGE_SCRIPT_ID: 'cc-bridge-script',

		INPUT_FIELD_SELECTORS: [
			'[data-testid="chat-input"]',
			'[data-testid="composer-input"]',
			'div[contenteditable="true"][spellcheck]',
			'div[contenteditable="true"]',
			'textarea[placeholder*="message" i]',
			'textarea[placeholder*="write" i]',
		],

		INPUT_WRAPPER_SELECTORS: [
			'[data-testid="chat-input-container"]',
			'[data-testid="composer"]',
			'fieldset',
		],
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS:        60 * 60 * 1000,  // Claude prompt cache = 1 hour
		CONTEXT_LIMIT_TOKENS:   200_000,
		IMAGE_TOKEN_ESTIMATE:   1_600,
		// FIX #4: Updated system prompt estimate for Claude 3.5+
		// Includes built-in instructions, tool definitions, project context
		SYSTEM_PROMPT_TOKENS:   4_000,
	});
})();
