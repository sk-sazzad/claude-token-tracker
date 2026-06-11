# Claude Token Tracker

<p align="center">
  <img src="icons/icon128.png" alt="Claude Token Tracker" width="80" />
</p>

<p align="center">
  <strong>Track your Claude API token usage, cache status, and rate limits — right inside claude.ai</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.4.0-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/manifest-v3-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/browser-Chrome-yellow?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔢 **Live Token Counter** | প্রতিটি conversation-এ real-time token count দেখায় |
| 💰 **Cost Estimation** | Token usage থেকে আনুমানিক API cost হিসাব করে |
| 🕐 **Cache Timer** | Prompt cache কতক্ষণ active আছে তার countdown দেখায় |
| 📊 **Session Usage Bar** | ৫-ঘণ্টার rate limit window-এর ব্যবহার দেখায় |
| 📅 **Weekly Usage Bar** | ৭-দিনের usage utilization দেখায় |
| 🔔 **Reset Countdown** | Rate limit কখন reset হবে তার সময় দেখায় |
| 🌐 **Multi-script Token Estimation** | Bengali, Arabic, CJK ও Latin text-এর জন্য আলাদা আলাদা BPE ratio ব্যবহার করে সঠিক estimate দেয় |
| 🪟 **Popup Dashboard** | Extension icon-এ click করলে সব usage একসাথে দেখা যায় |

---

## 📸 Screenshot

> Glass-strip UI সরাসরি claude.ai-এর chat input-এর উপরে দেখা যায়।

---

## 🚀 Installation

এটি একটি **unpacked Chrome extension** — Chrome Web Store-এ নেই, তাই manually install করতে হবে।

### Step-by-step

1. **ZIP ডাউনলোড করুন** — [Releases](../../releases) পেজ থেকে সর্বশেষ `claude-token-tracker.zip` নামিয়ে নিন

2. **Extract করুন** — ZIP ফাইলটি যেকোনো folder-এ extract করুন

3. **Chrome Extensions খুলুন** — Address bar-এ যান:
   ```
   chrome://extensions
   ```

4. **Developer Mode চালু করুন** — উপরের ডানদিকের toggle টি **On** করুন

5. **Load Unpacked ক্লিক করুন** — "Load unpacked" বাটনে ক্লিক করুন

6. **Folder সিলেক্ট করুন** — Extract করা folder-টি select করুন

7. ✅ **Done!** — `claude.ai`-এ গেলেই extension কাজ শুরু করবে

---

## 🛠️ How It Works

Extension-টি `claude.ai`-এর network requests intercept করে কাজ করে:

- **Bridge script** (`bridge.js`) — page-এর `fetch` intercept করে SSE (Server-Sent Events) stream থেকে token data বের করে
- **Content scripts** — intercepted data process করে UI update করে
- **Popup** — stored usage data Chrome storage থেকে পড়ে dashboard দেখায়

কোনো external server নেই, সব কিছু locally browser-এর মধ্যেই হয়।

---

## 📁 Project Structure

```
claude-token-tracker/
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── content/
│   │   ├── constants.js       # Shared constants & config
│   │   ├── bridge-client.js   # Communicates with injected bridge
│   │   ├── tokens.js          # Token counting & BPE estimation
│   │   ├── ui.js              # Glass-strip UI component
│   │   └── main.js            # Entry point, orchestrates everything
│   ├── injected/
│   │   └── bridge.js          # Injected into page context to intercept fetch
│   └── styles.css             # UI styles
├── manifest.json
└── popup.html                 # Extension popup dashboard
```

---

## 🌐 Multi-script Token Estimation

Claude uses **Byte-Pair Encoding (BPE)**। বিভিন্ন script-এর token density আলাদা:

| Script | Chars per Token | কারণ |
|---|---|---|
| Latin / ASCII | ~3.5 | Most efficient |
| CJK (Chinese, Japanese, Korean) | ~1.5 | প্রতিটি character ≈ 1 token |
| Bengali / Arabic / Devanagari | ~0.3 | Unicode bytes-এ split হয়, প্রতি char ≈ 3–4 token |

এই extension সেই ratio অনুযায়ী mixed-script text-এ সঠিক estimate দেয়।

---

## 🔒 Privacy

- কোনো data বাইরে পাঠানো হয় **না**
- সব কিছু আপনার browser-এ locally process হয়
- Extension শুধু `claude.ai` domain-এ কাজ করে

---

## 🤝 Contributing

Pull request ও issue welcome! কোনো bug পেলে বা নতুন feature চাইলে [Issues](../../issues) খুলুন।

---

## 📄 License

MIT © [sk-sazzad](https://github.com/sk-sazzad)
