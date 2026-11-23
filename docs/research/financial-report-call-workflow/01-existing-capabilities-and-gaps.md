# 現有能力、可沿用部分與缺口

盤點時間：2026-10-12；基準 HEAD `f44a70002d7e1dd45d8611808bfb2b0c595bbf2f`。本機程式靜態閱讀與 JSON metadata 盤點；沒有重新操作正式站、查詢 D1 或載入真實持倉。文中「已有」指目前程式路徑與資料契約存在，不是本轮 live 驗收。

## 七方向對照

| 方向 | 真正已有的能力與證據 | 還不能說有什麼 | 建議增量 |
|---|---|---|---|
| 1. 八季財報／法說變化 | `research-continuity.mjs:44–61` 比較同公司報告 claim 文字、條件、反證和来源變化；`SourceTrace.vue` 顯示来源定位 | 不是按季度比官方逐字稿；無 statement／target／actual 表、八季 coverage 或法說講者／Q&A | 建單公司八季資料包，再產生可審的語義變化候選 |
| 2. 公司研究庫與一頁摘要 | `CompanyHub.vue:8–15` 的 judgment/business/watch；公司、第三方觀點、關係、完整報告入口。`company-model.mjs:2–10` 合併目錄與公司中繼資料 | 605 個公司入口不等於605份深研；產品／客戶收入沒有通用結構化歷史表，管理目標對實績亦未完成 | 摘要以接受的 facts/claims/targets 生成；未揭露客戶收入留未知 |
| 3. 市場異常 | `api.js:15–19` 讀固定 X 行情／分類歷史補件，與母快照hash綁定；既有價格頁可閱讀快照 | 無台股法人流導入、全市場異常偵測、公告事件窗或即時行情；X分類不等於客觀市場流向 | 後期加入授權來源、復權與事件日對齊；只列觀察、另列解释假說 |
| 4. 量化告警 | `LocalReview.vue:102` 有手動複查日，明示不建通知；沒有 TradingView 接入 | 保存日期不是排程；價量條件沒有轉為基本面確認或失效規則 | 先存人工規則卡；外部提醒、webhook與服務啟用另議 |
| 5. 三情境模型 | bundle 的 `projection.models`、模型 artifact 與來源鏈；現有 NVDA/AMZN 手冊有獨立輸入與重算流程 | 網站 `api.js:27` 明確拒絕本機重算；無通用可編輯三情境模型器，原模型範圍各不相同 | 先定型財務facts與假設，再做同口徑有限模型；保留既有模型原件 |
| 6. 每月 thesis | `research-continuity.mjs:5–38` 保存 observations/checks；精確 report ID/SHA與claim IDs，核對結果人工填。`decision-workspace.mjs:54–55` 有部位理由及回顧 | 沒有每月截點資料包、需求／營運／競爭／價格四軸變化、目标達成判定或背景自動研究 | 手動發起月度更新，原baseline凍結，新證據另存，再由使用者接受 |
| 7. 每月研究回顧 | `review-core.mjs:1–5` 與 `ReviewInsights.vue` 按既有交易／回顧篩選；`decision-workspace.mjs:34–38,87–91` 同事件時間線 | 不是研究流程級的月檢討；沒有事前對事後資訊遮罩、改判原因分類或五項工作優先序 | 建有日期與基線的 review bundle；以 evidence 追改判，不靠報酬判研究對錯 |

## 實際資料與來源鏈

- `public/data/site-index.json`：實際 10 個報告 bundle，NVDA 7、AMZN 3；最新版入口為 NVDA v6、AMZN v3。這是報告版本數，**不是十季財報**。
- `company-traceability.json`：41列指定子主張的映射，欄位有 bundle_id/report_sha256/claim_id/subclaim_id、report_anchor、source_id/hash/locator、role/support_limit；不是所有可能主張全面驗證。
- `company-relations.json`：15個節點、20條邊、13個累積事件，另有排除候選及覆蓋限制。來源關係可沿用，但公司共同被提到不自動成為經濟關係。
- `scripts/build-report-registry.mjs:12–22` 核正文 SHA後產生 registry；**financial_period 目前只對 NVDA／AMZN 的特定字串判斷**，其餘為 null。新功能需明確 period identity，不能擴寫更多正則取代資料模型。
- `src/research-core.mjs:27–60` 使用 token overlap、來源hash、as-of與上游群去重，最多返回3筆摘錄；輸出明記 `semantic_support: not_evaluated`。這是決定式檢索，不是任意公司自動 RAG 研究。

這些數量與字段的讀取方式及來源hash記在 [read-only-inventory.json](evidence/read-only-inventory.json)。不將相同上游的 SEC、IR、CFO 文件算成三份獨立需求證據。

## 整合邊界

現有架構是 Vue/Vite 讀取私人部署的研究快照，加上 Worker/D1 的身份隔離私人 state。`worker/index.mjs:11–30` 使用嚴格欄位驗證；`37–73` 使用 owner_scope、整帳revision/CAS、2MB請求上限及歷史保存；`76–84` 沒有新資料提供商端點。`drizzle/0000_ledger.sql` 保存整包 JSON 與舊版本。

因此不應把八季逐字稿塞進 `/api/ledger`，也不能直接往既有嚴格 `research` 欄位加未登錄資料。第一階段新增的是本機 evidence bundle 和靜態閱讀 projection；沿用報告來源hash與導覽。後续私人月度review才設計新可選域及向後相容、舊client保護，另做遷移決定。公司層級營運thesis也不能因 ticker 同名，自動套用到不同商品、交易所、方向的部位。

`api.js:28` 的 `research-jobs/capabilities` 現回 `configured:false, supported:false`，寫入回503。`PublicResearchJob.vue` 即使有畫面程式，也不能據此說雲端研究可用。`scripts/build-workbench.mjs` 會重產registry、Markdown和dist，本次刻意不執行以免與部署writer撞檔。

## 方法依據

方法依據為作者的本機研究方法筆記（六個問題：edge、價格與生意、矛盾資訊、可推翻的 thesis、AI 與交付責任、清楚的核心判斷），不在本 repo。本計畫分別落到研究問題、條件模型、期間／口徑對齊、目標 deadline 與反證、人機覆核、一頁判斷與三個追蹤問題。
