# 驗收矩陣

以下是待開發功能的驗收規格，**全部尚未執行**。本次文件機械檢查另見[驗證紀錄](evidence/validation.md)。以固定合成資料／獲准官方樣本驗證，不載入真持倉或拿正式D1做測試。

| ID／階段 | 情境與方法 | 可接受結果／必要證據 |
|---|---|---|
| A01 P0 | 8個period×必備material coverage矩陣，逐檔核read spans | 分母固定8季；目錄、下載、片讀、全讀、語義覆核分開。6稿＋2缺不能呈現8稿完成；收據綁hash |
| A02 P0 | 財季末早於as-of、但發布晚於as-of；同日時間未知 | 排除未公開數字；日精度不通過盤中cutoff；actual保持null，不以季末當公布 |
| A03 P0 | 原公開版、後修訂版、現在才取得穩定舊申報 | 當時公開模式選符合cutoff版本，使用者當時模式只用原run；兩者不混。修訂不改舊pin |
| A04 P0 | 年／9M／單季，52/53週、不同分部、TWD/USD與non-GAAP定義 | 流量可比才推Q4，EPS／率／平均股數／存量禁止相減；不可比原因可見 |
| A05 P0 | 原始顯示值、scale、decimal、四捨五入、負值、zero denominator | 決定式重算和原表在公布精度容差內；殘差有解釋；缺值與除零為null，負數保留 |
| A06 P0 | 拆股前後EPS／平均稀釋股數與已重列數字 | corporate action只調整一次；share basis一致，不用期末股數計diluted EPS |
| A07 P0 | 100%關鍵quote、PDF連字與換行、翻譯、錯一個數字 | 原句精確match抽取文字；normalization可反向還原定位；OCR改字需原頁核；翻譯不是quote，錯值阻止接受 |
| A08 P0 | 準備稿、分析師問題、管理層回答與未知speaker | 問題不抽為承諾；speaker未知不猜；source類別區分官方自撰／第三方校訂／ASR |
| A09 P0 | 同一公告的IR、SEC、媒体轉引，與後續更正版 | upstream_group合一但保留文件版本；不把三份轉引當三票支持，不丟修訂 |
| A10 P0 | 語氣保守但數字不變；談不同時間／產品；本期未提及 | 只產生wording/omitted或不可比候選，不能自动判營運惡化、撤回或矛盾 |
| A11 P0 | target期限到但未披露、區間部分達成、延後、重新定義 | 使用not_disclosed/pending/partly_met/disputed；原deadline/KPI不被改寫；理由与可比actual來源完整 |
| A12 P0 | 無合格反方、最強反方與支持同上游 | 如實記缺口；不虛構反證。重大assessment由非原作者核來源與因果，保存範圍／時間／hash |
| A13 P0 | 新資料包進入，舊報告／觀察引用仍在 | 舊report/source pins完全不變；新claim不更動舊decision；未接受只顯示草稿 |
| A14 P0 | 公司頁→三子頁→quote→原件→返回，手機／桌面／鍵盤／reload | 狀態、period、as-of和公司篩選可回復；不存在來源清楚拒絕；不需新增主選單 |
| A15 P0 | 空公司、缺一季、全部無資料、404/401/403/429/5xx/timeout | 正確空／partial／blocked，不顯示0或另公司資料；403不繞過；有限retry與取消收據 |
| A16 P0 | 快速切公司、晚到response、manifest/hash不一致 | 舊response不能污染新公司；不一致拒載並保留原有效版本，不混拼新舊資料 |
| A17 P0 | 相同source與設定重跑；一頁修訂；parser升版 | 決定式facts／公式結果相同；只使依賴項失效；LLM輸出不保證逐字一致但每次都保存。建立dependency diff |
| A18 P0 | 成本80%/100%、API额度不足、取消、2次retry已用完 | 達閾值按規格提示／停run；保存partial；所有worker用量合計，未知usage不填0；無自動換供應商 |
| A19 P0 | 權利未清、只可鏈接來源、付費稿、來源內含工具指令 | export只保留allowed fields；不把完整稿打包入dist／Git；來源指令永不執行；檢查原始HTML／JSON payload |
| A20 P1 | 合成private state加月review，兩頁衝突、舊client、backup/restore | scope/CAS、完整歷史與舊域roundtrip保全；缺新域的舊writer不能靜默刪資料；變更需明確保存 |
| A21 P1 | 台股正式／自結／未審表、累計現金流、中文入口英文稿、無稿公司 | 文件分型正確，MOPS時間優先；無逐字稿保留缺件／合法ASR選項，不能把英文稿稱中文稿 |
| A22 P1 | 合法ASR合成含數字／產品名／中英混語／問答 | 關鍵數字、人名、單位與speaker全人工抽驗或逐項覆核；低信心不出確定target；保存原音定位及修正diff |
| A23 P1–2 | 月底新資料、月後資料、原thesis與新判讀 | 四軸baseline固定；月後資訊獨立；事前與事後標明；下月工作可逐項回查問題與完成條件 |
| A24 P2 | 三情境相同公式、缺税／股數、負EPS、不存在的共識 | formulas重算且每input有類型／時間／來源；缺值停相應输出；负EPS不乘PE產假合理價；不編共識或情境機率 |
| A25 P3 | 股價未復權、停牌、缺20日、事件盤後、法人淨買 | 不可比拒算；日期正確對交易session；觀察與推測分開，无主力標籤或自動交易 |
| A26 P3 | 若採webhook：重複、延遲、失敗、未知觸發來源 | 去重、記trigger/received時間、快速ack及限次處理；只進人工待核；未驗來源不給外部寫thesis權 |

## 品質門檻與可重現交付

P0接受需：所有展示關鍵數字／引用可定位並通過對應機械檢查；沒有未解的重大單位／時間／引用錯誤；研究者核對主判斷、範圍與最強反方；缺件只限制相應主張。來源完整率不足不應卡住已有證據支持的限定結果，但必須阻止「八季完整」等不實狀態。

檢索另用預先凍結的小型金標（建議20題，含5題無答案／缺件、5題跨期或重列）。記Recall@k、quote precision、abstention、漏重要反方數；所有呈現引用須正確，重大答案的原文定位不得遺漏。小樣本結果只代表該示範；不能推論任意公司或獲利。top-k召回與閱讀coverage兩個指標獨立。

每次run交：input/source manifest、schema/parser/model/prompt版本、period/coverage、accepted与rejected claims、算式與results、精確檢查命令／環境、錯誤／修正／重試、使用量、review receipt和output hash。原件hash驗身份；固定算式重算驗數學；獨立語義驗來源支持；UI驗可用性；預測成效本計畫未驗。不得把其中一種PASS擴稱全部完成。
