# 閱讀與查證介面契約 v3

2026-10-11。沿用白紙、深灰綠文字及一個綠色重點、既有字級與間距 tokens。公司概覽先回答生意與判斷，完整報告是閱讀主體；觀點、原始來源、算式及版本放在可選的次層。

## 技能與具體採用

已安裝並實際使用 [Impeccable](https://github.com/pbakaus/impeccable/tree/d631a8827f99414d2b6daba4ef08b7f8701751d7) 與 [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/67803eac81607188194aea9842a723b89326d90d)。安裝來源與檔案 hash 收據位於 owner workspace `evidence/uiux-v10-skill-review/installed-skills-provenance.json`。

Impeccable 採其 launcher-unavailable fallback，讀取現有產品脈絡及 layout/operate/craft-floor/clarify 參考；沒有執行下載 binary 或 hooks。UI UX Pro Max 實際執行本地 Python 設計資料與 Vue 搜尋，採閱讀型 grid、原生控制與語意元素。金融分類的行銷 hero/testimonials 建議不適合本產品，沒有採用。

## 閱讀操作

- 研究正文、重點與反證、依據与來源是同一基線的主要導航；「附錄與版本」是同列至少 44px 的按鈕。手機可換行，不能水平溢出。
- 展開附錄是文件流內的區塊，不遮蓋正文；可用 Escape 關閉並回到觸發按鈕。版本使用原生 select，附錄選擇後關閉。
- Loading 明確取代舊公司正文；失敗提供重試。返回和重新整理恢復 URL 指定的版本、頁籤、搜尋與篩選。
- 正文、表格、來源 fold、一般按鈕共用字體、色彩、間距與 focus。工程 hash/IDs/行號放在位置 fold；日期未知明寫未知。

## 來源與觀點

`SourceTrace` 在報告與公司觀點共用。每筆指定子主張綁 report SHA-256、實際章節 anchor、來源 ID、定位、角色、支持範圍及模型參數／結果 artifact。舊報告不能顯示另一版本的採用狀態。

公司角色與報告採用是不同維度。混合段落保留共同 view ID，逐卡標本公司為主體、供應／客戶背景、競爭比較或僅提及。沒有逐項對應只顯示尚未建立對應；不推論整篇來源都被採用、未用或核實。觀點搜尋範圍是轉述及標題，不稱全文搜尋。

## 關係圖

非互動連線先畫，互動標籤後畫；每個標籤是獨立有界 hitbox，依SVG實際像素與zoom維持至少44px；世界座標尺寸不能當CSS像素驗收。標籤彼此不重疊、避開節點，遠縮時可延伸拖移範圍。圖上實際 pointer、鍵盤與原生關係 select 須選中同 edge_id／parties／依據，尤其 Amazon–Anthropic 與 Amazon–OpenAI。登錄 fact_zh 標為「登錄事實摘要」，不冒充出版者逐字原文。

## 驗收範圍

本地與正式站分開收據；DOM／機制檢查不能替代 supported Chrome 實際點擊與像素檢查。桌面 1440/828 和手機 390/320、附錄操作、來源→報告→返回／重新整理、所有 Amazon 可見關係標籤與下拉對照都是必要項。只讀驗收不等於真人閱讀驗收，也不等於帳本写入／還原、真 touch 或已登入非 owner 權限測試。
