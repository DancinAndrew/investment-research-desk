# M1：內建 11 階段研究管線

功能在本 repo 內實作，資料與執行紀錄保存在私人目錄 `.private/`（不納入版本控制）。

## 使用

需要既有 Node 環境與 Pandoc（沿用網站原本的 Markdown 解析工具）。本次驗證為 Node 26.5.0；依 `package-lock.json` 安裝 Desk 自己的依賴，不借用其他 repo 的 `node_modules`。

```bash
npm ci --ignore-scripts
npm run research:prepare
npm run research:run
npm run dev -- --host 127.0.0.1 --port 55563 --strictPort
```

在公司列表開啟 NVDA，選「開始新的公開材料研究」→「開始研究」。完成規則檢查後可閱讀新報告、來源與系統紀錄。保留網址即可回到同一個 job；瀏覽器重新整理不會重新執行。取消、退修與失敗的研究只保留執行紀錄，不提供完成報告入口。

`research:prepare` 唯讀重用 Desk 既有 M2 candidate v4 與兩個已保存原件目錄，核對 30 份原始 bytes 和文字 hash，再建立獨立的 M1 輸入。它不匯入舊研究成品，也不抓取即時資訊；乾淨 checkout 未包含私人輸入時，需先備妥原件，不能以合成測例冒充正式 run。

## 執行與接受規則

11 個程式角色依序處理路由、來源、新聞／產業候選、財務、估值、籌碼覆蓋、技術資料覆蓋、健康檢查、風險、編報與評估。各階段保存實際輸入／輸出與 hash；未知公司在路由後停止。角色採固定程式規則，不呼叫外部模型。

財務階段重算季度成長、利潤率與自由現金流；估值使用四季原報稀釋 EPS 合計與明示本益比假設。管理層敘事標為既有人工整理候選，重核版本與定位。沒有每日行情與持股來源時，籌碼／技術階段輸出查過哪些資料、缺什麼與不能作何判斷，不生成替代數字。

評估分別檢查來源／數字／期間／算式，以及直接買賣指令。重要主張不能引用不存在的來源，敘事也不能靠改標「限制」繞過來源規則。指令檢查是明確字詞規則，涵蓋中英文常見下單表達；它不是能理解所有語言變體的語義分類器。來源引述須精確存在於原文並受長度限制，否定句和作者下指令分開處理。

只有 `accepted` 可讀或更新此管線的 latest。執行完畢、HTTP 成功或保存草稿都不等於接受。發布前重核評估；閱讀核對該版本當時的接受收據與檔案 hash，保留更新程式後的歷史可讀性。拒絕稿不更新 latest；M2 及既有靜態研究入口保持原值。`accepted` 在這裡表示當時版本的規則核對通過，**不表示新報告已獨立語義覆核或能預測獲利**。

## 保存與 API

- `.private/research-pipeline/inputs/`：獨立輸入；`profile.json` 登錄固定路徑與 hash。HTTP 呼叫不能指定檔案或指令。
- `.private/research-pipeline/jobs/jobs.sqlite`：唯一 server run ID、request 去重、狀態與 accepted latest。
- `.private/research-pipeline/jobs/<run-id>/`：輸入、報告、排版資料、11 階段 trace、結果與收據。

本機 API 由 Vite middleware 提供，僅監聽 loopback，拒絕跨來源提交和任意路徑／指令。私人目錄不由 Vite 提供靜態下載；不把 run 原件加入網站打包。SQLite 的單一執行器 lease 避免兩個程序同時覆寫狀態；重啟將未完成 job 記為 interrupted，讀取不觸發重跑。相同 request 重試查同一 job，失敗後須明確建立新請求。

1. `GET /api/research-jobs/capabilities`：公司、截止日、輸入 hash、11 階段及 local 能力。
2. `POST /api/research-jobs`：`company`、`question_id`、`source_sha256`、`request_id`；持久化後回 202 與 server `job_id`。
3. `GET /api/research-jobs/requests/<request-id>`：提交回應遺失時查回原 job；不自動重送。
4. `GET /api/research-jobs/<job-id>`、`GET /api/research-jobs`：詳情與最近 100 筆摘要。
5. `GET /api/research-jobs/<job-id>/reading`、`GET /api/research-jobs/latest/NVDA`：只回傳接受版本，含 Markdown、資料化排版與來源；非接受狀態回 409。
6. `POST /api/research-jobs/<job-id>/cancel`：空 JSON 取消。

正式私人網站維持 `supported:false`，沒有因本機成功就啟用雲端執行。本次沒有部署。

## 重現驗收

```bash
npm test
npm run build
npm run research:verify
npm run research:isolation
```

執行 `research:verify` 前先停止本機 dev server，釋放同一任務儲存。它先建立可接受的真實 NVDA 報告，再各自新增無來源主張、買進指令，檢查另一類規則仍通過、reader 回 409、latest 未改。`research:isolation` 僅給子程序讀取三個 Desk 核心模組與輸入副本的權限，禁止外部檔案、網路、子程序及寫入；同時實測外部檔案存取被拒。

本版以 2026-10-12 為固定資料截止，執行日另記。保留 M2 的 FY26Q4 USD 2 million 現金流調節差額、原語義審查邊界與 A14 產品限制；不是 11 月最新行情研究。X 動態發布與雲端任務均為後續產品工作。
