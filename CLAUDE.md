# CLAUDE.md — GROUN:D 包材採購對應追蹤系統

給 Claude Code / Cursor 的專案脈絡。每次 session 開始會自動讀這份。改動程式時請遵守這裡的約定。

## 這是什麼

GROUN:D 連鎖速食的「產品 → 包材 → 供應商」採購對應追蹤系統。核心階層：**產品(Product) → 包材(Packaging) → 供應商(Supplier)**。產品發散出所需包材，包材再對應供應商；可從產品、包材、供應商三種視角查看。多人即時協作。

主選單：總覽 / 產品管理 / 需求 × 廠商對應（包材主檔＋詢價）/ 廠商 / 分析中心 / 設定備份 / 修改紀錄 / 帳號。

- 品牌：**GROUN:D**（雙品牌系統 HAPPINESS／GROUN:D）。
- 法律實體：**喬亞國際餐飲股份有限公司**。產出對外文件需標公司名時，用此正式名稱，不要寫成 GROUN:D。

## 技術架構（重要）

- **單一檔案**：`index.html` 就是整個 App。原生 HTML + CSS + vanilla JS，**沒有框架、沒有 build 步驟**。所有 CSS 在 `<style>`、所有 JS 在底部單一 `<script>`。
- **資料庫**：Supabase（Postgres）。Project URL `https://enaygnahypbfvhznitmj.supabase.co`。
- **主機**：Vercel，正式網址 `https://ground-pack.vercel.app`。
- **Repo**：`goodmask77/ground-pack`，已接 Vercel → push 到 `main` 自動部署。

```
ground-pack/
├── index.html      ← 整個前端 App（編輯這裡）
├── api/extract.js  ← Vercel serverless function：Claude 視覺辨識，把產品截圖解析成 JSON
├── CLAUDE.md       ← 本檔
└── .gitignore      ← 排除 .vercel / .DS_Store
```

- serverless functions（皆 **CommonJS**，因無 package.json type:module）共用 Vercel 環境變數 `ANTHROPIC_API_KEY`，同網域 POST、本機 file:// 無法用：
  - `api/extract.js`：截圖→產品 JSON（可選 `EXTRACT_MODEL`，預設 claude-sonnet-4-6）。
  - `api/translate.js`：中文品名→英文菜單名（可選 `TRANSLATE_MODEL`，預設 claude-haiku）。產品視窗 `autoTranslateEn()`：品名 blur 時若英文欄空就自動翻譯帶入；`pmEnTouched` 防止覆蓋手動輸入；「🔄 自動翻譯」可強制重翻。

## 部署流程（不要再用 vercel --prod）

```
git add .
git commit -m "說明改了什麼"
git push
```

push 後 Vercel 自動 build、約 30 秒上線，網址不變。

## 雙模式儲存

`index.html` 最上方有三個常數：

```js
const SUPABASE_URL = '...';        // 已填，勿清空
const SUPABASE_ANON_KEY = '...';   // 已填，勿清空（anon 金鑰可公開）
const PASSCODE = '';               // 留空=不設密碼門禁；填字串=開頁需輸入
```

- 兩個金鑰有填 + supabase-js 載入成功 → **雲端模式**（Supabase，即時協作）。
- 任一缺少 → **本機模式**（fallback 到 `window.storage` / `localStorage`，僅單機、不協作）。
- 改程式時**務必保留這兩個金鑰**，否則線上版會掉回本機模式、協作失效。

## 資料模型

三張表（Supabase）↔ 前端記憶體 `DB`：

- **vendors**：`{id, name, en, reg, url, cats[], tags[], note, sort}`
- **items**：`{id, grp(前端叫 group), name, type, spec, prod, note, sort}`
- **matches**：主鍵 `(item_id, vendor_id)`，`{status, price, moq, lead, note, chosen}`
  - 前端 `DB.matches` 以 itemId 為 key → match 陣列。
  - 每個「品項 × 廠商」是一列；`chosen=true` 表示該品項選定的廠商（一品項僅一個 chosen）。
  - `hidden=true`：把某個「建議廠商」對該品項隱藏（建議是依 type 動態產生的，刪除無效會重生，故改用隱藏旗標）。`upMatch`／`pushAllToCloud` 對缺少 `hidden` 欄位的舊資料庫會自動降級（去掉該欄重送），不會中斷編輯。

### Supabase schema（重建用）

```sql
create table vendors(id text primary key, name text, en text, reg text, url text,
  cats jsonb default '[]'::jsonb, tags jsonb default '[]'::jsonb, note text, sort int default 0);
-- items＝包材主檔（沿用）。material 為材質欄位（後加）。
create table items(id text primary key, grp text, name text, type text, spec text,
  prod text, note text, sort int default 0, material text);
create table matches(item_id text references items(id) on delete cascade,
  vendor_id text references vendors(id) on delete cascade,
  status text, price text, moq text, lead text, note text, chosen boolean default false,
  hidden boolean default false,
  primary key(item_id, vendor_id));
create table accounts(name text primary key, is_admin boolean default false, sort int default 0,
  perms jsonb default '[]'::jsonb);  -- perms：該帳號可編輯的頁面 key 陣列，子集 of ['items','vendors','data']
create table history(id bigint generated always as identity primary key, ts timestamptz default now(),
  user_name text, action text, target text, detail text);
-- 產品模組：
create table products(id text primary key, category text, name text, english_name text,
  price text, note text, is_active boolean default true, sort int default 0);
create table product_packaging(product_id text references products(id) on delete cascade,
  packaging_id text references items(id) on delete cascade, sort int default 0,
  primary key(product_id, packaging_id));            -- 產品↔包材 多對多
create table packaging_images(id bigint generated always as identity primary key,
  packaging_id text references items(id) on delete cascade,
  image_url text, label text, sort_order int default 0);   -- 包材照片（URL 指向 Storage）
-- RLS 全關（公開讀寫設計）；realtime 對所有表開啟（vendors/items/matches/accounts/history/products/product_packaging/packaging_images）。
-- 照片存 Supabase Storage 公開 bucket「packaging-photos」；前端 sb.storage.upload 上傳、getPublicUrl 取網址，URL 存 packaging_images。
-- history：修改紀錄。每個 mutating 函式呼叫 logHist(action,target,detail) 寫一筆（cloud→insert，本機→DB.history 保留最近 500）。
--   表未建時 logHist 靜默略過、不影響編輯（沿用容錯設計）。「修改紀錄」分頁讀最近 500 筆顯示，管理員可清空。
```

## 帳號 / 登入（輕量門禁＋逐頁權限）

- **未登入 = 唯讀**；**登入（只輸帳號名、免密碼）後預設仍唯讀**，要由管理員逐頁開放編輯權限。
- 內建管理員常數 `SUPER_ADMIN='goodmask77'`：永遠可登入、不可刪除、即使 `accounts` 表還沒建也能用（bootstrap 安全）。
- **逐頁編輯權限**：可控制的頁面 `PAGES=['products','items','vendors','data']`（產品管理 / 包材對應 / 廠商 / 設定備份）。
  - 每帳號 `perms` 陣列存可編輯頁面；管理員（含內建）`accountPerms()` 一律回傳全部頁面。新帳號預設 `perms:[]`（不能改）。
  - 寫入把關：每個 mutating 函式呼叫 `requireWrite('<page>')`；未登入→開登入框，登入但無該頁權限→alert 擋下。
  - UI：`renderAuth()` 依 `canEdit()` 在 body 加 `can-items/can-vendors/can-data` 與 `li`(已登入) class；CSS `body:not(.can-X) .wr-X{display:none}` 隱藏該頁編輯鈕，`#noperm-X` 顯示唯讀提示。編輯控制項統一掛 `.wr-items/.wr-vendors/.wr-data`（不再用 `.wronly` 做逐頁）。
  - 管理員在「帳號」頁用 chip 切換每帳號每頁權限（`toggleAccountPerm`）。`upAccount` 對缺 `perms` 欄位的舊 DB 自動降級。
- 其他帳號存 `accounts` 表（雲端共享、即時同步）；本機模式存 `DB.accounts`。管理員在「帳號」分頁新增/刪除帳號、切換管理員角色、逐頁開關編輯權限。
- 帳號管理（新增/刪除/切換角色/調整權限）另需 `requireAdmin()`。`.wronly` 僅剩「未登入時隱藏」的通用用途（`body.ro`）；逐頁隱藏改用 `.wr-X` + `can-X`。
- 目前登入帳號記在 `localStorage['ground_pack_user']`；`currentUser={name,isAdmin,perms}`。
- ⚠️ 與 `PASSCODE` 一樣是**前端門禁**：RLS 關閉時懂技術者仍可直接打 API 寫入。要真正鎖權限需改 Supabase Auth + RLS。

## 適配邏輯（核心）

每個品項有一個 `type`（適配類型），每個廠商有 `cats[]`（供應類別）。
**建議廠商 = cats 包含該品項 type 的廠商**（`suggestedVendors()`）。

15 種類型代碼（`CAT` 物件）：
`burgerpaper`(漢堡紙) `box`(餐盒) `pizzabox`(比薩盒) `cupholder`(杯架) `bowl`(碗) `saucecup`(醬料杯) `hotcup`(熱飲杯/湯杯) `coldcup`(冷飲杯) `lid`(杯蓋/碗蓋) `bag`(紙袋) `cutlery`(餐具/吸管/手套) `cleaning`(清潔) `sauce`(醬料包) `sticker`(貼紙/印刷) `other`(其他)

- 品項群組 `GROUPS`：單品包材 / 包裝袋 / 醬料包 / 餐具 / 清潔 / 防護（僅顯示用分組）。
- 詢價狀態 `STATUS`：未詢價 / 詢價中 / 已報價 / 打樣中 / 已選定 / 已下單 / 不適用。
- 預設種子資料：14 家廠商 + 38 品項，寫在 `SEED_VENDORS` / `SEED_ITEMS`。雲端初始化靠「設定/備份」分頁的「匯入預設資料」按鈕。

## 產品模組（前端）

- 狀態：`DB.products`（[{id,category,name,en,price,note,active,sort}]）、`DB.prodPack`（product_id→[packaging_id]）、`DB.images`（packaging_id→[{id,url,label,sort}]）。`cloudLoad` 對這三張表各自 try/catch，未建表不影響其他資料。
- 產品類別 `PRODUCT_CATS`（Pizza/早餐/越南三明治/速食/副餐/沙拉飯碗/湯品/甜點/冰淇淋/飲品），允許自訂。
- 頁面：**產品管理** 為兩欄（`.pcols`）：左 `renderProducts` 依類別分組的表格（點類別標題 `selectCat` 選類別、點列開 `productDetail`）；右 `renderCatPhotos` 顯示「該選定類別產品所綁定的包材」照片並可上傳（`onCatPhotoPick`/`delPhotoCat`，共用 `doUploadPhoto`）、**分析中心**（`renderAnalysis`＋`anMode`：p2p 產品→包材 / k2p 包材→產品 / share 共用率 / coverage 供應商覆蓋率 / gaps 缺漏）。
- 詳情用 modal：`productDetail()`（綁定/解綁包材）、`packDetail()`（照片上傳/刪除、被哪些產品用、對應供應商）。`vendorsForPack()`＝該包材的 match 供應商 ∪ 依 type 建議的供應商。
- 照片：`uploadPhoto()` 上傳到 Storage bucket `PHOTO_BUCKET`（'packaging-photos'）→ `addImageRow` 寫 packaging_images；本機模式存 base64。
- 寫入把關：產品/綁定走 `requireWrite('products')`；包材主檔與照片走 `requireWrite('items')`。
- **批量上傳產品**（產品管理「⤓ 批量上傳」）：兩模式共用 `batchRows` ＋ `renderBatchRows()` 可編輯預覽 → `batchImport()` 經 `upProductsBatch` 一次寫入。① 截圖辨識：`batchRecognize()` 把圖 `downscaleImage` 後 POST `/api/extract`，回傳產品累加進預覽；視窗開啟時 document paste 事件可直接貼上截圖。② 貼上文字：`batchParseText()` 逗號/Tab 分欄。

## 改程式時的注意事項

- **新增一個欄位**要同步改五處：種子資料、`cloudLoad()` 對應、`up*/del*` 寫入函式、render 函式、以及 Supabase `alter table` 加欄位。
- 寫入一律走 `upVendor / upItem / upMatch / delVendorCloud / delItemCloud / delMatchCloud`；本機模式時這些會自動 fallback 到 `persist()`（整包存本機）。
- 即時同步：任何表變動 → `refetchSoon()` 重抓全部並重繪。
- **絕不**把 service_role 金鑰或資料庫密碼寫進 index.html / commit 進 repo。只有 anon 金鑰可公開。
- 不要把 `localStorage` 當主要儲存（它只是離線 fallback）。

## 設計規範（風格）

- 配色：暖牛皮紙底（`--paper #f4efe5`）、墨黑字（`--ink #1d1a15`）、主色焦橙（`--accent #c4582a`）、選定綠（`--green #3f7d4e`）。
- 字體：標題 `Archivo`、數字/代碼 `IBM Plex Mono`、內文 `Noto Sans TC`。
- 風格走「工業／採購儀表板」感：直角邊框、點陣背景、克制留白。延續此風格，勿改成圓角卡片 + 大量陰影的通用 AI 風。

## 安全模型

目前 RLS 關閉 = **拿到網址的人就能讀寫**。內部團隊共用 OK。要加門禁的強度遞增：
1. 不公開散播網址；2. 設 `PASSCODE`（輕量）；3. 改用 Supabase Auth + RLS（需另寫一版，做到只有指定成員能改）。
