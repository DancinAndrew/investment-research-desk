本文件中的標的、交易所與拓撲示例是合成驗收資料，不描述私人持倉。

# 實作與驗收收尾

## 0. 基線
- [x] 建立隔離QA資料（合成10快照拓撲）；保存正式只讀基線摘要，不提交私人payload。

## 1. 資料與保存基礎（P0）
- [x] 實作純持倉／timeline projection，快照／records來源分開、不讀取寫入。
- [x] 可選journal positions/entries/intakes、validator、source null來源能力與identity参照契約。
- [x] 所有writer往返保全journal與既有切片；backup/history/restore相容；舊client缺域拒絕保護。
- [x] 共享保存context固定scope/revision；解決focus reload舊form、save error提早關閉。
- [x] 穩定intake ID/digest與保存結果未知的讀回核實；局部撤回／依賴保護。
- [x] meaningful tests：舊state roundtrip、10部位不合併、unknown不補、whole-state互保、CAS／identity／retry／undo。

## 2. 持倉閱讀流程（P0）
- [x] SaaS app shell及URL相容；desktop／mobile互動層級一致。
- [x] 持倉摘要列表、搜尋篩選排序、局部日期状态、空／載入／失敗。
- [x] 標的詳頁含部位選擇、摘要、timeline、理由、回顧同頁；日期unknown區。
- [x] 後記理由、後續回顧、來源詳情與原研究版本連結。
- [x] 公司「我的紀錄」接共用projection；關聯不足不猜股票代幣公司映射。

## 3. 新增與核對（P0）
- [x] 单一新增composer；主對話截圖AI接力指引、結果檔／文字入口；manual／CSV次要。
- [x] 本地貼／選圖預覽、格式大小限制、hash配對、無圖fallback；無新上傳／模型端點。
- [x] 專用候選parser與逐筆型別核對；unknown、部分合法、unsupported product與原records分流。
- [x] 同檔重送與跨圖重疊、new/update position明選、来源增補／digest。
- [x] 保存前摘要与单次CAS；成功／失败／冲突／结果未知分明；返回不丟同分頁draft。

## 4. 全產品收尾（P1，屬完整交付）
- [x] 全域回顧直接列決策／回顧，不重複全快照；保留原filter與真成交統計範圍。
- [x] 手動估值移至資金績效；缺口局部揭露，原計算口徑不擴張。
- [x] 資料管理搬入匯入歷史、JSON backup、history、restore、danger區；browser backup另列。
- [x] 按DESIGN文案清單移除冗文與重複action；保留本機QA環境識別。
- [x] 搜尋／產業／上市市場／收藏組合、比較、觀察、報告及source返回不退化。

## 5. 驗收與交付
- [x] `node --test tests/*.test.mjs`、`npm run build`、`git diff --check`；只有實際配置的type checker才宣稱通過。
- [x] 現有OpenSpec CLI可用時strict validate本change；不為此自行安裝依賴。
- [x] Supported Chrome真頁／本機隔離UI實測桌面1440×900、390×844、320×740、鍵盤、200%文字、reduced motion。
- [x] 整批檢視、修復、最多一輪確認；DOM機制與pixels、真touch、正式寫入各自記錄。
- [x] 核對Git diff及靜態包無私人圖／備份／payload／token／Library ID／QA DB；原研究字節／hash不改。
