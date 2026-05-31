// Vercel serverless function — Claude 視覺辨識：把產品截圖解析成結構化產品資料
// 需要環境變數 ANTHROPIC_API_KEY（在 Vercel → Settings → Environment Variables 設定）
// 可選 EXTRACT_MODEL 覆寫模型，預設 claude-sonnet-4-6
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: '伺服器尚未設定 ANTHROPIC_API_KEY 環境變數' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const image = body.image || '';
    if (!image) { res.status(400).json({ error: '缺少 image' }); return; }

    let media = 'image/jpeg', data = image;
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(image);
    if (m) { media = m[1]; data = m[2]; }

    const model = process.env.EXTRACT_MODEL || 'claude-sonnet-4-6';
    const prompt = [
      '你是資料擷取助手。看這張圖（可能是菜單、價目表、Excel/表格截圖，或 POS 點餐畫面），擷取其中的「產品」清單。',
      '只回傳「純 JSON 陣列」，不要任何說明文字，不要 markdown 圍欄。每個元素格式：',
      '{"category":"","name":"","english_name":"","price":"","note":""}',
      '規則：',
      '- name = 產品中文名（必填；抓不到名稱的就略過該筆）。',
      '- english_name = 英文名，沒有就空字串。',
      '- price = 售價數字或原樣文字，沒有就空字串。',
      '- category = 產品類別，盡量從這些挑最接近的：Pizza、早餐、越南三明治、速食、副餐、沙拉/飯碗、湯品、甜點、冰淇淋、飲品；都不像就用你判斷的簡短類別或空字串。',
      '- note = 其他補充（規格、份量、口味等），沒有就空字串。',
      '只輸出 JSON 陣列。'
    ].join('\n');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: media, data } },
          { type: 'text', text: prompt }
        ] }]
      })
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: 'Anthropic API 錯誤：' + t.slice(0, 300) }); return; }

    const j = await r.json();
    let text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    let products = [];
    try { products = JSON.parse(text); }
    catch (e) { const mm = text.match(/\[[\s\S]*\]/); if (mm) { try { products = JSON.parse(mm[0]); } catch (_) {} } }
    if (!Array.isArray(products)) products = [];
    products = products
      .filter(p => p && String(p.name || '').trim())
      .map(p => ({
        category: String(p.category || ''),
        name: String(p.name || ''),
        english_name: String(p.english_name || p.en || ''),
        price: String(p.price == null ? '' : p.price),
        note: String(p.note || '')
      }));

    res.status(200).json({ products, usage: j.usage || null, model });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
