<div align="center">

<img src="icons/icon128.png" alt="Claude Token Tracker Logo" width="96" />

# Claude Token Tracker

**Track token usage, cache timers & rate limits — live inside claude.ai**

[![Version](https://img.shields.io/badge/version-1.4.0-6366f1?style=for-the-badge&logo=github)](https://github.com/sk-sazzad/claude-token-tracker/releases/tag/v1.4.0)
[![Manifest](https://img.shields.io/badge/Manifest-v3-f97316?style=for-the-badge&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-facc15?style=for-the-badge&logo=googlechrome&logoColor=black)](https://github.com/sk-sazzad/claude-token-tracker)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/sk-sazzad/claude-token-tracker?style=for-the-badge&color=f97316)](https://github.com/sk-sazzad/claude-token-tracker/stargazers)

<br/>

<a href="https://github.com/sk-sazzad/claude-token-tracker/releases/latest/download/claude-token-tracker.zip">
  <img src="https://img.shields.io/badge/⬇️%20Download%20v1.4.0-claude--token--tracker.zip-6366f1?style=for-the-badge&logo=github&logoColor=white" height="46" alt="Download Latest Release" />
</a>

<br/><br/>

> ⚠️ **Chrome Web Store-এ পাওয়া যাবে না।** নিচের Installation Guide দেখুন।

<br/>

---

**Made with ❤️ by [SK Sazzad](https://sazzad.site) &nbsp;·&nbsp; [🌐 Website](https://sazzad.site) &nbsp;·&nbsp; [GitHub](https://github.com/sk-sazzad)**

---

</div>

<br/>

## ✨ Features

<table>
<tr>
<td width="50%">

**🔢 Live Token Counter**
প্রতিটি conversation-এ real-time input/output token count দেখায়।

**💰 Cost Estimation**
Token usage থেকে আনুমানিক API cost হিসাব করে দেখায়।

**🕐 Cache Timer**
Prompt cache কতক্ষণ active আছে তার live countdown দেখায়।

**🪟 Popup Dashboard**
Extension icon-এ click করলে সব usage summary এক জায়গায় দেখা যায়।

</td>
<td width="50%">

**📊 Session Usage Bar**
৫-ঘণ্টার rate limit window-এর ব্যবহার progress bar-সহ দেখায়।

**📅 Weekly Usage Bar**
৭-দিনের usage utilization percentage দেখায়।

**🔔 Reset Countdown**
Rate limit কখন reset হবে তার সঠিক সময় দেখায়।

**🌐 Multi-script Token Support**
Bengali, Arabic, CJK ও Latin — সব script-এ accurate BPE estimation।

</td>
</tr>
</table>

---

## 🚀 Installation

> **Chrome Web Store-এ নেই।** নিচের ৬টি ধাপ অনুসরণ করুন:

### Step 1 — ডাউনলোড করুন

<a href="https://github.com/sk-sazzad/claude-token-tracker/releases/latest/download/claude-token-tracker.zip">
  <img src="https://img.shields.io/badge/⬇️%20Download%20ZIP-Latest%20Release-6366f1?style=for-the-badge&logo=github&logoColor=white" height="40" />
</a>

### Step 2 — Extract করুন

ZIP ফাইলটি আপনার পছন্দের যেকোনো folder-এ extract করুন।

### Step 3 — Chrome Extensions খুলুন

Browser-এর address bar-এ এটি টাইপ করুন:

```
chrome://extensions
```

### Step 4 — Developer Mode চালু করুন

পেজের উপরের ডানদিকে **Developer mode** toggle টি **On** করুন।

### Step 5 — Load Unpacked করুন

**"Load unpacked"** বাটনে click করুন এবং extract করা folder-টি select করুন।

### Step 6 — Done! ✅

`claude.ai` খুলুন — extension automatically কাজ শুরু করবে।

---

## 🛠️ How It Works

Extension-টি `claude.ai`-এর network layer intercept করে সম্পূর্ণ locally কাজ করে — কোনো external server নেই।

```
claude.ai request
       │
       ▼
  bridge.js  ──── fetch() intercept ────▶  SSE stream parse
       │
       ▼
 content scripts ── token data process ──▶  UI update
       │
       ▼
  popup.html  ──── Chrome storage read ──▶  Dashboard render
```

| Component | Role |
|:---|:---|
| `bridge.js` | Page context-এ inject হয়ে `fetch()` intercept করে SSE stream থেকে token data বের করে |
| `tokens.js` | BPE-aware multi-script token counting ও cost calculation করে |
| `ui.js` | claude.ai-এর UI-এর ভেতরে glass-strip component render করে |
| `main.js` | সব component orchestrate করে, URL change detect করে |
| `popup.html` | Stored usage data পড়ে summary dashboard দেখায় |

---

## 🌐 Multi-script Token Accuracy

Claude **Byte-Pair Encoding (BPE)** ব্যবহার করে। প্রতিটি script-এর token density আলাদা — এই extension সেটা বিবেচনায় রেখে estimate করে:

| Script | Chars / Token | কারণ |
|:---|:---:|:---|
| Latin / ASCII | ~3.5 | BPE-তে সবচেয়ে efficient |
| CJK (Chinese, Japanese, Korean) | ~1.5 | প্রতিটি character ≈ 1 token |
| **Bengali / Arabic / Devanagari** | ~0.3 | Unicode bytes-এ split হয়, প্রতি char ≈ 3–4 token |

Mixed-script text (যেমন Bangla + English) এর ক্ষেত্রেও সঠিক estimate পাওয়া যায়।

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
│   │   ├── constants.js        # Shared constants & pricing config
│   │   ├── bridge-client.js    # Communicates with injected bridge
│   │   ├── tokens.js           # BPE-aware multi-script token counter
│   │   ├── ui.js               # Glass-strip UI component
│   │   └── main.js             # Entry point & orchestration
│   ├── injected/
│   │   └── bridge.js           # Page-context fetch() interceptor
│   └── styles.css              # Component styles
├── manifest.json               # Chrome Extension Manifest v3
└── popup.html                  # Extension popup dashboard
```

---

## 🔒 Privacy

| | |
|:---:|:---|
| ✅ | **No data collection** — কোনো data বাইরে পাঠানো হয় না |
| ✅ | **Fully local** — সব কিছু আপনার browser-এর মধ্যে process হয় |
| ✅ | **Minimal permissions** — শুধু `claude.ai` domain-এ কাজ করে |
| ✅ | **Open source** — সম্পূর্ণ source code এখানেই available |

---

## 🤝 Contributing

Bug পেলে বা নতুন feature চাইলে [Issues](https://github.com/sk-sazzad/claude-token-tracker/issues) খুলুন।
Pull request সবসময় welcome!

---

## 👨‍💻 Author

<table>
<tr>
<td align="center" width="200">
<br/>
<strong>SK Sazzad</strong><br/>
<sub>Web Developer</sub><br/><br/>
<a href="https://sazzad.site"><img src="https://img.shields.io/badge/🌐%20Website-sazzad.site-6366f1?style=flat-square" /></a><br/>
<a href="https://github.com/sk-sazzad"><img src="https://img.shields.io/badge/GitHub-sk--sazzad-333?style=flat-square&logo=github" /></a>
<br/><br/>
</td>
</tr>
</table>

---

## 📄 License

MIT License © 2025 [SK Sazzad](https://sazzad.site)

---

<div align="center">

এই extension টি কাজের লাগলে একটি ⭐ **Star** দিন — অনেক উৎসাহ পাই!

<br/>

<a href="https://github.com/sk-sazzad/claude-token-tracker/releases/latest/download/claude-token-tracker.zip">
  <img src="https://img.shields.io/badge/⬇️%20Download%20Latest%20Release-claude--token--tracker.zip-6366f1?style=for-the-badge&logo=github&logoColor=white" height="46" />
</a>

<br/><br/>

<a href="https://github.com/sk-sazzad/claude-token-tracker/issues">
  <img src="https://img.shields.io/badge/🐛%20Report%20Bug-Issues-f97316?style=flat-square" />
</a>
&nbsp;
<a href="https://github.com/sk-sazzad/claude-token-tracker/issues">
  <img src="https://img.shields.io/badge/💡%20Request%20Feature-Issues-22c55e?style=flat-square" />
</a>

</div>
