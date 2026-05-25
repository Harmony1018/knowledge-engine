#!/usr/bin/env node
/**
 * 个人知识引擎 — 后端服务（云同步版）
 * API 端点：
 *   GET  /                — 前端页面
 *   GET  /api/items       — 所有知识
 *   POST /api/items       — 添加知识
 *   GET  /api/items/:id   — 单个知识
 *   DELETE /api/items/:id — 删除知识
 *   POST /api/items/sync  — 批量同步知识（全量替换）
 *   GET  /api/galaxies    — 星系名称
 *   PUT  /api/galaxies    — 更新星系名称
 *   GET  /api/graph       — 知识图谱数据
 *   POST /api/ask         — AI 问答
 *   POST /api/import-url  — 一键导入链接
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// 云部署模式下 public 目录与 server.js 同层
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// ===== 数据存储（JSON 文件）=====
const DATA_FILE = path.join(__dirname, 'knowledge.json');
const GALAXY_FILE = path.join(__dirname, 'galaxies.json');

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return []; }
}

function saveData(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function loadGalaxies() {
  try { return JSON.parse(fs.readFileSync(GALAXY_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveGalaxies(g) {
  fs.writeFileSync(GALAXY_FILE, JSON.stringify(g, null, 2), 'utf-8');
}

// ===== 工具函数：提取特征指纹 =====
function extractFingerprint(text) {
  const t = text.toLowerCase();
  const sig = new Set();

  // 中文 bigram（只取中文汉字）
  const cn = t.replace(/[^一-鿿]/g, '');
  for (let i = 0; i < cn.length - 1; i++) {
    sig.add(cn.slice(i, i + 2));
  }

  // 英文单词（>=3字母）
  (t.match(/[a-z][a-z0-9+#.-]{2,}/g) || []).forEach(w => sig.add(w));

  // 完整标题和句子片段（用标点拆分）
  t.split(/[，。！？、；：""''（）\[\]【】{}《》\s]+/).forEach(s => {
    const trimmed = s.trim();
    if (trimmed.length >= 2 && trimmed.length <= 10) sig.add(trimmed);
  });

  // 去重后取前 25 个最独特的
  return [...sig].slice(0, 25);
}

// ===== 工具函数：计算关联度（Jaccard 相似度）=====
function calcRelevance(fp1, fp2) {
  const set1 = new Set(fp1);
  const set2 = new Set(fp2);
  const intersection = [...set1].filter(k => set2.has(k));
  const union = new Set([...set1, ...set2]);
  return union.size > 0 ? intersection.length / union.size : 0;
}

// ===== API：知识增删改查 =====
app.get('/api/items', (req, res) => {
  const items = loadData();
  res.json(items);
});

app.get('/api/items/:id', (req, res) => {
  const items = loadData();
  const item = items.find(i => i.id === parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: '未找到' });
  res.json(item);
});

app.post('/api/items', (req, res) => {
  const { title, content, category, summary, tags, image, fingerprint, relatedIds } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: '标题和内容不能为空' });
  }

  const items = loadData();
  const newItem = {
    id: Date.now(),
    title,
    content,
    category: category || '未分类',
    summary: summary || '',
    tags: tags || [],
    image: image || null,
    relatedIds: relatedIds || [],
    fingerprint: fingerprint || extractFingerprint(title + ' ' + content),
    createdAt: new Date().toISOString()
  };
  items.push(newItem);
  saveData(items);
  res.json(newItem);
});

app.delete('/api/items/:id', (req, res) => {
  let items = loadData();
  const before = items.length;
  items = items.filter(i => i.id !== parseInt(req.params.id));
  if (items.length === before) return res.status(404).json({ error: '未找到' });
  saveData(items);
  res.json({ ok: true });
});

// ===== API：批量同步知识 =====
app.post('/api/items/sync', (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: '需要数组' });
  saveData(items);
  res.json({ ok: true });
});

// ===== API：星系名称 =====
app.get('/api/galaxies', (req, res) => {
  res.json(loadGalaxies());
});

app.put('/api/galaxies', (req, res) => {
  const g = req.body;
  if (typeof g !== 'object') return res.status(400).json({ error: '需要对象' });
  saveGalaxies(g);
  res.json({ ok: true });
});

// ===== API：一键导入链接 =====
app.post('/api/import-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL 不能为空' });

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeEngine/1.0)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return res.status(502).json({ error: `获取失败: ${resp.status}` });

    const html = await resp.text();

    // 提取标题
    const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = tm ? tm[1].trim() : '未命名';

    // 去标签取正文
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 5000);

    let result = { title, content: text || '无法提取内容', tags: [], category: '' };

    // AI 结构化
    const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || 'sk-207863609b034ffaa562c29de535ffb4';
    try {
      const ai = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: '分析内容返回JSON，只输出JSON。' }, { role: 'user', content: `标题：${title}\n内容：${text.slice(0, 2000)}\n\n{"title":"优化的标题","category":"2-4字分类","tags":["标签1","标签2"]}` }],
          temperature: 0.3, max_tokens: 500
        })
      });
      if (ai.ok) {
        const d = await ai.json();
        try { const r = JSON.parse(d.choices[0].message.content); result.title = r.title || title; result.category = r.category || ''; result.tags = r.tags || []; } catch (e) {}
      }
    } catch (e) {}

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `获取链接失败: ${e.message}` });
  }
});

// ===== API：知识图谱数据 =====
app.get('/api/graph', (req, res) => {
  const items = loadData();
  const nodes = items.map(item => ({
    id: item.id,
    title: item.title,
    content: item.content?.slice(0, 100),
    image: item.image
  }));

  const links = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const relevance = calcRelevance(items[i].fingerprint, items[j].fingerprint);
      if (relevance > 0.03) {
        links.push({
          source: items[i].id,
          target: items[j].id,
          strength: Math.round(relevance * 100) / 100
        });
      }
    }
  }

  res.json({ nodes, links });
});

// ===== API：AI 问答（RAG）=====
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: '问题不能为空' });

  const items = loadData();
  if (items.length === 0) {
    return res.json({ answer: '知识库还是空的，先添加一些知识吧！' });
  }

  // n-gram 指纹匹配：找最相关的知识
  const qFp = extractFingerprint(question);
  const ranked = items.map(item => {
    const score = calcRelevance(qFp, item.fingerprint);
    return { item, score };
  }).sort((a, b) => b.score - a.score);

  const topItems = ranked.filter(r => r.score > 0).slice(0, 5);
  const context = topItems.length > 0
    ? topItems.map((r, i) =>
        `相关知识 ${i + 1}：\n标题：${r.item.title}\n内容：${r.item.content?.slice(0, 500)}`
      ).join('\n\n')
    : items.slice(0, 3).map(item =>
        `标题：${item.title}\n内容：${item.content?.slice(0, 300)}`
      ).join('\n\n');

  const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || 'sk-207863609b034ffaa562c29de535ffb4';

  try {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `你是个人知识库助手。请基于以下知识内容回答问题。如果知识库中没有相关信息，请如实说不知道。\n\n知识库内容：\n${context}` },
        { role: 'user', content: question }
      ],
      temperature: 0.6,
      max_tokens: 1000
    });

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `AI 请求失败: ${err}` });
    }

    const data = await response.json();
    const answer = data.choices[0].message.content;

    res.json({
      answer,
      sources: topItems.map(r => ({ title: r.item.title, id: r.item.id }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 前端页面 =====
app.get('/', (req, res) => {
  for (const p of [
    path.join(__dirname, 'knowledge-engine.html'),
    path.join(__dirname, '..', 'knowledge-engine.html'),
    path.join(__dirname, 'public', 'index.html')
  ]) { if (fs.existsSync(p)) return res.sendFile(p); }
  res.send('<h2>请将 knowledge-engine.html 放在服务器目录下</h2>');
});

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`🌐 知识引擎已启动：http://localhost:${PORT}`);
  console.log(`   添加知识：POST /api/items`);
  console.log(`   AI问答：POST /api/ask`);
  console.log(`   查看图谱：GET /api/graph`);
});
