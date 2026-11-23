本文件中的標的、交易所與拓撲示例是合成驗收資料，不描述私人持倉。

# 持倉與決策工作區重做

## Why

現站把每個快照全部欄位垂直攤開，10部位構成約6181px的買賣決策頁；回顧區從約5903px才開始。使用者不能快速辨識持倉、當時決策和後续結果。快照本身也尚無決策理由／回顧契約，不能只改CSS完成任務。

## What Changes

- 買賣決策預設目前持倉；一個部位一列，依標的分組，原10筆保持獨立。
- 可深連結的標的詳頁，同頁呈現持倉摘要、事件時間線、理由及回顧。
- 單一新增入口，預設截圖整理；沿既有主對話AI產生候選，網站增量核對保存，手動／CSV次要。
- 可選journal附加域只支援部位關聯、補記／決定／回顧、匯入收據；原records與計算器保留。
- 保存draft、scope/revision固定、重複重送、undo及旧client保護列為必要。
- 冗長工程說明、完整快照重複、備份／清空操作移至符合任務的次層，關鍵資料限制仍局部可見。
- 共用SaaS導航與responsive規則；原研究、比較、觀察、收藏和公司篩選不退化。

## Non-goals

不連交易所、不執行交易、不補造歷史、不做即時行情、FX或跨交易所衍生品會計；不加新AI provider、secret、R2、排程、框架或套件。不把設計提案當部署完成。

## Impact

影響App shell、LedgerWorkspace、SnapshotList、CompanyLedgerSummary、ReviewInsights以及小幅Worker state驗證／保存防護、backup/history、相關測試。資料管理需保留CSV與finance既有功能。不改原研究正文／來源快照／私人圖像內容。

介面設計見 `docs/UI-DESIGN-v4.md`；資料契約見 `docs/decision-workspace.md`。
