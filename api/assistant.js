// Vercel serverless function — AI 包材採購主管
// 讀前端傳來的資料快照，回覆查詢/分析，並「提議」資料動作（前端確認後才執行）。
// 需要環境變數 ANTHROPIC_API_KEY；可選 ASSISTANT_MODEL，預設 claude-sonnet-4-6
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: '伺服器尚未設定 ANTHROPIC_API_KEY 環境變數' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const data = body.data || {};
    if (!messages.length) { res.status(400).json({ error: '缺少 messages' }); return; }

    const model = process.env.ASSISTANT_MODEL || 'claude-sonnet-4-6';
    const system = [
      '你是「AI 包材採購主管」，協助管理 GROUN:D 餐飲的產品、包材、供應商資料。',
      '資料模型：以「產品」為中心發散包材 —— 一個產品可對應多個包材；一個包材可被多個產品共用。',
      '（例：飲料→杯子/杯蓋/杯架/袋子；漢堡→漢堡盒/紙袋/貼紙；炸物→炸物盒/醬料杯/紙袋）。不是以套餐為主，也不是一道菜只對一個包材。',
      '',
      '你只「讀目前提供的資料」並「提議動作」，不會也不能直接改資料庫；實際新增/修改/刪除由前端在使用者按「確認」後執行。',
      '',
      '回覆規則：',
      '- 一律用繁體中文，直接用 Markdown 寫（條列用 - 、表格用 | 標準語法），不要包成 JSON、不要用程式碼圍欄。',
      '- 查詢/分析類：依「目前資料」回答；資料找不到就明說找不到，不要編造。',
      '- 需要新增/修改/刪除/綁定資料時：用文字說明你打算做什麼，並「呼叫 propose_actions 工具」帶上動作清單（前端會跳確認卡，刪除會再次確認）。純查詢不要呼叫工具。',
      '',
      'propose_actions 的 actions 陣列，每個元素為下列其一：',
      '- {"type":"add_product","name":"","category":"","english_name":"","price":"","unit":"","tags":[],"note":"","packaging":["包材名",...]}',
      '- {"type":"add_packaging","name":"","ptype":"<包材代碼或留空>","spec":"","material":"","group":"","note":""}',
      '- {"type":"link","product":"產品名","packaging":["包材名",...]}',
      '- {"type":"unlink","product":"產品名","packaging":["包材名",...]}',
      '- {"type":"update_product","match":"產品名或id","set":{要改的欄位}}',
      '- {"type":"update_packaging","match":"包材名或id","set":{要改的欄位}}',
      '- {"type":"delete_product","match":"產品名或id"}',
      '- {"type":"delete_packaging","match":"包材名或id"}',
      '',
      '欄位：產品(name, category, english_name, price, unit, tags[], note, is_active)；包材(name, type, spec, material, grp/group, note)。',
      '包材 type 代碼：burgerpaper漢堡紙 / box餐盒 / pizzabox比薩盒 / cupholder杯架 / bowl碗 / saucecup醬料杯 / hotcup熱飲杯 / coldcup冷飲杯 / lid杯蓋 / bag紙袋 / cutlery餐具吸管 / cleaning清潔 / sauce醬料包 / sticker貼紙 / other其他。',
      '新增產品時 category 盡量用現有 categories；單位用現有 units；標籤用現有 tags（沒有可新建）。',
      '',
      '以下是目前的完整資料（回答與提議動作都要依據它）：',
      '```json',
      JSON.stringify(data),
      '```'
    ].join('\n');

    const tools = [{
      name: 'propose_actions',
      description: '當使用者要新增/修改/刪除/綁定產品或包材時呼叫，提出「待使用者確認」的動作清單。純查詢、分析、列表時不要呼叫。',
      input_schema: { type: 'object', properties: { actions: { type: 'array', items: { type: 'object' }, description: '動作物件陣列，格式見 system 說明' } }, required: ['actions'] }
    }];

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 4096, system, tools,
        messages: messages.slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
      })
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: 'Anthropic API 錯誤：' + t.slice(0, 300) }); return; }

    const j = await r.json();
    let reply = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    let actions = [];
    (j.content || []).forEach(c => { if (c.type === 'tool_use' && c.input && Array.isArray(c.input.actions)) actions = actions.concat(c.input.actions); });
    if (!reply) reply = actions.length ? '我準備了以下動作，請確認後執行：' : '(無回覆)';

    res.status(200).json({ reply, actions, usage: j.usage || null, model });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
