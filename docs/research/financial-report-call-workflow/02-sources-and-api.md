# 台美股來源與 API 決策

查證日 **2026-10-12**。價格是當日官方頁面所示，非報價或已購方案；coverage、使用權與實測成功分開。所有服務均未開通。詳細官方入口及查看範圍另見[查證紀錄](07-research-log.md)。

## 兩條來源路徑

| 層次 | 美國 | 台灣 | 可支持與限制 |
|---|---|---|---|
| 首次公布數字 | 公司IR release／CFO、SEC 8-K附件 | 公司IR／MOPS重大訊息、自結公告 | 先公布不等於已審計；release和正式財報需分型 |
| 正式報表 | SEC 10-Q/10-K與XBRL | MOPS財報／Inline XBRL、公司正式財報 | 財季、公告日、修訂、幣別、單位與附註仍需核對 |
| 法說與展望 | 公司IR準備稿、簡報、官方寄存transcript／音訊 | MOPS法說資料、TWSE/TPEx影音、公司IR | 不保證每季都有法說或逐字稿；問題與回答不可混成承諾 |
| 價量／事件 | 另選授權行情；本輪未評估美股新行情API | TWSE/TPEx資料與FinMind輔助 | 股價／法人流是觀察；異常不代表因果、內線或「主力」 |

### 美國官方：SEC + IR

[SEC API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) 無API key，提供 submissions、companyfacts、companyconcept與frames。submissions主檔至少最近一年或1,000筆（取較多），更早資料由files索引取回。XBRL主要是標準taxonomy、整體申報實體，不能包辦所有自訂KPI／分部／non-GAAP。frames按曆季聚合最新近似期間，不能取代公司財季或point-in-time。無CORS，未來由本機／後端取得。[官方存取政策](https://www.sec.gov/about/developer-resources)上限每位使用者合計10 requests/s；本計畫擬採1–2/s共用佇列及有效User-Agent，這是保守設計值。

原件以accession與hash保留；新10-Q/A、10-K/A或重列版另存。[EDGAR存取說明](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)載有接收後更正／刪除及索引更新機制，不能視來源永不變。公司IR發布可能早於申報，兩個時間都保留。官方表示API通常快速更新、bulk nightly；不把典型延遲當SLA。

### NVDA 最近八季：已查到什麼

[官方archive](https://investor.nvidia.com/financial-info/quarterly-results/default.aspx)已透過正常瀏覽器選年度並展開八季。下表八份release已開啟；每季archive另列CFO、slides/presentation、10-Q或10-K、webcast。除了樣本外，附件未逐份全文核證。

| 財季 | 財季末 | release日／原文 | IR transcript |
|---|---|---|---|
| FY25Q3 | 2024-10-27 | [2024-11-20](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-third-quarter-fiscal-2025) | 本次archive未列，不能推定別處不存在 |
| FY25Q4 | 2025-01-26 | [2025-02-26](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2025) | 本次archive未列 |
| FY26Q1 | 2025-04-27 | [2025-05-28](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2026) | 有連結，未全文查核 |
| FY26Q2 | 2025-07-27 | [2025-08-27](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2026) | 有連結，未全文查核 |
| FY26Q3 | 2025-10-26 | [2025-11-19](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-third-quarter-fiscal-2026) | 有連結，未全文查核 |
| FY26Q4 | 2026-01-25 | [2026-02-25](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2026) | 有連結，未全文查核 |
| FY27Q1 | 2026-04-26 | [2026-05-20](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2027) | 有連結，未全文查核 |
| FY27Q2 | 2026-07-26 | [2026-08-26](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027) | 16頁PDF樣本實開 |

FY27Q2 [transcript樣本](https://s201.q4cdn.com/141608511/files/content_files/TRANSCRIPT_-NVIDIA-Corp-NVDA-US-Q2-2027-Earnings-Call-26-August-2026-5_00-PM-ET.pdf)是 **FactSet CallStreet Corrected Transcript**，應分類為官方IR寄存的第三方校訂稿。文內對webcast重製／轉錄有書面同意限制，replay只到下一季call；8個webcast連結不等於8份可取得音訊，更不是ASR授權。缺少兩季Q&A時，仍可完成八季財務與CFO說法追蹤，但只能寫「六季有逐字稿入口、兩季缺Q&A來源」，不能交付「完整八季法說對照」。

已開的 [FY27Q2 10-Q](https://s201.q4cdn.com/141608511/files/doc_financials/2027/NVDA-2027-Q2-10Q-Final-including-exhibits.pdf) 61頁與[presentation](https://s201.q4cdn.com/141608511/files/doc_financials/2027/Q227/NVDA-F2Q27-Quarterly-Presentation-final-1.pdf)17頁，只證明樣本取得。值得納入真實驗收案例：FY27Q1有分類變動；FY27Q2 release說明non-GAAP自FY27起包含SBC，歷史比較也更新。必須區分原報／重編定義，不能直接串舊EPS或分部曲線。

### 台灣官方：MOPS + 交易所 + 公司IR

[TWSE XBRL說明](https://www.twse.com.tw/zh/listed/xbrl.html)及[MOPS整批入口](https://mopsov.twse.com.tw/mops/web/t203sb02)可見多年季度目錄（本次看見民國102–115年），支持八季規劃但未逐包驗證。[單公司入口](https://mopsov.twse.com.tw/mops/web/t203sb01)、[重大訊息](https://mopsov.twse.com.tw/mops/web/t05st01)、[法說一覽](https://mopsov.twse.com.tw/mops/web/t100sb02_1)本次只核到表單／選項；[更補正](https://mopsov.twse.com.tw/mops/web/t56sb31_q1)逾時，不能聲稱已取完整修訂史。

[TWSE法說FAQ](https://dsp.twse.com.tw/public/static/downloads/listedCompany/%E4%B8%8A%E5%B8%82%E5%85%AC%E5%8F%B8%E8%BE%A6%E7%90%86%E6%B3%95%E4%BA%BA%E8%AA%AA%E6%98%8E%E6%9C%83%E5%8F%83%E8%80%83%E5%95%8F%E7%AD%94%E9%9B%86%2811404%29_20250502092113.pdf)第7–8頁說明簡報與部分影音申報、至少一年保存；一年不足以保證八季音訊，更沒有證據顯示全市場每季必有逐字稿。[WebPro條款](https://webpro.twse.com.tw/WebPortal/terms)區分AI輔助摘要與原片，引用／轉載另有權利人同意要求。[TPEx影音入口](https://www.tpex.org.tw/zh-tw/about/company/media/investor-conference.html)與FAQ本次403，不把上市細則自動外推上櫃。

[TWSE OpenAPI](https://openapi.twse.com.tw/)／[TPEx OpenAPI](https://www.tpex.org.tw/openapi/)本次工具只得Swagger外框；規格解析／網路取回受限。尚未確認端點的8季歷史、限速、快取與再展示權；不因叫OpenAPI就承諾任意下載。P0台股備案先走人工可讀官方文件與清楚缺件記錄。

### 台積電後續台股示範

截至查證日，[2026Q3頁](https://investor.tsmc.com/english/quarterly-results/2026/q3)仍列10/15待舉行，最近八季窗口是 **2024Q3–2026Q2**。下列八頁均已讀到財表、簡報、營運報告、release、transcript與重播入口，以及Actual／Guidance表；不代表八份音訊已播放或全文皆核。

[2024Q3](https://investor.tsmc.com/english/quarterly-results/2024/q3) · [2024Q4](https://investor.tsmc.com/english/quarterly-results/2024/q4) · [2025Q1](https://investor.tsmc.com/english/quarterly-results/2025/q1) · [2025Q2](https://investor.tsmc.com/english/quarterly-results/2025/q2) · [2025Q3](https://investor.tsmc.com/english/quarterly-results/2025/q3) · [2025Q4](https://investor.tsmc.com/english/quarterly-results/2025/q4) · [2026Q1](https://investor.tsmc.com/english/quarterly-results/2026/q1) · [2026Q2](https://investor.tsmc.com/english/quarterly-results/2026/q2)。

樣本2024Q3／2026Q2 transcript已開啟；[Q2稿](https://investor.tsmc.com/english/encrypt/files/encrypt_file/reports/2026-08/3e494f0c14dd0890f897aa044415e21d93486cc4/TSMC%202Q26%20Transcript.pdf)是LSEG編輯稿，事件日期2026-07-16，另有再出版／再散布限制。中文季頁指同一英文稿，不能宣稱中文逐字稿存在。季頁4頁未審財表與[正式半年財報及核閱報告](https://investor.tsmc.com/sites/ir/financial-report/2026/TSMC%202026Q2%20Consolidated%20Financial%20Statements_E_2.pdf)65頁需分開，URL月份也不是修訂時間。樣本給出的稿件時效不是全市場SLA。

## API 決策表

| 分類／服務 | 可做的事 | 金鑰／费用／額度 | 現階段決定與啟用前步驟 |
|---|---|---|---|
| 立即必要的資料主幹：SEC／公司IR／MOPS | 財務、發言及原始證據 | SEC無key、無資料API費；IR/MOPS公開閱讀無新訂閱，但權利與可取得範圍逐檔核 | 採用來源方法；未來導入先選單公司白名單、核條款／時間／hash，無需現在開服務 |
| 可替代：FinMind | 台股財表、月營收、價量／法人流便利查詢 | 有免費層及付費層；token需註冊驗證信箱，詳下表 | P3才考慮。先確定用途屬非商用或商用、特定dataset權限及展示權，再由使用者選方案 |
| 可替代：ASR API | 缺官方文字時轉錄合法音檔 | OpenAI需API帳戶／金鑰與billing；費用如下，帳戶rate未知 | 先核音源權利、人工／本機替代、時長和預算；同意後設專案上限與最小權限key，不能在前端存 |
| Optional：TradingView原生提醒 | 用可量化條件提醒人工回查 | 免費有限；付費與市場資料另計；webhook需2FA | 先用人可讀提醒。若要MCP／webhook整合，另定授權用途、OAuth及接收端；本輪不建告警 |
| Optional：Quartr API | transcript/audio／簡報等補件候選 | [官方價格頁](https://quartr.com/pricing)未列可核單價，需報價；API key／額度／實際權利未核 | 只有NVDA缺的兩季完整Q&A值得付費補時再評估；未驗證該兩季coverage，不聯絡sales |
| Optional：新LLM API、Claude／NotebookLM品牌流程 | 可作已授權資料的整理工具 | 本輪未選API產品，費率／保留政策／帳戶額度未查定 | 不屬P0必要；沿既有本機研究與對話工具，不能把現有訂閱推定為API額度 |

### FinMind：便利層，不能取代公告時間證據

[基本面文件](https://finmind.github.io/tutor/TaiwanMarket/Fundamental/)載台股損益、資產負債、現金流與月營收多年度歷史，schema的財報date並不提供完整公告／修訂時間；月營收 `create_time` 只自2026-04-21記錄且為入庫日。每季EPS保留當時原值，配股時不可直接相加。未見法說逐字稿dataset；美國目錄不等於完整美股財報供應。需用MOPS/IR補原始日期與版本。

[官方價格](https://finmind.github.io/Pricing/)（TWD）與使用範圍：

| 方案 | 月繳 | 年繳 | 每小時上限 | 用途 |
|---|---:|---:|---:|---|
| Free | 0 | 0 | 300；註冊600 | 非商用 |
| Backer | 699 | 5,499 | 1,600 | 非商用 |
| Sponsor | 999 | 8,888 | 6,000 | 非商用 |
| Sponsor Pro | 3,330 | 29,620 | 20,000 | 商用 |

全市場批次與還原股價等依資料集等級；付費並不授予原始資料再散布／鏡像API或對外直接展示即時資料的權利。需標示來源；owner-only與個人使用仍須按[授權說明](https://finmind.github.io/Disclaimer/)和實際用途核定，不能只看是否收費。遇[402額度／4xx封鎖政策](https://finmind.github.io/BanIPPolicy/)應停止或退避，不重試無效token。

### TradingView：MCP 新介面與條款需一起看

[2026-10-12方案頁](https://www.tradingview.com/pricing/)年繳畫面標special price：Essential $12.95/月（$155.40/年）、Plus $29.95/月、Premium $59.95/月、Ultimate $199.95/月；稅與交易所即時數據可能另計。Basic價格提醒3個、技術提醒0個；付費提醒额度依方案提高。不是所有交易所資料都隨訂閱包含。

[官方MCP Beta](https://www.tradingview.com/mcp/docs)已存在：Essential以上（trial不含）、OAuth2.1、約100 requests/min/user；提供行情、財務與文件工具。`create_alert`只支援簡單價格條件，不支援技術／複合條件或webhook。舊FAQ的「無資料API」不能概括所有新介面；broker REST、MCP及webhook是不同東西。

[條款第3節](https://www.tradingview.com/policies/)仍限制non-display、algorithmic decision-making等用途；與MCP研究工具的深度加工、長期快取／再發布邊界，本次公開文件未解決。**先列授權待澄清，不能把MCP当無限制行情庫。** [Webhook說明](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/)另有2FA、80/443、3秒timeout及可能投遞失敗限制。即使以後採用，也只排人工閱讀提醒，不進交易或自動thesis裁決。

### 音訊轉錄的可替代路線

先選官方可用文字；沒有文字時，可人工聽取並寫帶時間定位的筆記（不是逐字稿），或使用已核授權的本機ASR（設備、模型與品質成本本輪未測）。雲端候選按當日 [OpenAI speech-to-text文件](https://developers.openai.com/api/docs/guides/speech-to-text)：`gpt-transcribe`，檔案25MB上限；講者分離另有diarize選項，字級時間戳支援依模型不同，不能混用參數。中英混語、專名、數字與Q&A講者仍須覆核，無可用confidence就記未知。

[官方價格頁](https://developers.openai.com/api/docs/pricing)列 `gpt-transcribe`估計$0.0045/分鐘；`gpt-4o-transcribe` $0.006、mini $0.003。純示例：60分鐘×8場×$0.0045＝**$2.16轉錄費**；這不是NVDA實際時長或總成本，不含音源權利、重跑、文字模型、儲存與人工核對。模型snapshot、實際帳戶tier／rate、資料留存設定與音源允許上傳，須啟用前核定；本輪沒有上傳音訊或呼叫付費API。

## Request-safe 取得規則

每個來源先記allowlist、文件型態與權利；優先官方明列下載／API，無API時只在允許範圍內正常閱讀或人工匯入。單公司小批、相同原件快取、ETag／Last-Modified可用則使用；錯誤保留完整狀態。429依Retry-After退避，5xx最多兩次有間隔重試，401/403／paywall／驗證立即停來源，不換IP、冒用身份或找隱藏端點。未知速率先序列少量請求，不能把保守值當官方許可。所有原件／短引的保存與展示政策逐來源核對；無權利則只留合法可用的metadata／原創摘要／連結。
