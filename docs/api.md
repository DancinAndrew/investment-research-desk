# 私人帳本API v1

[M1 內建研究管線](m1-pipeline.md) 已於本機實作；完整 research-jobs 路由、唯一 ID、重試、取消、accepted／reading 與私人儲存契約見該文件。正式 Worker 仍回 `supported:false`。

GET /api/ledger：身份來自dispatch的oai-authenticated-user-id，無身份401。空帳本不寫DB。回傳state/schema_version/records/quotes/reviews、revision、updated_at、最近100個history metadata、owner_scope與storage。schema_version=1可省略research區；新增觀察決定、2–4版本比較與重新核對，欄位與精確report SHA/claim限制見research-continuity.md。舊備份與舊空帳本保持原樣。

GET /api/ledger?revision=N：只讀該身份的已保存舊版本；無/異人版本404。舊payload由SQLite trigger在成功UPDATE前同一statement保存。

PUT /api/ledger：JSON {expected_revision,expected_owner_scope,state}。需same-origin Origin，拒cross-site；請求上限2MB。嚴格domain/schema/日期/網址/股數重播，再以singleSQL CAS插入/更新，衝突409、不覆寫。每次SQL都bind身份與payload，無body選owner。state最多10000records/10000quotes/10000reviews；沒有訪客email或憑證持久化。

records fields：id,date,ticker,side BUY|SELL,quantity,price,currency,fees,reason,horizon,expectation,risk,invalidation,report_id,source_links,status active|withdrawn,revision,created_at,updated_at。正股數正價格非負費用。每個ticker/currency independently average成本；历史日期超賣422。缺報價的market_value/unrealized為null。

quotes：ticker,currency,price,date，同組唯一。reviews：id,record_id,date,outcome pending|supported|weakened|mixed,lesson,next_action，引用現有record。

服務token只通過託管平台的dispatch門禁，不提供訪客身份；禁止用bypass假冒owner identity。生產API不得接收本地QA cookie。

## 研究來源唯讀 projection

`/data/company-traceability.json` schema `company-source-traceability/1` 保存指定子主張的報告hash、既有claim ID、細分subclaim ID、章節anchor／行範圍、來源ID／hash／定位、角色與支持限制。模型另綁實際參數和保存結果artifact。這是固定JSON讀取，沒有新增寫入API。

報告端只接同bundle與同report SHA-256；來源端反向連結同公司最新版的指定用法。source-level fold不把同篇其他說法當作已核實。未知發表日保留null。官方網頁抽取行號明示不是出版者永久anchor，付費原稿僅保留定位與原稿hash，不上傳全文。

## 可省略的完整帳務與CSV區

`finance`的events/prices/fx/valuations/benchmark/settings及欄位口徑見portfolio-accounting.md。伺服器先validateFinance，再將SPLIT轉入整帳重播，與records/quotes/reviews/research一併CAS。`imports`記source_hash與原始批次record_hashes，嚴格欄位與最多1000批；其狀態保存不宣稱券商已驗證。GET空state不補新區、不建立DB；還原與歷史保持完整區域。未知欄位／非法日期／重複日期鍵／不匹配flow估值／超賣回422，無部分寫入。無新增endpoint/table/migration。


2026-10-12：私人 state 新增可選 `snapshots` 與 `company_favorites`。快照區分永續／現貨／股票代幣／機器人、方向與交易所；來源和缺口保留，未顯示日期／數量／成交價不推導，不參與現貨交易重播或績效。收藏按同一身份、整帳 CAS、history 與完整 JSON 備份持久化。公司列表搜尋、產業、上市市場、只看收藏可組合且保存 URL；上市市場不從總部推導，未登錄分類保留未分類。還原預覽綁檢查時版本與身份，資料改變需重查。
