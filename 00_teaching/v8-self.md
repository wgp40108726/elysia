# V8 學習心得與實作整理：從 JSON Demo 走向可部署的資料庫架構

這次整理 V8，我最大的感覺是：它表面上看起來只是把資料從 JSON 換成 PostgreSQL / Neon，但實際上做的事情比「換資料庫」大很多。V8 更像是把整個專案重新整理成一個比較能繼續長大的形狀，讓後面的 V9、Better Auth、Google 登入、正式部署都有比較穩的地基。

所以這份筆記我想用兩種方式合在一起寫：一方面保留我自己的理解與心得，另一方面也把 V8 具體新增了什麼、為什麼要做、實際怎麼做整理清楚。這樣之後回頭看，不只知道「我當時學到了什麼」，也能知道「如果要重做一次，步驟應該怎麼走」。

---

## 1. V8 給我的第一個感覺：它不是單純換資料庫

在 V7 的時候，專案已經可以前後端分離開發，也可以在部署時把前端 build 到 `public/`，再由 Elysia 後端一起 serve。那個階段很適合教學，因為 JSON file 很直觀，學生可以很快理解資料從哪裡來、API 回傳什麼、前端怎麼使用。

但到了 V8，我開始意識到：如果專案要更接近真實上線環境，JSON store 就不夠了。

JSON store 的好處是簡單，但它不適合作為正式部署的資料來源。Render 上的檔案系統不是可靠的持久資料庫；服務重啟、重新部署，甚至未來有多個 instance 時，資料狀態都會變得不穩定。因此 V8 導入 Drizzle + Neon PostgreSQL，目的不是追新技術，而是讓資料進入真正可查詢、可 migration、可備份、可部署的資料庫。

我覺得 V8 的一句話總結是：

> V8 不是單純把 JSON 換成 PostgreSQL，而是把資料、身份、契約、migration、部署與版本隔離都整理成可以繼續升級的架構。

---

## 2. V8 新增了什麼

如果把 V8 的變更整理成清單，它主要新增與強化了這些部分：

- Drizzle + Neon PostgreSQL。
- `db/client.ts`、`db/schema.ts`、`drizzle.config.ts` 與 migration SQL。
- `STORE_DRIVER`，讓專案可以切換 JSON / PostgreSQL。
- `PgStore`，讓菜單與訂單真的寫入 PostgreSQL。
- `Auth` interface、`DemoAuth`、`PgAuth`，把登入邏輯從後端 route 中拆出來。
- `shared/contracts.ts` 改成以 Zod schema 為核心。
- `shared/route-schemas.ts` 集中管理 API request / response schema。
- PostgreSQL namespace，也就是用 `PG_SCHEMA` 隔離 V8 的資料表。
- 部署流程加入 `db:migrate`。

我覺得這裡最重要的不是「檔案變多了」，而是責任變清楚了。V8 開始把專案分成幾個比較明確的層：

| 層級 | 負責內容 |
| --- | --- |
| `backend.ts` | HTTP route、錯誤處理、response |
| `shared/contracts.ts` | 業務資料型別與 Zod schema |
| `shared/route-schemas.ts` | API request / response schema |
| `auth/` | 登入與使用者查詢 |
| `store/` | 菜單與訂單資料存取 |
| `db/` | PostgreSQL client 與資料表 schema |
| `drizzle/` | migration SQL 與版本紀錄 |

這讓我比較能理解真實專案為什麼需要分層。不是為了讓架構看起來複雜，而是為了避免所有東西都塞在同一個地方，未來要升級時才不會整包糾纏在一起。

---

## 3. 資料庫層：從 JSON 到 Drizzle + Neon

V8 新增的資料庫相關檔案主要是：

```txt
db/
├── client.ts
├── health-check.ts
└── schema.ts

drizzle/
├── 0000_*.sql
└── meta/
```

`db/client.ts` 負責建立 Neon serverless pool，並交給 Drizzle 使用。`db/schema.ts` 則定義了 V8 需要的資料表：

| Table | 用途 |
| --- | --- |
| `users` | demo 使用者資料，包含 email、name、password |
| `menu_items` | 菜單品項 |
| `orders` | 訂單主檔 |
| `order_items` | 訂單明細，保留品項快照 |

這裡我學到的是，資料一旦進入資料庫，事情就不只是「把 JSON 改成 SQL」而已。資料表需要 schema，schema 需要 migration，migration 需要在本機和部署環境都能穩定執行。

以前 JSON 檔改一改就能跑，現在則必須思考：

- 新環境怎麼建立資料表？
- 已部署的環境怎麼升級？
- 本機和 Render 的資料庫結構要怎麼保持一致？
- 如果資料表改了，舊資料怎麼辦？

這讓我理解到，正式專案裡「程式碼版本」和「資料庫版本」其實要一起被管理。只更新程式碼但沒有 migration，後端很可能一啟動就壞掉。

---

## 4. `STORE_DRIVER`：保留 JSON，也導向 PostgreSQL

V8 新增 `STORE_DRIVER` 這個環境變數，我覺得是很實用的過渡設計。

```env
STORE_DRIVER=postgres
DATABASE_URL=
DATABASE_URL_MIGRATION=
PG_SCHEMA=bf_v8
```

它讓專案可以在兩種模式之間切換：

| 模式 | 用途 |
| --- | --- |
| `STORE_DRIVER=json` | 使用 JSON store，適合本機 demo 或資料庫還沒準備好時 |
| `STORE_DRIVER=postgres` | 使用 PostgreSQL，適合正式驗收與部署 |

這個設計讓升級比較有安全感。V8 不需要一次把 JSON 能力全部丟掉，而是可以保留 fallback。對教學來說也比較舒服，因為可以先用熟悉的 JSON 模式理解功能，再切到 PostgreSQL 模式觀察差異。

我也從這裡學到：好的升級不一定是一次性的大改，而是可以保留一條回退路徑，讓系統在轉換過程中仍然能跑。

---

## 5. `PgStore`：資料層開始真正被抽象出來

`PgStore` 是 V8 裡很關鍵的一塊。它不是單純把 JSON 的讀寫換成 SQL，而是把菜單與訂單相關的資料操作完整搬到 PostgreSQL。

它負責：

- 初始化時檢查 DB 連線。
- 如果 DB 是空的，從 `data/store.json` seed 初始資料。
- 從 PostgreSQL 載入 menu / orders。
- 新增、修改、刪除菜單時同步寫入 DB。
- 建立訂單、調整訂單項目、送出訂單時同步寫入 DB。

我覺得最值得注意的是：`PgStore` 仍然實作同一個 `Store` interface。也就是說，對 `backend.ts` 來說，`JsonFileStore` 和 `PgStore` 是可以被替換的。

```txt
backend.ts
  ↓
Store interface
  ├── JsonFileStore
  └── PgStore
```

這讓我比較具體地理解 interface 的用途。它不是為了讓程式看起來比較抽象，而是為了讓不同實作可以被穩定替換。後端 route 不需要知道資料到底存在 JSON 還是 PostgreSQL，只需要呼叫同一組方法。

---

## 6. `Auth` 分層：為 V9 Better Auth 先鋪路

V8 新增 `auth/` 資料夾時，我一開始會覺得 demo 登入好像不需要特別抽出來。但往後看 V9 要導入 Better Auth 和 Google provider，就會發現這一步其實很必要。

V8 新增的 auth 結構大致如下：

```txt
auth/
├── Auth.ts
├── DemoAuth.ts
├── index.ts
├── pg/PgAuth.ts
└── user-mapper.ts
```

它們的角色是：

- `Auth.ts`：定義登入與查使用者的介面。
- `DemoAuth.ts`：從 `data/store.json` 讀 demo user。
- `PgAuth.ts`：從 PostgreSQL `users` table 讀 user。
- `auth/index.ts`：依 `STORE_DRIVER` 決定使用 DemoAuth 或 PgAuth。
- `user-mapper.ts`：把完整 `User` 轉成不含 password 的 `SessionUser`。

如果登入邏輯一直寫在 `backend.ts` 裡，之後要換成 Better Auth 時，會需要大幅修改 route handler。V8 先把登入行為整理成 `Auth` interface，讓 `backend.ts` 只依賴 `auth.login()` 和 `auth.getUserById()`。

這裡我最大的心得是：有些重構當下看起來只是多拆檔案，但它真正的價值是在下一個版本才會顯現。V8 先做了這個邊界，V9 要接正式 auth 時就比較不會卡死。

---

## 7. Zod contracts：讓 API 格式更接近單一事實來源

V8 另一個重要整理，是把 `shared/contracts.ts` 改成以 Zod schema 為核心。

它定義了：

- `menuItemSchema`
- `userSchema`
- `sessionUserSchema`
- `orderSchema`
- 由 `z.infer` 推導出的 TypeScript types

同時，`shared/route-schemas.ts` 也集中管理：

- request body schema
- route params schema
- query schema
- response envelope schema
- API error schema
- `toOrderResponse()` 這類 response mapper

以前如果前端、後端、OpenAPI、資料庫各自維護一份型別，很容易出現「看起來差不多，但其實不一致」的狀況。V8 的方向是：

```txt
Zod schema
  ↓
TypeScript type
  ↓
Route schema
  ↓
OpenAPI 文件
```

這裡我學到的是：TypeScript type 只在開發時有用，執行時不會幫你擋錯。Zod 的價值在於它同時可以描述型別，也可以在 runtime 驗證資料。對 API 來說，這會比單純寫 interface 更可靠。

---

## 8. PostgreSQL namespace：避免版本互相污染

V8 使用 `PG_SCHEMA` 來控制 PostgreSQL schema，例如：

```env
PG_SCHEMA=bf_v8
```

這讓 V8 的 tables 可以放在自己的 namespace 裡，而不是全部塞進 `public`。

我覺得這個設計很重要，因為這個專案後面會接 V9，也可能會有 Better Auth 自己需要的資料表。如果全部都放在 `public`，很容易變成一堆表混在一起，分不清楚哪些是 V8 的、哪些是 Auth 的、哪些是舊版本留下來的。

用 namespace 隔離後，概念會清楚很多：

```txt
PostgreSQL database
├── public
├── bf_v8
│   ├── users
│   ├── menu_items
│   ├── orders
│   └── order_items
└── auth
    ├── user
    ├── session
    └── account
```

這讓我理解到，資料庫裡的命名與隔離不是小事。當版本越來越多、功能越來越複雜，如果一開始沒有隔離，後面會很難整理。

---

## 9. 怎麼做：我會用這個順序完成 V8

如果要重新做一次 V8，我會照這個順序來。

### 步驟 1：安裝依賴

```bash
bun install
```

這一步會安裝前後端依賴，也包含 V8 新增的 Drizzle、Neon client、Zod 與 migration 相關套件。

### 步驟 2：建立 `.env`

```bash
cp .env.example .env
```

接著確認 `.env` 至少有：

```env
PORT=3000
HOST=localhost
API_ALLOWED_ORIGIN=

STORE_DRIVER=postgres
DATABASE_URL=你的 Neon pooled connection URL
DATABASE_URL_MIGRATION=你的 Neon direct connection URL
PG_SCHEMA=bf_v8
```

我會特別注意 `STORE_DRIVER=postgres`，因為如果忘記設定，專案可能仍然跑得起來，但其實資料還是走 JSON。這種狀況最容易誤判，以為自己完成了 V8，但其實沒有真的完成資料庫化。

### 步驟 3：確認或產生 migration

如果有修改 `db/schema.ts`：

```bash
bun run db:generate
```

如果只是使用目前已存在的 migration，這一步可以略過。

### 步驟 4：套用 migration

```bash
bun run db:migrate
```

成功後，資料庫裡應該會出現 V8 需要的表：

- `users`
- `menu_items`
- `orders`
- `order_items`

如果有設定 `PG_SCHEMA=bf_v8`，這些表應該會在 `bf_v8` schema 裡，而不是 `public`。

### 步驟 5：準備初始資料

V8 的 `PgStore` 在初始化時會讀取 `data/store.json` 作為 seed 來源。如果資料庫是空的，啟動後會把 demo users、menu、orders 匯入 PostgreSQL。

如果需要手動從 JSON 匯入：

```bash
bun scripts/migrate-json-to-db.ts
```

### 步驟 6：啟動本機開發

```bash
bun run dev
```

預設：

- 前端：`http://localhost:5173`
- 後端：`http://localhost:3000`
- OpenAPI：`http://localhost:3000/openapi`
- OpenAPI JSON：`http://localhost:3000/openapi/json`

### 步驟 7：驗證 API 是否真的走 DB

我會先測健康檢查：

```bash
curl http://localhost:3000/health
```

再測登入：

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"1234"}'
```

再測菜單：

```bash
curl http://localhost:3000/api/menu
```

最後用前端建立訂單、加入品項、送出訂單，然後回到 Neon 查 `orders` 與 `order_items` 是否真的有資料。

### 步驟 8：本機建置與正式啟動

```bash
bun run build
bun run start
```

這會確認前端可以 build 到 `public/`，後端可以 build 到 `dist/backend.js`，也能用正式啟動方式跑起來。

---

## 10. Render 部署：V8 多了一個 migration 關卡

V7 部署時，主要是安裝依賴、build 前端和後端、再 start。到了 V8，部署多了一個關鍵步驟：migration。

所以 Render 的 Build Command 應該變成：

```bash
bun install && bun run db:migrate && bun run build
```

Start Command 維持：

```bash
bun run start
```

Render Environment Variables 至少要補：

```env
STORE_DRIVER=postgres
DATABASE_URL=你的 Neon pooled connection URL
DATABASE_URL_MIGRATION=你的 Neon direct connection URL
PG_SCHEMA=bf_v8
```

這讓我意識到，正式部署不是只看程式能不能 build。只要程式依賴資料庫，部署流程就必須確保資料庫 schema 已經準備好。否則程式碼雖然成功上線，但一打 API 就可能因為缺表而失敗。

部署完成後，我會立刻測：

```bash
curl https://你的-render-domain.onrender.com/health
curl https://你的-render-domain.onrender.com/api/menu
```

如果 API 可以正常回應，而且 Neon 裡有資料，才算完成 V8 的最小上線驗收。

---

## 11. 我覺得 V8 最容易混淆的地方

V8 有幾個地方如果只照著做，很容易做完但不一定真的理解。

第一個是 `DATABASE_URL` 和 `DATABASE_URL_MIGRATION`。一開始看起來都是資料庫連線字串，但實際用途不一樣。`DATABASE_URL` 偏向 runtime 使用，`DATABASE_URL_MIGRATION` 偏向 migration 使用。兩者可以暫時相同，但知道它們為什麼分開，後面排查部署問題會比較清楚。

第二個是 `STORE_DRIVER`。如果忘記設成 `postgres`，專案可能仍然跑得起來，但其實資料還是走 JSON。這種狀況最危險，因為表面上沒有壞，但驗收目標其實沒有達成。

第三個是 `PG_SCHEMA`。如果忘記設定，表可能會建在 `public`，短期內也能跑，但未來 V8、V9、Auth 表混在一起時，問題才會浮現。

所以我覺得 V8 的驗收不能只看畫面能不能動，而是要確認資料真的有進 PostgreSQL，而且進的是正確 schema。

---

## 12. 最小驗收清單

如果用心得的角度來看，我覺得 V8 的完成標準不是「我寫完了 PgStore」，而是要確認整個流程真的接起來。

我會檢查：

- `bun install` 成功。
- `.env` 已設定 `STORE_DRIVER=postgres`。
- `DATABASE_URL` 和 `DATABASE_URL_MIGRATION` 都有填。
- `PG_SCHEMA` 有設定成 V8 專用 schema。
- `bun run db:migrate` 可以成功。
- 後端可以啟動。
- `GET /health` 正常。
- `POST /api/auth/login` 可以用 demo user 登入。
- `GET /api/menu` 可以讀到 PostgreSQL 裡的菜單。
- 建立訂單、加入品項、送出訂單後，Neon 裡真的有資料。
- Render 部署流程有包含 `db:migrate`。

這些檢查讓我比較確定 V8 不只是本機畫面能操作，而是真的完成「資料庫化」。

---

## 13. 常見錯誤與排查

| 狀況 | 可能原因 | 處理方式 |
| --- | --- | --- |
| `DATABASE_URL is required` | `.env` 或 Render 沒設定 DB URL | 補上 `DATABASE_URL` |
| migration 沒有建表 | 沒跑 `bun run db:migrate`，或 URL 指錯 DB | 確認 `DATABASE_URL_MIGRATION` |
| 本機有資料，Render 沒資料 | 本機走 JSON，Render 才走 PostgreSQL | 確認 `STORE_DRIVER=postgres` |
| 表建在 `public` | 沒設定 `PG_SCHEMA` | 補上 `PG_SCHEMA=bf_v8` 後重新 migration |
| 登入失敗 | `users` 沒 seed 進 DB，或密碼不一致 | 檢查 `data/store.json` 與 DB 的 `users` |
| 菜單 API 空陣列 | `menu_items` 沒有資料 | 重新 seed 或執行 JSON 匯入腳本 |

這張表對我來說很實用，因為它提醒我：很多錯誤不是程式邏輯壞掉，而是環境變數、migration、schema 位置或 seed 資料沒有對齊。

---

## 14. 這次 V8 帶給我的收穫

我覺得 V8 最大的收穫，是讓我比較清楚看見一個專案從 demo 走向 production baseline 時，會多出哪些工程需求。

在 demo 階段，我們常常只在意功能能不能跑。但到了 V8，開始需要在意：

- 資料能不能持久保存。
- 資料庫 schema 能不能版本化。
- API contract 能不能保持一致。
- 後端 route 能不能不要綁死底層資料來源。
- 登入邏輯能不能在未來替換。
- 部署流程能不能同時處理程式碼和資料庫。
- 不同版本能不能用 namespace 隔離。

這些事情不一定會讓畫面看起來更華麗，但會讓專案變得更可靠、更能維護，也更接近真實開發。

---

## 15. 總結

如果只用功能角度看，V8 是「新增 PostgreSQL / Neon」。但如果用架構角度看，V8 其實是在整理專案的骨架。

它把資料層從 JSON 推向 PostgreSQL，把登入邏輯從 route 中拆成 `Auth`，把菜單與訂單資料操作整理成 `Store`，把 API contract 收斂到 Zod schema，也把部署流程從單純 build 升級成 build + migrate。

這次改完後，我對「可部署」的理解也變得比較完整。可部署不只是 `bun run build` 成功，而是從本機、資料庫、migration、環境變數、API 驗證，到 Render 上線都能串起來。

也因為 V8 先整理了這些邊界，後面的 V9 才比較有空間接 Better Auth 和 Google provider。換句話說，V8 是一個承上啟下的版本：它沒有只是新增功能，而是在替下一階段的正式身份驗證與更完整部署先鋪路。
