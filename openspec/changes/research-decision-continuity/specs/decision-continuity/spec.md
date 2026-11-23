## ADDED Requirements

### Requirement: 保存未交易決定與當時研究
系統 SHALL 保存觀察、未採取行動、改變想法的日期、理由、失效條件及精確研究版本；既有交易引用仍可回查原版。

#### Scenario: 新研究不覆蓋原判斷
- WHEN 使用者保存AMZN v2觀察後網站更新到v3
- THEN 原決定仍連v2及其SHA，並可查看兩版差異

### Requirement: 可重用問題與可追溯比較
系統 SHALL 保存2至4份研究版本及固定問題，每格連到原報告段落與依據；財務期間不可混同版次日期。

#### Scenario: 跨公司和跨版比較
- WHEN 選擇NVDA v6與AMZN v3，或AMZN v2與v3
- THEN 同一問題按各版原主張呈現，未知或缺資料標示，無推測排名

### Requirement: 更新後重新核對
系統 SHALL 顯示原決定所選主張相對最新部署報告的變更與來源，使用者可另存檢查結果和理由。

#### Scenario: 舊核對不冒充新版本結果
- WHEN 後續又部署新報告
- THEN 舊核對保留原target版本，新target顯示尚待核對

### Requirement: 舊帳本相容與身份隔離
系統 SHALL 讀取既有v1帳本且不自動寫入，新增資料沿用身份分区和CAS，未知字段/未登錄report SHA拒絕。

#### Scenario: 並行頁面修改
- WHEN 第二頁持舊revision或不同owner_scope儲存
- THEN 回409並保留第一頁資料

### Requirement: 可核對的CSV與帳務報酬
後續階段 SHALL 提供CSV預覽、對映、去重、確認、撤銷與匯出；完整帳務按可用資料計算，缺現金流/估值/匯率不得顯示完整報酬。

#### Scenario: 真帳本沒有資料
- WHEN 開啟空正式帳本
- THEN 顯示空狀態與補資料入口，無fixture、勝率或假績效

### Requirement: 雲端研究僅規劃
A7 SHALL 只交付資料來源、執行環境、成本與權限的可審閱規劃，不啟用新外部服務、背景研究或排程。
