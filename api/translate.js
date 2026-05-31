// Vercel serverless function — 把產品中文品名翻成英文菜單名稱（Claude）
// 需要環境變數 ANTHROPIC_API_KEY（與 /api/extract 同一把）；可選 TRANSLATE_MODEL，預設 haiku
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: '伺服器尚未設定 ANTHROPIC_API_KEY 環境變數' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const text = String(body.text || '').trim();
    if (!text) { res.status(400).json({ error: '缺少 text' }); return; }

    const model = process.env.TRANSLATE_MODEL || 'claude-haiku-4-5-20251001';
    const prompt = '把以下餐飲／菜單品名翻成自然、簡潔的英文菜單名稱（Title Case；不要句點、不要引號、不要任何解釋或多餘文字）。只輸出英文名稱本身：\n\n' + text;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 120, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: 'Anthropic API 錯誤：' + t.slice(0, 300) }); return; }

    const j = await r.json();
    let english = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
    english = english.replace(/^["'`\s]+/, '').replace(/["'`.\s]+$/, '').trim();
    res.status(200).json({ english });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
