# 研究版本與私人判斷的資料契約

本文件對應2026-10-11使用者授權A1–A3；實作與介面驗收完成後才標示可用。


## 保存的內容

觀察決定：id、date、action（watch/no_action/reconsider）、reason、invalidation、report_id、report_sha256、claim_ids、status（active/archived）、created_at、updated_at。日期用YYYY-MM-DD，文字為原樣資料由Vue逃逸顯示，不作HTML。所選report與SHA必須完全吻合本次已登錄registry，claim_ids不可借用其他公司的主張。

比較設定：id、name、reports（2–4個精確report_id/SHA）、questions（需求與變現、現金、資本投入、競爭、價格的固定問題ID）、created_at。保留當時選擇；「改看最新版」先改畫面選擇，再由使用者另存設定，不覆寫舊設定。比較格引用既有研究文本，不產生新的AI投資判斷。

重新核對：id、observation_id、date、目標report_id/SHA、outcome（pending/supported/weakened/mixed）、note、created_at。目標與原決定需同公司、時間不早於原版；核對保存一次版本，不會自動替下一個新版本給結論。

## 缺資料與口徑

同一天整理的不同版可能使用同一財務季；版本日期不是財務期間。NVDA FY27 Q2截止2026-07-26，AMZN 2026Q2截止2026-06-30。沒有可靠財務期標記的舊版顯示未登錄，不硬推同期間。題目沒有對應主張的格子提供完整原版入口並保持缺資料，不套用別版答案。

新報告與舊報告的逐主張差異顯示文字、條件、失效條件與來源定位變化。內容不變但正文hash不同，仍列正文有改版、需要回讀，不能把全文件改版當所有主張皆被新證據推翻。報告移除舊claim ID時列已移除，不能將其當反證成立。

## 身份、保存與復原

沿用/api/ledger、owner_scope、expected_revision。schema_version=1新增可省略research區，既有records/quotes/reviews不改。GET空資料不建立任何DB紀錄。歷史trigger保存完整payload，研究修改同樣可回查。交易清空保留research；完整還原預覽則明示交易/價格/回顧/觀察/比較/核對全部數量並下載目前備份。

私人輸入不上傳第三方。全站登錄研究仍是部署時固定快照；重新載入不取得新IR、SEC、或X，也不啟動雲端研究。真資料只在使用者明確按儲存/套用後寫入。
